import { Buffer } from 'node:buffer'
import path from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, gzip } from 'node:zlib'
import { bold, dim, green } from 'ansis'
import Debug from 'debug'
import { formatBytes } from '../utils/format'
import { noop } from '../utils/general'
import { logger } from '../utils/logger'
import { prettyFormat } from '../utils/package'
import type { OutputAsset, OutputChunk, Plugin } from 'rolldown'

const debug = Debug('tsdown:report')
const brotliCompressAsync = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

const RE_DTS = /\.d\.[cm]?ts$/

interface SizeInfo {
  filename: string
  dts: boolean
  isEntry: boolean
  raw: number
  gzip: number
  brotli: number
  rawText: string
  gzipText: string
  brotliText: string
}

export function ReportPlugin(cwd: string, cjsDts?: boolean): Plugin {
  return {
    name: 'tsdown:report',
    async writeBundle(options, bundle) {
      const outDir = path.relative(
        cwd,
        options.file
          ? path.resolve(cwd, options.file, '..')
          : path.resolve(cwd, options.dir!),
      )

      const sizes: SizeInfo[] = []
      for (const chunk of Object.values(bundle)) {
        const size = await calcSize(chunk)
        sizes.push(size)
      }

      const filenameLength = Math.max(
        ...sizes.map((size) => size.filename.length),
      )

      // padding rawText, gzipText, brotliText to the same length
      const rawTextLength = Math.max(
        ...sizes.map((size) => size.rawText.length),
      )
      const gzipTextLength = Math.max(
        ...sizes.map((size) => size.gzipText.length),
      )
      const brotliTextLength = Math.max(
        ...sizes.map((size) => size.brotliText.length),
      )

      let totalRaw = 0
      for (const size of sizes) {
        size.rawText = size.rawText.padStart(rawTextLength)
        size.gzipText = size.gzipText.padStart(gzipTextLength)
        size.brotliText = size.brotliText.padStart(brotliTextLength)
        totalRaw += size.raw
      }

      // sort
      sizes.sort((a, b) => {
        // dts last
        if (a.dts !== b.dts) return a.dts ? 1 : -1
        // entry first
        if (a.isEntry !== b.isEntry) return a.isEntry ? -1 : 1
        // otherwise, sort by brotli size descending
        return b.brotli - a.brotli
      })

      const formatLabel = prettyFormat(cjsDts ? 'cjs' : options.format)

      for (const size of sizes) {
        const filenameColor = size.dts ? green : noop

        logger.info(
          formatLabel,
          dim(`${outDir}/`) +
            filenameColor((size.isEntry ? bold : noop)(size.filename)),
          ` `.repeat(filenameLength - size.filename.length),
          dim`${size.rawText} │ gzip: ${size.gzipText} │ brotli: ${size.brotliText}`,
        )
      }

      const totalSizeText = formatBytes(totalRaw)
      logger.info(formatLabel, `${sizes.length} files, total: ${totalSizeText}`)
    },
  }
}

async function calcSize(chunk: OutputAsset | OutputChunk): Promise<SizeInfo> {
  debug(`Calculating size for ${chunk.fileName}`)

  const content = chunk.type === 'chunk' ? chunk.code : chunk.source

  const raw = Buffer.byteLength(content, 'utf8')
  const gzip = (await gzipAsync(content)).length
  const brotli = (await brotliCompressAsync(content)).length

  return {
    filename: chunk.fileName,
    dts: RE_DTS.test(chunk.fileName),
    isEntry: chunk.type === 'chunk' && chunk.isEntry,
    raw,
    rawText: formatBytes(raw),
    gzip,
    gzipText: formatBytes(gzip),
    brotli,
    brotliText: formatBytes(brotli),
  }
}
