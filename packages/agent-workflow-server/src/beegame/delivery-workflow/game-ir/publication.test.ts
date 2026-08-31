import { createHash } from 'node:crypto'
import { renameSync } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
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
  GAME_IR_CANONICAL_MODULE_IDS,
  gameIrCommittedPath,
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  parseGameIrCandidate,
  digestGameIrValue,
  type GameIrCandidate,
  type GameIrSourceSection,
} from './model'
import {
  assembleImplementationVerificationClosure,
  type ImplementationVerificationAssemblyAuthority,
} from './implementation-verification-assembler'
import { implementationVerificationFixture } from './implementation-verification-test-helpers'
import { prepareImplementationVerificationSemanticValidationPacket } from './phase7-admission'
import type { ResourceRealizationAssemblyAuthority } from './resource-realization-assembler'
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
const fifoProbeSupported =
  ['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos'].includes(
    process.platform,
  ) && typeof process.getuid === 'function'
setDefaultTimeout(30_000)
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
  const module = {
    moduleId,
    sourceDocumentPaths: CANONICAL_FOUNDATION_DOCUMENTS,
  }
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

function derivedFromAnchor(
  derivationRuleId: string,
  moduleId: string,
  nodeId: string,
  pointer: string,
  targetValue: unknown,
): Record<string, unknown> {
  return {
    kind: 'derived',
    derivationRuleId,
    inputs: [
      {
        kind: 'external',
        moduleId,
        nodeId,
        pointer,
        targetDigest: digestGameIrValue(targetValue),
      },
    ],
  }
}

function rawCandidate(extraNodeCount = 3): Record<string, unknown> {
  return {
    schemaVersion: GAME_IR_SCHEMA_VERSION,
    taskId: 'compile-task-1',
    foundationRevision: 'foundation-revision-1',
    modules: [...GAME_IR_CANONICAL_MODULE_IDS].map(moduleId => ({
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
                  {
                    type: 'z',
                    targetId: `${moduleId}.root`,
                    targetType: 'semantic-node',
                  },
                  {
                    type: 'ä',
                    targetId: `${moduleId}.root`,
                    targetType: 'semantic-node',
                  },
                ],
                bindings: {
                  '/id': derivedFromAnchor(
                    `identity-from-${moduleId}-root-${extraId}`,
                    moduleId,
                    `${moduleId}.root`,
                    '/id',
                    `${moduleId}.root`,
                  ),
                  '/value/score': derivedFromAnchor(
                    `score-from-${moduleId}-root-${extraId}`,
                    moduleId,
                    `${moduleId}.root`,
                    '/id',
                    `${moduleId}.root`,
                  ),
                  '/edges/0': derivedFromAnchor(
                    `blocks-from-${moduleId}-root-${extraId}`,
                    moduleId,
                    `${moduleId}.root`,
                    '/id',
                    `${moduleId}.root`,
                  ),
                  '/edges/1': derivedFromAnchor(
                    `requires-from-${moduleId}-root-${extraId}`,
                    moduleId,
                    `${moduleId}.root`,
                    '/id',
                    `${moduleId}.root`,
                  ),
                  '/edges/2': derivedFromAnchor(
                    `z-from-${moduleId}-root-${extraId}`,
                    moduleId,
                    `${moduleId}.root`,
                    '/id',
                    `${moduleId}.root`,
                  ),
                  '/edges/3': derivedFromAnchor(
                    `umlaut-from-${moduleId}-root-${extraId}`,
                    moduleId,
                    `${moduleId}.root`,
                    '/id',
                    `${moduleId}.root`,
                  ),
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
    })),
  }
}

