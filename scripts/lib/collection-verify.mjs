/**
 * 资产合集自洽性校验。
 *
 * 校验对象是本仓库的收录结构:根目录元数据、合集索引、标签词表、作者清单、
 * 包目录与版本目录,以及每个版本目录里的资产包是否符合 dsc-humanize-asset-template 的规范。
 * 只读取文件,不修改任何内容;verify-collection.mjs 与 build-collection.mjs 共用本模块。
 *
 * 失败语义:结构与清单错误记为错误,阻断发布;证书链与包关联的辅助结论记为警告,不阻断。
 * 这里不做任何签名与证书签发:证书只做解析、链校验与公钥配对,不产生新证书。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { X509Certificate, createPublicKey } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { CONTENT_TYPE_SET, loadSpec, readPackageTree, validatePackage } from './asset-package.mjs'
import { verifyPackageManifest } from './manifest.mjs'

/** 合集根目录必需的文件。tags.json 是标签词表,缺词表等于不校验标签,不能当作可选文件 */
export const ROOT_REQUIRED_FILES = ['meta.json', 'assets.json', 'tags.json']
/** 收录根目录名 */
export const ASSETS_DIR = 'assets'
/** 作者清单相对路径 */
export const AUTHOR_MANIFEST_PATH = ASSETS_DIR + '/author_manifest.json'
/** 公开材料的固定路径:信任锚与合集 EEC,一个来源一个目录 */
export const CERT_ROOT_PATH = 'certs/dsc-humanize/dsc-humanize-root-ca.crt'
export const CERT_ROOT_PUB_PATH = 'certs/dsc-humanize/dsc-humanize-root-ca-secret.pub'
export const CERT_EEC_PATH = 'certs/dsc-humanize-inner-asset/dsc-humanize-inner-asset-eec.crt'
export const CERT_EEC_PUB_PATH = 'certs/dsc-humanize-inner-asset/dsc-humanize-inner-asset-eec-secret.pub'

const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const PACKAGE_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/
const AUTHOR_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/
const AUTHOR_FILES = new Set(['asset_manifest.json', 'README.md'])
const META_FIELDS = new Set(['name', 'indexVersion', 'assetFormat'])
const INDEX_FIELDS = new Set(['id', 'author', 'tag', 'types'])

/* ---------- 通用工具 ---------- */

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function parseJsonFile(path, label, report) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    report.error('FILE_UNREADABLE', label + ' 无法读取:' + error.message, path)
    return undefined
  }
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch (error) {
    report.error('JSON_INVALID', label + ' 不是合法 JSON:' + error.message, path)
    return undefined
  }
}

/** 把三段版本号折成可比较的分量数组 */
function versionParts(version) {
  const [major, minor, patch] = String(version).split('.').map((item) => Number(item))
  return [major, minor, patch]
}

