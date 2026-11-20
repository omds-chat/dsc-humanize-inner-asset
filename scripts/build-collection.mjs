#!/usr/bin/env node
/**
 * 校验合集并生成分发内容。
 *
 * 流程: 先做合集自洽性校验(结构、清单、资产包、标签词表与公开证书材料),不通过则以非零退出码结束;
 * 通过后把根目录索引、assets/ 与 certs/ 复制到输出目录,并写入 build-info.json 作为发布统计。
 *
 * 本脚本不生成任何签名。资产包是纯数据,不做代码签名;合集页面的整站签名由 CI 用
 * 合集 EEC 私钥在 dist/ 上完成,产物为逐文件 <文件>.sig、web_files.json 与 eec.pem。
 *
 * 用法:
 *   node scripts/build-collection.mjs --dir . --out dist
 *   node scripts/build-collection.mjs --dir . --collection-name demo --out dist
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { formatProblems, verifyCollection } from './lib/collection-verify.mjs'

/** 根目录内随 dist 分发的文件 */
const ROOT_DIST_FILES = ['meta.json', 'assets.json', 'tags.json']
/** 连整树复制的目录;certs 是公开材料,签名的信任入口 */
const DIST_TREES = ['assets', 'certs']
const NEWLINE = String.fromCharCode(10)

function usage() {
  process.stdout.write([
    '用法: node scripts/build-collection.mjs [选项]',
    '',
    '选项:',
    '  --dir <目录>                合集根目录,默认当前目录',
    '  --out <目录>                分发内容输出目录,默认 dist',
    '  --collection-name <名称>    合集名称,默认取 meta.json 的 name',
    '  --help                      显示本说明',
    '',
    '整站签名不在这里做: CI 用合集 EEC 私钥对 dist/ 生成逐文件 .sig、web_files.json 与 eec.pem。',
    '',
  ].join(NEWLINE))
}

function parseArgs(argv) {
  const options = { dir: '.', out: 'dist', collectionName: null, help: false }
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
      case '--out': options.out = take(); break
      case '--collection-name': options.collectionName = take(); break
      case '--help':
      case '-h': options.help = true; break
      default: throw new Error('未知参数 ' + arg)
    }
  }
  return options
}

function copyTree(srcDir, destDir) {
  if (!existsSync(srcDir)) return 0
  mkdirSync(destDir, { recursive: true })
  let count = 0
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name)
    const dest = join(destDir, entry.name)
    if (entry.isDirectory()) {
      count += copyTree(src, dest)
    } else if (entry.isFile()) {
      copyFileSync(src, dest)
      count += 1
    }
  }
  return count
}

function writeDist({ root, outDir, collectionName, packages, stats }) {
  if (resolve(outDir) === resolve(root)) throw new Error('输出目录不能与合集根目录相同')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  let files = 0
  for (const name of ROOT_DIST_FILES) {
    const src = join(root, name)
    if (!existsSync(src)) continue
    copyFileSync(src, join(outDir, name))
    files += 1
  }
  for (const name of DIST_TREES) {
    files += copyTree(join(root, name), join(outDir, name))
  }
  const info = {
    collection: collectionName,
    asset_count: stats.packages,
    author_count: new Set(packages.map((item) => item.author)).size,
    version_count: stats.versions,
    content_count: stats.contentItems,
    assets: packages,
  }
  writeFileSync(join(outDir, 'build-info.json'), JSON.stringify(info, null, 2) + NEWLINE, 'utf8')
  files += 1
  return { files, info }
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write('构建失败:' + error.message + NEWLINE + NEWLINE)
    usage()
    return 2
  }
  if (options.help) {
    usage()
    return 0
  }

  const root = resolve(options.dir)
  const outDir = resolve(options.out)
  const result = verifyCollection(root, { collectionName: options.collectionName })
  const errors = result.problems.filter((item) => item.level === 'error')
  const warnings = result.problems.filter((item) => item.level === 'warning')

  if (errors.length > 0) {
    process.stderr.write('合集校验未通过,共 ' + String(errors.length) + ' 个错误:' + NEWLINE)
    process.stderr.write(formatProblems(result.problems) + NEWLINE)
    return 1
  }

  let dist
  try {
    dist = writeDist({
      root,
      outDir,
      collectionName: result.collectionName,
      packages: result.packages,
      stats: result.stats,
    })
  } catch (error) {
    process.stderr.write('构建失败:' + error.message + NEWLINE)
    return 1
  }

  process.stdout.write(
    '合集 ' + result.collectionName + ' 校验通过:'
    + String(result.stats.authors) + ' 个作者,'
    + String(result.stats.packages) + ' 个资产包,'
    + String(result.stats.versions) + ' 个版本,'
    + String(result.stats.contentItems) + ' 项内容' + NEWLINE,
  )
  if (warnings.length > 0) {
    process.stdout.write('警告 ' + String(warnings.length) + ' 条:' + NEWLINE)
    process.stdout.write(formatProblems(warnings) + NEWLINE)
  }
  process.stdout.write('分发内容已写入 ' + outDir + ',共 ' + String(dist.files) + ' 个文件' + NEWLINE)
  process.stdout.write('下一步: CI 用合集 EEC 私钥对 dist/ 做整站签名,产出 .sig、web_files.json 与 eec.pem' + NEWLINE)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write('构建失败:' + (error && error.message ? error.message : String(error)) + NEWLINE)
  process.exitCode = 1
}