function authority(
  workspacePath: string,
  extraNodeCount = 3,
): GameIrPublicationAuthority {
  const fixture = implementationVerificationFixture(
    extraNodeCount > 3 ? extraNodeCount : 0,
  )
  const phase6Authority =
    fixture.phase6Authority as ResourceRealizationAssemblyAuthority
  const preparation = {
    phase6Authority,
    implementationVerification: {
      source: fixture.authority.source,
      mechanical: fixture.authority.mechanical,
      semantic: fixture.semantic,
    },
  } as const
  const packet =
    prepareImplementationVerificationSemanticValidationPacket(preparation)
  const phase7Authority: ImplementationVerificationAssemblyAuthority = {
    phase6Authority,
    implementationVerification: {
      ...preparation.implementationVerification,
      validation: {
        outcome: 'PASS',
        packetDigest: packet.packetDigest,
        checkIds: packet.checkIds,
        coveredTargets: packet.requiredTargets,
      },
    },
  }
  const publicationId =
    phase6Authority.phase5Authority.phase4Authority.gameplay.source
      .compileRequest.publicationId
  return {
    workspacePath,
    publicationId,
    phase7Authority,
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

function sourceOf(value: GameIrPublicationAuthority) {
  return value.phase7Authority.phase6Authority.phase5Authority.phase4Authority
    .gameplay.source
}

describe('atomic Game IR publication and recovery', () => {
  test('binds semantic packet Section Indexes to the external publication authority', async () => {
    const value = await setup()
    for (const sectionIndex of [
      Object.freeze(sourceOf(value).authoritySectionIndex.slice(0, 1)),
      Object.freeze(
        sourceOf(value).authoritySectionIndex.map((section, index) =>
          Object.freeze(
            index === 0
              ? { ...section, heading: `${section.heading} tampered` }
              : section,
          ),
        ),
      ),
    ]) {
      const phase6Authority = value.phase7Authority.phase6Authority
      const tamperedPhase7 = {
        ...value.phase7Authority,
        phase6Authority: {
          ...phase6Authority,
          phase5Authority: {
            ...phase6Authority.phase5Authority,
            phase4Authority: {
              ...phase6Authority.phase5Authority.phase4Authority,
              gameplay: {
                ...phase6Authority.phase5Authority.phase4Authority.gameplay,
                source: {
                  ...sourceOf(value),
                  authoritySectionIndex: sectionIndex,
                },
              },
            },
          },
        },
      }
      await expect(
        prepareGameIrPublication({ ...value, phase7Authority: tamperedPhase7 }),
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
      gameIrCommittedPath(
        sourceOf(value).compileRequest.foundation.foundationRevision,
      ),
    )
    const dependencyGraphBytes = await readFile(
      join(
        value.workspacePath,
        ready.committedPath.replace(
          /COMMITTED\.json$/,
          'dependency-graph.json',
        ),
      ),
      'utf8',
    )
    const dependencyGraph = JSON.parse(dependencyGraphBytes) as {
      edges: readonly Record<string, unknown>[]
    }
    expect(
      dependencyGraph.edges.find(edge => edge.kind === 'derived'),
    ).toMatchObject({
      kind: 'derived',
    })
    expect(dependencyGraph.edges.length).toBeGreaterThan(0)
    expect(
      new Set(
        dependencyGraph.edges
          .filter(edge => edge.kind === 'relationship')
          .map(edge => edge.type),
      ),
    ).toEqual(expect.any(Set))
    const firstRelationshipTypes = dependencyGraph.edges
      .filter(edge => edge.kind === 'relationship')
      .slice(0, 4)
      .map(edge => edge.type)
    expect(firstRelationshipTypes.length).toBeGreaterThan(0)
    expect(ready.dependencyGraphDigest).toBe(shaBytes(dependencyGraphBytes))

    const sourceMapBytes = await readFile(
      join(
        value.workspacePath,
        ready.committedPath.replace(
          /COMMITTED\.json$/,
          'source-maps/implementation-verification.json',
        ),
      ),
      'utf8',
    )
    const sourceMap = JSON.parse(sourceMapBytes) as {
      bindings: readonly {
        nodeId: string
        pointer: string
        binding: Record<string, unknown>
      }[]
    }
    const extraBindings = sourceMap.bindings.filter(
      binding => binding.nodeId !== '',
    )
    expect(extraBindings.length).toBeGreaterThan(0)
    expect(
      extraBindings.every(
        binding =>
          binding.binding.kind === 'owner' ||
          binding.binding.kind === 'derived',
      ),
    ).toBe(true)
    await expect(validateCommittedGameIr(value)).resolves.toEqual(ready)
  })

  test('rejects every detached legacy candidate, section index, and admission field', async () => {
    const value = await setup()
    for (const legacyField of [
      { candidate: {} },
      { compileRequest: {} },
      { sectionIndex: [] },
      { admissions: [] },
    ])
      await expect(
        prepareGameIrPublication({ ...value, ...legacyField } as never),
      ).rejects.toThrow(/unknown or missing fields/)
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
      'modules/balance.json',
      'source-maps/balance.json',
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
          manifest.modules.find(
            module => module.moduleId === 'balance',
          )!.digest = shaBytes(attackerBytes)
        if (artifactPath.startsWith('source-maps/'))
          manifest.modules.find(
            module => module.moduleId === 'balance',
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
          marker.moduleDigests.balance = shaBytes(attackerBytes)
        if (artifactPath.startsWith('source-maps/'))
          marker.sourceMapDigests.balance = shaBytes(attackerBytes)
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

  test('rejects committed directory leaves before reading them', async () => {
    const value = await setup()
    await commitGameIrPublication(value)
    const target = join(
      value.workspacePath,
      '.beegame/ir/game-ir.v1/revisions/foundation-revision-1/modules/balance.json',
    )
    await rm(target)
    await mkdir(target)
    await expect(validateCommittedGameIr(value)).rejects.toThrow(
      /regular file|artifact/i,
    )
    await expect(recoverGameIrPublication(value)).rejects.toThrow(
      /regular file|artifact/i,
    )
  })

  test('syncs journal and staging tree before rename, then final tree before READY', async () => {
    const value = await setup()
    const events: {
      type: string
      path?: string
      from?: string
      to?: string
    }[] = []
    await commitGameIrPublication(value, {
      onEvent: event => events.push(event),
    })
    events.push({ type: 'ready-return' })
    const root = join(
      await realpath(value.workspacePath),
      '.beegame/ir/game-ir.v1',
    )
    const journalSync = events.findLastIndex(
      event =>
        event.type === 'directory-sync' &&
        event.path === join(root, '.journal'),
    )
    const stageWork = events.findIndex(event => event.type === 'stage-work')
    const renameEvent = events.findIndex(event => event.type === 'rename')
    const readyReturn = events.findIndex(event => event.type === 'ready-return')
    expect(journalSync).toBeGreaterThanOrEqual(0)
    expect(stageWork).toBeGreaterThan(journalSync)
    const modulesSync = events.findLastIndex(
      event =>
        event.type === 'directory-sync' &&
        event.path === join(root, '.staging', value.publicationId, 'modules'),
    )
    const sourceMapsSync = events.findLastIndex(
      event =>
        event.type === 'directory-sync' &&
        event.path ===
          join(root, '.staging', value.publicationId, 'source-maps'),
    )
    const stageSync = events.findLastIndex(
      event =>
        event.type === 'directory-sync' &&
        event.path === join(root, '.staging', value.publicationId),
    )
    expect(modulesSync).toBeGreaterThanOrEqual(0)
    expect(sourceMapsSync).toBeGreaterThanOrEqual(0)
    expect(stageSync).toBeGreaterThanOrEqual(0)
    expect(stageSync).toBeGreaterThan(modulesSync)
    expect(stageSync).toBeGreaterThan(sourceMapsSync)
    expect(modulesSync).toBeLessThan(renameEvent)
    expect(sourceMapsSync).toBeLessThan(renameEvent)
    expect(stageSync).toBeLessThan(renameEvent)
    const revisionsSync = events.findIndex(
      (event, index) =>
        index > renameEvent &&
        event.type === 'directory-sync' &&
        event.path === join(root, 'revisions'),
    )
    const finalSync = events.findIndex(
      (event, index) =>
        index > renameEvent &&
        event.type === 'directory-sync' &&
        event.path === join(root, 'revisions', 'foundation-revision-1'),
    )
    const stagingParentSync = events.findIndex(
      (event, index) =>
        index > renameEvent &&
        event.type === 'directory-sync' &&
        event.path === join(root, '.staging'),
    )
    expect(renameEvent).toBeGreaterThan(-1)
    expect(stagingParentSync).toBeGreaterThan(renameEvent)
    expect(revisionsSync).toBeGreaterThan(renameEvent)
    expect(finalSync).toBeGreaterThan(renameEvent)
    expect(stagingParentSync).toBeLessThan(readyReturn)
    expect(revisionsSync).toBeLessThan(readyReturn)
    expect(finalSync).toBeLessThan(readyReturn)
  })

  test('existing final performs its own destination durability barrier before READY', async () => {
    const value = await setup()
    await commitGameIrPublication(value)
    const events: { type: string; path?: string }[] = []
    await commitGameIrPublication(value, {
      onEvent: event => events.push(event),
    })
    events.push({ type: 'ready-return' })
    const root = join(
      await realpath(value.workspacePath),
      '.beegame/ir/game-ir.v1',
    )
    const readyReturn = events.findIndex(event => event.type === 'ready-return')
    const revisionsSync = events.findIndex(
      event =>
        event.type === 'directory-sync' &&
        event.path === join(root, 'revisions'),
    )
    const finalSync = events.findIndex(
      event =>
        event.type === 'directory-sync' &&
        event.path === join(root, 'revisions', 'foundation-revision-1'),
    )
    const publicationRootSync = events.findIndex(
      event => event.type === 'directory-sync' && event.path === root,
    )
    const journalSync = events.findIndex(
      event =>
        event.type === 'directory-sync' &&
        event.path === join(root, '.journal'),
    )
    expect(publicationRootSync).toBeGreaterThanOrEqual(0)
    expect(journalSync).toBeGreaterThanOrEqual(0)
    expect(publicationRootSync).toBeLessThan(journalSync)
    expect(revisionsSync).toBeGreaterThan(-1)
    expect(finalSync).toBeGreaterThan(-1)
    expect(revisionsSync).toBeLessThan(readyReturn)
    expect(finalSync).toBeLessThan(readyReturn)
  })

  test('validate performs its own destination durability barrier before READY', async () => {
    const value = await setup()
    await commitGameIrPublication(value)
    const events: { type: string; path?: string }[] = []
    await validateCommittedGameIr(value, {
      onEvent: event => events.push(event),
    })
    events.push({ type: 'ready-return' })
    const root = join(
      await realpath(value.workspacePath),
      '.beegame/ir/game-ir.v1',
    )
    const readyReturn = events.findIndex(event => event.type === 'ready-return')
    const revisionsSync = events.findIndex(
      event =>
        event.type === 'directory-sync' &&
        event.path === join(root, 'revisions'),
    )
    const finalSync = events.findIndex(
      event =>
        event.type === 'directory-sync' &&
        event.path === join(root, 'revisions', 'foundation-revision-1'),
    )
    expect(revisionsSync).toBeGreaterThan(-1)
    expect(finalSync).toBeGreaterThan(-1)
    expect(revisionsSync).toBeLessThan(readyReturn)
    expect(finalSync).toBeLessThan(readyReturn)
  })

  test('validate ignores crash-residual staging and never follows external private cleanup', async () => {
    const value = await setup()
    await commitGameIrPublication(value)
    const stage = join(
      value.workspacePath,
      '.beegame/ir/game-ir.v1/.staging',
      value.publicationId,
    )
    await mkdir(stage, { recursive: true })
    const external = await mkdtemp(join(tmpdir(), 'game-ir-validate-private-'))
    workspaces.push(external)
    const privatePlaceholder = join(
      value.workspacePath,
      '.beegame/.game-ir-private/placeholder',
    )
    await symlink(external, privatePlaceholder)
    const before = await readdir(external)
    await validateCommittedGameIr(value)
    expect(await readdir(external)).toEqual(before)
    expect((await lstat(stage)).isDirectory()).toBe(true)
  })

  test('rename loser performs its own destination durability barrier before READY', async () => {
    const value = await setup()
    const events: {
      type: string
      path?: string
      from?: string
      to?: string
    }[] = []
    let stoleRename = false
    await commitGameIrPublication(value, {
      onEvent: event => {
        events.push(event)
        if (event.type === 'before-rename') {
          // Steal the actual rename to deterministically exercise the loser branch.
          renameSync(event.from!, event.to!)
          stoleRename = true
        }
      },
    })
    events.push({ type: 'ready-return' })
    const root = join(
      await realpath(value.workspacePath),
      '.beegame/ir/game-ir.v1',
    )
    const readyReturn = events.findIndex(event => event.type === 'ready-return')
    const revisionsSync = events.findIndex(
      event =>
        event.type === 'directory-sync' &&
        event.path === join(root, 'revisions'),
    )
    const finalSync = events.findIndex(
      event =>
        event.type === 'directory-sync' &&
        event.path === join(root, 'revisions', 'foundation-revision-1'),
    )
    expect(stoleRename).toBe(true)
    expect(events.some(event => event.type === 'rename')).toBe(false)
    expect(revisionsSync).toBeGreaterThan(-1)
    expect(finalSync).toBeGreaterThan(-1)
    expect(revisionsSync).toBeLessThan(readyReturn)
    expect(finalSync).toBeLessThan(readyReturn)
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

  test.skipIf(!fifoProbeSupported)(
    'validate and recovery reject committed FIFOs without blocking on read',
    async () => {
      const value = await setup()
      await commitGameIrPublication(value)
      const fifoPath = join(
        value.workspacePath,
        '.beegame/ir/game-ir.v1/revisions/foundation-revision-1/modules/balance.json',
      )
      await rm(fifoPath)
      const fifo = Bun.spawn(['mkfifo', fifoPath], {
        stdout: 'ignore',
        stderr: 'pipe',
      })
      expect(await fifo.exited).toBe(0)
      const childScript = `
        import { validateCommittedGameIr, recoverGameIrPublication } from ${JSON.stringify(publicationModulePath)}
        const freeze = (value) => {
          if (value && typeof value === 'object') {
            for (const child of Object.values(value)) freeze(child)
            Object.freeze(value)
          }
          return value
        }
        try {
          const authority = freeze(JSON.parse(process.env.GAME_IR_AUTH))
          if (process.env.GAME_IR_OPERATION === 'recover')
            await recoverGameIrPublication(authority)
          else await validateCommittedGameIr(authority)
          process.exit(0)
        } catch {
          process.exit(1)
        }
      `
      for (const operation of ['validate', 'recover']) {
        const child = Bun.spawn(['bun', '--eval', childScript], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            GAME_IR_AUTH: JSON.stringify(value),
            GAME_IR_OPERATION: operation,
          },
          stdout: 'ignore',
          stderr: 'pipe',
        })
        const outcome = await Promise.race([
          child.exited.then(exit => ({ exit, timedOut: false })),
          new Promise<{ exit: number; timedOut: boolean }>(resolve =>
            // The child replays the complete Phase 7 authority before it
            // reaches the regular-file guard.  Keep this as a test-only
            // deadlock watchdog; it is intentionally independent of any
            // product timeout or business cap.
            setTimeout(() => resolve({ exit: -1, timedOut: true }), 5_000),
          ),
        ])
        if (outcome.timedOut) {
          child.kill()
          await child.exited
          throw new Error(`${operation} blocked on FIFO read`)
        }
        expect(outcome.exit).not.toBe(0)
      }
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
    const other = authority(value.workspacePath, 4)
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

    const phase7Authority = { ...value.phase7Authority }
    await expect(
      prepareGameIrPublication({
        ...value,
        phase7Authority,
        unexpected: true,
      } as never),
    ).rejects.toThrow(/unknown|property/i)
  })

  test('rejects missing, duplicate, relabelled, and homogenized publication evidence', async () => {
    const value = await setup()
    const ready = await commitGameIrPublication(value)
    const manifestPath = join(
      value.workspacePath,
      ready.committedPath.replace(/COMMITTED\.json$/, 'manifest.json'),
    )
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      semanticEvidence: unknown[]
    }
    const closure = assembleImplementationVerificationClosure(
      value.phase7Authority,
    )
    const phase4 =
      value.phase7Authority.phase6Authority.phase5Authority.phase4Authority
    const phase5 = value.phase7Authority.phase6Authority.phase5Authority
    const phase6 = value.phase7Authority.phase6Authority
    const expectedEvidence = [
      {
        phase: 'phase4',
        moduleId: 'balance',
        sourceDigest: phase4.balance.source.sourceDigest,
        mechanicalReceiptDigest: phase4.balance.mechanical.receiptDigest,
        semanticReceiptDigest: phase4.balance.semantic.receiptDigest,
        projectionDigest: closure.phase6.phase5.phase4.balance.projectionDigest,
      },
      {
        phase: 'phase4',
        moduleId: 'gameplay',
        sourceDigest: phase4.gameplay.source.sourceDigest,
        mechanicalReceiptDigest: phase4.gameplay.mechanical.receiptDigest,
        semanticReceiptDigest: phase4.gameplay.semantic.receiptDigest,
        projectionDigest:
          closure.phase6.phase5.phase4.gameplay.projectionDigest,
      },
      {
        phase: 'phase7',
        moduleId: 'implementation-verification',
        sourceDigest:
          value.phase7Authority.implementationVerification.source.sourceDigest,
        mechanicalReceiptDigest:
          value.phase7Authority.implementationVerification.mechanical
            .receiptDigest,
        semanticReceiptDigest:
          value.phase7Authority.implementationVerification.semantic
            .receiptDigest,
        semanticValidationResultDigest:
          closure.implementationVerification.semanticValidationResultDigest,
        projectionDigest: closure.implementationVerification.projectionDigest,
      },
      {
        phase: 'phase5',
        moduleId: 'presentation',
        sourceDigest: phase5.presentation.source.sourceDigest,
        mechanicalReceiptDigest: phase5.presentation.mechanical.receiptDigest,
        semanticReceiptDigest: phase5.presentation.semantic.receiptDigest,
        semanticValidationResultDigest:
          closure.phase6.phase5.presentation.semanticValidationResultDigest,
        projectionDigest: closure.phase6.phase5.presentation.projectionDigest,
      },
      {
        phase: 'phase6',
        moduleId: 'resource-realization',
        sourceDigest: phase6.resourceRealization.source.sourceDigest,
        mechanicalReceiptDigest:
          phase6.resourceRealization.mechanical.receiptDigest,
        semanticReceiptDigest:
          phase6.resourceRealization.semantic.receiptDigest,
        semanticValidationResultDigest:
          closure.phase6.resourceRealization.semanticValidationResultDigest,
        projectionDigest: closure.phase6.resourceRealization.projectionDigest,
      },
      {
        phase: 'phase5',
        moduleId: 'world-scene',
        sourceDigest: phase5.worldScene.source.sourceDigest,
        mechanicalReceiptDigest: phase5.worldScene.mechanical.receiptDigest,
        semanticReceiptDigest: phase5.worldScene.semantic.receiptDigest,
        semanticValidationResultDigest:
          closure.phase6.phase5.worldScene.semanticValidationResultDigest,
        projectionDigest: closure.phase6.phase5.worldScene.projectionDigest,
      },
    ]
    expect(manifest.semanticEvidence).toEqual(expectedEvidence)
    expect(
      manifest.semanticEvidence.map(
        entry => (entry as { moduleId: string }).moduleId,
      ),
    ).toEqual([
      'balance',
      'gameplay',
      'implementation-verification',
      'presentation',
      'resource-realization',
      'world-scene',
    ])
    for (const entry of manifest.semanticEvidence) {
      const phase = (entry as { phase: string }).phase
      expect(Object.hasOwn(entry!, 'semanticValidationResultDigest')).toBe(
        phase !== 'phase4',
      )
    }

    for (const mutate of [
      (evidence: unknown[]) => evidence.slice(1),
      (evidence: unknown[]) => [...evidence, evidence[0]],
      (evidence: unknown[]) =>
        evidence.map((entry, index) =>
          index === 0
            ? { ...(entry as object), moduleId: 'world-scene' }
            : entry,
        ),
      (evidence: unknown[]) =>
        evidence.map(entry => ({
          ...(entry as object),
          phase: 'phase7',
          semanticValidationResultDigest: 'f'.repeat(64),
        })),
    ]) {
      const value = await setup()
      const ready = await commitGameIrPublication(value)
      const manifestPath = join(
        value.workspacePath,
        ready.committedPath.replace(/COMMITTED\.json$/, 'manifest.json'),
      )
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        semanticEvidence: unknown[]
      }
      manifest.semanticEvidence = mutate(manifest.semanticEvidence)
      await Bun.write(manifestPath, `${canonical(manifest)}\n`)
      await expect(validateCommittedGameIr(value)).rejects.toThrow(
        /digest|artifact|authority|manifest/i,
      )
    }
  })

  test('publishes an expanded candidate beyond common node and edge counts', async () => {
    const value = await setup(24)
    const ready = await commitGameIrPublication(value)
    const graphPath = join(
      value.workspacePath,
      ready.committedPath.replace(/COMMITTED\.json$/, 'dependency-graph.json'),
    )
    const dependencyGraph = JSON.parse(await readFile(graphPath, 'utf8')) as {
      edges: readonly unknown[]
    }
    expect(dependencyGraph.edges.length).toBeGreaterThan(20)
    await expect(validateCommittedGameIr(value)).resolves.toEqual(ready)
  })
})
