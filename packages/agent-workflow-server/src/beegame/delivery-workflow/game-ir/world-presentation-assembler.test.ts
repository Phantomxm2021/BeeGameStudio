import { createHash } from 'node:crypto'
import { expect, test } from 'bun:test'
import { admitGameIrMechanicalProjectionReceipt } from './domain-projection'
import { buildGameIrDomainSourceEnvelope } from './domain-source'
import {
  admitGameplaySemanticResult,
  buildGameplaySemanticPacket,
} from './gameplay-producer'
import {
  admitBalanceSemanticResult,
  buildBalanceSemanticPacket,
} from './balance-producer'
import {
  admitWorldSceneSemanticResult,
  buildWorldSceneSemanticPacket,
  type WorldSceneSemanticReceipt,
} from './world-scene-producer'
import {
  admitPresentationSemanticResult,
  buildPresentationSemanticPacket,
  type PresentationSemanticReceipt,
} from './presentation-producer'
import {
  admitPhase5SemanticValidationResult,
  buildPhase5SemanticValidationPacket,
  replayAndBindPhase5SemanticReceipt,
} from './phase5-admission'
import { assembleGameplayBalanceModules } from './gameplay-balance-assembler'
import {
  assembleWorldPresentationClosure,
  type WorldSceneModuleProjection,
} from './world-presentation-assembler'
import { parseWorldSceneModule } from './world-scene-schema'
import { parsePresentationModule } from './presentation-schema'
import {
  canonicalGameIrJson,
  canonicalizeGameIrSourceSections,
  digestGameIrValue,
} from './model'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
} from './contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'
import { digestSectionIndex } from '../foundation-section-index'

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')
const digest = 'a'.repeat(64)

type FixtureNode = {
  id: string
  kind: string
  value: Record<string, unknown>
  references: readonly { targetId: string; targetType: string }[]
  edges: readonly { type: string; targetId: string; targetType: string }[]
}

const gameplayNodes: FixtureNode[] = [
  {
    id: 'state-start',
    kind: 'gameplay.state',
    value: { label: 'Start', initial: true, terminal: 'none' },
    references: [],
    edges: [],
  },
]
const balanceNodes: FixtureNode[] = [
  {
    id: 'balance-unit',
    kind: 'balance.unit',
    value: {
      symbol: 'unit',
      dimensions: [],
      scale: { numerator: 1, denominator: 1 },
    },
    references: [],
    edges: [],
  },
]
const worldNodes: FixtureNode[] = [
  {
    id: 'world-scene-main',
    kind: 'world-scene.scene',
    value: {
      label: 'Main',
      coordinateConvention: {
        dimensions: '2d',
        xDirection: 'right',
        yDirection: 'up',
        distanceUnit: 'meter',
      },
    },
    references: [],
    edges: [
      {
        type: 'root',
        targetId: 'world-node-root',
        targetType: 'world-scene.node',
      },
    ],
  },
  {
    id: 'world-node-root',
    kind: 'world-scene.node',
    value: {
      label: 'Root',
      nodeType: 'container',
      transform: {
        dimensions: '2d',
        space: 'world',
        position: { x: 0, y: 0 },
        rotationRadians: 0,
        scale: { x: 1, y: 1 },
      },
    },
    references: [],
    edges: [
      {
        type: 'scene',
        targetId: 'world-scene-main',
        targetType: 'world-scene.scene',
      },
    ],
  },
]
const presentationNodes: FixtureNode[] = [
  {
    id: 'presentation-screen-main',
    kind: 'presentation.ui-screen',
    value: { label: 'Main', modal: false },
    references: [],
    edges: [
      {
        type: 'driven-by',
        targetId: 'state-start',
        targetType: 'gameplay.state',
      },
      {
        type: 'initial-state',
        targetId: 'presentation-state-main',
        targetType: 'presentation.ui-state',
      },
    ],
  },
  {
    id: 'presentation-state-main',
    kind: 'presentation.ui-state',
    value: { label: 'Main', terminal: false },
    references: [],
    edges: [
      {
        type: 'driven-by',
        targetId: 'state-start',
        targetType: 'gameplay.state',
      },
      {
        type: 'screen',
        targetId: 'presentation-screen-main',
        targetType: 'presentation.ui-screen',
      },
    ],
  },
]

