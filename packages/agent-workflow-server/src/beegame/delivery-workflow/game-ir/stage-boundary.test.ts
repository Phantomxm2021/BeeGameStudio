import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'
import {
  boundaryViolations,
  FOUNDATION_PROTECTED_FILES,
  readProductionSourceFiles,
  readSourceFilesRecursively,
  standaloneProductionViolations,
} from './stage-boundary-test-helpers'

const deliveryWorkflowRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const gameIrContractFiles = ['contracts.ts'] as const

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
    ])
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
    const violations = (
      await readProductionSourceFiles(deliveryWorkflowRoot)
    ).flatMap(file =>
      boundaryViolations(file.source).map(
        violation => `${file.path}: ${violation}`,
      ),
    )
    expect(violations).toEqual([])
  })
})
