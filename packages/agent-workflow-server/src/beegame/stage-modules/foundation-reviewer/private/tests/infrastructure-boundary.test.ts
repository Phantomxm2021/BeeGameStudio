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

test('Reviewer source dependencies, including erased type imports, use only private code and approved public infrastructure', async () => {
  const resolveImport = resolver()
  const approved = new Set(['billing', 'runtime-configuration'].map(name => resolve(moduleRoot, '../../../', name, 'public.ts')))
  approved.add(resolve(repository, 'packages/agent-workflow/src/native-file-agent.ts'))
  const violations: string[] = []
  const paths = await sources(moduleRoot)
  for (const path of paths) {
    const found = imports(path, await readFile(path, 'utf8'))
    if (found.dynamic) violations.push(path + ' -> nonliteral module load')
    for (const specifier of found.specifiers) {
      // Declared pure data libraries; neither grants another stage's private API.
      if (specifier.startsWith('node:') || specifier === 'zod/v4' || specifier === 'diff') continue
      const destination = resolveImport(specifier, path)
      if (!destination || (!destination.startsWith(moduleRoot + sep) && !approved.has(destination))) violations.push(path + ' -> ' + specifier)
    }
  }
  expect(paths.length).toBeGreaterThan(5)
  expect(violations).toEqual([])
})

test('all packages and apps production imports and re-exports respect the Reviewer public entry', async () => {
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
  expect(paths.length).toBeGreaterThan(100)
  expect(violations).toEqual([])
})
