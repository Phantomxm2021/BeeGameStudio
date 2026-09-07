import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dir, '..')

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(resolve(directory, entry.name)) :
      entry.name.endsWith('.ts') ? [resolve(directory, entry.name)] : [])
}

test('all owned source and fixtures have closed static dependencies', () => {
  const moduleRoot = resolve(root, '..')
  for (const file of files(moduleRoot)) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    function check(specifier: ts.Node) {
      expect(ts.isStringLiteral(specifier), file).toBe(true)
      if (!ts.isStringLiteral(specifier)) return
      const name = specifier.text
      if (file === resolve(moduleRoot, 'public.ts') && ['../../../runtime-configuration/public', '../../../billing/public'].includes(name)) {
        expect(ts.isImportDeclaration(specifier.parent) && specifier.parent.importClause?.isTypeOnly).toBe(true)
        return
      }
      if (name === '../../../../runtime-configuration/public' && (file.endsWith('/fact-controller.ts') || file.endsWith('/semantic-controller.ts') || file.endsWith('/targeted-controller.ts') || file.endsWith('/initial-lifecycle.ts'))) {
        expect(ts.isImportDeclaration(specifier.parent) && specifier.parent.importClause?.isTypeOnly).toBe(true)
        return
      }
      if (name === '../../../../billing/public' && (file.endsWith('/usage-outbox.ts') || file.endsWith('/targeted-usage-outbox.ts') || file.endsWith('/initial-lifecycle.ts'))) {
        expect(ts.isImportDeclaration(specifier.parent) && specifier.parent.importClause?.isTypeOnly).toBe(true)
        return
      }
      if (name.startsWith('node:') || name === 'bun:test' || name === 'zod/v4' ||
        (name === 'typescript' && file.includes('/tests/'))) return
      expect(name.startsWith('.'), `${file}: ${name}`).toBe(true)
      const target = relative(moduleRoot, resolve(dirname(file), name))
      expect(target.startsWith('..') || isAbsolute(target), `${file}: ${name}`).toBe(false)
    }
    function visit(node: ts.Node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
        check(node.moduleSpecifier)
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        expect(node.arguments.length).toBe(1)
        check(node.arguments[0]!)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
})
