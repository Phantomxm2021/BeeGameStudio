import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'
import * as ts from 'typescript'
import {
  boundaryViolations,
  FOUNDATION_PROTECTED_FILES,
  readProductionSourceFiles,
  readSourceFilesRecursively,
  standaloneProductionViolations,
} from './stage-boundary-test-helpers'

const deliveryWorkflowRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const serverSourceRoot = dirname(dirname(deliveryWorkflowRoot))

const gameIrContractFiles = ['contracts.ts'] as const

const PHASE4_PRODUCTION_FILES = [
  'domain-source.ts',
  'domain-projection.ts',
  'gameplay-schema.ts',
  'balance-schema.ts',
  'gameplay-producer.ts',
  'balance-producer.ts',
  'gameplay-balance-assembler.ts',
] as const

const PHASE5_PRODUCTION_FILES = [
  'world-scene-schema.ts',
  'presentation-schema.ts',
  'world-scene-producer.ts',
  'presentation-producer.ts',
  'phase5-admission.ts',
  'world-presentation-assembler.ts',
] as const

/*
 * All stage policies consume this one fact set.  Keeping syntax collection in
 * one place prevents the phase scanners from drifting into separate walkers.
 */
type AstFacts = Readonly<{
  imports: readonly { kind: string; path: string }[]
  importBindings: readonly { original: string; local: string; path: string }[]
  namespaceImports: readonly { local: string; path: string }[]
  closureAliases: readonly string[]
  variableDeclarations: readonly string[]
  memberCalls: readonly { receiver: string; name: string }[]
  apiImports: readonly string[]
  calls: readonly string[]
  providerDispatch: boolean
  identifiers: readonly string[]
  properties: readonly { key?: string; value: string }[]
  objectLiterals: readonly {
    keys: readonly string[]
    schemaVersion?: string
    isDigestInput: boolean
  }[]
  strings: readonly {
    value: string
    isPropertyName: boolean
    isPropertyValue: boolean
    declarationName?: string
  }[]
}>

const forbiddenApis = new Set([
  'parseGameIrCandidate',
  'prepareGameIrPublication',
  'commitGameIrPublication',
])
const forbiddenStageCalls = new Set(['route', 'publish', 'publishGameIr'])
const forbiddenPaths =
  /(?:^|\/)(?:controller|store|run-store|delivery-run|foundation-issue(?:-registry)?)(?:\.ts)?$/
const forbiddenPhase5Paths =
  /(?:^|\/)(?:routes?|publication|consumer|delivery)(?:\.ts)?$/
const forbiddenClosurePath = /(?:^|\/)world-presentation-assembler(?:\.ts)?$/
const forbiddenContractPaths =
  /(?:^|\/)(?:controller|schema|recovery|foundation-(?:audit|fact|issue|revision))(?:\.ts)?$/
const placeholderModules = new Set([
  'core',
  'world-scene',
  'presentation',
  'resource-realization',
  'implementation-verification',
])
const futureModuleIds = new Set([
  'resource-realization',
  'implementation-verification',
])
const futureNodePrefixes = [
  'resource-realization.',
  'implementation-verification.',
]
const phase5NodePrefixes = [
  'world-scene.',
  'presentation.',
  ...futureNodePrefixes,
]

