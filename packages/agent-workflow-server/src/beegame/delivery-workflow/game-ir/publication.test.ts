import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { digestSectionIndex } from '../foundation-section-index'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  parseGameIrCandidate,
  type GameIrCandidate,
  type GameIrSourceSection,
} from './model'
import {
  GAME_IR_SEMANTIC_VALIDATOR_MANIFEST,
  admitGameIrSemanticValidationResult,
  buildGameIrSemanticValidationPacket,
  type GameIrSemanticValidationPacket,
  type GameIrSemanticValidationResult,
} from './semantic-admission'
import {
  commitGameIrPublication,
  prepareGameIrPublication,
  recoverGameIrPublication,
  validateCommittedGameIr,
  type GameIrPublicationAuthority,
} from './publication'

const digest = 'a'.repeat(64)
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
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function request(): GameIrCompileRequest {
  const body: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project-1',
    foundationRevision: 'foundation-revision-1',
    confirmedBriefDigest: digest,
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, digest]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(sectionIndex),
    authority: {
      kind: 'review',
      reviewDigest: digest,
      issueRegistryDigest: digest,
    },
  }
  return {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'compile-task-1',
    publicationId: 'publication-1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: { ...body, receiptDigest: sha(body) },
  }
}

function sha(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function rawCandidate(): Record<string, unknown> {
  return {
    schemaVersion: GAME_IR_SCHEMA_VERSION,
    taskId: 'compile-task-1',
    foundationRevision: 'foundation-revision-1',
    modules: [...GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules].map(
      ({ moduleId }) => ({
        moduleId,
        nodes: [
          ...(moduleId === 'gameplay'
            ? [0, 1, 2].map(index => ({
                id: `${moduleId}.extra-${index}`,
                kind: 'derived-node',
                producerMode: 'derived',
                value: { score: index },
                bindings: {
                  '/id': {
                    kind: 'owner',
                    documentPath: 'docs/GDD.md',
                    sectionId: 'core-loop',
                    sectionDigest,
                    sourcePointer: `/ir/${moduleId}/extra-${index}`,
                  },
                  '/value/score': {
                    kind: 'derived',
                    derivationRuleId: `score-${index}`,
                    inputPointers: ['/id'],
                  },
                },
              }))
            : []),
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
      }),
    ),
  }
}

function authority(workspacePath: string): GameIrPublicationAuthority {
  const compileRequest = request()
  const candidate = parseGameIrCandidate(rawCandidate(), {
    request: compileRequest,
    sections: sectionIndex,
  })
  const admissions = GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules.map(
    ({ moduleId }) => {
      const packet = buildGameIrSemanticValidationPacket({
        candidate,
        request: compileRequest,
        sectionIndex,
        moduleId,
        sectionBytes: { 'docs/GDD.md#core-loop': markdown },
      })
      const result = admitGameIrSemanticValidationResult(packet, {
        outcome: 'PASS',
        packetDigest: packet.packetDigest,
        checkIds: packet.checkIds,
      })
      return { moduleId, packet, result }
    },
  )
  return {
    workspacePath,
    publicationId: compileRequest.publicationId,
    compileRequest,
    candidate,
    sectionIndex: Object.freeze(
      sectionIndex.map(section => Object.freeze(section)),
    ),
    admissions: Object.freeze(
      admissions.map(admission => Object.freeze(admission)),
    ),
  }
}

const workspaces: string[] = []
async function setup(): Promise<GameIrPublicationAuthority> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'game-ir-publication-'))
  workspaces.push(workspacePath)
  return authority(workspacePath)
}
afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  )
})