/** 返回负数表示 left 比 right 旧,0 表示同版本 */
function compareVersion(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

function parseTime(text) {
  const value = Date.parse(text)
  return Number.isNaN(value) ? null : value
}

/* ---------- 证书与公钥 ---------- */

function readPem(path) {
  return readFileSync(path, 'utf8')
}

function keyToSpki(key) {
  return key.export({ type: 'spki', format: 'der' }).toString('base64')
}

function inspectCertificates(root, report) {
  const record = { root: null, eec: null }
  let rootCert = null
  let eecCert = null

  if (!isFile(join(root, CERT_ROOT_PATH))) {
    report.error('CERT_MISSING', '缺少信任锚 ' + CERT_ROOT_PATH + ';没有它就无法判断合集 EEC 的签发方', CERT_ROOT_PATH)
  } else {
    try {
      rootCert = new X509Certificate(readPem(join(root, CERT_ROOT_PATH)))
      record.root = { path: CERT_ROOT_PATH, subject: rootCert.subject, validFrom: rootCert.validFrom, validTo: rootCert.validTo }
    } catch (error) {
      report.error('CERT_INVALID', CERT_ROOT_PATH + ' 不是合法的 X.509 证书:' + error.message, CERT_ROOT_PATH)
    }
  }

  if (!isFile(join(root, CERT_EEC_PATH))) {
    report.error('CERT_MISSING', '缺少合集 EEC ' + CERT_EEC_PATH, CERT_EEC_PATH)
  } else {
    try {
      eecCert = new X509Certificate(readPem(join(root, CERT_EEC_PATH)))
      record.eec = { path: CERT_EEC_PATH, subject: eecCert.subject, validFrom: eecCert.validFrom, validTo: eecCert.validTo }
    } catch (error) {
      report.error('CERT_INVALID', CERT_EEC_PATH + ' 不是合法的 X.509 证书:' + error.message, CERT_EEC_PATH)
    }
  }

  if (rootCert) {
    if (rootCert.ca !== true) {
      report.error('CERT_ANCHOR_NOT_CA', CERT_ROOT_PATH + ' 不是 CA 证书,不能作为信任锚', CERT_ROOT_PATH)
    }
    let selfIssued = false
    try {
      selfIssued = rootCert.checkIssued(rootCert) && rootCert.verify(rootCert.publicKey)
    } catch (error) {
      selfIssued = false
    }
    if (!selfIssued) {
      report.error('CERT_ANCHOR_NOT_SELF_SIGNED', CERT_ROOT_PATH + ' 不是自签名证书,信任锚必须自签', CERT_ROOT_PATH)
    }
    inspectValidity(rootCert, CERT_ROOT_PATH, report)
  }

  if (eecCert) {
    if (eecCert.ca === true) {
      report.error('CERT_EEC_IS_CA', CERT_EEC_PATH + ' 是 CA 证书;合集 EEC 只能是终端证书,不能再签发', CERT_EEC_PATH)
    }
    if (rootCert) {
      let issued = false
      try {
        issued = eecCert.checkIssued(rootCert) && eecCert.verify(rootCert.publicKey)
      } catch (error) {
        issued = false
      }
      if (!issued) {
        report.error('CERT_NOT_ISSUED_BY_ANCHOR',
          CERT_EEC_PATH + ' 不是由 ' + CERT_ROOT_PATH + ' 签发的,或签名不匹配;证书链在此断开', CERT_EEC_PATH)
      }
    }
    if (eecCert.publicKey.asymmetricKeyType !== 'ec'
      || !eecCert.publicKey.asymmetricKeyDetails
      || eecCert.publicKey.asymmetricKeyDetails.namedCurve !== 'prime256v1') {
      report.warn('CERT_KEY_TYPE', CERT_EEC_PATH + ' 的密钥不是 ECDSA P-256,与组织约定不一致', CERT_EEC_PATH)
    }
    inspectValidity(eecCert, CERT_EEC_PATH, report)
  }

  inspectPublicKey({ root, cert: rootCert, certRel: CERT_ROOT_PATH, pubRel: CERT_ROOT_PUB_PATH, report })
  inspectPublicKey({ root, cert: eecCert, certRel: CERT_EEC_PATH, pubRel: CERT_EEC_PUB_PATH, report })

  return record
}

function inspectValidity(cert, certRel, report) {
  const now = Date.now()
  const from = parseTime(cert.validFrom)
  const to = parseTime(cert.validTo)
  if (from !== null && now < from) {
    report.warn('CERT_NOT_YET_VALID', certRel + ' 尚未生效,生效时间 ' + cert.validFrom, certRel)
  }
  if (to !== null && now > to) {
    report.warn('CERT_EXPIRED', certRel + ' 已过期,失效时间 ' + cert.validTo, certRel)
  }
}

function inspectPublicKey({ root, cert, certRel, pubRel, report }) {
  if (!isFile(join(root, pubRel))) {
    report.error('CERT_PUB_MISSING', '缺少公开公钥 ' + pubRel + ';它用于核对密钥对,属于公开材料', pubRel)
    return
  }
  if (!cert) return
  let key = null
  try {
    key = createPublicKey(readPem(join(root, pubRel)))
  } catch (error) {
    report.error('CERT_PUB_INVALID', pubRel + ' 不是合法的 PEM 公钥:' + error.message, pubRel)
    return
  }
  if (keyToSpki(key) !== keyToSpki(cert.publicKey)) {
    report.error('CERT_PUB_MISMATCH', pubRel + ' 与 ' + certRel + ' 的公钥不一致', pubRel)
  }
}

/* ---------- 合集根目录 ---------- */

function inspectCollectionMeta({ root, report }) {
  const metaPath = join(root, 'meta.json')
  const meta = parseJsonFile(metaPath, '根目录 meta.json', report)
  if (meta === undefined) return { meta: null, name: null }
  if (!isObject(meta)) {
    report.error('META_INVALID', '根目录 meta.json 的顶层必须是对象', 'meta.json')
    return { meta: null, name: null }
  }
  Object.keys(meta).forEach((key) => {
    if (!META_FIELDS.has(key)) {
      report.error('META_FIELD_INVALID', 'meta.json 不接受字段 ' + key + ';允许的字段为 name、indexVersion、assetFormat', 'meta.json')
    }
  })
  if (typeof meta.name !== 'string' || meta.name.trim().length === 0) {
    report.error('META_FIELD_INVALID', 'meta.json 的 name 必须是非空字符串', 'meta.json')
  }
  if (typeof meta.indexVersion !== 'string' || !SEMVER_PATTERN.test(meta.indexVersion)) {
    report.error('META_FIELD_INVALID', 'meta.json 的 indexVersion 必须是三段数字', 'meta.json')
  }
  if (!isObject(meta.assetFormat)) {
    report.error('META_FIELD_INVALID', 'meta.json 的 assetFormat 必须是对象,含 specVersion 与 formatVersion', 'meta.json')
  } else {
    const allowed = new Set(['specVersion', 'formatVersion'])
    Object.keys(meta.assetFormat).forEach((key) => {
      if (!allowed.has(key)) {
        report.error('META_FIELD_INVALID', 'meta.json 的 assetFormat 不接受字段 ' + key + ';允许的字段为 specVersion 与 formatVersion', 'meta.json')
      }
    })
    ;['specVersion', 'formatVersion'].forEach((key) => {
      if (typeof meta.assetFormat[key] !== 'string' || !SEMVER_PATTERN.test(meta.assetFormat[key])) {
        report.error('META_FIELD_INVALID', 'meta.json 的 assetFormat.' + key + ' 必须是三段数字', 'meta.json')
      }
    })
  }
  return { meta, name: typeof meta.name === 'string' && meta.name.trim().length > 0 ? meta.name : null }
}

function inspectTags({ root, report }) {
  const tagsPath = join(root, 'tags.json')
  const tags = parseJsonFile(tagsPath, 'tags.json', report)
  if (tags === undefined) return null
  if (!Array.isArray(tags)) {
    report.error('TAGS_INVALID', 'tags.json 的顶层必须是字符串数组', 'tags.json')
    return null
  }
  const seen = new Set()
  tags.forEach((tag, index) => {
    if (typeof tag !== 'string' || tag.length === 0) {
      report.error('TAGS_INVALID', 'tags.json 第 ' + index + ' 项必须是非空字符串', 'tags.json')
      return
    }
    if (seen.has(tag)) report.warn('TAGS_DUPLICATE', 'tags.json 存在重复标签 ' + tag, 'tags.json')
    seen.add(tag)
  })
  return seen
}

function inspectIndex({ root, report, tagSet }) {
  const indexPath = join(root, 'assets.json')
  const data = parseJsonFile(indexPath, 'assets.json', report)
  if (data === undefined) return []
  if (!Array.isArray(data)) {
    report.error('ASSETS_INDEX_INVALID', 'assets.json 的顶层必须是数组', 'assets.json')
    return []
  }
  const entries = []
  const seenIds = new Set()
  data.forEach((entry, index) => {
    const label = 'assets.json 第 ' + index + ' 项'
    if (!isObject(entry)) {
      report.error('ASSETS_INDEX_INVALID', label + ' 必须是对象', 'assets.json')
      return
    }
    Object.keys(entry).forEach((key) => {
      if (!INDEX_FIELDS.has(key)) {
        report.error('ASSETS_INDEX_INVALID', label + ' 不接受字段 ' + key + ';允许的字段为 id、author、tag、types', 'assets.json')
      }
    })
    if (typeof entry.id !== 'string' || !PACKAGE_ID_PATTERN.test(entry.id)) {
      report.error('ASSETS_INDEX_INVALID', label + ' 的 id 不是合法的包标识(小写字母开头,只含小写字母、数字与连字符,长度 3 到 64)', 'assets.json')
      return
    }
    if (typeof entry.author !== 'string' || !AUTHOR_PATTERN.test(entry.author)) {
      report.error('ASSETS_INDEX_INVALID', label + ' 的 author 不是合法的作者目录名', 'assets.json')
      return
    }
    if (!Array.isArray(entry.tag) || entry.tag.some((tag) => typeof tag !== 'string' || tag.length === 0)) {
      report.error('ASSETS_INDEX_INVALID', label + ' 的 tag 必须是字符串数组', 'assets.json')
      return
    }
    if (!Array.isArray(entry.types) || entry.types.length === 0) {
      report.error('ASSET_TYPES_INVALID', label + ' 的 types 必须是非空数组,至少声明一类内容', 'assets.json')
      return
    }
    if (entry.types.some((type) => !CONTENT_TYPE_SET.has(type))) {
      report.error('ASSET_TYPES_INVALID', label + ' 的 types 出现四类之外的标识;只能取 persona、labels、strategies、injection', 'assets.json')
      return
    }
    if (new Set(entry.types).size !== entry.types.length) {
      report.error('ASSET_TYPES_INVALID', label + ' 的 types 存在重复项', 'assets.json')
      return
    }
    if (seenIds.has(entry.id)) {
      report.error('ASSETS_INDEX_DUPLICATE', '包标识 ' + entry.id + ' 在 assets.json 中重复出现;同一 id 只应有一条索引', 'assets.json')
      return
    }
    seenIds.add(entry.id)
    if (tagSet) {
      entry.tag.forEach((tag) => {
        if (!tagSet.has(tag)) {
          report.error('TAG_NOT_DECLARED', '包 ' + entry.id + ' 的标签 ' + tag + ' 未在 tags.json 中声明', 'assets.json')
        }
      })
    }
    entries.push({ id: entry.id, author: entry.author, tag: [...entry.tag], types: [...entry.types] })
  })
  return entries
}

function inspectAuthorManifest({ root, report }) {
  const manifestPath = join(root, AUTHOR_MANIFEST_PATH)
  const registered = new Set()
  if (!isFile(manifestPath)) {
    report.error('AUTHOR_MANIFEST_MISSING', AUTHOR_MANIFEST_PATH + ' 不存在', AUTHOR_MANIFEST_PATH)
    return registered
  }
  const manifest = parseJsonFile(manifestPath, AUTHOR_MANIFEST_PATH, report)
  if (manifest === undefined) return registered
  if (!Array.isArray(manifest)) {
    report.error('AUTHOR_MANIFEST_INVALID', AUTHOR_MANIFEST_PATH + ' 的顶层必须是数组', AUTHOR_MANIFEST_PATH)
    return registered
  }
  manifest.forEach((item, index) => {
    const label = AUTHOR_MANIFEST_PATH + ' 第 ' + index + ' 项'
    if (!isObject(item) || typeof item.username !== 'string' || !AUTHOR_PATTERN.test(item.username)) {
      report.error('AUTHOR_MANIFEST_INVALID', label + ' 缺少合法的 username(小写字母、数字与连字符,不得以连字符开头或结尾)', AUTHOR_MANIFEST_PATH)
      return
    }
    if (typeof item.profile !== 'string' || item.profile.trim().length === 0) {
      report.error('AUTHOR_MANIFEST_INVALID', label + ' 缺少合法的 profile', AUTHOR_MANIFEST_PATH)
    }
    if (registered.has(item.username)) {
      report.warn('AUTHOR_MANIFEST_DUPLICATE', '作者 ' + item.username + ' 在 ' + AUTHOR_MANIFEST_PATH + ' 中重复登记', AUTHOR_MANIFEST_PATH)
    }
    registered.add(item.username)
  })
  return registered
}

/* ---------- 作者目录与包目录 ---------- */

function inspectAuthor({ root, author, report }) {
  const authorRel = ASSETS_DIR + '/' + author
  const authorDir = join(root, ASSETS_DIR, author)
  if (!isDirectory(authorDir)) {
    report.error('AUTHOR_DIR_MISSING', '作者目录不存在:' + authorRel, authorRel)
    return null
  }
  const manifestRel = authorRel + '/asset_manifest.json'
  const manifestPath = join(authorDir, 'asset_manifest.json')
  const declaredIds = new Set()
  if (!isFile(manifestPath)) {
    report.error('ASSET_MANIFEST_MISSING', '作者包清单不存在:' + manifestRel, manifestRel)
  } else {
    const manifest = parseJsonFile(manifestPath, manifestRel, report)
    if (manifest !== undefined) {
      if (!Array.isArray(manifest)) {
        report.error('ASSET_MANIFEST_INVALID', manifestRel + ' 的顶层必须是包标识数组', manifestRel)
      } else {
        manifest.forEach((id, index) => {
          if (typeof id !== 'string' || !PACKAGE_ID_PATTERN.test(id)) {
            report.error('ASSET_MANIFEST_INVALID', manifestRel + ' 第 ' + index + ' 项不是合法的包标识', manifestRel)
            return
          }
          if (declaredIds.has(id)) {
            report.warn('ASSET_MANIFEST_DUPLICATE', manifestRel + ' 重复登记包标识 ' + id, manifestRel)
          }
          declaredIds.add(id)
        })
      }
    }
  }
  const presentDirs = new Set()
  readdirSync(authorDir).sort().forEach((name) => {
    const abs = join(authorDir, name)
    if (isDirectory(abs)) {
      presentDirs.add(name)
      return
    }
    if (!AUTHOR_FILES.has(name)) {
      report.error('AUTHOR_ENTRY_UNEXPECTED', authorRel + '/' + name + ' 不是作者目录允许的条目;只允许 asset_manifest.json、可选的 README.md 与包目录', authorRel + '/' + name)
    }
  })
  presentDirs.forEach((name) => {
    if (!declaredIds.has(name)) {
      report.error('ASSET_NOT_IN_MANIFEST', '包目录 ' + name + ' 未出现在 ' + manifestRel + ' 中', manifestRel)
    }
  })
  declaredIds.forEach((id) => {
    if (!presentDirs.has(id)) {
      report.warn('ASSET_NOT_PRESENT', '包 ' + id + ' 在 ' + manifestRel + ' 中登记,但作者目录下还没有对应目录', manifestRel)
    }
  })
  return { author, authorDir, authorRel, declaredIds, presentDirs }
}

function inspectVersions({ entry, packageDir, packageRel, report }) {
  const versionsRel = packageRel + '/versions.json'
  if (!isFile(join(packageDir, 'versions.json'))) {
    report.error('VERSIONS_MISSING', '包目录缺少 versions.json:' + versionsRel, versionsRel)
    return null
  }
  const data = parseJsonFile(join(packageDir, 'versions.json'), versionsRel, report)
  if (data === undefined) return null
  if (!isObject(data)) {
    report.error('VERSIONS_INVALID', versionsRel + ' 的顶层必须是对象', versionsRel)
    return null
  }
  const allowed = new Set(['latest', 'versions'])
  Object.keys(data).forEach((key) => {
    if (!allowed.has(key)) {
      report.error('VERSIONS_INVALID', versionsRel + ' 不接受字段 ' + key + ';允许的字段为 latest 与 versions', versionsRel)
    }
  })
  if (!Array.isArray(data.versions) || data.versions.length === 0) {
    report.error('VERSIONS_INVALID', versionsRel + ' 的 versions 必须是非空数组', versionsRel)
    return null
  }
  const listed = []
  const seen = new Set()
  data.versions.forEach((version) => {
    if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
      report.error('VERSIONS_INVALID', versionsRel + ' 含非法版本号 ' + JSON.stringify(version), versionsRel)
      return
    }
    if (seen.has(version)) {
      report.error('VERSIONS_DUPLICATE', versionsRel + ' 重复列出版本 ' + version, versionsRel)
      return
    }
    seen.add(version)
    listed.push(version)
  })
  for (let index = 1; index < listed.length; index += 1) {
    if (compareVersion(listed[index - 1], listed[index]) <= 0) {
      report.error('VERSIONS_ORDER', versionsRel + ' 的版本必须按版本号降序排列,当前 ' + listed[index - 1] + ' 排在 ' + listed[index] + ' 之前', versionsRel)
      break
    }
  }
  if (typeof data.latest !== 'string' || !SEMVER_PATTERN.test(data.latest)) {
    report.error('VERSIONS_INVALID', versionsRel + ' 的 latest 不是合法版本号', versionsRel)
    return { listed, latest: null }
  }
  if (!listed.includes(data.latest)) {
    report.error('LATEST_NOT_LISTED', versionsRel + ' 的 latest ' + data.latest + ' 不在 versions 列表内', versionsRel)
  }
  return { listed, latest: data.latest }
}

