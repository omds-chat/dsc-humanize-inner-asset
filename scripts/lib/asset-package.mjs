/**
 * 资产包校验:资产包格式在本仓库内的机器判据,只使用 Node 内置模块。
 *
 * 判据来源是 dsc-humanize-asset-template 的规范 1.0.0,其 Schema 以只读副本形式放在
 * 本仓库的 specs/ 与 schemas/。这里只做结构与取值校验,不解释内容语义,不联网,
 * 不执行包内任何内容。
 *
 * 一个包就是一个目录:asset.json 加若干已声明的类型目录。本模块校验单个包,
 * 合集层面的目录、清单与版本规则由 collection-verify.mjs 负责。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** 四类内容类型,顺序与规范 3.1 一致 */
export const CONTENT_TYPES = ['persona', 'labels', 'strategies', 'injection']
export const CONTENT_TYPE_SET = new Set(CONTENT_TYPES)
export const TYPE_LABELS = {
  persona: '人物设定',
  labels: '分类标签集',
  strategies: '策略规则',
  injection: '注入文本',
}
/** 包根目录的元数据文件名 */
export const METADATA_FILE = 'asset.json'
/** 规范区:版本登记与 Schema 路径 */
const SPEC_VERSION_FILE = path.join('specs', 'spec-version.json')
const SPEC_KEYS = ['package', 'persona', 'labels', 'strategies', 'injection']
const ALLOWED_ROOT_FILES = new Set([METADATA_FILE, 'README.md'])

/** 校验脚本支持的 JSON Schema 关键字;出现其他关键字即视为脚本缺陷 */
const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', '$comment', '$defs', '$ref', 'title', 'description', 'type',
  'properties', 'required', 'additionalProperties', 'pattern', 'minLength', 'maxLength',
  'enum', 'const', 'items', 'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'examples', 'default', 'deprecated',
])

/* ---------- 通用工具 ---------- */

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const typeOf = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const matchesType = (value, type) => {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'number') return typeof value === 'number'
  return typeOf(value) === type
}

const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right)

const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

const issue = (code, at, message) => ({ code, path: at, message })

const patternCache = new Map()

const compilePattern = (pattern) => {
  if (patternCache.has(pattern)) return patternCache.get(pattern)
  let compiled = null
  try {
    compiled = new RegExp(pattern)
  } catch {
    compiled = null
  }
  patternCache.set(pattern, compiled)
  return compiled
}

const resolvePointer = (ref, document) => {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined
  const segments = ref.slice(2).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
  let node = document
  for (const segment of segments) {
    if (!isObject(node) && !Array.isArray(node)) return undefined
    node = node[segment]
    if (node === undefined) return undefined
  }
  return node
}

/* ---------- JSON Schema 子集校验 ---------- */

const collectKeywords = (node, found) => {
  if (Array.isArray(node)) {
    node.forEach((item) => collectKeywords(item, found))
    return
  }
  if (!isObject(node)) return
  Object.keys(node).forEach((key) => {
    if (key === 'properties' || key === '$defs' || key === 'patternProperties') {
      Object.values(node[key]).forEach((child) => collectKeywords(child, found))
      return
    }
    found.add(key)
    if (key === 'items' || key === 'additionalProperties' || key === 'not' || key === 'if'
      || key === 'then' || key === 'else' || key === 'allOf' || key === 'anyOf' || key === 'oneOf') {
      collectKeywords(node[key], found)
    }
  })
}

const assertSupportedKeywords = (name, schema) => {
  const found = new Set()
  collectKeywords(schema, found)
  const unknown = [...found].filter((key) => !SUPPORTED_KEYWORDS.has(key) && !/^[0-9]+$/.test(key))
  if (unknown.length > 0) {
    throw new Error('Schema ' + name + ' 使用了校验脚本尚未支持的关键字: ' + unknown.join('、'))
  }
}

