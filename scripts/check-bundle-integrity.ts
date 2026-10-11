#!/usr/bin/env bun
/**
 * 构建产物完整性检查脚本
 *
 * 检查 Bun.build({ splitting: true }) 输出的 dist/ 目录中是否存在：
 * 1. 引用了不存在的 chunk 文件（断链）
 * 2. 通过 __require() 或 import() 引用的第三方模块（非 Node.js 内置），在生产环境中会找不到
 * 3. 缺失的静态 import 依赖（跨 chunk 引用目标不存在）
 *
 * 用法：
 *   bun scripts/check-bundle-integrity.ts          # 检查当前 dist/
 *   bun scripts/check-bundle-integrity.ts ./dist    # 指定目录
 */

import { readdir, readFile, access } from 'fs/promises'
import { join, resolve, dirname, sep } from 'path'
import { isBuiltin } from 'node:module'
import ts from 'typescript'

const BUN_MODULES = new Set(['bun', 'bun:ffi', 'bun:test', 'bun:sqlite', 'bun:jsc', 'bun:wrap'])
// Bun's isBuiltin() includes npm packages which Node does not provide.
const BUN_ALIASED_PACKAGES = new Set(['undici', 'ws', 'node-fetch'])
// Node 22+ provides SQLite, while some Bun versions omit it from isBuiltin().
const NODE_ONLY_BUILTINS = new Set(['node:sqlite'])

// localVault/keychain.ts explicitly catches load failure and the vault
// falls back to encrypted file storage. Report reduced capability, not a
// guaranteed startup failure; do not silently whitelist unknown libraries.
const OPTIONAL_FALLBACK_MODULES = new Set(['@napi-rs/keyring'])

// macOS JXA / native 框架（通过 ObjC.import，非真正的 require）
const NATIVE_FRAMEWORKS = new Set([
  'AppKit',
  'CoreGraphics',
  'Foundation',
  'UIKit',
])

interface Finding {
  type:
    | 'broken-chunk-ref'
    | 'third-party-require'
    | 'third-party-import'
    | 'third-party-node-require'
    | 'bun-runtime-only'
    | 'optional-runtime-unavailable'
    | 'syntax-error'
  severity: 'error' | 'warning'
  file: string
  line: number
  module: string
  snippet: string
}

