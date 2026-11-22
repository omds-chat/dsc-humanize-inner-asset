/**
 * 包层清单(L3 manifest.json)的生成与校验。
 *
 * 消费方(dsc-humanize 资产市场)安装一个资产包时先取「包目录/manifest.json」,再按清单里以
 * 「<版本>/」开头的条目逐个取件、比对 SHA-512;没有清单就整包拒绝(manifest-missing)。
 * 因此清单放在包目录,路径相对包目录,覆盖 versions.json 与各版本目录下的全部包内文件。
 *
 * 本模块只生成与校验清单,不签名。清单签名是 manifest.json.sig,与非清单的 .json 走同一条
 * 发布流程命令(openssl cms -sign -binary -md sha512 -outform DER -nocerts -noattr),由 CI 用
 * 合集 EEC 私钥对 dist/ 内的 .json 一并生成;本地没有私钥时清单保持未签名,校验只警告。
 *
 * 清单覆盖范围是包目录内除 manifest.json 与 manifest.json.sig 之外的全部文件,哈希算法
 * 全组织统一为 SHA-512,条目按 path 字典序排列,同一份内容总是同一串字节。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 清单文件名与签名后缀,与消费方读取口径一致 */
export const MANIFEST_FILE = 'manifest.json'
export const MANIFEST_SIG_SUFFIX = '.sig'
export const MANIFEST_SIG_FILE = MANIFEST_FILE + MANIFEST_SIG_SUFFIX
/** 清单结构版本;消费方按 schemaVersion 判定形状,不认其他字段 */
export const MANIFEST_SCHEMA_VERSION = 1

/** 清单不登记的两个文件:清单自身与其签名 */
const MANIFEST_SELF = new Set([MANIFEST_FILE, MANIFEST_SIG_FILE])
/** 清单条目的哈希格式:128 位小写十六进制 */
const SHA512_PATTERN = /^[0-9a-f]{128}$/
const NEWLINE = String.fromCharCode(10)

/* ---------- 通用工具 ---------- */

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** 递归列出目录内的普通文件,返回相对该目录的正斜杠路径,按字典序排序 */
function listFilesRecursive(dir, prefix = '') {
  const names = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : prefix + '/' + entry.name
    if (entry.isDirectory()) names.push(...listFilesRecursive(join(dir, entry.name), rel))
    else if (entry.isFile()) names.push(rel)
  }
  return names.sort()
}

/** 计算文件字节的 SHA-512,小写十六进制 */
function sha512OfFile(path) {
  return createHash('sha512').update(readFileSync(path)).digest('hex')
}

/**
 * 列出包目录里需要进清单的文件:除清单自身与其签名之外的全部文件。
 * @param {string} packageDir 包目录
 * @returns {Array<string>} 相对包目录的正斜杠路径,按字典序排序
 */
export function listManifestFiles(packageDir) {
  return listFilesRecursive(packageDir).filter((rel) => !MANIFEST_SELF.has(rel))
}

/**
 * 把包目录的文件列表转成清单条目:path、sha512 与 bytes,按 path 字典序排列。
 * @param {string} packageDir 包目录
 * @param {Array<string>} [files] 相对路径列表,缺省时重新枚举
 * @returns {Array<{path: string, sha512: string, bytes: number}>}
 */