function collectAstFacts(
  source: string,
  filename = 'game-ir-static-scan.ts',
): AstFacts {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const imports: Array<{ kind: string; path: string }> = []
  const importBindings: Array<{
    original: string
    local: string
    path: string
  }> = []
  const namespaceImports: Array<{ local: string; path: string }> = []
  const closureAliases: string[] = []
  const variableDeclarations: string[] = []
  const memberCalls: Array<{ receiver: string; name: string }> = []
  const apiImports: string[] = []
  const calls: string[] = []
  const identifiers: string[] = []
  const properties: Array<{ key?: string; value: string }> = []
  const objectLiterals: Array<{
    keys: string[]
    schemaVersion?: string
    isDigestInput: boolean
  }> = []
  const strings: Array<{
    value: string
    isPropertyName: boolean
    isPropertyValue: boolean
    declarationName?: string
  }> = []
  type ConstStringDeclaration = Readonly<{
    name: string
    declaration: ts.VariableDeclaration
    scope: ts.Node
  }>
  const constStringDeclarations: ConstStringDeclaration[] = []
  const isLexicalScope = (node: ts.Node): boolean =>
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  const lexicalScopeFor = (node: ts.Node): ts.Node => {
    for (let parent: ts.Node | undefined = node; parent; parent = parent.parent)
      if (isLexicalScope(parent)) return parent
    return file
  }
  const collectConstStringBindings = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    )
      constStringDeclarations.push({
        name: node.name.text,
        declaration: node,
        scope: lexicalScopeFor(node),
      })
    ts.forEachChild(node, collectConstStringBindings)
  }
  collectConstStringBindings(file)
  const unwrapTransparentExpression = (
    expression: ts.Expression,
  ): ts.Expression => {
    let current = expression
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current)
    )
      current = current.expression
    return current
  }
  const resolveConstStringExpression = (
    expression: ts.Expression,
    resolving = new Set<ts.VariableDeclaration>(),
  ): string | undefined => {
    const unwrapped = unwrapTransparentExpression(expression)
    if (ts.isStringLiteral(unwrapped)) return unwrapped.text
    if (!ts.isIdentifier(unwrapped)) return undefined
    let scope = lexicalScopeFor(unwrapped)
    while (true) {
      const declarations = constStringDeclarations.filter(
        declaration =>
          declaration.scope === scope && declaration.name === unwrapped.text,
      )
      if (declarations.length > 0) {
        const usePosition = unwrapped.getStart(file)
        const declaration = declarations
          .filter(
            candidate => candidate.declaration.getStart(file) < usePosition,
          )
          .at(-1)
        if (!declaration || resolving.has(declaration.declaration))
          return undefined
        if (!declaration.declaration.initializer) return undefined
        const next = new Set(resolving)
        next.add(declaration.declaration)
        return resolveConstStringExpression(
          declaration.declaration.initializer,
          next,
        )
      }
      const parent = scope.parent
      if (!parent) return undefined
      let nextScope: ts.Node | undefined
      for (
        let ancestor: ts.Node | undefined = parent;
        ancestor;
        ancestor = ancestor.parent
      )
        if (isLexicalScope(ancestor)) {
          nextScope = ancestor
          break
        }
      if (!nextScope) return undefined
      scope = nextScope
    }
  }
  let providerDispatch = false
  const containsProvider = (expression: ts.Expression): boolean => {
    if (ts.isIdentifier(expression)) return expression.text === 'provider'
    if (ts.isPropertyAccessExpression(expression))
      return (
        expression.name.text === 'provider' ||
        containsProvider(expression.expression)
      )
    if (ts.isElementAccessExpression(expression))
      return containsProvider(expression.expression)
    return false
  }
  const declarationName = (node: ts.Node): string | undefined => {
    for (let parent = node.parent; parent; parent = parent.parent)
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
        return parent.name.text
    return undefined
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({ kind: 'import', path: node.moduleSpecifier.text })
      if (
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      )
        for (const specifier of node.importClause.namedBindings.elements) {
          const original = specifier.propertyName?.text ?? specifier.name.text
          const local = specifier.name.text
          importBindings.push({
            original,
            local,
            path: node.moduleSpecifier.text,
          })
          if (forbiddenApis.has(original)) {
            apiImports.push(original)
            if (local !== original) apiImports.push(local)
          }
          if (original === 'assembleWorldPresentationClosure')
            closureAliases.push(local)
        }
      else if (
        node.importClause?.namedBindings &&
        ts.isNamespaceImport(node.importClause.namedBindings)
      )
        namespaceImports.push({
          local: node.importClause.namedBindings.name.text,
          path: node.moduleSpecifier.text,
        })
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push({ kind: 'export', path: node.moduleSpecifier.text })
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    )
      for (const specifier of node.exportClause.elements) {
        const original = specifier.propertyName?.text ?? specifier.name.text
        const local = specifier.name.text
        importBindings.push({
          original,
          local,
          path: node.moduleSpecifier.text,
        })
        if (forbiddenApis.has(original)) {
          apiImports.push(original)
          if (local !== original) apiImports.push(local)
        }
        if (original === 'assembleWorldPresentationClosure')
          closureAliases.push(local)
      }
    if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference
      if (
        ts.isExternalModuleReference(reference) &&
        ts.isStringLiteral(reference.expression)
      )
        imports.push({ kind: 'import-equals', path: reference.expression.text })
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      if (
        ts.isIdentifier(expression) &&
        expression.text === 'require' &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      )
        imports.push({ kind: 'require', path: node.arguments[0].text })
      if (
        expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      )
        imports.push({ kind: 'dynamic-import', path: node.arguments[0].text })
      const calledName = ts.isIdentifier(expression)
        ? expression.text
        : ts.isPropertyAccessExpression(expression)
          ? expression.name.text
          : ts.isElementAccessExpression(expression) &&
              ts.isStringLiteral(expression.argumentExpression)
            ? expression.argumentExpression.text
            : undefined
      if (calledName) calls.push(calledName)
      if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression)
      )
        memberCalls.push({
          receiver: expression.expression.text,
          name: expression.name.text,
        })
      const receiver =
        ts.isPropertyAccessExpression(expression) ||
        ts.isElementAccessExpression(expression)
          ? expression.expression
          : undefined
      if (calledName === 'dispatch' && receiver && containsProvider(receiver))
        providerDispatch = true
      if (calledName === 'assembleWorldPresentationClosure')
        calls.push(calledName)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      variableDeclarations.push(node.name.text)
    if (ts.isObjectLiteralExpression(node)) {
      const entries = node.properties.filter(ts.isPropertyAssignment)
      const keys = entries.flatMap(entry => {
        if (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name))
          return [entry.name.text]
        return []
      })
      const schemaVersion = entries.find(
        entry =>
          (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) &&
          entry.name.text === 'schemaVersion' &&
          ts.isStringLiteral(entry.initializer),
      )
      objectLiterals.push({
        keys,
        isDigestInput:
          ts.isCallExpression(node.parent) &&
          ts.isIdentifier(node.parent.expression) &&
          node.parent.expression.text === 'digestGameIrValue',
        ...(schemaVersion && ts.isStringLiteral(schemaVersion.initializer)
          ? { schemaVersion: schemaVersion.initializer.text }
          : {}),
      })
    }
    if (ts.isIdentifier(node)) identifiers.push(node.text)
    if (ts.isPropertyAssignment(node)) {
      const key = ts.isIdentifier(node.name)
        ? node.name.text
        : ts.isStringLiteral(node.name)
          ? node.name.text
          : undefined
      const value = resolveConstStringExpression(node.initializer)
      if (key !== undefined && value !== undefined)
        properties.push({ key, value })
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      const value = resolveConstStringExpression(node.name)
      if (value !== undefined) properties.push({ key: node.name.text, value })
    }
    if (ts.isStringLiteral(node))
      strings.push({
        value: node.text,
        isPropertyName:
          ts.isPropertyAssignment(node.parent) && node.parent.name === node,
        isPropertyValue:
          ts.isPropertyAssignment(node.parent) &&
          node.parent.initializer === node,
        declarationName: declarationName(node),
      })
    ts.forEachChild(node, visit)
  }
  visit(file)
  return {
    imports,
    importBindings,
    namespaceImports,
    closureAliases,
    variableDeclarations,
    memberCalls,
    apiImports,
    calls,
    providerDispatch,
    identifiers,
    properties,
    objectLiterals,
    strings,
  }
}

