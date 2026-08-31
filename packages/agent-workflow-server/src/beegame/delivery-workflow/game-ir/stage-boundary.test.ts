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

const TASK_7_PHASE4_PRODUCTION_FILES = [
  'domain-source.ts',
  'domain-projection.ts',
  'gameplay-schema.ts',
  'balance-schema.ts',
  'gameplay-producer.ts',
  'balance-producer.ts',
  'gameplay-balance-assembler.ts',
] as const

function task7IsolationViolations(source: string): string[] {
  const file = ts.createSourceFile(
    'task-7-static-scan.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const violations = new Set<string>()
  const forbiddenApis = new Set([
    'parseGameIrCandidate',
    'prepareGameIrPublication',
    'commitGameIrPublication',
  ])
  const placeholderModules = new Set([
    'core',
    'world-scene',
    'presentation',
    'resource-realization',
    'implementation-verification',
  ])
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
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const path = node.moduleSpecifier.text
      if (
        /(?:^|\/)(?:controller|store|run-store|delivery-run|foundation-issue(?:-registry)?)(?:\.ts)?$/.test(
          path,
        )
      )
        violations.add(`path: ${path}`)
      if (
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      )
        for (const specifier of node.importClause.namedBindings.elements) {
          const name = specifier.propertyName?.text ?? specifier.name.text
          if (forbiddenApis.has(name)) violations.add(`api-import: ${name}`)
        }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      forbiddenApis.has(node.expression.text)
    )
      violations.add(`api-call: ${node.expression.text}`)
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      const calledName = ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : ts.isElementAccessExpression(expression) &&
            ts.isStringLiteral(expression.argumentExpression)
          ? expression.argumentExpression.text
          : undefined
      if (calledName && forbiddenApis.has(calledName))
        violations.add(`api-call: ${calledName}`)
      const receiver =
        ts.isPropertyAccessExpression(expression) ||
        ts.isElementAccessExpression(expression)
          ? expression.expression
          : undefined
      if (calledName === 'dispatch' && receiver && containsProvider(receiver))
        violations.add('provider-dispatch: provider dispatch call')
    }
    if (
      ts.isIdentifier(node) &&
      (node.text === 'DeliveryRun' || node.text === 'FoundationIssue')
    )
      violations.add(`identifier: ${node.text}`)
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'moduleId' &&
      ts.isStringLiteral(node.initializer) &&
      placeholderModules.has(node.initializer.text)
    )
      violations.add(`placeholder-module: ${node.initializer.text}`)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return [...violations].sort()
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

  test('scans every Phase 4 production file from its UTF-8 source', async () => {
    const sourceFiles = await Promise.all(
      TASK_7_PHASE4_PRODUCTION_FILES.map(async filename => ({
        filename,
        source: await readFile(
          join(dirname(fileURLToPath(import.meta.url)), filename),
          'utf8',
        ),
      })),
    )
    expect(sourceFiles.map(file => file.filename)).toEqual([
      ...TASK_7_PHASE4_PRODUCTION_FILES,
    ])
    expect(
      sourceFiles.flatMap(({ filename, source }) =>
        task7IsolationViolations(source).map(
          violation => `${filename}: ${violation}`,
        ),
      ),
    ).toEqual([])
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