function inspectPackageVersion({ entry, version, versionDir, versionRel, spec, schemas, report, stats }) {
  let tree
  try {
    tree = readPackageTree(versionDir)
  } catch (error) {
    report.error('PACKAGE_READ_FAILED', versionRel + ' 无法读取:' + error.message, versionRel)
    return null
  }
  const { issues, summary } = validatePackage(tree, spec, schemas)
  issues.forEach((item) => {
    report.error(item.code, item.message, versionRel + '/' + item.path)
  })
  stats.versions += 1
  Object.values(summary.counts).forEach((count) => {
    stats.contentItems += count
  })
  if (summary.id !== null && summary.id !== entry.id) {
    report.error('PACKAGE_ID_MISMATCH', versionRel + '/asset.json 的 id 为 ' + JSON.stringify(summary.id) + ',与包目录 ' + entry.id + ' 不一致', versionRel + '/asset.json/id')
  }
  if (summary.version !== null && summary.version !== version) {
    report.error('PACKAGE_VERSION_MISMATCH', versionRel + '/asset.json 的 version 为 ' + JSON.stringify(summary.version) + ',与版本目录 ' + version + ' 不一致', versionRel + '/asset.json/version')
  }
  if (summary.author !== null && summary.author !== entry.author) {
    report.error('PACKAGE_AUTHOR_MISMATCH', versionRel + '/asset.json 的 author 为 ' + JSON.stringify(summary.author) + ',与作者目录 ' + entry.author + ' 不一致', versionRel + '/asset.json/author')
  }
  return summary
}