function leafPointers(value: Record<string, unknown>): string[] {
  const output: string[] = []
  const escape = (key: string) =>
    key.replaceAll('~', '~0').replaceAll('/', '~1')
  const visit = (entry: unknown, pointer: string): void => {
    if (Array.isArray(entry)) {
      if (entry.length === 0) output.push(pointer)
      else entry.forEach((child, index) => visit(child, `${pointer}/${index}`))
    } else if (entry && typeof entry === 'object') {
      const entries = Object.entries(entry as Record<string, unknown>)
      if (entries.length === 0) output.push(pointer)
      else
        entries.forEach(([key, child]) =>
          visit(child, `${pointer}/${escape(key)}`),
        )
    } else output.push(pointer)
  }
  Object.entries(value).forEach(([key, entry]) =>
    visit(entry, `/value/${escape(key)}`),
  )
  return output
}

function pointerValue(node: FixtureNode, pointer: string): unknown {
  if (pointer === '/id') return node.id
  if (pointer.startsWith('/references/'))
    return node.references[Number(pointer.slice('/references/'.length))]
  if (pointer.startsWith('/edges/'))
    return node.edges[Number(pointer.slice('/edges/'.length))]
  let current: unknown = node.value
  for (const segment of pointer
    .slice('/value/'.length)
    .split('/')
    .map(entry => entry.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (current && typeof current === 'object')
      current = (current as Record<string, unknown>)[segment]
    else return undefined
  }
  return current
}

const literal = (value: unknown): string =>
  typeof value === 'string' ? value : canonicalGameIrJson(value)
const pointers = (node: FixtureNode): string[] => [
  '/id',
  ...leafPointers(node.value),
  ...node.references.map((_, index) => `/references/${index}`),
  ...node.edges.map((_, index) => `/edges/${index}`),
]
const allNodes = [
  ...gameplayNodes,
  ...balanceNodes,
  ...worldNodes,
  ...presentationNodes,
]
const sourceRanges = new Map<string, string>()
let sourceBytes = ''
for (const node of [...allNodes].sort((left, right) =>
  left.id.localeCompare(right.id),
)) {
  for (const pointer of pointers(node).sort()) {
    const subject = `node:${node.id}#${pointer}`
    const start = Buffer.byteLength(sourceBytes, 'utf8')
    sourceBytes += `${literal(pointerValue(node, pointer))}\n`
    const end = Buffer.byteLength(sourceBytes, 'utf8') - 1
    sourceRanges.set(subject, `/bytes/${start}/${end}`)
  }
}
for (const value of [
  { type: 'root', targetId: 'balance-unit', targetType: 'world-scene.node' },
  { type: 'scene', targetId: 'balance-unit', targetType: 'world-scene.scene' },
  { type: 'driven-by', targetId: 'balance-unit', targetType: 'gameplay.state' },
  {
    type: 'initial-state',
    targetId: 'balance-unit',
    targetType: 'presentation.ui-state',
  },
  {
    type: 'screen',
    targetId: 'balance-unit',
    targetType: 'presentation.ui-screen',
  },
])
  sourceBytes += `${canonicalGameIrJson(value)}\n`

const fullIndex = canonicalizeGameIrSourceSections(
  CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => ({
    documentPath,
    sectionId: `section-${index}`,
    heading: documentPath,
    startLine: 1,
    endLine: sourceBytes.split('\n').length,
    digest: sha256(sourceBytes),
  })),
)
const foundationBody: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
  schemaVersion: 'foundation-ready-receipt.v1',
  projectId: 'task8-fixture',
  foundationRevision: 'foundation-revision-1',
  confirmedBriefDigest: digest,
  documentDigests: Object.fromEntries(
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, sha256(sourceBytes)]),
  ) as FoundationReadyReceipt['documentDigests'],
  sectionIndexPath: '.beegame/foundation/section-index.json',
  sectionIndexDigest: digestSectionIndex(fullIndex),
  authority: {
    kind: 'review',
    reviewDigest: digest,
    issueRegistryDigest: digest,
  },
}
const request = {
  schemaVersion: 'game-ir-compile-request.v1' as const,
  taskId: 'task8-fixture',
  publicationId: 'task8-publication',
  gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
  foundation: {
    ...foundationBody,
    receiptDigest: digestGameIrValue(foundationBody),
  },
}

