#!/usr/bin/env node
/**
 * 资产合集自洽性校验,供 CI 与本地使用。
 *
 * 与 build-collection.mjs 共用 lib/collection-verify.mjs 的校验逻辑,只读不写。
 * 校验范围是收录结构、清单、资产包与标签词表,以及公开证书材料之间的关系;
 * 不做任何签名,也不签发、替换证书。
 *
 * 用法:
 *   node scripts/verify-collection.mjs --dir .
 *   node scripts/verify-collection.mjs --dir . --json
 *   node scripts/verify-collection.mjs --self-test
 */
import { formatProblems, verifyCollection } from './lib/collection-verify.mjs'
import { loadSpec, runSelfTest } from './lib/asset-package.mjs'
import { resolve } from 'node:path'

function usage() {
  process.stdout.write([
    '用法: node scripts/verify-collection.mjs [选项]',
    '',
    '选项:',
    '  --dir <目录>                合集根目录,默认当前目录',
    '  --collection-name <名称>    合集名称,默认取 meta.json 的 name',
    '  --json                      以 JSON 输出校验结果',
    '  --self-test                 运行资产包规则自检,不校验合集',
    '  --help                      显示本说明',
    '',
  ].join(String.fromCharCode(10)))
}

function parseArgs(argv) {
  const options = { dir: '.', collectionName: null, json: false, selfTest: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const separator = arg.indexOf('=')
    const flag = separator === -1 ? arg : arg.slice(0, separator)
    const inline = separator === -1 ? null : arg.slice(separator + 1)
    const take = () => {
      if (inline !== null) return inline
      index += 1
      const value = argv[index]
      if (value === undefined) throw new Error(flag + ' 缺少取值')
      return value
    }
    switch (flag) {
      case '--dir': options.dir = take(); break
      case '--collection-name': options.collectionName = take(); break
      case '--json': options.json = true; break
      case '--self-test': options.selfTest = true; break
      case '--help':
      case '-h': options.help = true; break
      default: throw new Error('未知参数 ' + arg)
    }
  }
  return options
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write('校验失败:' + error.message + String.fromCharCode(10) + String.fromCharCode(10))
    usage()
    return 2
  }
  if (options.help) {
    usage()
    return 0
  }

  const root = resolve(options.dir)

  if (options.selfTest) {
    let spec
    let schemas
    try {
      const loaded = loadSpec(root)
      spec = loaded.spec
      schemas = loaded.schemas
    } catch (error) {
      process.stderr.write('自检失败:规范区读取失败:' + error.message + String.fromCharCode(10))
      return 2
    }
    const result = runSelfTest(spec, schemas)
    if (!result.ok) {
      result.failures.forEach((message) => process.stdout.write('失败: ' + message + String.fromCharCode(10)))
      process.stdout.write('自检未通过,' + String(result.failures.length) + ' 项不符合预期' + String.fromCharCode(10))
      return 1
    }
    process.stdout.write('自检通过,' + String(result.caseCount) + ' 个用例覆盖资产包的结构与取值规则' + String.fromCharCode(10))
    return 0
  }

  const result = verifyCollection(root, { collectionName: options.collectionName })

  if (options.json) {
    const payload = {
      ok: result.ok,
      collection: result.collectionName,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      stats: result.stats,
      certificates: result.certificates,
      packages: result.packages,
      problems: result.problems,
    }
    process.stdout.write(JSON.stringify(payload, null, 2) + String.fromCharCode(10))
    return result.ok ? 0 : 1
  }

  if (result.problems.length > 0) {
    process.stdout.write(formatProblems(result.problems) + String.fromCharCode(10))
  }
  const summary = '合集 ' + result.collectionName + ':'
    + String(result.stats.authors) + ' 个作者,'
    + String(result.stats.packages) + ' 个资产包,'
    + String(result.stats.versions) + ' 个版本,'
    + String(result.stats.contentItems) + ' 项内容'
  if (result.ok) {
    process.stdout.write('校验通过 ' + summary + ',警告 ' + String(result.warningCount) + ' 条' + String.fromCharCode(10))
  } else {
    process.stdout.write('校验未通过 ' + summary + ',错误 ' + String(result.errorCount)
      + ' 条,警告 ' + String(result.warningCount) + ' 条' + String.fromCharCode(10))
  }
  if (result.certificates.root) {
    process.stdout.write('信任锚: ' + result.certificates.root.subject.split(String.fromCharCode(10)).join(' ') + String.fromCharCode(10))
  }
  if (result.certificates.eec) {
    process.stdout.write('合集 EEC: ' + result.certificates.eec.subject.split(String.fromCharCode(10)).join(' ') + String.fromCharCode(10))
  }
  return result.ok ? 0 : 1
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write('校验失败:' + (error && error.message ? error.message : String(error)) + String.fromCharCode(10))
  process.exitCode = 1
}