function inspectPackage({ root, entry, authorContext, spec, schemas, report, stats, manifestOptions, certs }) {
  const packageRel = authorContext.authorRel + '/' + entry.id
  const packageDir = join(authorContext.authorDir, entry.id)
  if (!isDirectory(packageDir)) {
    report.error('ASSET_DIR_MISSING', '包目录不存在:' + packageRel, packageRel)
    return null
  }
  stats.packages += 1
  const versions = inspectVersions({ entry, packageDir, packageRel, report })
  if (!versions) return null

  let latestSummary = null
  versions.listed.forEach((version) => {
    const versionRel = packageRel + '/' + version
    const versionDir = join(packageDir, version)
    if (!isDirectory(versionDir)) {
      report.error('VERSION_DIR_MISSING', '版本目录不存在:' + versionRel, versionRel)
      return
    }
    const summary = inspectPackageVersion({ entry, version, versionDir, versionRel, spec, schemas, report, stats })
    if (version === versions.latest) latestSummary = summary
  })

  if (latestSummary && latestSummary.types.length > 0) {
    const declared = [...latestSummary.types].sort().join(',')
    const indexed = [...entry.types].sort().join(',')
    if (declared !== indexed) {
      report.error('ASSET_TYPES_MISMATCH',
        '包 ' + entry.id + ' 的索引 types(' + indexed + ')与 latest 版本 ' + versions.latest + ' 的 asset.json types(' + declared + ')不一致',
        'assets.json')
    }
  }

  // 包层清单:消费方安装时按它逐文件取件并比对 SHA-512,缺清单只警告(存量兼容),
  // 清单存在但与内容不一致一律按错误,否则发布出去的清单会把消费方引到错误的字节上。
  const manifest = verifyPackageManifest({
    packageDir,
    packageRel,
    report,
    certs,
    requireManifest: manifestOptions.requireManifests,
    requireSignature: manifestOptions.requireManifestSignatures,
    verifySignature: manifestOptions.verifyManifestSignature,
  })
  if (manifest !== null) {
    stats.manifests += 1
    stats.manifestFiles += manifest.files
  }

  return {
    id: entry.id,
    author: entry.author,
    latest: versions.latest,
    versions: versions.listed,
    types: entry.types,
    manifest,
  }
}

