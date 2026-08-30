import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../../__tests__/complete-game-document-fixture'
import { withTestDocumentMetadata } from '../../../__tests__/delivery-workflow-test-helpers'
import {
  buildFoundationSectionIndex,
  digestSectionIndex,
} from '../foundation-section-index'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'
import {
  gameIrCommittedPath,
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
const chmodProbeSupported =
  ['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos'].includes(
    process.platform,
  ) &&
  typeof process.getuid === 'function' &&
  process.getuid() !== 0
const documents = new Map(
  CANONICAL_FOUNDATION_DOCUMENTS.map(path => {
    const submission = completeTestSubmission(path)
    return [
      path,
      withTestDocumentMetadata(
        path,
        renderTestCompleteGameDocument(path, submission),
      ),
    ] as const
  }),
)
const sectionIndex: readonly GameIrSourceSection[] = [
  ...buildFoundationSectionIndex({ documents }),
].sort((left, right) =>
  `${left.documentPath}\0${left.startLine}\0${left.sectionId}`.localeCompare(
    `${right.documentPath}\0${right.startLine}\0${right.sectionId}`,
  ),
)
const documentDigests = Object.fromEntries(
  [...documents].map(([path, bytes]) => [path, shaBytes(bytes)]),
) as Record<FoundationDocumentPath, string>
const gddSection = sectionIndex.find(
  section => section.documentPath === 'docs/GDD.md',
)!
const sectionDigest = gddSection.digest
const sectionId = gddSection.sectionId

function sectionKey(
  ref: Pick<GameIrSourceSection, 'documentPath' | 'sectionId'>,
): string {
  return `${ref.documentPath}#${ref.sectionId}`
}

function sectionBytesFor(moduleId: string): Record<string, string> {
  const module = GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules.find(
    item => item.moduleId === moduleId,
  )!
  const result = Object.fromEntries(
    sectionIndex
      .filter(
        section =>
          module.sourceDocumentPaths.includes(section.documentPath) ||
          sectionKey(section) === sectionKey(gddSection),
      )
      .map(section => [
        sectionKey(section),
        documents
          .get(section.documentPath)!
          .split('\n')
          .slice(section.startLine - 1, section.endLine)
          .join('\n'),
      ]),
  )
  return result
}

const publicationModulePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'publication.ts',
)

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function request(publicationId = 'publication-1'): GameIrCompileRequest {
  const body: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project-1',
    foundationRevision: 'foundation-revision-1',
    confirmedBriefDigest: shaBytes('confirmed brief'),
    documentDigests: documentDigests,
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
    publicationId,
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: { ...body, receiptDigest: sha(body) },
  }
}

