import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'

const deliveryWorkflowRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const protectedFoundationFiles = [
  'foundation-audit-artifacts.ts',
  'foundation-audit-authority.ts',
  'foundation-audit-check-definitions.ts',
  'foundation-audit-contracts.ts',
  'foundation-audit-production-manifest.ts',
  'foundation-audit-rules.ts',
  'foundation-audit-state.ts',
  'foundation-fact-definitions.ts',
  'foundation-fact-extraction.ts',
  'foundation-fact-runtime.ts',
  'foundation-fact-store.ts',
  'foundation-impact-analysis.ts',
  'foundation-issue-registry.ts',
  'foundation-patch-validation.ts',
  'foundation-revision-batches.ts',
  'foundation-revision-publication.ts',
  'foundation-revision-round-policy.ts',
  'foundation-revision-stage.ts',
  'foundation-semantic-audit.ts',
  'foundation-semantic-runtime.ts',
  'revision.ts',
] as const

const currentStageFiles = [
  'types.ts',
  'schema.ts',
  'controller.ts',
  'transition.ts',
  'recovery.ts',
] as const

const gameIrContractFiles = ['contracts.ts'] as const

const forbiddenImportPath = /game-ir(?:\/|['"])/
const forbiddenFoundationTokens = ['GameIr', 'GAME_IR', 'gameIrState'] as const

function boundaryViolations(source: string): string[] {
  const violations: string[] = []
  if (forbiddenImportPath.test(source)) violations.push('game-ir import path')
  for (const token of forbiddenFoundationTokens)
    if (source.includes(token)) violations.push(`token: ${token}`)
  return violations
}

function currentStage5Markers(source: string): string[] {
  return ['GAME_IR_COMPILATION', 'gameIrState'].filter(token =>
    source.includes(token),
  )
}

async function readSourceFilesRecursively(
  directory: string,
): Promise<Array<{ path: string; source: string }>> {
  const files: Array<{ path: string; source: string }> = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      files.push(...(await readSourceFilesRecursively(path)))
    else if (entry.isFile())
      files.push({ path, source: await readFile(path, 'utf8') })
  }
  return files
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
      'type GameIrResult = unknown',
      'const kind = GAME_IR',
      'const state = gameIrState',
    ].map(source => boundaryViolations(source))

    expect(syntheticViolations).toEqual([
      ['game-ir import path'],
      ['token: GameIr'],
      ['token: GAME_IR'],
      ['token: gameIrState'],
    ])
    expect(
      boundaryViolations("import { foundation } from './foundation-runtime'"),
    ).toEqual([])
  })

  test('keeps Foundation internals independent from Game IR', async () => {
    const sourceFiles = await readSourceFilesRecursively(deliveryWorkflowRoot)
    for (const filename of protectedFoundationFiles) {
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
    for (const filename of currentStageFiles) {
      const source = await readFile(
        join(deliveryWorkflowRoot, filename),
        'utf8',
      )
      expect({ filename, markers: currentStage5Markers(source) }).toEqual({
        filename,
        markers: [],
      })
    }
  })
})
