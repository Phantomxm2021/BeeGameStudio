import type { Plugin } from 'rollup'
import ts from 'typescript'
import { getBuildFeatures } from './defines.ts'

export function getEnabledFeatures(): Set<string> {
  return new Set(getBuildFeatures())
}

/** Replace real feature calls; leave strings/comments and disposal semantics intact. */
export default function featureFlagsPlugin(): Plugin {
  const features = getEnabledFeatures()
  const virtualModuleId = 'bun:bundle'
  const resolvedVirtualModuleId = '\0' + virtualModuleId
  return {
    name: 'feature-flags',
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId
    },
    load(id) {
      if (id === resolvedVirtualModuleId) return 'export function feature(name) { return false; }'
    },
    transform(code, id) {
      if (id.includes('node_modules') || !/\.[cm]?[jt]sx?(?:\?|$)/.test(id)) return null
      if (!code.includes('feature') && !code.includes('using ')) return null
      const result = ts.transpileModule(code, {
        fileName: id.split('?')[0],
        compilerOptions: {
          target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.Preserve, sourceMap: true,
        },
        transformers: { before: [context => source => {
          const bindings = new Set<string>()
          for (const statement of source.statements) {
            if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'bun:bundle') continue
            const imports = statement.importClause?.namedBindings
            if (imports && ts.isNamedImports(imports)) {
              for (const item of imports.elements) {
                if ((item.propertyName ?? item.name).text === 'feature') bindings.add(item.name.text)
              }
            }
          }
          // Use TS's existing binder instead of guessing lexical scopes from
          // names. This in-memory program loads no libraries or imports.
          const options = { noResolve: true, noLib: true }
          const checker = bindings.size ? ts.createProgram([source.fileName], options, {
            ...ts.createCompilerHost(options),
            getSourceFile: name => name === source.fileName ? source : undefined,
            readFile: () => undefined,
            fileExists: name => name === source.fileName,
          }).getTypeChecker() : undefined
          const importedSymbols = new Set<ts.Symbol>()
          for (const statement of source.statements) {
            if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'bun:bundle') continue
            const imports = statement.importClause?.namedBindings
            if (imports && ts.isNamedImports(imports)) for (const item of imports.elements) {
              if ((item.propertyName ?? item.name).text !== 'feature') continue
              const symbol = checker?.getSymbolAtLocation(item.name)
              if (symbol) importedSymbols.add(symbol)
            }
          }
          const visit: ts.Visitor = node => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && importedSymbols.has(checker?.getSymbolAtLocation(node.expression)!) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]!)) {
              return features.has(node.arguments[0]!.text) ? context.factory.createTrue() : context.factory.createFalse()
            }
            return ts.visitEachChild(node, visit, context)
          }
          return ts.visitNode(source, visit) as ts.SourceFile
        }] },
      })
      return { code: result.outputText, map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null }
    },
  }
}