const validateSchema = (schema, value, at, root, code, issues, depth) => {
  if (schema === true) return
  if (schema === false) {
    issues.push(issue(code, at, '该位置不允许出现任何值'))
    return
  }
  if (!isObject(schema)) {
    issues.push(issue('PACKAGE_SCHEMA_DEFECT', at, '子 schema 必须是对象或布尔值'))
    return
  }
  if (depth > 32) {
    issues.push(issue('PACKAGE_SCHEMA_DEFECT', at, '$ref 嵌套过深'))
    return
  }
  if (schema.$ref !== undefined) {
    const target = resolvePointer(schema.$ref, root)
    if (target === undefined) {
      issues.push(issue('PACKAGE_SCHEMA_DEFECT', at, '无法解析 $ref ' + schema.$ref))
      return
    }
    validateSchema(target, value, at, root, code, issues, depth + 1)
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((type) => matchesType(value, type))) {
      issues.push(issue(code, at, '类型应为 ' + types.join(' 或 ') + ',实际为 ' + typeOf(value)))
      return
    }
  }
  if (schema.const !== undefined && !sameValue(schema.const, value)) {
    issues.push(issue(code, at, '取值必须是 ' + JSON.stringify(schema.const)))
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => sameValue(item, value))) {
    issues.push(issue(code, at,
      '取值必须是 ' + schema.enum.map((item) => JSON.stringify(item)).join('、') + ' 之一,实际为 ' + JSON.stringify(value)))
  }
  if (typeof value === 'string') {
    const length = [...value].length
    if (schema.minLength !== undefined && length < schema.minLength) {
      issues.push(issue(code, at, '长度不得小于 ' + String(schema.minLength)))
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      issues.push(issue(code, at, '长度不得大于 ' + String(schema.maxLength)))
    }
    if (schema.pattern !== undefined) {
      const compiled = compilePattern(schema.pattern)
      if (compiled === null) {
        issues.push(issue('PACKAGE_SCHEMA_DEFECT', at, 'schema 的 pattern 无法编译: ' + schema.pattern))
      } else if (!compiled.test(value)) {
        issues.push(issue(code, at, JSON.stringify(value) + ' 不符合 ' + schema.pattern))
      }
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push(issue(code, at, '不得小于 ' + String(schema.minimum)))
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push(issue(code, at, '不得大于 ' + String(schema.maximum)))
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      issues.push(issue(code, at, '必须大于 ' + String(schema.exclusiveMinimum)))
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      issues.push(issue(code, at, '必须小于 ' + String(schema.exclusiveMaximum)))
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push(issue(code, at, '至少需要 ' + String(schema.minItems) + ' 项,实际为 ' + String(value.length) + ' 项'))
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      issues.push(issue(code, at, '最多允许 ' + String(schema.maxItems) + ' 项,实际为 ' + String(value.length) + ' 项'))
    }
    if (schema.uniqueItems === true) {
      const seen = new Set()
      value.forEach((item, index) => {
        const key = JSON.stringify(item)
        if (seen.has(key)) {
          issues.push(issue(code, at + '/' + String(index), '取值与前面重复: ' + key))
        }
        seen.add(key)
      })
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        validateSchema(schema.items, item, at + '/' + String(index), root, code, issues, depth + 1)
      })
    }
  }
  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {}
    if (Array.isArray(schema.required)) {
      schema.required.forEach((name) => {
        if (!Object.prototype.hasOwnProperty.call(value, name)) {
          issues.push(issue(code, at + '/' + name, '缺少必填字段'))
        }
      })
    }
    Object.keys(value).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        validateSchema(properties[key], value[key], at + '/' + key, root, code, issues, depth + 1)
        return
      }
      if (schema.additionalProperties === false) {
        issues.push(issue(code, at + '/' + key, '不允许出现该字段;字段集合见规范第五节与第七节'))
        return
      }
      if (isObject(schema.additionalProperties)) {
        validateSchema(schema.additionalProperties, value[key], at + '/' + key, root, code, issues, depth + 1)
      }
    })
  }
}

/* ---------- 规范区 ---------- */

/**
 * 读取规范区:版本登记与四类内容的 Schema。
 * 路径取自 specs/spec-version.json 的 schemas 字段,与其在模板仓库中的相对位置一致。
 * @param {string} rootDir 合集根目录
 * @returns {{spec: object, schemas: object}}
 */