function sha(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}
function shaBytes(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function rawCandidate(extraNodeCount = 3): Record<string, unknown> {
  return {
    schemaVersion: GAME_IR_SCHEMA_VERSION,
    taskId: 'compile-task-1',
    foundationRevision: 'foundation-revision-1',
    modules: [...GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules].map(
      ({ moduleId }) => ({
        moduleId,
        nodes: [
          ...(moduleId === 'gameplay'
            ? Array.from({ length: extraNodeCount }, (_, index) => {
                const extraId =
                  extraNodeCount > 9
                    ? String(index).padStart(3, '0')
                    : String(index)
                return {
                  id: `${moduleId}.extra-${extraId}`,
                  kind: 'derived-node',
                  producerMode: 'derived',
                  value: { score: index },
                  references: [],
                  edges: [
                    {
                      type: 'blocks',
                      targetId: `${moduleId}.root`,
                      targetType: 'semantic-node',
                    },
                    {
                      type: 'requires',
                      targetId: `${moduleId}.root`,
                      targetType: 'semantic-node',
                    },
                  ],
                  bindings: {
                    '/id': {
                      kind: 'owner',
                      documentPath: 'docs/GDD.md',
                      sectionId,
                      sectionDigest,
                      sourcePointer: `/ir/${moduleId}/extra-${extraId}`,
                    },
                    '/value/score': {
                      kind: 'derived',
                      derivationRuleId: `score-${extraId}`,
                      inputPointers: ['/id'],
                    },
                    '/edges/0': {
                      kind: 'owner',
                      documentPath: 'docs/GDD.md',
                      sectionId,
                      sectionDigest,
                      sourcePointer: `/ir/${moduleId}/extra-${extraId}/blocks`,
                    },
                    '/edges/1': {
                      kind: 'owner',
                      documentPath: 'docs/GDD.md',
                      sectionId,
                      sectionDigest,
                      sourcePointer: `/ir/${moduleId}/extra-${extraId}/requires`,
                    },
                  },
                }
              })
            : []),
          {
            id: `${moduleId}.root`,
            kind: 'semantic-node',
            producerMode: 'semantic',
            value: { label: moduleId },
            references: [],
            edges: [],
            bindings: {
              '/id': {
                kind: 'owner',
                documentPath: 'docs/GDD.md',
                sectionId,
                sectionDigest,
                sourcePointer: `/ir/${moduleId}`,
              },
              '/value/label': {
                kind: 'owner',
                documentPath: 'docs/GDD.md',
                sectionId,
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

function authority(
  workspacePath: string,
  extraNodeCount = 3,
  publicationId = 'publication-1',
): GameIrPublicationAuthority {
  const compileRequest = request(publicationId)
  const candidate = parseGameIrCandidate(rawCandidate(extraNodeCount), {
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
        sectionBytes: sectionBytesFor(moduleId),
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
async function setup(extraNodeCount = 3): Promise<GameIrPublicationAuthority> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'game-ir-publication-'))
  workspaces.push(workspacePath)
  return authority(workspacePath, extraNodeCount)
}
afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  )
})

describe('atomic Game IR publication and recovery', () => {
  test('binds semantic packet Section Indexes to the external publication authority', async () => {
    const value = await setup()
    for (const sectionIndex of [
      Object.freeze(value.sectionIndex.slice(0, 1)),
      Object.freeze(
        value.sectionIndex.map((section, index) =>
          Object.freeze(
            index === 0
              ? { ...section, heading: `${section.heading} tampered` }
              : section,
          ),
        ),
      ),
    ]) {
      await expect(
        prepareGameIrPublication({ ...value, sectionIndex }),
      ).rejects.toThrow(/section|index|authority|packet|digest/i)
    }
  })

  test('writes PREPARED journal first and exposes only a complete revision after directory rename', async () => {
    const value = await setup()
    const prepared = await prepareGameIrPublication(value)
    const root = join(value.workspacePath, '.beegame/ir/game-ir.v1')
    const journalPath = join(value.workspacePath, prepared.journalPath)
    const journalBytes = await readFile(journalPath, 'utf8')
    expect(await readFile(journalPath, 'utf8')).toContain('PREPARED')
    expect((await readdir(root)).sort()).toEqual(['.journal', '.staging'])
    await expect(validateCommittedGameIr(value)).rejects.toThrow()
    const ready = await commitGameIrPublication(value)
    expect((await readdir(root)).sort()).toEqual(['.journal', 'revisions'])
    expect(await readFile(journalPath, 'utf8')).toBe(journalBytes)
    expect(ready.committedPath).toBe(
      gameIrCommittedPath(value.compileRequest.foundation.foundationRevision),
    )
    const dependencyGraph = JSON.parse(
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
    ) as { edges: readonly Record<string, unknown>[] }
    expect(dependencyGraph.edges.some(edge => edge.type === 'requires')).toBe(
      true,
    )
    expect(
      new Set(
        dependencyGraph.edges
          .filter(edge => edge.kind === 'relationship')
          .map(edge => edge.type),
      ),
    ).toEqual(new Set(['blocks', 'requires']))
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
        reasonCode: 'ambiguous-projection',
        actual: 'uncertain',
        missingSubject: '/value/ambiguous',
        expectedProjection: 'the canonical projection',
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
    const journalPath = join(value.workspacePath, prepared.journalPath)
    const journalBytes = await readFile(journalPath, 'utf8')
    await rm(join(staging, 'manifest.json'))
    const recovered = await recoverGameIrPublication(value)
    await expect(recoverGameIrPublication(value)).resolves.toEqual(recovered)
    expect(await readFile(journalPath, 'utf8')).toBe(journalBytes)

    const interrupted = await setup()
    const interruptedPrepared = await prepareGameIrPublication(interrupted)
    const crashedPrivateRoot = join(
      interrupted.workspacePath,
      '.beegame/.game-ir-private/crashed-publication-123-abcdef',
    )
    await mkdir(crashedPrivateRoot, { recursive: true })
    await Bun.write(
      join(crashedPrivateRoot, 'manifest.partial'),
      'partial write',
    )
    await rm(
      join(
        interrupted.workspacePath,
        interruptedPrepared.preparedPath,
        'manifest.json',
      ),
    )
    await expect(recoverGameIrPublication(interrupted)).resolves.toBeTruthy()
    expect(await readdir(crashedPrivateRoot)).toEqual(['manifest.partial'])

    const renamed = await setup()
    const renamedPrepared = await prepareGameIrPublication(renamed)
    expect(
      await readdir(join(renamed.workspacePath, renamedPrepared.preparedPath)),
    ).toContain('COMMITTED.json')
    await mkdir(
      join(renamed.workspacePath, '.beegame/ir/game-ir.v1/revisions'),
      { recursive: true },
    )
    await rename(
      join(renamed.workspacePath, renamedPrepared.preparedPath),
      join(
        renamed.workspacePath,
        '.beegame/ir/game-ir.v1/revisions/foundation-revision-1',
      ),
    )
    await expect(recoverGameIrPublication(renamed)).resolves.toBeTruthy()
    expect(
      (
        await readdir(join(renamed.workspacePath, '.beegame/ir/game-ir.v1'))
      ).sort(),
    ).toEqual(['.journal', 'revisions'])

    const conflict = await setup()
    const conflictPrepared = await prepareGameIrPublication(conflict)
    const conflictManifest = join(
      conflict.workspacePath,
      conflictPrepared.preparedPath,
      'manifest.json',
    )
    await Bun.write(conflictManifest, 'conflicting target\n')
    await expect(recoverGameIrPublication(conflict)).rejects.toThrow(
      /conflict|bytes|artifact/i,
    )
    expect(await readFile(conflictManifest, 'utf8')).toBe(
      'conflicting target\n',
    )

    const second = await setup()
    const secondPrepared = await prepareGameIrPublication(second)
    const tamperedJournalPath = join(
      second.workspacePath,
      secondPrepared.journalPath,
    )
    const journal = JSON.parse(
      await readFile(tamperedJournalPath, 'utf8'),
    ) as Record<string, unknown>
    const entries = journal.entries as Array<Record<string, unknown>>
    entries[0] = { ...entries[0], digest: sha('coordinated') }
    await Bun.write(tamperedJournalPath, `${canonical(journal)}\n`)
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

  test('fails closed when a committed revision has no immutable PREPARED journal', async () => {
    const value = await setup()
    const prepared = await prepareGameIrPublication(value)
    await commitGameIrPublication(value)
    await rm(join(value.workspacePath, prepared.journalPath))
    await expect(validateCommittedGameIr(value)).rejects.toThrow(
      /journal|audit|authority/i,
    )
    await expect(recoverGameIrPublication(value)).rejects.toThrow(
      /journal|audit|authority/i,
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
    expect(await readFile(join(finalRoot, 'manifest.json'), 'utf8')).toBe(
      'attacker\n',
    )
    expect(
      (
        await readdir(join(value.workspacePath, '.beegame/ir/game-ir.v1'))
      ).sort(),
    ).toEqual(['.journal', '.staging', 'revisions'])
    for (const artifactPath of [
      'modules/core.json',
      'source-maps/core.json',
      'dependency-graph.json',
      'manifest.json',
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
      const attackerBytes = `${canonical({
        attacker: true,
        recomputedDigest: shaBytes(artifactPath),
      })}\n`
      await Bun.write(target, attackerBytes)
      if (
        artifactPath !== 'manifest.json' &&
        artifactPath !== 'COMMITTED.json'
      ) {
        const manifestPath = join(committedRoot, 'manifest.json')
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
          modules: Array<{
            moduleId: string
            digest: string
            sourceMapDigest: string
          }>
          dependencyGraphDigest: string
        }
        if (artifactPath.startsWith('modules/'))
          manifest.modules.find(module => module.moduleId === 'core')!.digest =
            shaBytes(attackerBytes)
        if (artifactPath.startsWith('source-maps/'))
          manifest.modules.find(
            module => module.moduleId === 'core',
          )!.sourceMapDigest = shaBytes(attackerBytes)
        if (artifactPath === 'dependency-graph.json')
          manifest.dependencyGraphDigest = shaBytes(attackerBytes)
        const manifestBytes = `${canonical(manifest)}\n`
        await Bun.write(manifestPath, manifestBytes)
        const markerPath = join(committedRoot, 'COMMITTED.json')
        const marker = JSON.parse(await readFile(markerPath, 'utf8')) as {
          manifestDigest: string
          authorityDigest: string
          moduleDigests: Record<string, string>
          sourceMapDigests: Record<string, string>
          dependencyGraphDigest: string
        }
        marker.manifestDigest = shaBytes(manifestBytes)
        marker.authorityDigest = shaBytes(manifestBytes)
        if (artifactPath.startsWith('modules/'))
          marker.moduleDigests.core = shaBytes(attackerBytes)
        if (artifactPath.startsWith('source-maps/'))
          marker.sourceMapDigests.core = shaBytes(attackerBytes)
        if (artifactPath === 'dependency-graph.json')
          marker.dependencyGraphDigest = shaBytes(attackerBytes)
        await Bun.write(markerPath, `${canonical(marker)}\n`)
      } else if (artifactPath === 'manifest.json') {
        const markerPath = join(committedRoot, 'COMMITTED.json')
        const marker = JSON.parse(await readFile(markerPath, 'utf8')) as {
          manifestDigest: string
          authorityDigest: string
        }
        marker.manifestDigest = shaBytes(attackerBytes)
        marker.authorityDigest = shaBytes(attackerBytes)
        await Bun.write(markerPath, `${canonical(marker)}\n`)
      }
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

  test('rejects a journal or journal ancestor replaced with an external symlink after commit', async () => {
    const value = await setup()
    const prepared = await prepareGameIrPublication(value)
    await commitGameIrPublication(value)
    const journalPath = join(value.workspacePath, prepared.journalPath)
    const journalBytes = await readFile(journalPath, 'utf8')
    const journalDirectory = dirname(journalPath)
    const external = await mkdtemp(join(tmpdir(), 'game-ir-journal-outside-'))
    workspaces.push(external)
    const externalJournal = join(external, 'publication-1.json')
    await Bun.write(externalJournal, journalBytes)

    await rm(journalDirectory, { recursive: true })
    await symlink(external, journalDirectory)
    await expect(validateCommittedGameIr(value)).rejects.toThrow(
      /journal|symlink|path/i,
    )
    await expect(recoverGameIrPublication(value)).rejects.toThrow(
      /journal|symlink|path/i,
    )
    expect(await readFile(externalJournal, 'utf8')).toBe(journalBytes)
    expect(await readdir(external)).toEqual(['publication-1.json'])
  })

  test.skipIf(!chmodProbeSupported)(
    'recovery rejects an external journal ancestor before consulting its target',
    async () => {
      const value = await setup()
      const prepared = await prepareGameIrPublication(value)
      await commitGameIrPublication(value)
      const journalPath = join(value.workspacePath, prepared.journalPath)
      const journalDirectory = dirname(journalPath)
      const external = await mkdtemp(
        join(tmpdir(), 'game-ir-journal-permission-'),
      )
      workspaces.push(external)
      const externalJournal = join(external, 'publication-1.json')
      await Bun.write(externalJournal, 'outside\n')
      await chmod(external, 0o000)
      try {
        // The mutation proof requires POSIX non-root permission semantics.
        await expect(readFile(externalJournal, 'utf8')).rejects.toThrow(
          /EACCES|EPERM|permission denied/i,
        )
        await rm(journalDirectory, { recursive: true })
        await symlink(external, journalDirectory)
        await expect(recoverGameIrPublication(value)).rejects.toThrow(
          'existing path component is symlink or non-directory',
        )
      } finally {
        await chmod(external, 0o700)
      }
      expect(await readdir(external)).toEqual(['publication-1.json'])
    },
  )

  test('rejects the committed journal file replaced with an external symlink', async () => {
    const value = await setup()
    const prepared = await prepareGameIrPublication(value)
    await commitGameIrPublication(value)
    const journalPath = join(value.workspacePath, prepared.journalPath)
    const journalBytes = await readFile(journalPath, 'utf8')
    const external = await mkdtemp(
      join(tmpdir(), 'game-ir-journal-file-outside-'),
    )
    workspaces.push(external)
    const externalJournal = join(external, 'journal.json')
    await Bun.write(externalJournal, journalBytes)

    await rm(journalPath)
    await symlink(externalJournal, journalPath)
    await expect(validateCommittedGameIr(value)).rejects.toThrow(
      /journal|symlink|path/i,
    )
    await expect(recoverGameIrPublication(value)).rejects.toThrow(
      /journal|symlink|path/i,
    )
    expect(await readFile(externalJournal, 'utf8')).toBe(journalBytes)
    expect(await readdir(external)).toEqual(['journal.json'])
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

  test('coordinates same-revision publishers in independent processes', async () => {
    const value = await setup()
    const childScript = `
      import { commitGameIrPublication } from ${JSON.stringify(publicationModulePath)}
      const freeze = (value) => {
        if (value && typeof value === 'object') {
          for (const child of Object.values(value)) freeze(child)
          Object.freeze(value)
        }
        return value
      }
      console.log(
        JSON.stringify(
          await commitGameIrPublication(
            freeze(JSON.parse(process.env.GAME_IR_AUTH)),
          ),
        ),
      )
    `
    const serialized = JSON.stringify(value)
    const launch = () =>
      Bun.spawn(['bun', '--eval', childScript], {
        cwd: process.cwd(),
        env: { ...process.env, GAME_IR_AUTH: serialized },
        stdout: 'pipe',
        stderr: 'pipe',
      })
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const children = [launch(), launch()]
      const exits = await Promise.all(children.map(child => child.exited))
      if (exits.some(exit => exit !== 0)) {
        const errors = await Promise.all(
          children.map(child =>
            child.stderr
              ? new Response(child.stderr).text()
              : Promise.resolve(''),
          ),
        )
        throw new Error(errors.join('\n'))
      }
      expect(exits).toEqual([0, 0])
      const receipts = await Promise.all(
        children.map(child =>
          child.stdout
            ? new Response(child.stdout).text()
            : Promise.reject(new Error('same-authority child stdout missing')),
        ),
      )
      expect(receipts[0]).toBe(receipts[1])
    }
    await expect(validateCommittedGameIr(value)).resolves.toBeTruthy()
    expect(
      (
        await readdir(join(value.workspacePath, '.beegame/ir/game-ir.v1'))
      ).sort(),
    ).toEqual(['.journal', 'revisions'])
  })

  test('rejects an independent different authority without mixing final bytes', async () => {
    const value = await setup()
    const other = authority(value.workspacePath, 4, 'publication-1')
    await prepareGameIrPublication(value)
    const childScript = `
      import { commitGameIrPublication } from ${JSON.stringify(publicationModulePath)}
      const freeze = (value) => {
        if (value && typeof value === 'object') {
          for (const child of Object.values(value)) freeze(child)
          Object.freeze(value)
        }
        return value
      }
      try {
        await commitGameIrPublication(freeze(JSON.parse(process.env.GAME_IR_AUTH)))
      } catch {
        process.exit(1)
      }
    `
    const launch = (candidate: GameIrPublicationAuthority) =>
      Bun.spawn(['bun', '--eval', childScript], {
        cwd: process.cwd(),
        env: { ...process.env, GAME_IR_AUTH: JSON.stringify(candidate) },
        stdout: 'ignore',
        stderr: 'ignore',
      })
    const children = [launch(value), launch(value), launch(other)]
    const exits = await Promise.all(children.map(child => child.exited))
    expect([...exits].sort()).toEqual([0, 0, 1])
    await expect(validateCommittedGameIr(value)).resolves.toBeTruthy()
    await expect(validateCommittedGameIr(other)).rejects.toThrow()
    expect(
      (
        await readdir(join(value.workspacePath, '.beegame/ir/game-ir.v1'))
      ).sort(),
    ).toEqual(['.journal', 'revisions'])
  })

  test('rejects strict authority descriptor and array-shape tricks', async () => {
    const value = await setup()
    const symbolAuthority = { ...value, [Symbol('hidden')]: true }
    await expect(prepareGameIrPublication(symbolAuthority)).rejects.toThrow(
      /symbol|property/i,
    )

    const nonEnumerableAuthority = { ...value }
    Object.defineProperty(nonEnumerableAuthority, 'hidden', {
      value: true,
      enumerable: false,
    })
    await expect(
      prepareGameIrPublication(nonEnumerableAuthority),
    ).rejects.toThrow(/non-enumerable|property/i)

    const accessorAuthority = { ...value }
    Object.defineProperty(accessorAuthority, 'hidden', {
      get: () => true,
      enumerable: true,
    })
    await expect(prepareGameIrPublication(accessorAuthority)).rejects.toThrow(
      /accessor|property/i,
    )

    const sparseAdmissions = [...value.admissions]
    delete sparseAdmissions[0]
    await expect(
      prepareGameIrPublication({
        ...value,
        admissions: Object.freeze(sparseAdmissions),
      }),
    ).rejects.toThrow(/sparse|array|property/i)

    const customAdmissions = [
      ...value.admissions,
    ] as typeof value.admissions & {
      custom?: boolean
    }
    customAdmissions.custom = true
    await expect(
      prepareGameIrPublication({
        ...value,
        admissions: Object.freeze(customAdmissions),
      }),
    ).rejects.toThrow(/custom|array|property/i)
  })

  test('publishes an expanded candidate beyond common node and edge counts', async () => {
    const value = await setup(260)
    const ready = await commitGameIrPublication(value)
    const graphPath = join(
      value.workspacePath,
      ready.committedPath.replace(/COMMITTED\.json$/, 'dependency-graph.json'),
    )
    const dependencyGraph = JSON.parse(await readFile(graphPath, 'utf8')) as {
      edges: readonly unknown[]
    }
    expect(dependencyGraph.edges.length).toBeGreaterThan(256)
    await expect(validateCommittedGameIr(value)).resolves.toEqual(ready)
  })
})