function source(
  moduleId: 'gameplay' | 'balance' | 'world-scene' | 'presentation',
) {
  const documents = {
    gameplay: ['docs/GDD.md'],
    balance: ['docs/GDD.md', 'docs/BALANCE_DESIGN.md'],
    'world-scene': ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
    presentation: [
      'docs/GDD.md',
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
      'docs/AUDIO_DESIGN.md',
    ],
  }[moduleId]
  return buildGameIrDomainSourceEnvelope({
    moduleId,
    request,
    sectionIndex: fullIndex,
    sectionBytes: Object.fromEntries(
      documents.map(documentPath => {
        const section = fullIndex.find(
          item => item.documentPath === documentPath,
        )!
        return [`${documentPath}#${section.sectionId}`, sourceBytes]
      }),
    ),
  })
}

function mechanical(currentSource: ReturnType<typeof source>) {
  const body = {
    schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
    taskId: currentSource.taskId,
    moduleId: currentSource.moduleId,
    foundationRevision:
      currentSource.compileRequest.foundation.foundationRevision,
    sourceDigest: currentSource.sourceDigest,
    nodes: [],
    verifiedClaims: [],
    ownedTargets: [],
  }
  return admitGameIrMechanicalProjectionReceipt({
    source: currentSource,
    receipt: { ...body, receiptDigest: digestGameIrValue(body) },
  })
}