export function manifestEntries(packageDir, files) {
  const list = files ?? listManifestFiles(packageDir)
  const entries = []
  for (const rel of list) {
    const abs = join(packageDir, ...rel.split('/'))
    if (!isFile(abs)) continue
    entries.push({ path: rel, sha512: sha512OfFile(abs), bytes: statSync(abs).size })
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return entries
}

/* ---------- 生成 ---------- */

/**
 * 写一个包目录的清单。
 *
 * 内容没变化时不重写文件,避免让本来有效的签名失效;内容变化时删掉旧签名,
 * 让「缺签名」在下一步显式暴露,而不是留下一个与清单对不上的签名。
 * @param {object} input
 * @param {string} input.packageDir 包目录
 * @param {string} input.packageRel 包目录相对合集根的路径,只用于报告
 * @param {Array<object>} input.entries 清单条目
 * @param {(code: string, message: string, path: string) => void} [input.warn] 警告回调
 * @returns {{packageRel: string, files: number, changed: boolean}}
 */
export function writePackageManifest({ packageDir, packageRel, entries, warn }) {
  const text = JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION, files: entries }, null, 2) + NEWLINE
  const manifestPath = join(packageDir, MANIFEST_FILE)
  const previousText = isFile(manifestPath) ? readFileSync(manifestPath, 'utf8') : null
  const changed = previousText !== text
  if (changed) writeFileSync(manifestPath, text, 'utf8')

  const sigPath = join(packageDir, MANIFEST_SIG_FILE)
  if (changed && isFile(sigPath)) {
    rmSync(sigPath, { force: true })
    if (warn) {
      warn('MANIFEST_SIG_REMOVED',
        '清单内容已变化,已删除失效的 ' + packageRel + '/' + MANIFEST_SIG_FILE + ';发布流程会用合集 EEC 重新签名',
        packageRel + '/' + MANIFEST_SIG_FILE)
    }
  }
  return { packageRel, files: entries.length, changed }
}

/**
 * 为每个包目录生成清单。
 * @param {object} input
 * @param {string} input.root 合集根目录(构建时是输出目录)
 * @param {Array<{author: string, id: string}>} input.packages 已通过校验的包清单
 * @param {(code: string, message: string, path: string) => void} [input.warn] 警告回调
 * @returns {Array<{packageRel: string, files: number, changed: boolean}>}
 */
export function generatePackageManifests({ root, packages, warn }) {
  const summaries = []
  for (const item of packages) {
    const packageRel = 'assets/' + item.author + '/' + item.id
    const packageDir = join(root, 'assets', item.author, item.id)
    const entries = manifestEntries(packageDir)
    if (entries.length === 0) {
      throw new Error('包目录里没有可进清单的文件:' + packageRel)
    }
    summaries.push(writePackageManifest({ packageDir, packageRel, entries, warn }))
  }
  return summaries
}

/* ---------- 签名 ---------- */

let opensslUsable = null

/** openssl 是否可用;结果缓存,避免逐份清单重复探测 */
export function hasOpenssl() {
  if (opensslUsable !== null) return opensslUsable
  try {
    const result = spawnSync('openssl', ['version'], { encoding: 'utf8' })
    opensslUsable = !result.error && result.status === 0
  } catch {
    opensslUsable = false
  }
  return opensslUsable
}

/**
 * 用 openssl 校验一份 CMS 分离签名。
 * 命令与签名侧成对:签名是 -binary -md sha512 -outform DER -nocerts -noattr,
 * 因此验签必须显式给 -inform DER,并用 -certfile 补回未随签名内嵌的签名证书。
 * @returns {{status: 'ok'|'invalid'|'unavailable', reason: string}}
 */
function verifyCmsSignature({ signaturePath, contentPath, caPath, signerCertPath }) {
  const result = spawnSync('openssl', [
    'cms', '-verify', '-binary', '-md', 'sha512', '-inform', 'DER',
    '-in', signaturePath, '-content', contentPath,
    '-CAfile', caPath, '-certfile', signerCertPath,
  ], { encoding: 'utf8' })
  if (result.error) return { status: 'unavailable', reason: result.error.message }
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim().split(NEWLINE).filter(Boolean)
    const detail = stderr.length > 0 ? stderr[stderr.length - 1] : 'openssl cms -verify 返回 ' + String(result.status)
    // openssl 的 ASN.1 报错很长,截断后仍能定位问题类型,不把整串堆栈塞进报告
    return { status: 'invalid', reason: detail.length > 200 ? detail.slice(0, 200) + '...' : detail }
  }
  return { status: 'ok', reason: '' }
}

/* ---------- 校验 ---------- */

/** 清单条目的 path 必须相对包目录、正斜杠、不含空段与 . 或 .. 段,也不指向清单自身 */
function checkEntryPath(value) {
  if (typeof value !== 'string' || value.length === 0) return 'path 必须是非空字符串'
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return 'path 不得是绝对路径'
  if (value.includes('\\')) return 'path 必须用正斜杠'
  const segments = value.split('/')
  if (segments.some((segment) => segment.length === 0)) return 'path 不得含空段'
  if (segments.includes('.') || segments.includes('..')) return 'path 不得出现 . 或 .. 段'
  if (MANIFEST_SELF.has(value)) return 'path 不得指向清单自身或其签名'
  return null
}

