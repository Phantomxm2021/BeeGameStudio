import { expect, test } from 'bun:test'
import { readFile, readdir, realpath } from 'node:fs/promises'
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

function imports(path: string, content: string) {
  const tree = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  let dynamic = false
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      specifiers.push(node.moduleSpecifier.text)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
      specifiers.push(node.argument.literal.text)
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const argument = node.moduleReference.expression
      if (argument && ts.isStringLiteral(argument)) specifiers.push(argument.text)
      else dynamic = true
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const argument = node.arguments[0]
      if (argument && ts.isStringLiteral(argument)) specifiers.push(argument.text)
      else dynamic = true
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
  return async (specifier: string, path: string) => {
    const destination = ts.resolveModuleName(specifier, path, parsed.options, ts.sys, cache).resolvedModule?.resolvedFileName
    return destination ? realpath(destination) : undefined
  }
}

test('Reviewer production imports, including erased types, remain private or use approved public infrastructure', async () => {
  const resolveImport = resolver()
  const approved = new Set(await Promise.all(['billing', 'runtime-configuration'].map(name => realpath(resolve(moduleRoot, '../../../', name, 'public.ts')))))
  const root = await realpath(moduleRoot)
  const violations: string[] = []
  const paths = await sources(moduleRoot)
  for (const path of paths) {
    const found = imports(path, await readFile(path, 'utf8'))
    if (found.dynamic) violations.push(path + ' -> nonliteral module load')
    for (const specifier of found.specifiers) {
      if (specifier.startsWith('node:') || specifier === 'zod/v4') continue
      const destination = await resolveImport(specifier, path)
      if (!destination || (!destination.startsWith(root + sep) && !approved.has(destination)))
        violations.push(path + ' -> ' + specifier)
    }
  }
  expect(paths.length).toBeGreaterThan(20)
  expect(violations).toEqual([])
})

test('all packages and apps production consumers access Reviewer only through its public entry', async () => {
  const resolveImport = resolver()
  const root = await realpath(moduleRoot)
  const publicEntry = join(root, 'public.ts')
  const violations: string[] = []
  const paths = [...await sources(join(repository, 'packages')), ...await sources(join(repository, 'apps'))]
  for (const path of paths) {
    if ((await realpath(path)).startsWith(root + sep)) continue
    for (const specifier of imports(path, await readFile(path, 'utf8')).specifiers) {
      const destination = await resolveImport(specifier, path)
      if (destination?.startsWith(root + sep) && destination !== publicEntry)
        violations.push(path + ' -> ' + destination)
    }
  }
  // Application cutover is a later milestone, not evidence required to
  // manufacture a production consumer during standalone module acceptance.
  expect(paths.length).toBeGreaterThan(100)
  expect(violations).toEqual([])
})