function policyViolations(
  facts: AstFacts,
  policy:
    | 'task7'
    | 'phase4'
    | 'phase5'
    | 'contracts'
    | 'publication'
    | 'semantic'
    | 'other',
): string[] {
  const violations = new Set<string>()
  for (const entry of facts.imports)
    if (
      forbiddenPaths.test(entry.path) ||
      forbiddenClosurePath.test(entry.path) ||
      ((policy === 'phase4' || policy === 'phase5' || policy === 'other') &&
        forbiddenPhase5Paths.test(entry.path))
    )
      violations.add(`path: ${entry.path}`)
  if (policy === 'contracts')
    for (const entry of facts.imports)
      if (forbiddenContractPaths.test(entry.path))
        violations.add(`contract-path: ${entry.path}`)
  if (
    policy === 'task7' ||
    policy === 'phase4' ||
    policy === 'phase5' ||
    policy === 'other'
  )
    for (const name of facts.apiImports) violations.add(`api-import: ${name}`)
  for (const name of facts.calls) {
    if (
      (policy === 'phase4' || policy === 'phase5') &&
      forbiddenStageCalls.has(name)
    )
      violations.add(`stage-call: ${name}`)
    if (
      forbiddenApis.has(name) &&
      (policy === 'task7' ||
        policy === 'phase4' ||
        policy === 'phase5' ||
        policy === 'other')
    )
      violations.add(`api-call: ${name}`)
    if (
      (policy === 'phase5' ||
        policy === 'other' ||
        policy === 'contracts' ||
        policy === 'publication' ||
        policy === 'semantic') &&
      (name === 'assembleWorldPresentationClosure' ||
        facts.closureAliases.includes(name))
    )
      violations.add('detached-closure-consumer: closure assembler call')
  }
  if (facts.providerDispatch)
    violations.add('provider-dispatch: provider dispatch call')
  for (const name of facts.identifiers) {
    if (name === 'DeliveryRun' || name === 'FoundationIssue')
      violations.add(`identifier: ${name}`)
    if (
      policy === 'phase5' &&
      [
        'fallback',
        'compatibility',
        'legacy',
        'migration',
        'dualWrite',
      ].includes(name)
    )
      violations.add(`forbidden-strategy: ${name}`)
    if (
      (policy === 'phase4' || policy === 'phase5' || policy === 'other') &&
      /^(?:ResourceRealization|ImplementationVerification)/.test(name)
    )
      violations.add(`future-identifier: ${name}`)
  }
  for (const entry of facts.properties) {
    if (
      policy === 'task7' &&
      entry.key === 'moduleId' &&
      placeholderModules.has(entry.value)
    )
      violations.add(`placeholder-module: ${entry.value}`)
    if (
      policy === 'phase4' &&
      (entry.key === 'kind' || entry.key === 'moduleId') &&
      (entry.value === 'world-scene' ||
        entry.value === 'presentation' ||
        futureModuleIds.has(entry.value) ||
        phase5NodePrefixes.some(prefix => entry.value.startsWith(prefix)))
    )
      violations.add(`phase5-construction: ${entry.value}`)
    if (policy === 'phase5') {
      if (entry.key === 'moduleId' && futureModuleIds.has(entry.value))
        violations.add(`future-module: ${entry.value}`)
      if (
        entry.key === 'kind' &&
        futureNodePrefixes.some(prefix => entry.value.startsWith(prefix))
      )
        violations.add(`future-node: ${entry.value}`)
    }
  }
  return [...violations].sort()
}

function task7IsolationViolations(source: string): string[] {
  return policyViolations(
    collectAstFacts(source, 'task-7-static-scan.ts'),
    'task7',
  )
}

function task11Phase5IsolationViolations(
  source: string,
  filename?: string,
): string[] {
  return policyViolations(
    collectAstFacts(source, filename ?? 'task-11-phase-5-static-scan.ts'),
    'phase5',
  )
}

function task11Phase4IsolationViolations(source: string): string[] {
  return policyViolations(
    collectAstFacts(source, 'task-11-phase-4-static-scan.ts'),
    'phase4',
  )
}

function futureModuleLiteralViolations(
  filename: string,
  source: string,
): string[] {
  const allowedDeclaration =
    filename === 'domain-source.ts'
      ? 'GAME_IR_MODULE_SOURCE_DOCUMENTS'
      : undefined
  return collectAstFacts(source, filename)
    .strings.filter(
      entry =>
        futureModuleIds.has(entry.value) &&
        entry.isPropertyName &&
        entry.declarationName !== allowedDeclaration,
    )
    .map(entry => `future-module-literal: ${entry.value}`)
    .sort()
}