export function loadSpec(rootDir) {
  const specPath = path.join(rootDir, SPEC_VERSION_FILE)
  if (!existsSync(specPath)) {
    throw new Error('缺少规范版本登记 ' + SPEC_VERSION_FILE + ';它是资产包校验的唯一判据来源')
  }
  let spec
  try {
    spec = JSON.parse(stripBom(readFileSync(specPath, 'utf8')))
  } catch (error) {
    throw new Error(SPEC_VERSION_FILE + ' 不是合法 JSON: ' + error.message)
  }
  if (!isObject(spec)) throw new Error(SPEC_VERSION_FILE + ' 的顶层必须是对象')
  if (typeof spec.format_version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(spec.format_version)) {
    throw new Error(SPEC_VERSION_FILE + ' 的 format_version 必须是三段数字')
  }
  const schemas = {}
  SPEC_KEYS.forEach((key) => {
    if (!isObject(spec.schemas) || typeof spec.schemas[key] !== 'string') {
      throw new Error(SPEC_VERSION_FILE + ' 缺少 schemas.' + key)
    }
    const relPath = spec.schemas[key]
    const schemaPath = path.join(rootDir, relPath)
    if (!existsSync(schemaPath)) throw new Error('Schema 文件不存在: ' + relPath)
    let schema
    try {
      schema = JSON.parse(stripBom(readFileSync(schemaPath, 'utf8')))
    } catch (error) {
      throw new Error(relPath + ' 不是合法 JSON: ' + error.message)
    }
    assertSupportedKeywords(relPath, schema)
    schemas[key] = schema
  })
  const declaredTypes = schemas.package.$defs && schemas.package.$defs.contentType && schemas.package.$defs.contentType.enum
  if (!Array.isArray(declaredTypes) || declaredTypes.join(',') !== CONTENT_TYPES.join(',')) {
    throw new Error('元数据 Schema 的类型枚举与本脚本的类型集合不一致: ' + JSON.stringify(declaredTypes))
  }
  return { spec, schemas }
}

/* ---------- 包的读取 ---------- */

const emptyTree = () => ({ files: new Map(), dirs: new Set(), rootEntries: new Map() })

/**
 * 把一个包目录读进内存树。只读,不写回。
 * @param {string} dir 包目录
 */
export function readPackageTree(dir) {
  const tree = emptyTree()
  readdirSync(dir).sort().forEach((name) => {
    const abs = path.join(dir, name)
    const stat = statSync(abs)
    if (stat.isDirectory()) {
      tree.dirs.add(name)
      tree.rootEntries.set(name, 'dir')
      readdirSync(abs).sort().forEach((child) => {
        const childAbs = path.join(abs, child)
        if (statSync(childAbs).isDirectory()) {
          tree.dirs.add(name + '/' + child)
          return
        }
        tree.files.set(name + '/' + child, readFileSync(childAbs, 'utf8'))
      })
      return
    }
    if (stat.isFile()) {
      tree.rootEntries.set(name, 'file')
      tree.files.set(name, readFileSync(abs, 'utf8'))
    }
  })
  return tree
}

/**
 * 由内存结构构造同一形状的树,供自检使用。
 * @param {object} input 键为包根条目,字符串表示文件内容,对象表示目录
 */
export function treeFrom(input) {
  const tree = emptyTree()
  Object.keys(input).forEach((name) => {
    const value = input[name]
    if (typeof value === 'string') {
      tree.files.set(name, value)
      tree.rootEntries.set(name, 'file')
      return
    }
    tree.dirs.add(name)
    tree.rootEntries.set(name, 'dir')
    Object.keys(value).forEach((child) => {
      const childValue = value[child]
      if (typeof childValue === 'string') {
        tree.files.set(name + '/' + child, childValue)
        return
      }
      tree.dirs.add(name + '/' + child)
    })
  })
  return tree
}

const typeFiles = (tree, type) => [...tree.files.keys()].filter((relPath) => relPath.startsWith(type + '/')).sort()

/* ---------- 单包校验 ---------- */

const majorOf = (version) => String(version).split('.')[0]

/**
 * 校验一个已读入内存的包。
 * @param {{files: Map<string, string>, dirs: Set<string>, rootEntries: Map<string, string>}} tree 包树
 * @param {{format_version: string}} spec 规范版本登记
 * @param {object} schemas 四类内容与元数据的 Schema
 * @returns {{issues: Array<object>, summary: object}}
 */