describe('atomic Game IR publication and recovery', () => {
  test('writes PREPARED journal first and exposes only a complete revision after directory rename', async () => {
    const value = await setup()
    const prepared = await prepareGameIrPublication(value)
    const root = join(value.workspacePath, '.beegame/ir/game-ir.v1')
    expect(
      await readFile(join(value.workspacePath, prepared.journalPath), 'utf8'),
    ).toContain('PREPARED')
    expect((await readdir(root)).sort()).toEqual(['.journal', '.staging'])
    await expect(validateCommittedGameIr(value)).rejects.toThrow()
    const ready = await commitGameIrPublication(value)
    expect(await readdir(root)).toEqual(['revisions'])
    expect(ready.committedPath).toBe(
      '.beegame/ir/game-ir.v1/revisions/foundation-revision-1/COMMITTED.json',
    )
    expect(
      await readFile(
        join(
          value.workspacePath,
          ready.committedPath.replace(
            /COMMITTED\.json$/,
            'dependency-graph.json',
          ),
        ),
        'utf8',
      ),
    ).toContain('gameplay.extra-0')
    await expect(validateCommittedGameIr(value)).resolves.toEqual(ready)
  })

  test('uses real packet/result admission and rejects digest-only, stale, missing, and ambiguous evidence', async () => {
    const value = await setup()
    const bad = {
      ...value,
      admissions: Object.freeze(
        value.admissions.map(admission =>
          Object.freeze({
            ...admission,
            result: Object.freeze({
              outcome: 'PASS',
              packetDigest: digest,
              checkIds: admission.packet.checkIds,
            }) as GameIrSemanticValidationResult,
          }),
        ),
      ),
    }
    await expect(prepareGameIrPublication(bad)).rejects.toThrow(
      /packet|admission|immutable/i,
    )
    await expect(
      prepareGameIrPublication({
        ...value,
        admissions: Object.freeze(value.admissions.slice(1)),
      }),
    ).rejects.toThrow(/module|admission|immutable/i)
    const stale = Object.freeze({
      ...value.admissions[0]!,
      packet: Object.freeze({
        ...value.admissions[0]!.packet,
        foundationRevision: 'stale',
      }) as GameIrSemanticValidationPacket,
    })
    await expect(
      prepareGameIrPublication({
        ...value,
        admissions: Object.freeze([stale, ...value.admissions.slice(1)]),
      }),
    ).rejects.toThrow(/packet|revision|immutable/i)
    const ambiguous = Object.freeze({
      ...value.admissions[0]!,
      result: Object.freeze({
        outcome: 'AMBIGUOUS',
        packetDigest: value.admissions[0]!.packet.packetDigest,
        reasonCode: 'uncertain',
        actual: 'uncertain',
        evidencePointers: Object.freeze([
          value.admissions[0]!.packet.allowedEvidencePointers[0]!,
        ]),
      }) as GameIrSemanticValidationResult,
    })
    await expect(
      prepareGameIrPublication({
        ...value,
        admissions: Object.freeze([ambiguous, ...value.admissions.slice(1)]),
      }),
    ).rejects.toThrow(/PASS|ambiguous|admission/i)
    const missingCandidate = Object.freeze({
      ...value.candidate,
      modules: Object.freeze(value.candidate.modules.slice(1)),
    })
    await expect(
      prepareGameIrPublication({ ...value, candidate: missingCandidate }),
    ).rejects.toThrow(/module|candidate|packet/i)
    const invalidCandidate = Object.freeze({
      ...value.candidate,
      modules: Object.freeze(
        value.candidate.modules.map((module, index) =>
          index === 0
            ? Object.freeze({ ...module, nodes: Object.freeze([]) })
            : module,
        ),
      ),
    })
    await expect(
      prepareGameIrPublication({ ...value, candidate: invalidCandidate }),
    ).rejects.toThrow(/packet|candidate|admission/i)
  })

  test('recovery fills missing staging files, rejects coordinated journal/staging tamper, and replays marker-before-cleanup', async () => {
    const value = await setup()
    const prepared = await prepareGameIrPublication(value)
    const staging = join(value.workspacePath, prepared.preparedPath)
    await rm(join(staging, 'manifest.json'))
    const recovered = await recoverGameIrPublication(value)
    await expect(recoverGameIrPublication(value)).resolves.toEqual(recovered)

    const second = await setup()
    const secondPrepared = await prepareGameIrPublication(second)
    const journalPath = join(second.workspacePath, secondPrepared.journalPath)
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Record<
      string,
      unknown
    >
    const entries = journal.entries as Array<Record<string, unknown>>
    entries[0] = { ...entries[0], digest: sha('coordinated') }
    await Bun.write(journalPath, `${canonical(journal)}\n`)
    await Bun.write(
      join(
        second.workspacePath,
        secondPrepared.preparedPath,
        entries[0]!.path as string,
      ),
      'coordinated\n',
    )
    await expect(recoverGameIrPublication(second)).rejects.toThrow(
      /authority|digest|staging|conflicting/i,
    )
  })

  test('never overwrites a conflicting final and rejects tampered module, source-map, graph, and marker bytes', async () => {
    const value = await setup()
    const prepared = await prepareGameIrPublication(value)
    const finalRoot = join(
      value.workspacePath,
      '.beegame/ir/game-ir.v1/revisions/foundation-revision-1',
    )
    await mkdir(finalRoot, { recursive: true })
    await Bun.write(join(finalRoot, 'manifest.json'), 'attacker\n')
    await expect(commitGameIrPublication(value)).rejects.toThrow(
      /conflict|final|authority/i,
    )
    for (const artifactPath of [
      'modules/core.json',
      'source-maps/core.json',
      'dependency-graph.json',
      'COMMITTED.json',
    ]) {
      const clean = await setup()
      await prepareGameIrPublication(clean)
      await commitGameIrPublication(clean)
      const committedRoot = join(
        clean.workspacePath,
        '.beegame/ir/game-ir.v1/revisions/foundation-revision-1',
      )
      const target = join(committedRoot, artifactPath)
      await Bun.write(
        target,
        `${canonical({ attacker: true, recomputedDigest: digest })}\n`,
      )
      await expect(validateCommittedGameIr(clean)).rejects.toThrow(
        /digest|artifact|authority|module|final/i,
      )
    }
  })

  test('rejects symlink path components before writing outside workspace and has no fixed node cap', async () => {
    const value = await setup()
    await mkdir(join(value.workspacePath, '.beegame/ir/game-ir.v1'), {
      recursive: true,
    })
    const outside = await mkdtemp(join(tmpdir(), 'game-ir-outside-'))
    workspaces.push(outside)
    await symlink(
      outside,
      join(value.workspacePath, '.beegame/ir/game-ir.v1/.staging'),
    )
    await expect(prepareGameIrPublication(value)).rejects.toThrow(
      /symlink|directory|path/i,
    )
    expect(await readdir(outside)).toEqual([])
    const traversalWorkspace = await setup()
    await expect(
      prepareGameIrPublication({
        ...traversalWorkspace,
        publicationId: '../escape',
      }),
    ).rejects.toThrow(/publication|path|match/i)
    expect(await readdir(traversalWorkspace.workspacePath)).toEqual([])
  })

  test('concurrent same-revision publishers yield one exact winner', async () => {
    const value = await setup()
    const [left, right] = await Promise.allSettled([
      commitGameIrPublication(value),
      commitGameIrPublication(value),
    ])
    expect(
      [left, right].filter(result => result.status === 'fulfilled'),
    ).toHaveLength(2)
    expect(
      left.status === 'fulfilled' && right.status === 'fulfilled' && left.value,
    ).toEqual(right.status === 'fulfilled' && right.value)
    await expect(validateCommittedGameIr(value)).resolves.toBeTruthy()
  })
})
