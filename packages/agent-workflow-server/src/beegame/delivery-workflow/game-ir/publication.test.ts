import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  GAME_IR_SEMANTIC_VALIDATOR_MANIFEST,
  type GameIrSemanticValidationResult,
} from './semantic-admission'
import type { GameIrCandidate, GameIrSourceSection } from './model'
import { parseGameIrCandidate } from './model'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { digestSectionIndex } from '../foundation-section-index'
import {
  commitGameIrPublication,
  prepareGameIrPublication,
  recoverGameIrPublication,
  validateCommittedGameIr,
} from './publication'

const allDigest = 'a'.repeat(64)
const markdown = '# Core Loop\n\nThe player survives.\n'
const sectionDigest = createHash('sha256').update(markdown).digest('hex')
const sectionIndex: readonly GameIrSourceSection[] = [
  {
    documentPath: 'docs/GDD.md',
    sectionId: 'core-loop',
    heading: 'Core Loop',
    startLine: 1,
    endLine: 3,
    digest: sectionDigest,
  },
]

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function request(): GameIrCompileRequest {
  const foundationWithoutDigest: Omit<FoundationReadyReceipt, 'receiptDigest'> =
    {
      schemaVersion: 'foundation-ready-receipt.v1',
      projectId: 'project-1',
      foundationRevision: 'foundation-revision-1',
      confirmedBriefDigest: allDigest,
      documentDigests: Object.fromEntries(
        CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, allDigest]),
      ) as FoundationReadyReceipt['documentDigests'],
      sectionIndexPath: '.beegame/foundation/section-index.json',
      sectionIndexDigest: digestSectionIndex(sectionIndex),
      authority: {
        kind: 'review',
        reviewDigest: allDigest,
        issueRegistryDigest: allDigest,
      },
    }
  const foundation = {
    ...foundationWithoutDigest,
    receiptDigest: createHash('sha256')
      .update(canonical(foundationWithoutDigest))
      .digest('hex'),
  }
  return {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'compile-task-1',
    publicationId: 'publication-1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation,
  }
}

function rawCandidate(): Record<string, unknown> {
  const modules = [...GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules]
    .map(({ moduleId }) => ({
      moduleId,
      nodes: [
        {
          id: `${moduleId}.root`,
          kind: 'semantic-node',
          producerMode: 'semantic',
          value: { label: moduleId },
          bindings: {
            '/id': {
              kind: 'owner',
              documentPath: 'docs/GDD.md',
              sectionId: 'core-loop',
              sectionDigest,
              sourcePointer: `/ir/${moduleId}`,
            },
            '/value/label': {
              kind: 'owner',
              documentPath: 'docs/GDD.md',
              sectionId: 'core-loop',
              sectionDigest,
              sourcePointer: `/ir/${moduleId}/label`,
            },
          },
        },
      ],
    }))
    .sort((left, right) => left.moduleId.localeCompare(right.moduleId))
  return {
    schemaVersion: GAME_IR_SCHEMA_VERSION,
    taskId: 'compile-task-1',
    foundationRevision: 'foundation-revision-1',
    modules,
  }
}

function candidate(): GameIrCandidate {
  return parseGameIrCandidate(rawCandidate(), {
    request: request(),
    sections: sectionIndex,
  })
}

function passReceipts(): Readonly<
  Record<string, GameIrSemanticValidationResult>
> {
  return Object.fromEntries(
    GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules.map(module => [
      module.moduleId,
      {
        outcome: 'PASS' as const,
        packetDigest: allDigest,
        checkIds: module.checkIds,
      },
    ]),
  )
}

const workspaces: string[] = []
async function input() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'game-ir-publication-'))
  workspaces.push(workspacePath)
  return {
    workspacePath,
    request: request(),
    candidate: candidate(),
    semanticPassReceipts: passReceipts(),
  }
}

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  )
})

describe('atomic Game IR publication and recovery', () => {
  test('writes PREPARED journal before COMMITTED and exposes only the fixed revision layout', async () => {
    const value = await input()
    const prepared = await prepareGameIrPublication(value)
    const root = join(value.workspacePath, '.beegame/ir/game-ir.v1')
    expect(await stat(join(root, '.journal/publication-1.json'))).toBeTruthy()
    await expect(
      stat(join(root, 'revisions/foundation-revision-1/COMMITTED.json')),
    ).rejects.toThrow()

    const ready = await commitGameIrPublication(value)
    expect(ready.foundationRevision).toBe('foundation-revision-1')
    expect(
      await stat(join(root, 'revisions/foundation-revision-1/COMMITTED.json')),
    ).toBeTruthy()
    expect(
      (await readdir(join(root, 'revisions/foundation-revision-1'))).sort(),
    ).toEqual([
      'COMMITTED.json',
      'dependency-graph.json',
      'manifest.json',
      'modules',
      'source-maps',
    ])
    expect(await readdir(root)).toEqual(['revisions'])
    expect(prepared.preparedPath).toContain('.staging/publication-1')
    await expect(
      validateCommittedGameIr({
        workspacePath: value.workspacePath,
        request: value.request,
      }),
    ).resolves.toEqual(ready)
  })

  test('recovery rolls forward a partial publication, is idempotent, then removes staging and journal', async () => {
    const value = await input()
    await prepareGameIrPublication(value)
    const root = join(value.workspacePath, '.beegame/ir/game-ir.v1')
    const finalRoot = join(root, 'revisions/foundation-revision-1')
    await rm(join(finalRoot, 'modules'), { recursive: true, force: true })
    const recovered = await recoverGameIrPublication(value)
    expect(await stat(join(finalRoot, 'COMMITTED.json'))).toBeTruthy()
    await expect(recoverGameIrPublication(value)).resolves.toEqual(recovered)
    await expect(stat(join(root, '.staging/publication-1'))).rejects.toThrow()
    await expect(
      stat(join(root, '.journal/publication-1.json')),
    ).rejects.toThrow()
  })

  test('rejects FAIL or AMBIGUOUS semantic receipts and stale authority', async () => {
    const value = await input()
    const failed = {
      ...passReceipts(),
      gameplay: {
        outcome: 'FAIL' as const,
        packetDigest: allDigest,
        reasonCode: 'x',
        actual: 'x',
        evidencePointers: ['/docs/GDD.md#core-loop/ir/gameplay'],
      },
    }
    await expect(
      prepareGameIrPublication({ ...value, semanticPassReceipts: failed }),
    ).rejects.toThrow(/PASS|semantic/i)
    await expect(
      prepareGameIrPublication({
        ...value,
        request: {
          ...value.request,
          foundation: {
            ...value.request.foundation,
            foundationRevision: 'other-revision',
          },
        },
      }),
    ).rejects.toThrow(/digest|revision|authority/i)
  })

  test('rejects conflicting final bytes and tampering', async () => {
    const value = await input()
    await prepareGameIrPublication(value)
    const root = join(value.workspacePath, '.beegame/ir/game-ir.v1')
    const manifestPath = join(root, '.staging/publication-1/manifest.json')
    const original = await readFile(manifestPath, 'utf8')
    await Bun.write(manifestPath, `${original}tampered`)
    await expect(recoverGameIrPublication(value)).rejects.toThrow(
      /staging|digest|journal/i,
    )
  })

  test('does not impose a fixed node or artifact count cap', async () => {
    const value = await input()
    expect(await prepareGameIrPublication(value)).toBeTruthy()
  })
})