export function validatePackage(tree, spec, schemas) {
  const issues = []
  const summary = { id: null, version: null, formatVersion: null, author: null, types: [], counts: {} }

  if (!tree.files.has(METADATA_FILE)) {
    issues.push(issue('PACKAGE_METADATA_MISSING', METADATA_FILE, '包根目录缺少元数据 ' + METADATA_FILE))
    return { issues, summary }
  }

  let metadata = null
  try {
    metadata = JSON.parse(stripBom(tree.files.get(METADATA_FILE)))
  } catch (error) {
    issues.push(issue('PACKAGE_METADATA_JSON', METADATA_FILE, '不是合法 JSON: ' + error.message))
    return { issues, summary }
  }

  validateSchema(schemas.package, metadata, METADATA_FILE, schemas.package, 'PACKAGE_METADATA_SCHEMA', issues, 0)
  if (issues.length > 0) return { issues, summary }

  summary.id = metadata.id
  summary.version = metadata.version
  summary.formatVersion = metadata.formatVersion
  summary.author = typeof metadata.author === 'string' ? metadata.author : null
  summary.types = [...metadata.types]

  if (majorOf(metadata.formatVersion) !== majorOf(spec.format_version)) {
    issues.push(issue('PACKAGE_FORMAT_VERSION', METADATA_FILE + '/formatVersion',
      '格式版本 ' + metadata.formatVersion + ' 与当前支持的 ' + spec.format_version + ' 主版本不同'))
  }

  const declared = new Set(metadata.types)

  tree.rootEntries.forEach((kind, name) => {
    if (name === METADATA_FILE) return
    if (kind === 'file' && ALLOWED_ROOT_FILES.has(name)) return
    if (kind === 'dir' && CONTENT_TYPE_SET.has(name)) return
    issues.push(issue('PACKAGE_ROOT_ENTRY', name,
      '包根目录不允许出现该' + (kind === 'dir' ? '目录' : '文件') + ';只允许 ' + METADATA_FILE + '、四类内容目录与可选的 README.md'))
  })

  CONTENT_TYPES.forEach((type) => {
    const hasDir = tree.dirs.has(type)
    const files = typeFiles(tree, type)
    if (!hasDir && files.length === 0) {
      if (declared.has(type)) {
        issues.push(issue('PACKAGE_TYPE_CONTENT_MISSING', type, '元数据声明了「' + TYPE_LABELS[type] + '」,但目录 ' + type + '/ 不存在'))
      }
      return
    }
    if (!declared.has(type)) {
      issues.push(issue('PACKAGE_TYPE_UNDECLARED', type, '存在 ' + type + '/ 内容,但元数据的 types 未声明「' + TYPE_LABELS[type] + '」'))
      return
    }
    if (files.length === 0) {
      issues.push(issue('PACKAGE_CONTENT_EMPTY', type, type + '/ 目录存在但没有内容文件;声明了该类型就必须给出至少一项内容'))
      return
    }
    ;[...tree.dirs].forEach((dir) => {
      if (dir.startsWith(type + '/')) {
        issues.push(issue('PACKAGE_NESTED_DIR', dir, '类型目录下不允许嵌套子目录'))
      }
    })
    files.forEach((relPath) => {
      if (!relPath.endsWith('.json')) {
        issues.push(issue('PACKAGE_CONTENT_NOT_JSON', relPath, '内容文件必须是 .json'))
      }
    })
  })

  const labelIds = new Set()

  CONTENT_TYPES.forEach((type) => {
    if (!declared.has(type)) return
    const files = typeFiles(tree, type).filter((relPath) => relPath.endsWith('.json'))
    const ids = new Map()
    summary.counts[type] = files.length
    files.forEach((relPath) => {
      let doc = null
      try {
        doc = JSON.parse(stripBom(tree.files.get(relPath)))
      } catch (error) {
        issues.push(issue('PACKAGE_CONTENT_JSON', relPath, '不是合法 JSON: ' + error.message))
        return
      }
      validateSchema(schemas[type], doc, relPath, schemas[type], 'PACKAGE_CONTENT_SCHEMA', issues, 0)
      if (isObject(doc) && typeof doc.id === 'string') {
        if (ids.has(doc.id)) {
          issues.push(issue('PACKAGE_CONTENT_DUPLICATE_ID', relPath, '内容标识 ' + doc.id + ' 与 ' + ids.get(doc.id) + ' 重复'))
        } else {
          ids.set(doc.id, relPath)
        }
        if (type === 'labels') labelIds.add(doc.id)
      }
      if (type !== 'strategies' || !isObject(doc) || !Array.isArray(doc.rules)) return
      doc.rules.forEach((rule, index) => {
        const at = relPath + '/rules/' + String(index)
        if (!isObject(rule)) return
        if (isObject(rule.strategy) && Object.keys(rule.strategy).length === 0) {
          issues.push(issue('PACKAGE_RULE_STRATEGY_EMPTY', at + '/strategy', '策略对象至少给出一个字段'))
        }
        if (declared.has('labels') && typeof rule.label === 'string' && !labelIds.has(rule.label)) {
          issues.push(issue('PACKAGE_RULE_LABEL_UNRESOLVED', at + '/label',
            '引用的标签 ' + rule.label + ' 不在本包标签集内;包内声明了 labels 时引用必须自洽'))
        }
      })
    })
  })

  return { issues, summary }
}

