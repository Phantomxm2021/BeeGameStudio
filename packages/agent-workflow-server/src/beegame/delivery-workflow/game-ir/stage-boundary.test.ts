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
  apiImports: readonly string[]
  calls: readonly string[]
  providerDispatch: boolean
  identifiers: readonly string[]
  properties: readonly { key?: string; value: string }[]
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
const forbiddenPaths =
  /(?:^|\/)(?:controller|store|run-store|delivery-run|foundation-issue(?:-registry)?)(?:\.ts)?$/
const forbiddenPhase5Paths =
  /(?:^|\/)(?:routes?|publication|consumer|delivery)(?:\.ts)?$/
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
  const apiImports: string[] = []
  const calls: string[] = []
  const identifiers: string[] = []
  const properties: Array<{ key?: string; value: string }> = []
  const strings: Array<{
    value: string
    isPropertyName: boolean
    isPropertyValue: boolean
    declarationName?: string
  }> = []
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
          const name = specifier.propertyName?.text ?? specifier.name.text
          if (forbiddenApis.has(name)) apiImports.push(name)
        }
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push({ kind: 'export', path: node.moduleSpecifier.text })
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
      if (calledName && forbiddenApis.has(calledName)) calls.push(calledName)
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
    if (ts.isIdentifier(node)) identifiers.push(node.text)
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer))
      properties.push({
        key: ts.isIdentifier(node.name) ? node.name.text : undefined,
        value: node.initializer.text,
      })
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
    apiImports,
    calls,
    providerDispatch,
    identifiers,
    properties,
    strings,
  }
}

function policyViolations(
  facts: AstFacts,
  policy: 'task7' | 'phase4' | 'phase5' | 'other',
): string[] {
  const violations = new Set<string>()
  for (const entry of facts.imports)
    if (
      forbiddenPaths.test(entry.path) ||
      (policy === 'phase5' && forbiddenPhase5Paths.test(entry.path))
    )
      violations.add(`path: ${entry.path}`)
  for (const name of facts.apiImports) violations.add(`api-import: ${name}`)
  for (const name of facts.calls) {
    if (forbiddenApis.has(name)) violations.add(`api-call: ${name}`)
    if (
      (policy === 'phase5' || policy === 'other') &&
      name === 'assembleWorldPresentationClosure'
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
  if (policy === 'phase5' || policy === 'other')
    for (const entry of facts.strings)
      if (
        futureModuleIds.has(entry.value) &&
        !entry.isPropertyName &&
        !entry.isPropertyValue
      )
        violations.add(`future-module-literal: ${entry.value}`)
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

function futureModuleLiteralViolations(source: string): string[] {
  return collectAstFacts(source, 'task-11-future-module-whitelist.ts')
    .strings.filter(
      entry =>
        futureModuleIds.has(entry.value) &&
        (!entry.isPropertyName ||
          !['GAME_IR_MODULE_SOURCE_DOCUMENTS', 'MODULE_DESCRIPTORS'].includes(
            entry.declarationName ?? '',
          )),
    )
    .map(entry => `future-module-literal: ${entry.value}`)
    .sort()
}

type GameIrProductionRole = 'phase4' | 'phase5' | 'authorized' | 'other'

function gameIrProductionRole(filename: string): GameIrProductionRole {
  if (
    filename === 'contracts.ts' ||
    filename === 'publication.ts' ||
    filename === 'semantic-admission.ts'
  )
    return 'authorized'
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
      expect(source).toContain("from '../types'")
      expect(source).not.toMatch(
        /from ['"].*foundation-(?:audit|fact|issue|revision)/,
      )
      expect(source).not.toMatch(/from ['"].*(?:controller|schema|recovery)/)
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
      `),
    ).toEqual([
      'api-call: parseGameIrCandidate',
      'api-call: prepareGameIrPublication',
      'future-module: implementation-verification',
      'future-node: resource-realization.logical-resource',
      'path: ../routes',
      'path: ./publication',
      'provider-dispatch: provider dispatch call',
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
  })

  test('allows future module keys only in service-owned manifest declarations', () => {
    expect(
      futureModuleLiteralViolations(
        `const GAME_IR_MODULE_SOURCE_DOCUMENTS = { 'resource-realization': [] }`,
      ),
    ).toEqual([])
    expect(
      futureModuleLiteralViolations(
        `const MODULE_DESCRIPTORS = { 'implementation-verification': {} }`,
      ),
    ).toEqual([])
    expect(
      futureModuleLiteralViolations(
        `const future = 'resource-realization'; const node = { kind: 'implementation-verification.node' }`,
      ),
    ).toEqual(['future-module-literal: resource-realization'])
    expect(
      futureModuleLiteralViolations(
        `// 'resource-realization'\nconst text = "implementation-verification"`,
      ),
    ).toEqual(['future-module-literal: implementation-verification'])
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
      if (role === 'other')
        expect(
          policyViolations(collectAstFacts(source, filename), 'other'),
          filename,
        ).toEqual([])
      if (role !== 'authorized')
        expect(futureModuleLiteralViolations(source), filename).toEqual([])
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
