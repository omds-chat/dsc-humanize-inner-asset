#!/usr/bin/env node
/**
 * 校验合集并生成分发内容。
 *
 * 流程: 先做合集自洽性校验(结构、清单、资产包、标签词表与公开证书材料),不通过则以非零退出码结束;
 * 通过后把根目录索引、assets/ 与 certs/ 复制到输出目录,为每个包目录生成包层清单
 * manifest.json,并写入 build-info.json 作为发布统计。
 *
 * 本脚本不生成任何签名。资产包是纯数据,不做代码签名;合集页面的整站签名由 CI 用
 * 合集 EEC 私钥在 dist/ 上完成,产物为逐文件 <文件>.sig、web_files.json 与 eec.pem。
 * 包层清单就在 dist/ 的包目录里,是普通的 .json,因此同一轮整站签名会为它产出
 * manifest.json.sig,消费方安装时按这个名字读清单签名;本地没有私钥时清单保持未签名。
 *
 * 用法:
 *   node scripts/build-collection.mjs --dir . --out dist
 *   node scripts/build-collection.mjs --dir . --collection-name demo --out dist
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { formatProblems, verifyCollection } from './lib/collection-verify.mjs'
import { generatePackageManifests } from './lib/manifest.mjs'

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
    '整站签名不在这里做: CI 用合集 EEC 私钥对 dist/ 生成逐文件 .sig、web_files.json 与 eec.pem;',
    '其中包目录的 manifest.json 与其他 .json 一样被签名,签名为 manifest.json.sig。',
    '清单在这里生成,但不在这里签名: 本地没有私钥时清单保持未签名。',
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

  // 包层清单按复制后的实际字节生成:覆盖 versions.json 与各版本目录下的全部包内文件,
  // 清单自身与其签名不进清单。内容变化时删掉旧签名,避免留下与清单对不上的 manifest.json.sig。
  const manifestWarnings = []
  const manifests = generatePackageManifests({
    root: outDir,
    packages,
    warn: (code, message, path) => {
      manifestWarnings.push({ level: 'warning', code, message, path: path === undefined ? null : path })
    },
  })
  files += manifests.length + manifests.reduce((count, item) => count + item.files, 0)

  const info = {
    collection: collectionName,
    asset_count: stats.packages,
    author_count: new Set(packages.map((item) => item.author)).size,
    version_count: stats.versions,
    content_count: stats.contentItems,
    manifest_count: manifests.length,
    assets: packages.map((item) => ({
      id: item.id,
      author: item.author,
      latest: item.latest,
      versions: item.versions,
      types: item.types,
    })),
  }
  writeFileSync(join(outDir, 'build-info.json'), JSON.stringify(info, null, 2) + NEWLINE, 'utf8')
  files += 1
  return { files, info, manifests, manifestWarnings }
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
  // 源码树里没有清单是正常状态:构建按实际字节重新生成,缺清单与未签名不必重复提示
  const expectedSourcesWarnings = new Set(['MANIFEST_MISSING', 'MANIFEST_SIG_MISSING'])
  const warnings = result.problems.filter(
    (item) => item.level === 'warning' && !expectedSourcesWarnings.has(item.code),
  )

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
  const manifestFiles = dist.manifests.reduce((count, item) => count + item.files, 0)
  process.stdout.write('包层清单已写入 ' + String(dist.manifests.length) + ' 份,覆盖 ' + String(manifestFiles)
    + ' 个文件;清单未签名,签名由下一步的整站签名补齐' + NEWLINE)
  if (dist.manifestWarnings.length > 0) {
    process.stdout.write('清单警告 ' + String(dist.manifestWarnings.length) + ' 条:' + NEWLINE)
    process.stdout.write(formatProblems(dist.manifestWarnings) + NEWLINE)
  }
  process.stdout.write('下一步: CI 用合集 EEC 私钥对 dist/ 做整站签名,产出逐文件 .sig、web_files.json 与 eec.pem;'
    + '包目录的 manifest.json 与其他 .json 一样被签名,签名为 manifest.json.sig' + NEWLINE)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write('构建失败:' + (error && error.message ? error.message : String(error)) + NEWLINE)
  process.exitCode = 1
}