/** 读一份清单;读不到或不是合法 JSON 时返回 null 并记账 */
function readManifest(manifestPath, manifestRel, report) {
  let text
  try {
    text = readFileSync(manifestPath, 'utf8')
  } catch (error) {
    report.error('MANIFEST_UNREADABLE', manifestRel + ' 无法读取:' + error.message, manifestRel)
    return null
  }
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch (error) {
    report.error('MANIFEST_INVALID', manifestRel + ' 不是合法 JSON:' + error.message, manifestRel)
    return null
  }
}

/**
 * 校验清单结构、覆盖范围与每个文件的 SHA-512,再按需校验签名。
 * @param {object} input
 * @param {string} input.packageDir 包目录
 * @param {string} input.packageRel 包目录相对合集根的路径
 * @param {object} input.report 报告器,提供 error 与 warn
 * @param {{rootCertPath: string, eecCertPath: string}|null} [input.certs] 公开证书材料路径
 * @param {boolean} [input.requireManifest] 缺清单是否按错误处理,默认按警告
 * @param {boolean} [input.requireSignature] 缺清单签名是否按错误处理,默认按警告
 * @param {boolean} [input.verifySignature] 是否用 openssl 验签,默认是
 * @returns {object|null} 清单摘要;缺清单时返回 null
 */
export function verifyPackageManifest({
  packageDir,
  packageRel,
  report,
  certs = null,
  requireManifest = false,
  requireSignature = false,
  verifySignature = true,
}) {
  const manifestRel = packageRel + '/' + MANIFEST_FILE
  const manifestPath = join(packageDir, MANIFEST_FILE)
  if (!isFile(manifestPath)) {
    if (requireManifest) {
      report.error('MANIFEST_MISSING', '包目录缺清单 ' + manifestRel + ';消费方安装时会以 manifest-missing 拒绝该包', manifestRel)
    } else {
      report.warn('MANIFEST_MISSING', '包目录还没有清单 ' + manifestRel + ';构建会生成,发布目录必须带清单', manifestRel)
    }
    return null
  }

  const data = readManifest(manifestPath, manifestRel, report)
  if (data === null) return null
  if (!isObject(data)) {
    report.error('MANIFEST_NOT_OBJECT', manifestRel + ' 的顶层必须是对象', manifestRel)
    return null
  }
  if (data.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    report.error('MANIFEST_SCHEMA_VERSION',
      manifestRel + ' 的 schemaVersion 必须为 ' + String(MANIFEST_SCHEMA_VERSION) + ',实际为 ' + JSON.stringify(data.schemaVersion),
      manifestRel)
  }
  if (!Array.isArray(data.files) || data.files.length === 0) {
    report.error('MANIFEST_FILES_INVALID', manifestRel + ' 的 files 必须是非空数组', manifestRel)
    return null
  }

  const listed = new Map()
  data.files.forEach((item, index) => {
    const where = manifestRel + ' files[' + String(index) + ']'
    if (!isObject(item)) {
      report.error('MANIFEST_ENTRY_NOT_OBJECT', where + ' 必须是对象', where)
      return
    }
    const extra = Object.keys(item).filter((key) => key !== 'path' && key !== 'sha512' && key !== 'bytes')
    if (extra.length > 0) {
      report.warn('MANIFEST_ENTRY_EXTRA_FIELD', where + ' 多出字段 ' + extra.join('、') + ';消费方只读 path 与 sha512', where)
    }
    const pathError = checkEntryPath(item.path)
    if (pathError !== null) {
      report.error('MANIFEST_PATH_INVALID', JSON.stringify(item.path) + ':' + pathError, where)
      return
    }
    if (listed.has(item.path)) {
      report.error('MANIFEST_PATH_DUPLICATE', where + ' 重复登记 ' + item.path, where)
      return
    }
    if (typeof item.sha512 !== 'string' || !SHA512_PATTERN.test(item.sha512)) {
      report.error('MANIFEST_HASH_INVALID', where + ' 的 sha512 必须是 128 位小写十六进制', where)
      return
    }
    if (!Number.isInteger(item.bytes) || item.bytes < 0) {
      report.error('MANIFEST_BYTES_INVALID', where + ' 的 bytes 必须是非负整数', where)
      return
    }
    listed.set(item.path, item)
  })

  const expected = listManifestFiles(packageDir)
  const expectedSet = new Set(expected)
  for (const rel of expected) {
    if (!listed.has(rel)) {
      report.error('MANIFEST_PATH_MISSING', manifestRel + ' 漏记文件 ' + rel + ';清单必须覆盖包目录内除自身与签名之外的全部文件', manifestRel)
    }
  }
  for (const rel of listed.keys()) {
    if (!expectedSet.has(rel)) {
      report.error('MANIFEST_PATH_EXTRA', manifestRel + ' 多记了包目录里不存在的文件 ' + rel, manifestRel)
    }
  }
  for (const [rel, item] of listed) {
    if (!expectedSet.has(rel)) continue
    const abs = join(packageDir, ...rel.split('/'))
    if (sha512OfFile(abs) !== item.sha512) {
      report.error('MANIFEST_HASH_MISMATCH', manifestRel + ' 登记的 ' + rel + ' 哈希与文件实际内容不一致', manifestRel)
    }
    if (statSync(abs).size !== item.bytes) {
      report.error('MANIFEST_BYTES_MISMATCH', manifestRel + ' 登记的 ' + rel + ' 字节数与文件实际大小不一致', manifestRel)
    }
  }

  const signature = inspectManifestSignature({
    manifestPath, manifestRel, report, certs, requireSignature, verifySignature,
  })

  return { path: manifestRel, files: data.files.length, signature }
}