export async function listBundleJavaScript(distDir: string): Promise<string[]> {
  const entry = await readFile(join(distDir, 'cli.js'), 'utf8').catch(() => { throw new Error('Missing CLI entry: cli.js') })
  const generation = entry.match(/^import\s+["']\.\/(build-[\w-]+)\/cli\.js["']/)?.[1]
  const files: string[] = []
  async function walk(directory: string, prefix = ''): Promise<void> {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + item.name
      if (item.isFile() && item.name.endsWith('.js')) files.push(name)
      if (item.isDirectory() && item.name === 'chunks') await walk(join(directory, item.name), name + '/')
    }
  }
  if (generation) {
    await access(join(distDir, generation, 'cli.js')).catch(() => { throw new Error('Missing active generation CLI entry') })
    for (const name of ['cli.js', 'cli-bun.js', 'cli-node.js']) {
      if (await Bun.file(join(distDir, name)).exists()) files.push(name)
    }
    await walk(join(distDir, generation), generation + '/')
  } else {
    await walk(distDir)
  }
  if (!files.length) throw new Error('No JavaScript build files found')
  return files.sort()
}

/** Read only manifests inside the target; never borrow the source repo's deps. */
async function packageDependencies(file: string, root: string): Promise<Set<string>> {
  let directory = dirname(file)
  while (directory === root || directory.startsWith(root + sep)) {
    const manifest = await readFile(join(directory, 'package.json'), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (manifest !== null) {
      const metadata = JSON.parse(manifest)
      return new Set([...Object.keys(metadata.dependencies ?? {}), ...Object.keys(metadata.optionalDependencies ?? {})])
    }
    directory = dirname(directory)
  }
  return new Set()
}

async function main() {
  const distDir = resolve(process.argv[2] || './dist')

  console.log(`\n🔍 检查构建产物完整性: ${distDir}\n`)

  // 1. 列出所有 chunk 文件
  let files: string[]
  try {
    files = await listBundleJavaScript(distDir)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(`❌ 构建入口或目录不完整: ${distDir}`)
    console.error('   请先运行 bun run build')
    process.exit(1)
  }

  console.log(`📦 找到 ${files.length} 个 JS 文件\n`)

  const findings: Finding[] = []

  // 2. 逐文件扫描
  for (const file of files) {
    const filePath = join(distDir, file)
    const content = await readFile(filePath, 'utf-8')
    const dependencies = await packageDependencies(filePath, distDir)
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const options = { noResolve: true, noLib: true, allowJs: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext }
    const program = ts.createProgram([filePath], options, {
      ...ts.createCompilerHost(options),
      getSourceFile: name => name === filePath ? source : undefined,
      readFile: () => undefined, fileExists: name => name === filePath,
    })
    for (const diagnostic of program.getSyntacticDiagnostics(source)) {
      findings.push({ type: 'syntax-error', severity: 'error', file,
        line: source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
        module: '', snippet: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') })
    }
    const checker = program.getTypeChecker()
    const factories = new Set<ts.Symbol>()
    const loaders = new Set<ts.Symbol>()
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !['module', 'node:module'].includes(statement.moduleSpecifier.text)) continue
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if ((item.propertyName ?? item.name).text === 'createRequire') {
          const symbol = checker.getSymbolAtLocation(item.name)
          if (symbol) factories.add(symbol)
        }
      }
    }
    function collectLoaders(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && factories.has(checker.getSymbolAtLocation(node.initializer.expression)!)) {
        const symbol = checker.getSymbolAtLocation(node.name)
        if (symbol) loaders.add(symbol)
      }
      ts.forEachChild(node, collectLoaders)
    }
    collectLoaders(source)
    const references: Array<{ specifier: string; node: ts.Node; type: Finding['type'] }> = []
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        references.push({ specifier: node.moduleSpecifier.text, node, type: 'third-party-import' })
      } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]!)) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text : ''
        const type = node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'third-party-import'
          : name === 'nodeRequire' || (ts.isIdentifier(node.expression) && loaders.has(checker.getSymbolAtLocation(node.expression)!)) ? 'third-party-node-require'
          : ['require', '__require'].includes(name) ? 'third-party-require' : null
        if (type) references.push({ specifier: node.arguments[0]!.text, node, type })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    for (const { specifier: mod, node, type } of references) {
      const location = source.getLineAndCharacterOfPosition(node.getStart(source))
      const base = { file, line: location.line + 1, module: mod, snippet: node.getText(source).slice(0, 120) }
      if (mod.startsWith('./') || mod.startsWith('../') || mod.startsWith('/')) {
        if (!(await access(resolve(dirname(filePath), mod)).then(() => true, () => false))) {
          findings.push({ ...base, type: 'broken-chunk-ref', severity: 'error' })
        }
        continue
      }
      if (BUN_MODULES.has(mod)) {
        findings.push({ ...base, type: 'bun-runtime-only', severity: 'warning' })
        continue
      }
      if (NODE_ONLY_BUILTINS.has(mod) || (isBuiltin(mod) && !BUN_ALIASED_PACKAGES.has(mod.replace(/^node:/, ''))) || NATIVE_FRAMEWORKS.has(mod)) continue
      const packageName = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0]!
      if (dependencies.has(packageName)) continue
      if (OPTIONAL_FALLBACK_MODULES.has(mod) && hasLoadErrorHandler(node)) {
        findings.push({ ...base, type: 'optional-runtime-unavailable', severity: 'warning' })
      } else findings.push({ ...base, type, severity: 'error' })
    }
  }

  // 3. 汇总报告
  const errors = findings.filter(f => f.severity === 'error')
  const warnings = findings.filter(f => f.severity === 'warning')

  // 按 type 分组
  const brokenRefs = errors.filter(f => f.type === 'broken-chunk-ref')
  const thirdPartyRequires = errors.filter(
    f => f.type === 'third-party-require',
  )
  const thirdPartyImports = errors.filter(f => f.type === 'third-party-import')
  const thirdPartyNodeRequires = errors.filter(
    f => f.type === 'third-party-node-require',
  )
  const bunRuntimeOnly = warnings.filter(f => f.type === 'bun-runtime-only')
  const optionalRuntime = warnings.filter(f => f.type === 'optional-runtime-unavailable')
  for (const finding of errors.filter(f => f.type === 'syntax-error')) {
    console.log(`❌ JavaScript 语法错误: ${finding.file}:${finding.line}: ${finding.snippet}`)
  }

  if (brokenRefs.length > 0) {
    console.log('❌ 断裂的 chunk 引用（引用了不存在的文件）:')
    for (const f of brokenRefs) {
      console.log(`   ${f.file}:${f.line} → ${f.module}`)
    }
    console.log()
  }

  if (thirdPartyRequires.length > 0) {
    console.log('❌ 通过 __require() 引用的第三方模块（生产环境会找不到）:')
    const grouped = groupByModule(thirdPartyRequires)
    for (const [mod, items] of grouped) {
      console.log(`   "${mod}" — 出现 ${items.length} 次:`)
      for (const f of items.slice(0, 5)) {
        console.log(`     ${f.file}:${f.line}`)
      }
      if (items.length > 5) console.log(`     ... 还有 ${items.length - 5} 处`)
    }
    console.log()
  }

  if (thirdPartyImports.length > 0) {
    console.log('❌ 通过 import() 动态引用的第三方模块（生产环境会找不到）:')
    const grouped = groupByModule(thirdPartyImports)
    for (const [mod, items] of grouped) {
      console.log(`   "${mod}" — 出现 ${items.length} 次:`)
      for (const f of items.slice(0, 5)) {
        console.log(`     ${f.file}:${f.line}`)
      }
      if (items.length > 5) console.log(`     ... 还有 ${items.length - 5} 处`)
    }
    console.log()
  }

  if (thirdPartyNodeRequires.length > 0) {
    console.log(
      '❌ 通过 nodeRequire() 引用的第三方模块（绕过打包，生产环境会找不到）:',
    )
    const grouped = groupByModule(thirdPartyNodeRequires)
    for (const [mod, items] of grouped) {
      console.log(`   "${mod}" — 出现 ${items.length} 次:`)
      for (const f of items.slice(0, 5)) {
        console.log(`     ${f.file}:${f.line}`)
      }
      if (items.length > 5) console.log(`     ... 还有 ${items.length - 5} 处`)
    }
    console.log()
  }

  if (bunRuntimeOnly.length > 0) {
    console.log('⚠️  Bun 专用模块引用（需确认 Node 路径有运行时保护）:')
    const grouped = groupByModule(bunRuntimeOnly)
    for (const [mod, items] of grouped) {
      console.log(`   "${mod}" — 出现 ${items.length} 次`)
    }
    console.log()
  }

  if (optionalRuntime.length > 0) {
    console.log('⚠️  可选系统钥匙串模块未随包提供；缺失时使用加密文件回退:')
    for (const f of optionalRuntime) console.log(`   ${f.file}:${f.line} → ${f.module}`)
    console.log()
  }

  // 4. 总结
  console.log('─'.repeat(50))
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ 构建静态语法及依赖声明检查通过；实际安装和非字面量动态加载需运行验证。')
  } else {
    console.log(`📊 总计: ${errors.length} 个错误, ${warnings.length} 个警告`)
    if (errors.length > 0) {
      console.log(
        `\n💡 修复建议:
   - 第三方模块问题：在 build.ts 中通过 external 选项排除，或确保它们被正确打包到 chunk 中
   - 断链问题：检查 build 时是否有文件被意外删除或构建不完整
   - Bun 专用模块：确保运行时使用 bun 而非 node`,
      )
    }
  }

  process.exit(errors.length > 0 ? 1 : 0)
}

/** A known optional module is optional only where its load error is caught. */
function hasLoadErrorHandler(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false // Static imports cannot fall back.
  const asynchronous = node.expression.kind === ts.SyntaxKind.ImportKeyword
  if (asynchronous && ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === 'catch' && ts.isCallExpression(node.parent.parent)) return true
  let awaited = !asynchronous
  let child: ts.Node = node
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isAwaitExpression(parent)) awaited = true
    if (ts.isTryStatement(parent) && parent.tryBlock === child && parent.catchClause) return awaited
    if (ts.isFunctionLike(parent)) break
  }
  return false
}

function groupByModule(items: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>()
  for (const item of items) {
    const list = map.get(item.module) || []
    list.push(item)
    map.set(item.module, list)
  }
  // 按出现次数降序
  return new Map([...map.entries()].sort((a, b) => b[1].length - a[1].length))
}

if (import.meta.main) main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(2)
})