function stagedCallerViolations(source: string, filename: string): string[] {
  const facts = collectAstFacts(source, filename)
  const violations = new Set<string>()
  const allowedGenericBuilderFile =
    filename === 'world-presentation-assembler.ts' ||
    filename === 'phase5-admission.test.ts'
  if (!allowedGenericBuilderFile) {
    const genericBuilder = 'buildPhase5SemanticValidationPacket'
    const importedAliases = facts.importBindings
      .filter(binding => binding.original === genericBuilder)
      .map(binding => binding.local)
    if (
      facts.calls.some(
        name => name === genericBuilder || importedAliases.includes(name),
      )
    )
      violations.add(`call: ${genericBuilder}`)
    for (const namespaceImport of facts.namespaceImports)
      if (
        facts.memberCalls.some(
          call =>
            call.receiver === namespaceImport.local &&
            call.name === genericBuilder,
        )
      )
        violations.add(`call: ${genericBuilder}`)
    if (facts.identifiers.includes('WorldSceneModuleProjection'))
      violations.add('type: WorldSceneModuleProjection')
    if (facts.identifiers.includes('PresentationModuleProjection'))
      violations.add('type: PresentationModuleProjection')
    for (const object of facts.objectLiterals) {
      const hasProjectionDigest = object.keys.includes('projectionDigest')
      const hasProjectionSchema =
        object.schemaVersion === 'game-ir-world-scene-module.v1' ||
        object.schemaVersion === 'game-ir-presentation-module.v1'
      const hasProjectionSignature =
        [
          'module',
          'sourceDigest',
          'mechanicalReceiptDigest',
          'semanticReceiptDigest',
          'semanticValidationResultDigest',
        ].filter(key => object.keys.includes(key)).length >= 2
      if (
        (hasProjectionSchema && hasProjectionDigest) ||
        (hasProjectionSignature && !object.isDigestInput)
      )
        violations.add('object: hand-built module projection')
    }
  }
  return [...violations].sort()
}

type GameIrProductionRole =
  | 'phase4'
  | 'phase5'
  | 'contracts'
  | 'publication'
  | 'semantic'
  | 'other'

function gameIrProductionRole(filename: string): GameIrProductionRole {
  if (filename === 'contracts.ts') return 'contracts'
  if (filename === 'publication.ts') return 'publication'
  if (filename === 'semantic-admission.ts') return 'semantic'
  if (PHASE4_PRODUCTION_FILES.includes(filename as never)) return 'phase4'
  if (PHASE5_PRODUCTION_FILES.includes(filename as never)) return 'phase5'
  return 'other'
}

async function readGameIrProductionSourceFiles() {
  const files = await readSourceFilesRecursively(
    dirname(fileURLToPath(import.meta.url)),
  )
  return files
    .filter(
      file =>
        file.path.endsWith('.ts') &&
        !file.path.endsWith('.test.ts') &&
        !file.path.endsWith('-test-helpers.ts'),
    )
    .map(file => ({
      filename: basename(file.path),
      source: file.source,
    }))
    .sort((left, right) => left.filename.localeCompare(right.filename))
}