/* ---------- 入口 ---------- */

/**
 * 校验一个资产合集目录。
 * @param {string} collectionDir 合集根目录
 * @param {object} [options] 选项
 * @param {string} [options.collectionName] 合集名称,默认取 meta.json 的 name
 * @param {boolean} [options.requireManifests] 缺包层清单是否按错误处理;默认按警告,校验发布目录时打开
 * @param {boolean} [options.requireManifestSignatures] 缺清单签名是否按错误处理;默认按警告
 * @param {boolean} [options.verifyManifestSignature] 是否用 openssl 验清单签名,默认验;没有 openssl 时只警告
 * @param {string} [options.specDir] 规范区所在目录,默认取合集目录;校验 dist/ 这类不含 specs/ 的副本时指向源码树
 * @returns {{ok: boolean, root: string, collectionName: string, errorCount: number, warningCount: number, problems: Array<object>, stats: object, packages: Array<object>, certificates: object}}
 */
export function verifyCollection(collectionDir, options = {}) {
  const root = resolve(collectionDir)
  const problems = []
  const stats = { authors: 0, packages: 0, versions: 0, contentItems: 0, manifests: 0, manifestFiles: 0 }
  const manifestOptions = {
    requireManifests: options.requireManifests === true,
    requireManifestSignatures: options.requireManifestSignatures === true,
    verifyManifestSignature: options.verifyManifestSignature !== false,
  }
  // 清单签名用本合集自己的公开材料验:根证书是信任锚,EEC 是签名证书
  const manifestCerts = { rootCertPath: join(root, CERT_ROOT_PATH), eecCertPath: join(root, CERT_EEC_PATH) }
  const packages = []
  let certificates = { root: null, eec: null }
  const report = {
    error(code, message, path) {
      problems.push({ level: 'error', code, message, path: path ?? null })
    },
    warn(code, message, path) {
      problems.push({ level: 'warning', code, message, path: path ?? null })
    },
  }

  const finish = (collectionName) => {
    const errorCount = problems.filter((item) => item.level === 'error').length
    return {
      ok: errorCount === 0,
      root,
      collectionName: collectionName || basename(root),
      errorCount,
      warningCount: problems.length - errorCount,
      problems,
      stats,
      packages,
      certificates,
    }
  }

  if (!isDirectory(root)) {
    report.error('ROOT_MISSING', '合集目录不存在或不是目录:' + root, root)
    return finish()
  }

  let spec
  let schemas
  try {
    const specDir = options.specDir === undefined ? root : resolve(options.specDir)
    const loaded = loadSpec(specDir)
    spec = loaded.spec
    schemas = loaded.schemas
  } catch (error) {
    report.error('SPEC_UNREADABLE', '规范区读取失败:' + error.message, 'specs/spec-version.json')
    return finish()
  }

  ROOT_REQUIRED_FILES.forEach((name) => {
    if (isFile(join(root, name))) return
    if (name === 'tags.json') {
      report.error('TAGS_MISSING', '根目录缺少必需文件 tags.json: 没有标签词表就无法校验包标签,发布必须带标签词表', name)
      return
    }
    report.error('ROOT_FILE_MISSING', '根目录缺少必需文件 ' + name, name)
  })

  const collectionMeta = inspectCollectionMeta({ root, report })
  if (collectionMeta.meta && isObject(collectionMeta.meta.assetFormat)) {
    const declared = collectionMeta.meta.assetFormat
    if (typeof declared.specVersion === 'string' && declared.specVersion !== spec.spec_version) {
      report.error('META_SPEC_MISMATCH', 'meta.json 的 assetFormat.specVersion 为 ' + declared.specVersion
        + ',与 specs/spec-version.json 的 spec_version ' + String(spec.spec_version) + ' 不一致', 'meta.json')
    }
    if (typeof declared.formatVersion === 'string' && declared.formatVersion !== spec.format_version) {
      report.error('META_SPEC_MISMATCH', 'meta.json 的 assetFormat.formatVersion 为 ' + declared.formatVersion
        + ',与 specs/spec-version.json 的 format_version ' + String(spec.format_version) + ' 不一致', 'meta.json')
    }
  }
  const tagSet = isFile(join(root, 'tags.json')) ? inspectTags({ root, report }) : null
  const entries = isFile(join(root, 'assets.json')) ? inspectIndex({ root, report, tagSet }) : []
  const registeredAuthors = inspectAuthorManifest({ root, report })
  certificates = inspectCertificates(root, report)

  const authorCache = new Map()
  entries.forEach((entry) => {
    if (!registeredAuthors.has(entry.author)) {
      report.warn('AUTHOR_NOT_REGISTERED', '作者 ' + entry.author + ' 未在 ' + AUTHOR_MANIFEST_PATH + ' 中登记', AUTHOR_MANIFEST_PATH)
    }
    if (!authorCache.has(entry.author)) {
      authorCache.set(entry.author, inspectAuthor({ root, author: entry.author, report }))
    }
    const authorContext = authorCache.get(entry.author)
    if (!authorContext) return
    if (!authorContext.declaredIds.has(entry.id)) {
      report.error('ASSET_NOT_IN_MANIFEST',
        '包 ' + entry.id + ' 未出现在 ' + authorContext.authorRel + '/asset_manifest.json 中',
        authorContext.authorRel + '/asset_manifest.json')
    }
    const packageIndex = inspectPackage({
      root, entry, authorContext, spec, schemas, report, stats, manifestOptions, certs: manifestCerts,
    })
    if (packageIndex) packages.push(packageIndex)
  })

  // 已登记的作者即使还没有索引条目,也要核对其清单与目录:这样可以发现只放了包目录、
  // 却忘了写 assets.json 条目的情况,也能让空集合同样检查作者目录本身。
  registeredAuthors.forEach((author) => {
    if (!authorCache.has(author)) {
      authorCache.set(author, inspectAuthor({ root, author, report }))
    }
  })

  const indexedKeys = new Set(entries.map((entry) => entry.author + '/' + entry.id))
  const authorContexts = [...authorCache.values()]
  authorContexts.forEach((context) => {
    if (!context) return
    stats.authors += 1
    context.presentDirs.forEach((id) => {
      if (indexedKeys.has(context.author + '/' + id)) return
      report.warn('PACKAGE_NOT_INDEXED',
        '包目录 ' + context.authorRel + '/' + id + ' 存在,但 assets.json 里没有对应条目',
        'assets.json')
      // 未索引的包目录也要核对其清单:它同样会被复制进 dist/,发布后照样能被消费方取到
      verifyPackageManifest({
        packageDir: join(context.authorDir, id),
        packageRel: context.authorRel + '/' + id,
        report,
        certs: manifestCerts,
        verifySignature: manifestOptions.verifyManifestSignature,
      })
    })
  })

  return finish(options.collectionName || collectionMeta.name)
}

/**
 * 把问题列表格式化为可读文本。
 * @param {Array<object>} problems 问题列表
 * @returns {string}
 */
export function formatProblems(problems) {
  return problems
    .map((item) => {
      const level = item.level === 'error' ? '[错误]' : '[警告]'
      const location = item.path ? ' (' + item.path + ')' : ''
      return level + ' ' + item.code + ' ' + item.message + location
    })
    .join(String.fromCharCode(10))
}