function claims(
  nodes: readonly FixtureNode[],
  aliases: ReadonlyMap<string, string> = new Map(),
) {
  const sourcePointer = (node: FixtureNode, pointer: string): string => {
    const value = literal(pointerValue(node, pointer))
    const alias = aliases.get(node.id)
    const offset = sourceBytes.indexOf(`${value}\n`)
    if (offset >= 0)
      return `/bytes/${Buffer.byteLength(sourceBytes.slice(0, offset), 'utf8')}/${Buffer.byteLength(sourceBytes.slice(0, offset + value.length), 'utf8')}`
    const direct = sourceRanges.get(`node:${alias ?? node.id}#${pointer}`)
    if (direct) return direct
    return sourceRanges.get(`node:${alias ?? node.id}#${pointer}`)!
  }
  const output = nodes
    .flatMap(node =>
      pointers(node)
        .sort()
        .map(pointer => ({
          subject: `node:${node.id}#${pointer}`,
          documentPath: 'docs/GDD.md' as FoundationDocumentPath,
          sectionId: 'section-0',
          sourcePointer: sourcePointer(node, pointer),
          literal: literal(pointerValue(node, pointer)),
        })),
    )
    .sort((left, right) =>
      `${left.subject}\0${left.sourcePointer}\0${left.literal}`.localeCompare(
        `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
      ),
    )
  return output
}

function makePhase4Authority(balanceId = 'balance-unit') {
  const gameplaySource = source('gameplay')
  const balanceSource = source('balance')
  const gameplayMechanical = mechanical(gameplaySource)
  const balanceMechanical = mechanical(balanceSource)
  const balanceVariant = balanceNodes.map(node => ({ ...node, id: balanceId }))
  const gameplaySemantic = admitGameplaySemanticResult(
    buildGameplaySemanticPacket({
      source: gameplaySource,
      mechanical: gameplayMechanical,
    }),
    {
      outcome: 'PROJECTED',
      nodes: gameplayNodes,
      sourceClaims: claims(gameplayNodes),
    },
  )
  const balanceSemantic = admitBalanceSemanticResult(
    buildBalanceSemanticPacket({
      source: balanceSource,
      mechanical: balanceMechanical,
    }),
    {
      outcome: 'PROJECTED',
      nodes: balanceVariant,
      sourceClaims: claims(
        balanceVariant,
        new Map([[balanceId, 'balance-unit']]),
      ),
    },
  )
  return {
    gameplay: {
      source: gameplaySource,
      mechanical: gameplayMechanical,
      semantic: gameplaySemantic as never,
    },
    balance: {
      source: balanceSource,
      mechanical: balanceMechanical,
      semantic: balanceSemantic as never,
    },
  }
}

function buildAuthority(
  overrides: Readonly<{
    balanceId?: string
    worldId?: string
    presentationId?: string
  }> = {},
) {
  const phase4Authority = makePhase4Authority(overrides.balanceId)
  const phase4 = assembleGameplayBalanceModules(phase4Authority)
  const worldId = overrides.worldId ?? 'world-scene-main'
  const presentationId = overrides.presentationId ?? 'presentation-screen-main'
  const worldVariant = worldNodes.map(node => ({
    ...node,
    id: node.id === 'world-scene-main' ? worldId : node.id,
    edges: node.edges.map(edge =>
      edge.targetId === 'world-scene-main'
        ? { ...edge, targetId: worldId }
        : edge,
    ),
  }))
  const presentationVariant = presentationNodes.map(node => ({
    ...node,
    id: node.id === 'presentation-screen-main' ? presentationId : node.id,
    edges: node.edges.map(edge =>
      edge.targetId === 'presentation-screen-main'
        ? { ...edge, targetId: presentationId }
        : edge,
    ),
  }))
  const worldAliases = new Map([[worldId, 'world-scene-main']])
  const presentationAliases = new Map([
    [presentationId, 'presentation-screen-main'],
  ])
  const worldSource = source('world-scene')
  const worldMechanical = mechanical(worldSource)
  const worldPacket = buildWorldSceneSemanticPacket({
    source: worldSource,
    mechanical: worldMechanical,
  })
  const worldSemantic = admitWorldSceneSemanticResult(worldPacket, {
    outcome: 'PROJECTED',
    nodes: worldVariant,
    sourceClaims: claims(worldVariant, worldAliases),
  }) as WorldSceneSemanticReceipt
  const worldBound = replayAndBindPhase5SemanticReceipt({
    source: worldSource,
    mechanical: worldMechanical,
    packet: worldPacket,
    semantic: worldSemantic,
  })
  const worldModule = parseWorldSceneModule(worldBound.module)
  const worldValidationPacket = buildPhase5SemanticValidationPacket({
    source: worldSource,
    mechanical: worldMechanical,
    semantic: worldSemantic,
    module: worldModule,
    externalProjections: { gameplay: phase4.gameplay },
  })
  const worldValidation = admitPhase5SemanticValidationResult(
    worldValidationPacket,
    {
      outcome: 'PASS',
      packetDigest: worldValidationPacket.packetDigest,
      checkIds: worldValidationPacket.checkIds,
      coveredTargets: worldValidationPacket.requiredTargets,
    },
  )
  const worldProjectionBody = {
    schemaVersion: 'game-ir-world-scene-module.v1' as const,
    taskId: worldSource.taskId,
    foundationRevision:
      worldSource.compileRequest.foundation.foundationRevision,
    module: worldModule,
    sourceDigest: worldSource.sourceDigest,
    mechanicalReceiptDigest: worldBound.mechanicalReceiptDigest,
    semanticReceiptDigest: worldBound.semanticReceiptDigest,
    semanticValidationResultDigest: digestGameIrValue(worldValidation),
  }
  const worldProjection = Object.freeze({
    ...worldProjectionBody,
    projectionDigest: digestGameIrValue(worldProjectionBody),
  }) as WorldSceneModuleProjection

  const presentationSource = source('presentation')
  const presentationMechanical = mechanical(presentationSource)
  const presentationPacket = buildPresentationSemanticPacket({
    source: presentationSource,
    mechanical: presentationMechanical,
  })
  const presentationSemantic = admitPresentationSemanticResult(
    presentationPacket,
    {
      outcome: 'PROJECTED',
      nodes: presentationVariant,
      sourceClaims: claims(presentationVariant, presentationAliases),
    },
  ) as PresentationSemanticReceipt
  const presentationBound = replayAndBindPhase5SemanticReceipt({
    source: presentationSource,
    mechanical: presentationMechanical,
    packet: presentationPacket,
    semantic: presentationSemantic,
  })
  const presentationModule = parsePresentationModule(
    presentationBound.module,
    new Map(
      [...phase4.gameplay.module.nodes, ...worldProjection.module.nodes].map(
        node => [node.id, node],
      ),
    ),
  )
  const presentationValidationPacket = buildPhase5SemanticValidationPacket({
    source: presentationSource,
    mechanical: presentationMechanical,
    semantic: presentationSemantic,
    module: presentationModule,
    externalProjections: {
      gameplay: phase4.gameplay,
      worldScene: worldProjection,
    },
  })
  const presentationValidation = admitPhase5SemanticValidationResult(
    presentationValidationPacket,
    {
      outcome: 'PASS',
      packetDigest: presentationValidationPacket.packetDigest,
      checkIds: presentationValidationPacket.checkIds,
      coveredTargets: presentationValidationPacket.requiredTargets,
    },
  )
  return {
    phase4Authority,
    worldScene: {
      source: worldSource,
      mechanical: worldMechanical,
      semantic: worldSemantic,
      validation: worldValidation,
    },
    presentation: {
      source: presentationSource,
      mechanical: presentationMechanical,
      semantic: presentationSemantic,
      validation: presentationValidation,
    },
  }
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeepFrozen(child, seen)
}

test('assembles a complete authority deterministically and freezes derived projections', () => {
  const authority = buildAuthority()
  const first = assembleWorldPresentationClosure(authority)
  const second = assembleWorldPresentationClosure(authority)
  const { projectionDigest: _worldDigest, ...worldBody } = first.worldScene
  const { projectionDigest: _presentationDigest, ...presentationBody } =
    first.presentation
  expect(first).toEqual(second)
  expect(first.worldScene.projectionDigest).toBe(digestGameIrValue(worldBody))
  expect(first.presentation.projectionDigest).toBe(
    digestGameIrValue(presentationBody),
  )
  expect(Object.isFrozen(first)).toBe(true)
  expect(Object.isFrozen(first.phase4)).toBe(true)
  expect(Object.isFrozen(first.worldScene)).toBe(true)
  expect(Object.isFrozen(first.presentation)).toBe(true)
  expectDeepFrozen(first)
  expect(Reflect.ownKeys(first).sort()).toEqual([
    'authoritySectionIndexDigest',
    'closureDigest',
    'compileRequestDigest',
    'foundationReceiptDigest',
    'foundationRevision',
    'phase4',
    'presentation',
    'schemaVersion',
    'taskId',
    'worldScene',
  ])
  expect(Reflect.ownKeys(first.worldScene).sort()).toEqual([
    'foundationRevision',
    'mechanicalReceiptDigest',
    'module',
    'projectionDigest',
    'schemaVersion',
    'semanticReceiptDigest',
    'semanticValidationResultDigest',
    'sourceDigest',
    'taskId',
  ])
  expect(Reflect.ownKeys(first.presentation).sort()).toEqual([
    'foundationRevision',
    'mechanicalReceiptDigest',
    'module',
    'projectionDigest',
    'schemaVersion',
    'semanticReceiptDigest',
    'semanticValidationResultDigest',
    'sourceDigest',
    'taskId',
  ])
})

test('rejects detached Phase 4 projection input before any Phase 5 work', () => {
  const authority = buildAuthority()
  const projection = assembleGameplayBalanceModules(
    authority.phase4Authority,
  ).gameplay
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        ...authority.phase4Authority,
        gameplay: { projection },
      },
    } as never),
  ).toThrow()
})

test('rejects World and Presentation IDs that collide with the replayed Balance namespace', () => {
  expect(() =>
    assembleWorldPresentationClosure(
      buildAuthority({ balanceId: 'world-scene-main' }),
    ),
  ).toThrow(/duplicate global node ID/)
  expect(() =>
    assembleWorldPresentationClosure(
      buildAuthority({ balanceId: 'presentation-screen-main' }),
    ),
  ).toThrow(/duplicate global node ID/)
})

test('rejects exact authority shape violations without accepting maps or digest-only branches', () => {
  const authority = buildAuthority()
  expect(() =>
    assembleWorldPresentationClosure({ ...authority, extra: true } as never),
  ).toThrow(/unknown or missing fields/)
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: new Map(),
    } as never),
  ).toThrow(/plain object/)
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        ...authority.phase4Authority,
        gameplay: { projection: authority.phase4Authority.gameplay.source },
      },
    } as never),
  ).toThrow(/unknown or missing fields/)
  const hidden = { ...authority.phase4Authority.gameplay }
  Object.defineProperty(hidden, 'semantic', {
    value: authority.phase4Authority.gameplay.semantic,
    enumerable: false,
  })
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: { ...authority.phase4Authority, gameplay: hidden },
    } as never),
  ).toThrow(/hidden or accessor/)
})

test('rejects stale Phase 4 raw authority and missing World authority before Presentation', () => {
  const authority = buildAuthority()
  const staleSource = {
    ...authority.phase4Authority.gameplay.source,
    sourceDigest: digest,
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        ...authority.phase4Authority,
        gameplay: {
          ...authority.phase4Authority.gameplay,
          source: staleSource,
        },
      },
    } as never),
  ).toThrow(/source envelope digest/)
  const { semantic: _semantic, ...missingSemantic } = authority.worldScene
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      worldScene: missingSemantic,
    } as never),
  ).toThrow(/unknown or missing fields/)
})

test('rejects stale or missing Phase 4 raw branches before World replay', () => {
  const authority = buildAuthority()
  const staleBalance = {
    ...authority.phase4Authority.balance.source,
    sourceDigest: digest,
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        ...authority.phase4Authority,
        balance: {
          ...authority.phase4Authority.balance,
          source: staleBalance,
        },
      },
    } as never),
  ).toThrow(/source envelope digest/)

  const missingBalance = { ...authority.phase4Authority.balance }
  delete (missingBalance as Record<string, unknown>).semantic
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        ...authority.phase4Authority,
        balance: missingBalance,
      },
    } as never),
  ).toThrow(/unknown or missing fields/)
})

test('rejects invalid World receipt, schema, or fidelity before Presentation admission', () => {
  const authority = buildAuthority()
  const invalidReceipt = {
    ...authority.worldScene.semantic,
    receiptDigest: digest,
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      worldScene: { ...authority.worldScene, semantic: invalidReceipt },
    } as never),
  ).toThrow(/semantic receipt digest/)

  const invalidSchema = {
    ...authority.worldScene.semantic,
    schemaVersion: 'wrong-schema',
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      worldScene: { ...authority.worldScene, semantic: invalidSchema },
    } as never),
  ).toThrow(/stale or relabeled/)

  const invalidFidelity = {
    ...authority.worldScene.validation,
    packetDigest: digest,
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      worldScene: { ...authority.worldScene, validation: invalidFidelity },
    } as never),
  ).toThrow(/fidelity PASS packet digest/)
})

test('rejects invalid Presentation receipt or fidelity only after World succeeds', () => {
  const authority = buildAuthority()
  const invalidReceipt = {
    ...authority.presentation.semantic,
    receiptDigest: digest,
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      presentation: { ...authority.presentation, semantic: invalidReceipt },
    } as never),
  ).toThrow(/semantic receipt digest/)

  const invalidFidelity = {
    ...authority.presentation.validation,
    packetDigest: digest,
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      presentation: {
        ...authority.presentation,
        validation: invalidFidelity,
      },
    } as never),
  ).toThrow(/fidelity PASS packet digest/)
})

test('keeps output digests mechanically tied to their exact bodies', () => {
  const closure = assembleWorldPresentationClosure(buildAuthority())
  const { projectionDigest: _worldDigest, ...worldBody } = closure.worldScene
  const alteredWorldBody = {
    ...worldBody,
    sourceDigest: digest,
  }
  expect(closure.worldScene.projectionDigest).not.toBe(
    digestGameIrValue(alteredWorldBody),
  )
  const { closureDigest: _closureDigest, ...closureBody } = closure
  expect(closure.closureDigest).toBe(digestGameIrValue(closureBody))
  expect(
    digestGameIrValue({ ...closureBody, taskId: 'tampered-task' }),
  ).not.toBe(closure.closureDigest)
})

test('retains independent upstream source identities while deriving one shared closure identity', () => {
  const authority = buildAuthority()
  expect(authority.phase4Authority.gameplay.source.sourceDigest).not.toBe(
    authority.worldScene.source.sourceDigest,
  )
  expect(authority.worldScene.source.sourceDigest).not.toBe(
    authority.presentation.source.sourceDigest,
  )
  const closure = assembleWorldPresentationClosure(authority)
  expect(closure.foundationReceiptDigest).toBe(
    authority.worldScene.source.compileRequest.foundation.receiptDigest,
  )
  expect(closure.compileRequestDigest).toBe(
    digestGameIrValue(authority.worldScene.source.compileRequest),
  )
  expect(closure.authoritySectionIndexDigest).toBe(
    digestGameIrValue(authority.worldScene.source.authoritySectionIndex),
  )
  const { closureDigest: _closureDigest, ...closureBody } = closure
  expect(closure.closureDigest).toBe(digestGameIrValue(closureBody))
})