describe('Game IR stage boundary', () => {
  test('keeps the DTO seam independent from Foundation internals', async () => {
    for (const filename of gameIrContractFiles) {
      const source = await readFile(
        join(dirname(fileURLToPath(import.meta.url)), filename),
        'utf8',
      )
      const facts = collectAstFacts(source, filename)
      expect(
        facts.importBindings.some(binding => binding.path === '../types'),
      ).toBe(true)
      expect(
        policyViolations(facts, 'contracts').filter(violation =>
          violation.startsWith('contract-path:'),
        ),
      ).toEqual([])
    }
  })

  test('rejects every forbidden import and foundation token in synthetic source', () => {
    const syntheticViolations = [
      "import { compileGame } from './game-ir/runtime'",
      "export { compileGame } from './game-ir/runtime'",
      "import x = require('./game-ir/runtime')",
      "const x = require('./game-ir/runtime')",
      "const x = import('./game-ir/runtime')",
      'type GameIrResult = unknown',
      'const kind = GAME_IR_ENABLED',
      'const state = enableGameIr',
      'const state = switchGameIr',
    ].map(source => boundaryViolations(source))

    expect(syntheticViolations).toEqual([
      ['import: ./game-ir/runtime'],
      ['export: ./game-ir/runtime'],
      ['import-equals: ./game-ir/runtime'],
      ['require: ./game-ir/runtime'],
      ['dynamic-import: ./game-ir/runtime'],
      ['identifier: GameIrResult'],
      ['identifier: GAME_IR_ENABLED'],
      ['identifier: enableGameIr'],
      ['identifier: switchGameIr'],
    ])
    expect(
      boundaryViolations(
        "// import './game-ir/runtime'\nconst text = 'GameIrResult'",
      ),
    ).toEqual([])
    expect(
      boundaryViolations(
        'const object = { GameIrState: "x" }; const value = object.GameIrState; const run = { gameIrState: value }; const config = { enableGameIr: true }',
      ),
    ).toEqual([
      'identifier: GameIrState',
      'identifier: GameIrState',
      'identifier: gameIrState',
      'identifier: enableGameIr',
    ])

    expect(
      standaloneProductionViolations([
        {
          path: 'synthetic-static-import.ts',
          source: "import { compileGame } from './game-ir/runtime'",
        },
        {
          path: 'synthetic-export.ts',
          source: "export { compileGame } from './game-ir/runtime'",
        },
        {
          path: 'synthetic-import-equals.ts',
          source: "import x = require('./game-ir/runtime')",
        },
        {
          path: 'synthetic-require.ts',
          source: "const required = require('./game-ir/runtime')",
        },
        {
          path: 'synthetic-dynamic-import.ts',
          source: "const loaded = import('./game-ir/runtime')",
        },
        {
          path: 'synthetic-game-ir-identifier.ts',
          source: 'type GameIrResult = unknown',
        },
        {
          path: 'synthetic-game-ir-constant.ts',
          source: 'const kind = GAME_IR_ENABLED',
        },
        {
          path: 'synthetic-property-declaration.ts',
          source: 'const object = { GameIrState: "x" }',
        },
        {
          path: 'synthetic-property-access.ts',
          source:
            'const value = object.GameIrState; const state = run.gameIrState',
        },
        {
          path: 'synthetic-enable.ts',
          source: 'const config = { enableGameIr: true }',
        },
        {
          path: 'synthetic-switch.ts',
          source: 'const switched = switchGameIr',
        },
        {
          path: 'src/app/routes.ts',
          source: "import { compileGame } from '../game-ir/runtime'",
        },
      ]),
    ).toEqual([
      'synthetic-static-import.ts: import: ./game-ir/runtime',
      'synthetic-export.ts: export: ./game-ir/runtime',
      'synthetic-import-equals.ts: import-equals: ./game-ir/runtime',
      'synthetic-require.ts: require: ./game-ir/runtime',
      'synthetic-dynamic-import.ts: dynamic-import: ./game-ir/runtime',
      'synthetic-game-ir-identifier.ts: identifier: GameIrResult',
      'synthetic-game-ir-constant.ts: identifier: GAME_IR_ENABLED',
      'synthetic-property-declaration.ts: identifier: GameIrState',
      'synthetic-property-access.ts: identifier: GameIrState',
      'synthetic-property-access.ts: identifier: gameIrState',
      'synthetic-enable.ts: identifier: enableGameIr',
      'synthetic-switch.ts: identifier: switchGameIr',
      'src/app/routes.ts: import: ../game-ir/runtime',
    ])
  })

  test('static isolation detector catches every Task 7 forbidden production path', () => {
    const synthetic = `
      import { parseGameIrCandidate } from './model'
      import { createDeliveryWorkflowController } from '../controller'
      import { getRun } from '../store'
      import { getDeliveryRun } from '../delivery-run'
      import { getIssue } from '../foundation-issue-registry'
      import { DeliveryRun, FoundationIssue } from '../types'
      parseGameIrCandidate(input)
      prepareGameIrPublication(input)
      commitGameIrPublication(input)
      const result = provider.dispatch(input)
      const namespaced = runtime.provider.dispatch(input)
      const computed = provider['dispatch'](input)
      const candidate = compiler.parseGameIrCandidate(input)
      const publication = compiler['prepareGameIrPublication'](input)
      const modules = [
        { moduleId: 'core' },
        { moduleId: 'world-scene' },
        { moduleId: 'presentation' },
        { moduleId: 'resource-realization' },
        { moduleId: 'implementation-verification' },
      ]
      void createDeliveryWorkflowController
      void getRun
      void getDeliveryRun
      void getIssue
      void DeliveryRun
      void FoundationIssue
      void result
      void namespaced
      void computed
      void candidate
      void publication
      void modules
    `
    expect(task7IsolationViolations(synthetic)).toEqual([
      'api-call: commitGameIrPublication',
      'api-call: parseGameIrCandidate',
      'api-call: prepareGameIrPublication',
      'api-import: parseGameIrCandidate',
      'identifier: DeliveryRun',
      'identifier: FoundationIssue',
      'path: ../controller',
      'path: ../delivery-run',
      'path: ../foundation-issue-registry',
      'path: ../store',
      'placeholder-module: core',
      'placeholder-module: implementation-verification',
      'placeholder-module: presentation',
      'placeholder-module: resource-realization',
      'placeholder-module: world-scene',
      'provider-dispatch: provider dispatch call',
    ])
    expect(
      task7IsolationViolations(`
        // parseGameIrCandidate prepareGameIrPublication commitGameIrPublication
        // controller store run-store delivery-run foundation-issue-registry
        // DeliveryRun FoundationIssue provider.dispatch core world-scene
        // presentation resource-realization implementation-verification
      `),
    ).toEqual([])
    expect(
      task7IsolationViolations(`
        const vocabulary = "parseGameIrCandidate prepareGameIrPublication commitGameIrPublication controller store run-store delivery-run foundation-issue-registry DeliveryRun FoundationIssue provider.dispatch core world-scene presentation resource-realization implementation-verification"
        void vocabulary
      `),
    ).toEqual([])
    expect(
      task7IsolationViolations(`
        const provider = { dispatch: handler }
        const dispatch = provider.dispatch
        const unrelated = service.dispatch(input)
        const computed = provider['other'](input)
        void dispatch
        void unrelated
        void computed
      `),
    ).toEqual([])
  })

  test('Phase 5 boundary rejects future resource nodes and production reachability', () => {
    expect(
      task11Phase5IsolationViolations(`
        import { route } from '../routes'
        import { publish } from './publication'
        const resource = { kind: 'resource-realization.logical-resource' }
        const implementation = { moduleId: 'implementation-verification' }
        const candidate = parseGameIrCandidate(input)
        const published = prepareGameIrPublication(candidate)
        const result = provider.dispatch(published)
        route(published)
        publish(published)
      `),
    ).toEqual([
      'api-call: parseGameIrCandidate',
      'api-call: prepareGameIrPublication',
      'future-module: implementation-verification',
      'future-node: resource-realization.logical-resource',
      'path: ../routes',
      'path: ./publication',
      'provider-dispatch: provider dispatch call',
      'stage-call: publish',
      'stage-call: route',
    ])
    expect(
      task11Phase5IsolationViolations(`
        import { assembleWorldPresentationClosure as invokeClosure } from './world-presentation-assembler'
        invokeClosure(authority)
      `),
    ).toEqual([
      'detached-closure-consumer: closure assembler call',
      'path: ./world-presentation-assembler',
    ])
    expect(
      collectAstFacts(
        "export { assembleWorldPresentationClosure as exportClosure } from './world-presentation-assembler'",
      ).importBindings,
    ).toEqual([
      {
        original: 'assembleWorldPresentationClosure',
        local: 'exportClosure',
        path: './world-presentation-assembler',
      },
    ])
    expect(
      task11Phase5IsolationViolations(`
        const fallback = legacy
        const compatibility = migration
        const dualWrite = true
        assembleWorldPresentationClosure(authority)
      `),
    ).toEqual([
      'detached-closure-consumer: closure assembler call',
      'forbidden-strategy: compatibility',
      'forbidden-strategy: dualWrite',
      'forbidden-strategy: fallback',
      'forbidden-strategy: legacy',
      'forbidden-strategy: migration',
    ])
  })

  test('rejects aliased future module and kind values only at sensitive properties', () => {
    for (const moduleId of [
      'resource-realization',
      'implementation-verification',
    ]) {
      expect(
        task11Phase5IsolationViolations(`
          const future = '${moduleId}'
          const moduleIdValue = future
          const record = { moduleId: moduleIdValue }
        `),
      ).toEqual([`future-module: ${moduleId}`])
      expect(
        task11Phase5IsolationViolations(`
          const future = '${moduleId}'
          const moduleId = future
          const record = { moduleId }
        `),
      ).toEqual([`future-module: ${moduleId}`])
      expect(
        task11Phase4IsolationViolations(`
          const future = '${moduleId}'
          const moduleId = future
          const record = { moduleId }
        `),
      ).toEqual([`phase5-construction: ${moduleId}`])
    }
    for (const kind of [
      'resource-realization.logical-resource',
      'implementation-verification.target',
    ]) {
      expect(
        task11Phase5IsolationViolations(`
          const future = '${kind}'
          const kindValue = future
          const record = { kind: kindValue }
        `),
      ).toEqual([`future-node: ${kind}`])
      expect(
        task11Phase5IsolationViolations(`
          const future = '${kind}'
          const kind = future
          const record = { kind }
        `),
      ).toEqual([`future-node: ${kind}`])
      expect(
        task11Phase4IsolationViolations(`
          const future = '${kind}'
          const kind = future
          const record = { kind }
        `),
      ).toEqual([`phase5-construction: ${kind}`])
    }
    expect(
      task11Phase5IsolationViolations(`
        const ordinary = 'ordinary'
        const moduleId = ordinary
        const kind = ordinary
        const record = { moduleId: moduleId, kind }
        const unused = 'resource-realization'
        // kind: 'implementation-verification.target'
      `),
    ).toEqual([])
  })

  test('resolves aliased sensitive values in their lexical scope', () => {
    expect(
      task11Phase5IsolationViolations(`
        const kind = 'gameplay.action'
        function unusedFuture() {
          const kind = 'resource-realization.logical-resource'
          void kind
        }
        const record = { kind }
      `),
    ).toEqual([])
    expect(
      task11Phase5IsolationViolations(`
        const kind = 'resource-realization.logical-resource'
        const outer = { kind }
        function legalShadow() {
          const kind = 'gameplay.action'
          const inner = { kind }
          void inner
        }
        void outer
      `),
    ).toEqual(['future-node: resource-realization.logical-resource'])
    expect(
      task11Phase5IsolationViolations(`
        const moduleId = 'resource-realization' as const
        const record = { moduleId }
      `),
    ).toEqual(['future-module: resource-realization'])
    expect(
      task11Phase5IsolationViolations(`
        const source = 'implementation-verification'
        const alias = (source)
        const moduleId = alias
        const record = { moduleId }
      `),
    ).toEqual(['future-module: implementation-verification'])
    expect(
      task11Phase5IsolationViolations(`
        const kind = 'resource-realization.logical-resource'
        function legalNested() {
          const kind = 'gameplay.action'
          const nested = { kind }
          void nested
        }
        const outer = { kind }
      `),
    ).toEqual(['future-node: resource-realization.logical-resource'])
  })

  test('splits accepted Phase 4 isolation from Phase 5 module construction', () => {
    expect(
      task11Phase4IsolationViolations(`
        const gameplayOnly = { kind: 'gameplay.action', moduleId: 'gameplay' }
      `),
    ).toEqual([])
    expect(
      task11Phase4IsolationViolations(`
        const worldModule = { moduleId: 'world-scene' }
        const worldNode = { kind: 'world-scene.node' }
        const worldProjection = { moduleId: 'world-scene', kind: 'world-scene.scene' }
        const presentationModule = { moduleId: 'presentation' }
        const presentationNode = { kind: 'presentation.ui-screen' }
        const presentationProjection = { moduleId: 'presentation', kind: 'presentation.ui-screen' }
        const resourceModule = { moduleId: 'resource-realization' }
        const resourceNode = { kind: 'resource-realization.asset' }
        const resourceProjection = { moduleId: 'resource-realization', kind: 'resource-realization.asset' }
        const implementationModule = { moduleId: 'implementation-verification' }
        const implementationNode = { kind: 'implementation-verification.target' }
        const implementationProjection = { moduleId: 'implementation-verification', kind: 'implementation-verification.target' }
      `),
    ).toEqual([
      'phase5-construction: implementation-verification',
      'phase5-construction: implementation-verification.target',
      'phase5-construction: presentation',
      'phase5-construction: presentation.ui-screen',
      'phase5-construction: resource-realization',
      'phase5-construction: resource-realization.asset',
      'phase5-construction: world-scene',
      'phase5-construction: world-scene.node',
      'phase5-construction: world-scene.scene',
    ])
    expect(
      task11Phase5IsolationViolations(`
        const world = { kind: 'world-scene.scene', moduleId: 'world-scene' }
        const presentation = { moduleId: 'presentation' }
      `),
    ).toEqual([])
    expect(
      task11Phase4IsolationViolations(`
        import { route } from '../routes'
        import { publish } from './publication'
        route(input)
        publish(input)
      `),
    ).toEqual([
      'path: ../routes',
      'path: ./publication',
      'stage-call: publish',
      'stage-call: route',
    ])
    expect(
      task11Phase5IsolationViolations(`
        function ResourceRealizationProducer() { return null }
        type ImplementationVerificationProjection = unknown
        const candidate: ResourceRealizationCandidate = {}
      `),
    ).toEqual([
      'future-identifier: ImplementationVerificationProjection',
      'future-identifier: ResourceRealizationCandidate',
      'future-identifier: ResourceRealizationProducer',
    ])
  })

  test('allows future module keys only in service-owned manifest declarations', () => {
    expect(
      futureModuleLiteralViolations(
        'domain-source.ts',
        `const GAME_IR_MODULE_SOURCE_DOCUMENTS = { 'resource-realization': [] }`,
      ),
    ).toEqual([])
    expect(
      futureModuleLiteralViolations(
        'semantic-admission.ts',
        `const MODULE_DESCRIPTORS = { 'implementation-verification': {} }`,
      ),
    ).toEqual(['future-module-literal: implementation-verification'])
    expect(
      futureModuleLiteralViolations(
        'consumer.ts',
        `const future = 'resource-realization'; const node = { kind: 'implementation-verification.node' }`,
      ),
    ).toEqual([])
    expect(
      futureModuleLiteralViolations(
        'consumer.ts',
        `// 'resource-realization'\nconst text = "implementation-verification"`,
      ),
    ).toEqual([])
  })

  test('rejects aliased builders and hand-built projections by AST facts', () => {
    expect(
      stagedCallerViolations(
        `import { buildPhase5SemanticValidationPacket as makePacket } from './phase5-admission'
         makePacket(input)`,
        'consumer.ts',
      ),
    ).toEqual(['call: buildPhase5SemanticValidationPacket'])
    expect(
      stagedCallerViolations(
        `import * as assembler from './phase5-admission'
         assembler.buildPhase5SemanticValidationPacket(input)`,
        'consumer.ts',
      ),
    ).toEqual(['call: buildPhase5SemanticValidationPacket'])
    expect(
      stagedCallerViolations(
        `const anonymous = {
          schemaVersion: 'game-ir-world-scene-module.v1',
          module: value,
          projectionDigest: digest,
        }`,
        'consumer.ts',
      ),
    ).toEqual(['object: hand-built module projection'])
    expect(
      stagedCallerViolations(
        `const unnamed = {
          module: value,
          sourceDigest: source,
          mechanicalReceiptDigest: mechanical,
          semanticReceiptDigest: semantic,
        }`,
        'consumer.ts',
      ),
    ).toEqual(['object: hand-built module projection'])
    expect(
      stagedCallerViolations(
        `type LocalAlias = WorldSceneModuleProjection
         type AnotherAlias = PresentationModuleProjection`,
        'consumer.ts',
      ),
    ).toEqual([
      'type: PresentationModuleProjection',
      'type: WorldSceneModuleProjection',
    ])
    expect(
      stagedCallerViolations(
        `import {
          prepareWorldSceneSemanticValidationPacket,
          preparePresentationSemanticValidationPacket,
        } from './world-presentation-assembler'
         // buildPhase5SemanticValidationPacket('comment')
         const text = 'WorldSceneModuleProjection'
         prepareWorldSceneSemanticValidationPacket(input)
         preparePresentationSemanticValidationPacket(input)`,
        'consumer.ts',
      ),
    ).toEqual([])
  })

  test('binds semantic future derivation to the canonical source helper and descriptor enumeration', async () => {
    const source = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), 'semantic-admission.ts'),
      'utf8',
    )
    const facts = collectAstFacts(source, 'semantic-admission.ts')
    expect(
      facts.importBindings.some(
        binding =>
          binding.path === './domain-source' &&
          binding.original === 'canonicalGameIrModuleSourceDocuments' &&
          binding.local === 'canonicalGameIrModuleSourceDocuments',
      ),
    ).toBe(true)
    expect(facts.calls).toContain('canonicalGameIrModuleSourceDocuments')
    expect(facts.memberCalls).toContainEqual({
      receiver: 'Object',
      name: 'keys',
    })
    expect(
      futureModuleLiteralViolations('semantic-admission.ts', source),
    ).toEqual([])
  })

  test('scans every Phase 4 production file from its UTF-8 source', async () => {
    const sourceFiles = await Promise.all(
      PHASE4_PRODUCTION_FILES.map(async filename => ({
        filename,
        source: await readFile(
          join(dirname(fileURLToPath(import.meta.url)), filename),
          'utf8',
        ),
      })),
    )
    expect(sourceFiles.map(file => file.filename)).toEqual([
      ...PHASE4_PRODUCTION_FILES,
    ])
    expect(
      sourceFiles.flatMap(({ filename, source }) =>
        task7IsolationViolations(source).map(
          violation => `${filename}: ${violation}`,
        ),
      ),
    ).toEqual([])
  })

  test('scans every accepted Phase 4 file with the stricter Phase 5 construction rule', async () => {
    const sourceFiles = await Promise.all(
      PHASE4_PRODUCTION_FILES.map(async filename => ({
        filename,
        source: await readFile(
          join(dirname(fileURLToPath(import.meta.url)), filename),
          'utf8',
        ),
      })),
    )
    expect(
      sourceFiles.flatMap(({ filename, source }) =>
        task11Phase4IsolationViolations(source).map(
          violation => `${filename}: ${violation}`,
        ),
      ),
    ).toEqual([])
  })

  test('scans every Phase 5 production file and forbids future reachability', async () => {
    const sourceFiles = await Promise.all(
      PHASE5_PRODUCTION_FILES.map(async filename => ({
        filename,
        source: await readFile(
          join(dirname(fileURLToPath(import.meta.url)), filename),
          'utf8',
        ),
      })),
    )
    expect(sourceFiles.map(file => file.filename)).toEqual([
      ...PHASE5_PRODUCTION_FILES,
    ])
    expect(
      sourceFiles.flatMap(({ filename, source }) =>
        task11Phase5IsolationViolations(source).map(
          violation => `${filename}: ${violation}`,
        ),
      ),
    ).toEqual([])
  })

  test('keeps integration callers on staged preparation and out of projection construction', async () => {
    for (const filename of [
      'foundation-parity.test.ts',
      'world-presentation-traversal.integration.test.ts',
      'world-presentation-puzzle.integration.test.ts',
    ]) {
      const source = await readFile(
        join(dirname(fileURLToPath(import.meta.url)), filename),
        'utf8',
      )
      expect(stagedCallerViolations(source, filename)).toEqual([])
    }
  })

  test('discovers and classifies every non-test Game IR production file', async () => {
    const sourceFiles = await readGameIrProductionSourceFiles()
    expect(sourceFiles.map(file => file.filename)).toEqual([
      'balance-producer.ts',
      'balance-schema.ts',
      'contracts.ts',
      'domain-projection.ts',
      'domain-source.ts',
      'foundation-ready-adapter.ts',
      'gameplay-balance-assembler.ts',
      'gameplay-producer.ts',
      'gameplay-schema.ts',
      'model.ts',
      'phase5-admission.ts',
      'presentation-producer.ts',
      'presentation-schema.ts',
      'publication.ts',
      'semantic-admission.ts',
      'world-presentation-assembler.ts',
      'world-scene-producer.ts',
      'world-scene-schema.ts',
    ])
    for (const { filename, source } of sourceFiles) {
      const role = gameIrProductionRole(filename)
      if (role === 'phase4')
        expect(task11Phase4IsolationViolations(source), filename).toEqual([])
      if (role === 'phase5')
        expect(
          task11Phase5IsolationViolations(source, filename),
          filename,
        ).toEqual([])
      if (
        role === 'other' ||
        role === 'contracts' ||
        role === 'publication' ||
        role === 'semantic'
      )
        expect(
          policyViolations(collectAstFacts(source, filename), role),
          filename,
        ).toEqual([])
      expect(futureModuleLiteralViolations(filename, source), filename).toEqual(
        [],
      )
    }
  })

  test('keeps Foundation internals independent from Game IR', async () => {
    const sourceFiles = await readSourceFilesRecursively(deliveryWorkflowRoot)
    for (const protectedPath of FOUNDATION_PROTECTED_FILES) {
      const filename = basename(protectedPath)
      const matches = sourceFiles.filter(
        file => basename(file.path) === filename,
      )
      expect(matches).toHaveLength(1)
      expect({
        filename,
        violations: boundaryViolations(matches[0]!.source),
      }).toEqual({ filename, violations: [] })
    }
  })

  test('keeps incomplete Stage 5 unreachable from current production files', async () => {
    const violations = standaloneProductionViolations(
      await readProductionSourceFiles(serverSourceRoot),
    )
    expect(violations).toEqual([])
  })
})
