import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const officialHosts = new Set(['pmbusprod.wpenginepowered.com', 'www.smbus.org'])

/** @typedef {{ id: string, downloadUrl: string, fileName: string, bytes: number, sha256: string }} Specification */

/** @param {string} repoRoot */
export async function loadSpecifications(repoRoot) {
  const manifestFile = path.join(repoRoot, 'document/specifications.json')
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
  const documents = manifest?.documents
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new Error('规范清单必须包含至少一份文档')
  }

  /** @type {Map<string, Specification>} */
  const entries = new Map()
  const fileNames = new Set()
  for (const entry of documents) {
    if (typeof entry?.id !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(entry.id)) {
      throw new Error('规范清单中的 ID 无效')
    }

    const { id, downloadUrl, fileName, bytes, sha256 } = entry
    if (entries.has(id)) throw new Error(`重复的规范 ID：${id}`)
    if (typeof fileName !== 'string' || !/^[\w][\w .(),-]*\.pdf$/i.test(fileName)) {
      throw new Error(`${id} 的 PDF 文件名无效`)
    }
    if (fileNames.has(fileName.toLowerCase())) throw new Error(`重复的规范文件名：${fileName}`)

    const url = typeof downloadUrl === 'string' ? URL.parse(downloadUrl) : null
    if (
      !url ||
      url.protocol !== 'https:' ||
      !officialHosts.has(url.host) ||
      url.username ||
      url.password
    ) {
      throw new Error(`${id} 需要官方 HTTPS 下载地址`)
    }
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`${id} 的文件大小无效`)
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error(`${id} 的 SHA-256 无效`)
    }

    entries.set(id, { id, downloadUrl: url.href, fileName, bytes, sha256 })
    fileNames.add(fileName.toLowerCase())
  }
  return entries
}

/**
 * 使用 curl 读取系统的 HTTPS 代理设置。当前官方 URL 均直接提供 PDF，
 * 不自动跟随跳转，以免从清单以外的站点获取规范。
 * @param {Specification} entry
 */
async function downloadPdf({ id, downloadUrl, bytes }) {
  const { stdout } = await exec(
    'curl',
    [
      '--disable',
      '--fail',
      '--silent',
      '--show-error',
      '--globoff',
      '--proto',
      '=https',
      '--max-time',
      '30',
      '--max-filesize',
      String(bytes),
      '--write-out',
      '%{http_code}',
      '--',
      downloadUrl,
    ],
    { encoding: 'buffer', maxBuffer: bytes + 3 },
  ).catch((error) => {
    if (error.code === 'ENOENT') throw new Error('下载规范需要 curl。请安装 curl 后重试。')
    const details =
      error.stderr?.toString().split('\n', 1)[0].trim() ||
      `curl 退出状态 ${error.code ?? error.signal}`
    throw new Error(`下载 ${id} 失败。${details}`)
  })
  const status = stdout.subarray(-3).toString('ascii')
  if (status !== '200') throw new Error(`下载 ${id} 失败。官方地址返回 HTTP ${status}。`)
  return stdout.subarray(0, -3)
}

/** @param {string} filePath */
async function fileStat(filePath) {
  try {
    return await fs.lstat(filePath)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

/** @param {Buffer} contents */
function checksum(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

/**
 * @param {string} repoRoot
 * @param {string} id
 * @param {(entry: Specification) => Promise<Buffer>} [download]
 */
export async function fetchSpecification(repoRoot, id, download = downloadPdf) {
  const entries = await loadSpecifications(repoRoot)
  const entry = entries.get(id)
  if (!entry) throw new Error(`未找到规范 ${id}。可用 ID：${[...entries.keys()].join('、')}`)

  let cache = repoRoot
  for (const segment of ['.cache', 'specifications']) {
    cache = path.join(cache, segment)
    await fs.mkdir(cache, { recursive: true })
    if (!(await fs.lstat(cache)).isDirectory()) {
      throw new Error(`规范缓存必须是普通目录：${cache}`)
    }
  }

  const target = path.join(cache, entry.fileName)
  const existing = await fileStat(target)
  if (existing && !existing.isFile()) throw new Error(`规范缓存必须是普通文件：${target}`)
  if (existing?.size === entry.bytes && checksum(await fs.readFile(target)) === entry.sha256) {
    return target
  }

  const contents = await download(entry)
  if (contents.length !== entry.bytes) throw new Error(`下载的文件大小与清单不符：${entry.id}`)
  if (checksum(contents) !== entry.sha256) throw new Error(`下载的 SHA-256 与清单不符：${entry.id}`)

  // 在同一文件系统中写完再替换，下载或写入中断时保留原缓存。
  const tempDir = await fs.mkdtemp(path.join(cache, '.download-'))
  try {
    const tempFile = path.join(tempDir, entry.fileName)
    await fs.writeFile(tempFile, contents)
    await fs.rename(tempFile, target)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
  return target
}

/** @param {string[]} args */
async function main(args) {
  const repoRoot = fileURLToPath(new URL('../', import.meta.url))
  const [command, option, id] = args
  if (command === 'check' && args.length === 1) {
    const entries = await loadSpecifications(repoRoot)
    console.log(`已校验 ${entries.size} 份规范的下载地址和清单字段`)
  } else if (command === 'fetch' && option === '--id' && id && args.length === 3) {
    console.log(await fetchSpecification(repoRoot, id))
  } else {
    throw new Error('用法：npm run specs:check 或 npm run specs:fetch -- --id <id>')
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
