import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

test('stages cannot reach sibling stages, scheduler or mutable storage even through shared modules', () => {
  const root = dirname(import.meta.path), directory = join(root, 'stages')
  const files = readdirSync(directory).filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  expect(files.sort()).toEqual(['acceptance.ts', 'content.ts', 'implementation.ts', 'planning.ts', 'resources.ts', 'review.ts'])
  for (const file of files) {
    const seen = new Set<string>()
    const visitFile = (path: string) => {
      if (seen.has(path)) return
      seen.add(path)
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
      const inspect = (node: ts.Node) => {
        const module = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier :
          ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            ts.isIdentifier(node.expression) && node.expression.text === 'require') ? node.arguments[0] : undefined
        if (module && ts.isStringLiteral(module) && (module.text.startsWith('.') || module.text.startsWith('@bee-game-studio/'))) {
          const target = (module.text.startsWith('.') ? resolve(dirname(path), module.text) :
            Bun.resolveSync(module.text, dirname(path))).replace(/\.(?:ts|js)$/, '')
          expect(target.startsWith(directory + '/') && target !== join(directory, file).replace(/\.ts$/, '')).toBe(false)
          for (const forbidden of ['project-delivery', 'project-conversation', 'delivery/state-store', 'delivery/state'])
            expect(target).not.toBe(resolve(root, '..', forbidden))
          const resolved = [target, target + '.ts', target + '.tsx', target + '.mjs']
            .find(candidate => /\.(ts|tsx|mjs)$/.test(candidate) && existsSync(candidate))
          if (resolved) visitFile(resolved)
        }
        ts.forEachChild(node, inspect)
      }
      inspect(source)
    }
    visitFile(join(directory, file))
  }
})