/* ---------- 自检 ---------- */

const metaText = (overrides) => {
  const base = {
    formatVersion: '1.0.0',
    id: 'dsc-selftest-asset',
    name: '自检包',
    version: '0.1.0',
    description: '自检用的内存包',
    author: 'omds-chat',
    types: ['persona'],
  }
  return JSON.stringify(Object.assign(base, overrides), null, 2)
}

const personaText = (overrides) => JSON.stringify(Object.assign({ id: 'steady', name: '稳重', prefix: '先给结论。' }, overrides), null, 2)
const labelText = (overrides) => JSON.stringify(Object.assign({ id: 'daily-chat' }, overrides), null, 2)
const strategyText = (overrides) => JSON.stringify(Object.assign({
  id: 'daily-strategy',
  version: '1.0.0',
  rules: [{ label: 'daily-chat', strategy: { temperature: 0.7 } }],
}, overrides), null, 2)

/** 自检用例:每个用例声明一棵内存包与期望出现的问题码 */
export const selfTestCases = [
  {
    name: '四类内容齐全的包通过',
    tree: {
      'asset.json': metaText({ types: ['persona', 'labels', 'strategies', 'injection'] }),
      persona: { 'a.json': personaText() },
      labels: { 'a.json': labelText() },
      strategies: { 'a.json': strategyText() },
      injection: { 'a.json': JSON.stringify({ id: 'brief', name: '简洁', text: '保持简洁。' }) },
    },
    expect: [],
  },
  {
    name: '只声明一类内容通过',
    tree: { 'asset.json': metaText(), persona: { 'a.json': personaText() } },
    expect: [],
  },
  {
    name: '策略包跨包引用标签通过',
    tree: { 'asset.json': metaText({ types: ['strategies'] }), strategies: { 'a.json': strategyText() } },
    expect: [],
  },
  {
    name: '缺少元数据被拒绝',
    tree: { persona: { 'a.json': personaText() } },
    expect: ['PACKAGE_METADATA_MISSING'],
  },
  {
    name: '元数据不是合法 JSON 被拒绝',
    tree: { 'asset.json': '{', persona: { 'a.json': personaText() } },
    expect: ['PACKAGE_METADATA_JSON'],
  },
  {
    name: '包标识格式错误被拒绝',
    tree: { 'asset.json': metaText({ id: 'Bad_ID' }), persona: { 'a.json': personaText() } },
    expect: ['PACKAGE_METADATA_SCHEMA'],
  },
  {
    name: '声明未知类型被拒绝',
    tree: { 'asset.json': metaText({ types: ['prompts'] }), prompts: { 'a.json': '{}' } },
    expect: ['PACKAGE_METADATA_SCHEMA'],
  },
  {
    name: '声明为空被拒绝',
    tree: { 'asset.json': metaText({ types: [] }), persona: { 'a.json': personaText() } },
    expect: ['PACKAGE_METADATA_SCHEMA'],
  },
  {
    name: '声明重复被拒绝',
    tree: { 'asset.json': metaText({ types: ['persona', 'persona'] }), persona: { 'a.json': personaText() } },
    expect: ['PACKAGE_METADATA_SCHEMA'],
  },
  {
    name: '声明了却没有内容被拒绝',
    tree: { 'asset.json': metaText({ types: ['persona', 'labels'] }), persona: { 'a.json': personaText() } },
    expect: ['PACKAGE_TYPE_CONTENT_MISSING'],
  },
  {
    name: '有内容却没有声明被拒绝',
    tree: { 'asset.json': metaText(), persona: { 'a.json': personaText() }, labels: { 'a.json': labelText() } },
    expect: ['PACKAGE_TYPE_UNDECLARED'],
  },
  {
    name: '声明目录为空被拒绝',
    tree: { 'asset.json': metaText({ types: ['persona'] }), persona: {} },
    expect: ['PACKAGE_CONTENT_EMPTY'],
  },
  {
    name: '同类型内容标识重复被拒绝',
    tree: { 'asset.json': metaText(), persona: { 'a.json': personaText(), 'b.json': personaText() } },
    expect: ['PACKAGE_CONTENT_DUPLICATE_ID'],
  },
  {
    name: '规则引用包内不存在的标签被拒绝',
    tree: {
      'asset.json': metaText({ types: ['labels', 'strategies'] }),
      labels: { 'a.json': labelText() },
      strategies: { 'a.json': strategyText({ rules: [{ label: 'missing', strategy: { temperature: 0.5 } }] }) },
    },
    expect: ['PACKAGE_RULE_LABEL_UNRESOLVED'],
  },
  {
    name: '规则策略对象为空被拒绝',
    tree: {
      'asset.json': metaText({ types: ['labels', 'strategies'] }),
      labels: { 'a.json': labelText() },
      strategies: { 'a.json': strategyText({ rules: [{ label: 'daily-chat', strategy: {} }] }) },
    },
    expect: ['PACKAGE_RULE_STRATEGY_EMPTY'],
  },
  {
    name: '内容不是合法 JSON 被拒绝',
    tree: { 'asset.json': metaText(), persona: { 'a.json': '{' } },
    expect: ['PACKAGE_CONTENT_JSON'],
  },
  {
    name: '类型目录放非 JSON 文件被拒绝',
    tree: { 'asset.json': metaText(), persona: { 'a.txt': 'hello' } },
    expect: ['PACKAGE_CONTENT_NOT_JSON'],
  },
  {
    name: '包根目录出现多余条目被拒绝',
    tree: { 'asset.json': metaText(), persona: { 'a.json': personaText() }, notes: { 'a.md': 'hello' } },
    expect: ['PACKAGE_ROOT_ENTRY'],
  },
  {
    name: '格式版本主版本不一致被拒绝',
    tree: { 'asset.json': metaText({ formatVersion: '2.0.0' }), persona: { 'a.json': personaText() } },
    expect: ['PACKAGE_FORMAT_VERSION'],
  },
  {
    name: '数值越界被拒绝',
    tree: {
      'asset.json': metaText({ types: ['labels', 'strategies'] }),
      labels: { 'a.json': labelText() },
      strategies: { 'a.json': strategyText({ rules: [{ label: 'daily-chat', strategy: { temperature: 3 } }] }) },
    },
    expect: ['PACKAGE_CONTENT_SCHEMA'],
  },
]

/**
 * 运行自检用例。
 * @param {{format_version: string}} spec 规范版本登记
 * @param {object} schemas Schema 集合
 * @returns {{ok: boolean, failures: Array<string>, caseCount: number, issueCount: number}}
 */
export function runSelfTest(spec, schemas) {
  const failures = []
  let issueCount = 0
  selfTestCases.forEach((testCase) => {
    const result = validatePackage(treeFrom(testCase.tree), spec, schemas)
    const codes = result.issues.map((item) => item.code)
    issueCount += codes.length
    const ok = testCase.expect.length === 0
      ? result.issues.length === 0
      : testCase.expect.every((code) => codes.includes(code))
    if (!ok) {
      failures.push('用例「' + testCase.name + '」判定不符:期望 '
        + (testCase.expect.length === 0 ? '无问题' : testCase.expect.join('、'))
        + ',实际 ' + (codes.length === 0 ? '无问题' : codes.join('、')))
    }
  })
  return { ok: failures.length === 0, failures, caseCount: selfTestCases.length, issueCount }
}
