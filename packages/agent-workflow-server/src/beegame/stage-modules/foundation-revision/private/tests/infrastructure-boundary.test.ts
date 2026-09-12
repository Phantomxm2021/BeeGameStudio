import { expect, test } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import ts from 'typescript'

const moduleRoot = resolve(import.meta.dir, '../..')
const repository = resolve(moduleRoot, '../../../../../..')

async function sources(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.worktrees', 'tests', '__tests__', 'test-fixtures'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await sources(path))
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) result.push(path)
  }
  return result
}

function imports(path: string, content: string): { specifiers: string[]; dynamic: boolean } {
  const tree = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  let dynamic = false
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) specifiers.push(node.argument.literal.text)
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression
      if (expression && ts.isStringLiteral(expression)) specifiers.push(expression.text)
      else dynamic = true
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const argument = node.arguments[0]
      if (!argument || !ts.isStringLiteral(argument)) dynamic = true
      else specifiers.push(argument.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return { specifiers, dynamic }
}

function resolver() {
  const configPath = ts.findConfigFile(repository, ts.sys.fileExists, 'tsconfig.json')!
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repository)
  const cache = ts.createModuleResolutionCache(repository, path => path, parsed.options)
  return (specifier: string, path: string) => ts.resolveModuleName(specifier, path, parsed.options, ts.sys, cache).resolvedModule?.resolvedFileName
}

test('fixed-input public lifecycle acceptance has no static dependency on Reviewer or legacy stage execution', async () => {
  const resolveImport = resolver()
  const approved = new Set(['auth', 'billing', 'runtime-configuration'].map(name => resolve(moduleRoot, '../../../', name, 'public.ts')))
  approved.add(resolve(repository, 'packages/agent-workflow/src/native-file-agent.ts'))
  const entries = ['lifecycle.test.ts', 'lifecycle-infrastructure.test.ts', 'lifecycle-followup.test.ts',
    'lifecycle-next-round.test.ts', 'detached-public-process.test.ts']
  const pending = entries.map(name => join(import.meta.dir, name))
  const visited = new Set<string>()
  const violations: string[] = []
  while (pending.length) {
    const path = pending.pop()!
    if (visited.has(path)) continue
    visited.add(path)
    if (path.endsWith('.json')) continue // Frozen copied data, never producer code.
    const content = await readFile(path, 'utf8')
    const tree = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true)
    for (const specifier of imports(path, content).specifiers) {
      if (specifier.startsWith('node:') || ['bun:test', 'zod/v4'].includes(specifier)) continue
      if (specifier === '@bee-game-studio/beegame-billing-core/usage-control-client') {
        const declarations = tree.statements.filter((node): node is ts.ImportDeclaration =>
          ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === specifier)
        if (!declarations.length || declarations.some(node => !node.importClause?.isTypeOnly))
          violations.push(path + ' -> billing authority runtime implementation')
        continue
      }
      const destination = resolveImport(specifier, path)
      if (destination && approved.has(destination)) continue
      if (!destination || !destination.startsWith(moduleRoot + sep)) {
        violations.push(path + ' -> ' + specifier)
        continue
      }
      pending.push(destination)
    }
  }
  // Peer-contract and cross-stage integration tests remain separate evidence;
  // they are not counted as this independent entry suite.
  expect(visited.size).toBeGreaterThan(20)
  expect(violations).toEqual([])
})

test('Revision source dependencies, including erased type imports, use only private code and approved public infrastructure', async () => {
  const resolveImport = resolver()
  const approved = new Set(['billing', 'runtime-configuration'].map(name => resolve(moduleRoot, '../../../', name, 'public.ts')))
  approved.add(resolve(repository, 'packages/agent-workflow/src/native-file-agent.ts'))
  const violations: string[] = []
  const paths = await sources(moduleRoot)
  for (const path of paths) {
    const found = imports(path, await readFile(path, 'utf8'))
    if (found.dynamic) violations.push(path + ' -> nonliteral module load')
    for (const specifier of found.specifiers) {
      if (specifier.startsWith('node:') || specifier === 'zod/v4') continue
      const destination = resolveImport(specifier, path)
      if (!destination || (!destination.startsWith(moduleRoot + sep) && !approved.has(destination))) violations.push(path + ' -> ' + specifier)
    }
  }
  expect(paths.length).toBeGreaterThan(20)
  expect(violations).toEqual([])
})

test('all packages and apps production imports and re-exports respect the Revision public entry', async () => {
  const resolveImport = resolver()
  const violations: string[] = []
  const paths = [...await sources(join(repository, 'packages')), ...await sources(join(repository, 'apps'))]
  for (const path of paths) {
    if (path.startsWith(moduleRoot + sep)) continue
    for (const specifier of imports(path, await readFile(path, 'utf8')).specifiers) {
      const destination = resolveImport(specifier, path)
      if (destination?.startsWith(moduleRoot + sep) && destination !== join(moduleRoot, 'public.ts')) violations.push(path + ' -> ' + destination)
    }
  }
  // No consumer-count claim: app cutover is deliberately not implemented yet.
  expect(paths.length).toBeGreaterThan(100)
  expect(violations).toEqual([])
})
