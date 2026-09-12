import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('./', import.meta.url))

async function productionSources(directory: string, includeTests = false): Promise<string[]> {
  const paths: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.worktrees'].includes(entry.name) ||
      (!includeTests && ['tests', '__tests__', 'test-fixtures'].includes(entry.name))) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await productionSources(path, includeTests))
    else if (/\.tsx?$/.test(entry.name) && (includeTests || !/\.(test|spec)\.tsx?$/.test(entry.name))) paths.push(path)
  }
  return paths
}

test('author does not own a duplicate login or refresh-token implementation', async () => {
  expect(existsSync(join(root, 'private/runtime/auth.ts'))).toBe(false)
  for (const path of await productionSources(root)) {
    const source = await readFile(path, 'utf8')
    expect(source).not.toContain('grant_type=refresh_token')
    expect(source).not.toContain('createPrivateRuntimeAuth')
  }
})

test('production consumers cannot import or re-export any Author implementation below public', async () => {
  const repository = resolve(root, '../../../../../..')
  const configPath = ts.findConfigFile(repository, ts.sys.fileExists, 'tsconfig.json')!
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repository)
  const cache = ts.createModuleResolutionCache(repository, path => path, parsed.options)
  const paths = [...await productionSources(join(repository, 'packages')), ...await productionSources(join(repository, 'apps'))]
  let publicConsumers = 0
  const violations: string[] = []
  for (const path of paths) {
    if (path.startsWith(resolve(root) + sep)) continue
    const tree = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const imports: string[] = []
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text)
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) imports.push(node.argument.literal.text)
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text)
      ts.forEachChild(node, visit)
    }
    visit(tree)
    for (const specifier of imports) {
      const destination = ts.resolveModuleName(specifier, path, parsed.options, ts.sys, cache).resolvedModule?.resolvedFileName
      if (!destination?.startsWith(resolve(root) + sep)) continue
      if (destination === join(root, 'public.ts')) publicConsumers++
      else violations.push(path + ' -> ' + destination)
    }
  }
  expect(publicConsumers).toBeGreaterThanOrEqual(5)
  expect(violations).toEqual([])
})

test('all author production dependencies stay private or use an approved foundation public entry', async () => {
  const allowedPublicEntries = new Set([
    resolve(root, '../../../auth/public'), resolve(root, '../../../billing/public'),
    resolve(root, '../../../runtime-configuration/public'),
  ])
  const paths = await productionSources(root)
  for (const path of paths) {
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const imports: string[] = []
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        expect(ts.isStringLiteral(node.moduleSpecifier)).toBe(true)
        if (ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text)
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        expect(node.arguments.length).toBe(1)
        expect(ts.isStringLiteral(node.arguments[0]!)).toBe(true)
        if (ts.isStringLiteral(node.arguments[0]!)) imports.push(node.arguments[0]!.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    for (const specifier of imports) {
      if (specifier.startsWith('node:') || specifier === 'zod' || specifier === 'zod/v4' ||
          specifier === '@bee-game-studio/agent-workflow/native-task-access') continue
      expect(specifier.startsWith('.')).toBe(true)
      const destination = resolve(path, '..', specifier).replace(/\.ts$/, '')
      expect(destination.startsWith(`${resolve(root)}${sep}`) || allowedPublicEntries.has(destination)).toBe(true)
    }
  }
})

test('isolated Author tests and protocol fixtures do not load old workflow or document generators', async () => {
  const foundations = new Set(['auth', 'billing', 'runtime-configuration'].map(name => resolve(root, '../../../' + name + '/public')))
  const violations: string[] = []
  for (const path of await productionSources(root, true)) {
    const tree = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
    function check(specifier: string) {
      if (specifier.startsWith('node:') || ['bun:test', 'zod', 'zod/v4', 'typescript',
        '@bee-game-studio/agent-workflow/native-task-access'].includes(specifier)) return
      const destination = resolve(path, '..', specifier).replace(/\.ts$/, '')
      if (!specifier.startsWith('.') || (!destination.startsWith(resolve(root) + sep) && !foundations.has(destination)))
        violations.push(path + ' -> ' + specifier)
    }
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text)
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) check(node.argument.literal.text)
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        const argument = node.arguments[0]
        if (!argument || !ts.isStringLiteral(argument)) violations.push(path + ' -> nonliteral module load')
        else check(argument.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  expect(violations).toEqual([])
})