/** 清单签名:形状必须是 CMS DER,提供证书材料时用 openssl 验签 */
function inspectManifestSignature({ manifestPath, manifestRel, report, certs, requireSignature, verifySignature }) {
  const sigPath = manifestPath + MANIFEST_SIG_SUFFIX
  const sigRel = manifestRel + MANIFEST_SIG_SUFFIX
  if (!isFile(sigPath)) {
    if (requireSignature) {
      report.error('MANIFEST_SIG_MISSING', '包层清单缺签名 ' + sigRel + ';发布目录的每份清单都必须有签名', sigRel)
    } else {
      report.warn('MANIFEST_SIG_MISSING', '包层清单未签名 ' + sigRel + ';本地构建不签名,发布流程的整站签名会补齐', sigRel)
    }
    return 'missing'
  }

  const bytes = readFileSync(sigPath)
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '-----') {
    report.error('MANIFEST_SIG_NOT_DER', sigRel + ' 是 PEM 文本;签名必须是 CMS DER,签名时加 -outform DER', sigRel)
    return 'invalid'
  }
  if (bytes.length < 100) {
    report.error('MANIFEST_SIG_TRUNCATED', sigRel + ' 过短,不可能是 CMS DER 签名', sigRel)
    return 'invalid'
  }
  if (bytes[0] !== 0x30) {
    report.error('MANIFEST_SIG_NOT_DER', sigRel + ' 的首字节不是 0x30;CMS 签名必须是 DER(-outform DER)', sigRel)
    return 'invalid'
  }
  if (!verifySignature) return 'present'
  if (!certs || !certs.rootCertPath || !certs.eecCertPath) {
    report.warn('MANIFEST_SIG_UNVERIFIABLE', sigRel + ' 没有可用的证书材料,无法验签', sigRel)
    return 'present'
  }
  if (!hasOpenssl()) {
    report.warn('MANIFEST_SIG_UNVERIFIABLE', sigRel + ' 需要 openssl 才能验签,当前环境没有 openssl;只核对了 DER 形状', sigRel)
    return 'present'
  }
  const result = verifyCmsSignature({
    signaturePath: sigPath,
    contentPath: manifestPath,
    caPath: certs.rootCertPath,
    signerCertPath: certs.eecCertPath,
  })
  if (result.status === 'invalid') {
    report.error('MANIFEST_SIG_INVALID', sigRel + ' 验签不通过:' + result.reason, sigRel)
    return 'invalid'
  }
  if (result.status === 'unavailable') {
    report.warn('MANIFEST_SIG_UNVERIFIABLE', sigRel + ' 验签工具不可用:' + result.reason, sigRel)
    return 'present'
  }
  return 'verified'
}
