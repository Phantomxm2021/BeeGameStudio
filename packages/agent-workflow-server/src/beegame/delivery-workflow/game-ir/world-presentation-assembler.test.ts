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
  type Phase5SemanticValidationPacket,
} from './phase5-admission'
import { assembleGameplayBalanceModules } from './gameplay-balance-assembler'
import {
  assembleWorldPresentationClosure,
  preparePresentationSemanticValidationPacket,
  prepareWorldSceneSemanticValidationPacket,
} from './world-presentation-assembler'
import { WORLD_SCENE_DOMAIN_MANIFEST } from './world-scene-schema'
import { PRESENTATION_DOMAIN_MANIFEST } from './presentation-schema'
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

const richGameplayNodes: FixtureNode[] = [
  {
    id: 'action.jump',
    kind: 'gameplay.action',
    value: { label: 'Jump' },
    references: [
      { targetId: 'condition.can-jump', targetType: 'gameplay.condition' },
      { targetId: 'effect.jump', targetType: 'gameplay.effect' },
      { targetId: 'event.jumped', targetType: 'gameplay.event' },
    ],
    edges: [
      {
        type: 'causes',
        targetId: 'effect.jump',
        targetType: 'gameplay.effect',
      },
      {
        type: 'causes',
        targetId: 'event.jumped',
        targetType: 'gameplay.event',
      },
      {
        type: 'requires',
        targetId: 'condition.can-jump',
        targetType: 'gameplay.condition',
      },
    ],
  },
  {
    id: 'capability.player-jump',
    kind: 'gameplay.capability',
    value: { label: 'Can jump' },
    references: [],
    edges: [
      {
        type: 'belongs-to',
        targetId: 'entity.player',
        targetType: 'gameplay.entity',
      },
    ],
  },
  {
    id: 'condition.can-jump',
    kind: 'gameplay.condition',
    value: { expression: { kind: 'reference', referenceIndex: 0 } },
    references: [
      {
        targetId: 'capability.player-jump',
        targetType: 'gameplay.capability',
      },
    ],
    edges: [],
  },
  {
    id: 'effect.jump',
    kind: 'gameplay.effect',
    value: {
      effect: { operation: 'set', targetReferenceIndex: 0, value: true },
    },
    references: [{ targetId: 'entity.player', targetType: 'gameplay.entity' }],
    edges: [],
  },
  {
    id: 'entity.player',
    kind: 'gameplay.entity',
    value: { label: 'Player' },
    references: [],
    edges: [],
  },
  {
    id: 'event.jumped',
    kind: 'gameplay.event',
    value: { label: 'Jumped' },
    references: [],
    edges: [],
  },
  {
    id: 'objective.complete',
    kind: 'gameplay.objective',
    value: { label: 'Complete the game' },
    references: [],
    edges: [
      {
        type: 'fails-with',
        targetId: 'outcome.loss',
        targetType: 'gameplay.outcome',
      },
      {
        type: 'succeeds-with',
        targetId: 'outcome.win',
        targetType: 'gameplay.outcome',
      },
    ],
  },
  {
    id: 'outcome.loss',
    kind: 'gameplay.outcome',
    value: { label: 'Loss', result: 'loss' },
    references: [],
    edges: [],
  },
  {
    id: 'outcome.neutral',
    kind: 'gameplay.outcome',
    value: { label: 'Neutral', result: 'neutral' },
    references: [],
    edges: [],
  },
  {
    id: 'outcome.win',
    kind: 'gameplay.outcome',
    value: { label: 'Win', result: 'win' },
    references: [],
    edges: [],
  },
  {
    id: 'rule.jump',
    kind: 'gameplay.rule',
    value: { label: 'Jump rule' },
    references: [],
    edges: [
      {
        type: 'guards',
        targetId: 'condition.can-jump',
        targetType: 'gameplay.condition',
      },
      {
        type: 'triggered-by',
        targetId: 'event.jumped',
        targetType: 'gameplay.event',
      },
    ],
  },
  {
    id: 'state.lose',
    kind: 'gameplay.state',
    value: { label: 'Lost', initial: false, terminal: 'failure' },
    references: [],
    edges: [],
  },
  {
    id: 'state.win',
    kind: 'gameplay.state',
    value: { label: 'Won', initial: false, terminal: 'success' },
    references: [],
    edges: [],
  },
  {
    id: 'transition.finish',
    kind: 'gameplay.transition',
    value: { label: 'Finish' },
    references: [],
    edges: [
      { type: 'from', targetId: 'state-start', targetType: 'gameplay.state' },
      { type: 'on', targetId: 'event.jumped', targetType: 'gameplay.event' },
      { type: 'to', targetId: 'state.win', targetType: 'gameplay.state' },
    ],
  },
  {
    id: 'transition.lose',
    kind: 'gameplay.transition',
    value: { label: 'Lose' },
    references: [],
    edges: [
      { type: 'from', targetId: 'state-start', targetType: 'gameplay.state' },
      { type: 'to', targetId: 'state.lose', targetType: 'gameplay.state' },
    ],
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

const richWorldNodes: FixtureNode[] = [
  {
    id: 'world-node-anchor',
    kind: 'world-scene.node',
    value: {
      label: 'Anchor',
      nodeType: 'anchor',
      transform: {
        dimensions: '2d',
        space: 'local',
        position: { x: 2, y: 1 },
        rotationRadians: 0,
        scale: { x: 1, y: 1 },
      },
    },
    references: [],
    edges: [
      {
        type: 'parent',
        targetId: 'world-node-root',
        targetType: 'world-scene.node',
      },
      {
        type: 'scene',
        targetId: 'world-scene-main',
        targetType: 'world-scene.scene',
      },
    ],
  },
  {
    id: 'world-zone-main',
    kind: 'world-scene.zone',
    value: {
      label: 'Zone',
      shape: { kind: 'circle', radius: 2 },
      transform: {
        dimensions: '2d',
        space: 'local',
        position: { x: 2, y: 1 },
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
  {
    id: 'world-route-main',
    kind: 'world-scene.route',
    value: { label: 'Route', closed: false, waypointReferenceIndexes: [0, 1] },
    references: [
      { targetId: 'world-node-anchor', targetType: 'world-scene.node' },
      { targetId: 'world-node-root', targetType: 'world-scene.node' },
    ],
    edges: [
      {
        type: 'scene',
        targetId: 'world-scene-main',
        targetType: 'world-scene.scene',
      },
    ],
  },
  {
    id: 'world-entity-player',
    kind: 'world-scene.entity-instance',
    value: { label: 'Player instance' },
    references: [],
    edges: [
      {
        type: 'entity',
        targetId: 'entity.player',
        targetType: 'gameplay.entity',
      },
      {
        type: 'location',
        targetId: 'world-node-anchor',
        targetType: 'world-scene.node',
      },
      {
        type: 'scene',
        targetId: 'world-scene-main',
        targetType: 'world-scene.scene',
      },
    ],
  },
  {
    id: 'world-spawn-main',
    kind: 'world-scene.spawn',
    value: { label: 'Spawn', quantity: 1, policy: 'once' },
    references: [],
    edges: [
      {
        type: 'entity',
        targetId: 'entity.player',
        targetType: 'gameplay.entity',
      },
      {
        type: 'location',
        targetId: 'world-node-anchor',
        targetType: 'world-scene.node',
      },
      {
        type: 'scene',
        targetId: 'world-scene-main',
        targetType: 'world-scene.scene',
      },
    ],
  },
  {
    id: 'world-encounter-main',
    kind: 'world-scene.encounter',
    value: { label: 'Encounter', mode: 'patrol' },
    references: [],
    edges: [
      {
        type: 'scene',
        targetId: 'world-scene-main',
        targetType: 'world-scene.scene',
      },
      {
        type: 'spawn',
        targetId: 'world-spawn-main',
        targetType: 'world-scene.spawn',
      },
      {
        type: 'zone',
        targetId: 'world-zone-main',
        targetType: 'world-scene.zone',
      },
    ],
  },
  {
    id: 'world-checkpoint-main',
    kind: 'world-scene.checkpoint',
    value: { label: 'Checkpoint', ordinal: 1, resetPolicy: 'restart' },
    references: [],
    edges: [
      {
        type: 'location',
        targetId: 'world-node-anchor',
        targetType: 'world-scene.node',
      },
      {
        type: 'respawn-state',
        targetId: 'state-start',
        targetType: 'gameplay.state',
      },
      {
        type: 'scene',
        targetId: 'world-scene-main',
        targetType: 'world-scene.scene',
      },
    ],
  },
  {
    id: 'world-camera-main',
    kind: 'world-scene.camera-region',
    value: { label: 'Camera', priority: 1, blendIn: 0.2, blendOut: 0.2 },
    references: [],
    edges: [
      {
        type: 'anchor',
        targetId: 'world-node-anchor',
        targetType: 'world-scene.node',
      },
      {
        type: 'scene',
        targetId: 'world-scene-main',
        targetType: 'world-scene.scene',
      },
      {
        type: 'zone',
        targetId: 'world-zone-main',
        targetType: 'world-scene.zone',
      },
    ],
  },
  {
    id: 'world-objective-main',
    kind: 'world-scene.objective-placement',
    value: { label: 'Objective placement' },
    references: [],
    edges: [
      {
        type: 'location',
        targetId: 'world-node-anchor',
        targetType: 'world-scene.node',
      },
      {
        type: 'objective',
        targetId: 'objective.complete',
        targetType: 'gameplay.objective',
      },
      {
        type: 'scene',
        targetId: 'world-scene-main',
        targetType: 'world-scene.scene',
      },
      {
        type: 'zone',
        targetId: 'world-zone-main',
        targetType: 'world-scene.zone',
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
  ...richGameplayNodes,
  ...balanceNodes,
  ...worldNodes,
  ...richWorldNodes,
  ...presentationNodes,
]

function fixtureExternalKinds(
  manifest: Readonly<
    Record<
      string,
      Readonly<{
        relationships: Readonly<
          Record<string, Readonly<{ targetKinds: readonly string[] }>>
        >
        references?: Readonly<{ targetKinds: readonly string[] }>
      }>
    >
  >,
): ReadonlySet<string> {
  const localKinds = new Set(Object.keys(manifest))
  const targetKinds = new Set<string>()
  for (const descriptor of Object.values(manifest)) {
    for (const relationship of Object.values(descriptor.relationships))
      relationship.targetKinds.forEach(kind => targetKinds.add(kind))
    descriptor.references?.targetKinds.forEach(kind => targetKinds.add(kind))
  }
  return new Set([...targetKinds].filter(kind => !localKinds.has(kind)))
}

function fixtureExternalTargets(
  nodes: readonly FixtureNode[],
  manifest: Parameters<typeof fixtureExternalKinds>[0],
  localNodes: readonly FixtureNode[] = [],
): ReadonlyMap<string, FixtureNode> {
  const allowedKinds = fixtureExternalKinds(manifest)
  const localIds = new Set(localNodes.map(node => node.id))
  const targets = new Map<string, FixtureNode>()
  for (const node of nodes) {
    if (
      allowedKinds.has(node.kind) &&
      !localIds.has(node.id) &&
      !targets.has(node.id)
    )
      targets.set(node.id, node)
  }
  return targets
}
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
  { type: 'scene', targetId: 'state-start', targetType: 'world-scene.scene' },
  {
    type: 'scene',
    targetId: 'presentation-screen-main',
    targetType: 'world-scene.scene',
  },
  {
    type: 'screen',
    targetId: 'state-start',
    targetType: 'presentation.ui-screen',
  },
  {
    type: 'screen',
    targetId: 'world-scene-main',
    targetType: 'presentation.ui-screen',
  },
  {
    type: 'driven-by',
    targetId: 'state-start',
    targetType: 'world-scene.scene',
  },
  {
    type: 'scene',
    targetId: 'world-scene-alt',
    targetType: 'world-scene.scene',
  },
])
  sourceBytes += `${canonicalGameIrJson(value)}\n`
sourceBytes += 'Changed\nworld-scene-alt\n'

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

type FixtureProfile = {
  request: typeof request
  sectionIndex: typeof fullIndex
}

const defaultProfile: FixtureProfile = { request, sectionIndex: fullIndex }

type ProfileChanges = Readonly<{
  task?: boolean
  foundationRevision?: boolean
  ready?: boolean
  compileRequest?: boolean
  authorityIndex?: boolean
}>

function makeProfile(
  label: string,
  changes: ProfileChanges = {},
): FixtureProfile {
  const changeAll = Object.keys(changes).length === 0
  const changeIndex = changeAll || changes.authorityIndex === true
  const sectionIndex = fullIndex.map((section, index) =>
    index === 0 && changeIndex
      ? { ...section, heading: `${section.heading}-${label}` }
      : section,
  )
  const marker = sha256(`fixture-${label}`)
  const body = {
    ...foundationBody,
    foundationRevision:
      changeAll || changes.foundationRevision
        ? `foundation-revision-${label}`
        : foundationBody.foundationRevision,
    confirmedBriefDigest:
      changeAll || changes.ready ? marker : foundationBody.confirmedBriefDigest,
    sectionIndexDigest: digestSectionIndex(sectionIndex),
    authority: {
      ...foundationBody.authority,
      reviewDigest: changeAll || changes.ready ? marker : digest,
      issueRegistryDigest:
        changeAll || changes.ready
          ? marker
          : foundationBody.authority.issueRegistryDigest,
    },
  }
  return {
    sectionIndex,
    request: {
      ...request,
      taskId: changeAll || changes.task ? `task8-${label}` : request.taskId,
      publicationId:
        changeAll || changes.compileRequest
          ? `task8-publication-${label}`
          : request.publicationId,
      foundation: { ...body, receiptDigest: digestGameIrValue(body) },
    },
  }
}

function source(
  moduleId: 'gameplay' | 'balance' | 'world-scene' | 'presentation',
  profile: FixtureProfile = defaultProfile,
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
    request: profile.request,
    sectionIndex: profile.sectionIndex,
    sectionBytes: Object.fromEntries(
      documents.map(documentPath => {
        const section = profile.sectionIndex.find(
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

type ValidationOutcome = 'PASS' | 'FAIL' | 'AMBIGUOUS'

function admitValidation(
  packet: Phase5SemanticValidationPacket,
  outcome: ValidationOutcome,
) {
  if (outcome === 'PASS')
    return admitPhase5SemanticValidationResult(packet, {
      outcome,
      packetDigest: packet.packetDigest,
      checkIds: packet.checkIds,
      coveredTargets: packet.requiredTargets,
    })
  const evidence = packet.allowedEvidencePointers.find(pointer =>
    pointer.startsWith('section:'),
  )
  return admitPhase5SemanticValidationResult(packet, {
    outcome,
    packetDigest: packet.packetDigest,
    reasonCode:
      outcome === 'FAIL' ? 'missing-projection' : 'ambiguous-projection',
    actual: outcome === 'FAIL' ? 'missing' : 'ambiguous',
    missingSubject: packet.requiredTargets[0]!,
    expectedProjection: 'node',
    evidencePointers: [evidence!],
  } as never)
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

function makePhase4Authority(
  balanceId = 'balance-unit',
  profile: FixtureProfile = defaultProfile,
  gameplayLabel = 'Start',
  includeUnusedGameplayKinds = false,
) {
  const gameplaySource = source('gameplay', profile)
  const balanceSource = source('balance', profile)
  const gameplayMechanical = mechanical(gameplaySource)
  const balanceMechanical = mechanical(balanceSource)
  const balanceVariant = balanceNodes.map(node => ({ ...node, id: balanceId }))
  const gameplayVariant = [
    ...gameplayNodes,
    ...(includeUnusedGameplayKinds ? richGameplayNodes : []),
  ].map(node => ({
    ...node,
    value:
      node.id === 'state-start'
        ? { ...node.value, label: gameplayLabel }
        : node.value,
  }))
  const gameplaySemantic = admitGameplaySemanticResult(
    buildGameplaySemanticPacket({
      source: gameplaySource,
      mechanical: gameplayMechanical,
    }),
    {
      outcome: 'PROJECTED',
      nodes: gameplayVariant,
      sourceClaims: claims(gameplayVariant),
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
    profile?: FixtureProfile
    gameplayLabel?: string
    worldKind?: string
    presentationKind?: string
    presentationDrivenByTargetType?: string
    worldValidationOutcome?: ValidationOutcome
    presentationValidationOutcome?: ValidationOutcome
    includeUnusedKinds?: boolean
  }> = {},
) {
  const profile = overrides.profile ?? defaultProfile
  const phase4Authority = makePhase4Authority(
    overrides.balanceId,
    profile,
    overrides.gameplayLabel,
    overrides.includeUnusedKinds,
  )
  const phase4 = assembleGameplayBalanceModules(phase4Authority)
  const worldId = overrides.worldId ?? 'world-scene-main'
  const presentationId = overrides.presentationId ?? 'presentation-screen-main'
  const worldVariant = [
    ...worldNodes,
    ...(overrides.includeUnusedKinds ? richWorldNodes : []),
  ].map(node => ({
    ...node,
    kind:
      node.id === 'world-scene-main'
        ? (overrides.worldKind ?? node.kind)
        : node.kind,
    id: node.id === 'world-scene-main' ? worldId : node.id,
    edges: node.edges.map(edge =>
      edge.targetId === 'world-scene-main'
        ? { ...edge, targetId: worldId }
        : edge,
    ),
  }))
  const presentationVariant = presentationNodes.map(node => ({
    ...node,
    kind:
      node.id === 'presentation-screen-main'
        ? (overrides.presentationKind ?? node.kind)
        : node.kind,
    id: node.id === 'presentation-screen-main' ? presentationId : node.id,
    edges: node.edges.map(edge =>
      edge.type === 'driven-by' && overrides.presentationDrivenByTargetType
        ? { ...edge, targetType: overrides.presentationDrivenByTargetType }
        : edge.targetId === 'presentation-screen-main'
          ? { ...edge, targetId: presentationId }
          : edge,
    ),
  }))
  const worldAliases = new Map([[worldId, 'world-scene-main']])
  const presentationAliases = new Map([
    [presentationId, 'presentation-screen-main'],
  ])
  const worldSource = source('world-scene', profile)
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
  const worldValidationPacket = prepareWorldSceneSemanticValidationPacket({
    source: worldSource,
    mechanical: worldMechanical,
    semantic: worldSemantic,
    phase4,
  })
  const worldValidation = admitValidation(
    worldValidationPacket,
    overrides.worldValidationOutcome ?? 'PASS',
  )

  const presentationSource = source('presentation', profile)
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
  const presentationValidationPacket =
    preparePresentationSemanticValidationPacket({
      phase4,
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
      },
    })
  const presentationValidation = admitValidation(
    presentationValidationPacket,
    overrides.presentationValidationOutcome ?? 'PASS',
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

function expectMutation(
  mutate: (baseline: ReturnType<typeof buildAuthority>) => unknown,
  matcher: RegExp,
): void {
  const baseline = buildAuthority()
  expect(() => assembleWorldPresentationClosure(baseline)).not.toThrow()
  let mutated: unknown
  try {
    mutated = mutate(baseline)
  } catch (error) {
    if (matcher.test(String(error))) return
    throw new Error(
      `baseline-derived mutation construction failed: ${String(error)}`,
    )
  }
  expect(() => assembleWorldPresentationClosure(mutated as never)).toThrow(
    matcher,
  )
}

function reSignSemantic(
  semantic: unknown,
  nodes: readonly FixtureNode[],
): Record<string, unknown> {
  const { receiptDigest: _receiptDigest, ...body } = semantic as Record<
    string,
    unknown
  >
  const signed = {
    ...body,
    nodes,
    sourceClaims: claims(nodes),
  }
  return { ...signed, receiptDigest: digestGameIrValue(signed) }
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeepFrozen(child, seen)
}

test('prepares strict staged validation packets without exposing projections', () => {
  const authority = buildAuthority()
  const phase4 = assembleGameplayBalanceModules(authority.phase4Authority)
  const worldInput = {
    source: authority.worldScene.source,
    mechanical: authority.worldScene.mechanical,
    semantic: authority.worldScene.semantic,
    phase4,
  }
  const worldPacket = prepareWorldSceneSemanticValidationPacket(worldInput)
  expect(worldPacket.moduleId).toBe('world-scene')
  expect(Object.isFrozen(worldPacket)).toBe(true)
  expect(prepareWorldSceneSemanticValidationPacket(worldInput)).toEqual(
    worldPacket,
  )
  expect(() =>
    prepareWorldSceneSemanticValidationPacket({
      ...worldInput,
      extra: true,
    } as never),
  ).toThrow(/unknown or missing fields/)

  const presentationInput = {
    phase4,
    worldScene: authority.worldScene,
    presentation: {
      source: authority.presentation.source,
      mechanical: authority.presentation.mechanical,
      semantic: authority.presentation.semantic,
    },
  }
  const presentationPacket =
    preparePresentationSemanticValidationPacket(presentationInput)
  expect(presentationPacket.moduleId).toBe('presentation')
  expect(Object.isFrozen(presentationPacket)).toBe(true)
  expect(
    preparePresentationSemanticValidationPacket(presentationInput),
  ).toEqual(presentationPacket)
  expect(() =>
    preparePresentationSemanticValidationPacket({
      ...presentationInput,
      presentation: { ...presentationInput.presentation, extra: true },
    } as never),
  ).toThrow(/unknown or missing fields/)

  const failedWorld = admitValidation(worldPacket, 'FAIL')
  expect(() =>
    preparePresentationSemanticValidationPacket({
      ...presentationInput,
      worldScene: { ...presentationInput.worldScene, validation: failedWorld },
    }),
  ).toThrow(/semantic fidelity must be PASS, received FAIL/)
})

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
  expect(first.worldScene.semanticValidationResultDigest).toBe(
    digestGameIrValue(authority.worldScene.validation),
  )
  expect(first.presentation.semanticValidationResultDigest).toBe(
    digestGameIrValue(authority.presentation.validation),
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

test('accepts complete upstream kinds that downstream domains do not reference', () => {
  const authority = buildAuthority({ includeUnusedKinds: true })
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
})

test('rejects detached Phase 4 projection input before any Phase 5 work', () => {
  const authority = buildAuthority()
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
  const pair = assembleGameplayBalanceModules(authority.phase4Authority)
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        ...authority.phase4Authority,
        gameplay: { projection: pair.gameplay },
      },
    } as never),
  ).toThrow(/unknown or missing fields/)
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        gameplay: { projection: pair.gameplay },
        balance: { projection: pair.balance },
      },
    } as never),
  ).toThrow(/unknown or missing fields/)
})

test('rejects a detached current Phase 4 module placed in raw authority', () => {
  expectMutation(baseline => {
    const pair = assembleGameplayBalanceModules(baseline.phase4Authority)
    return {
      ...baseline,
      phase4Authority: {
        ...baseline.phase4Authority,
        gameplay: {
          ...baseline.phase4Authority.gameplay,
          mechanical: pair.gameplay.module,
        },
      },
    }
  }, /unknown or missing fields/)
})

test('rejects forged recomputed Phase 4 projections in raw authority positions', () => {
  expectMutation(baseline => {
    const pair = assembleGameplayBalanceModules(baseline.phase4Authority)
    const { projectionDigest: _projectionDigest, ...body } = pair.gameplay
    const forgedGameplay = {
      ...body,
      taskId: 'forged-task',
      projectionDigest: digestGameIrValue({ ...body, taskId: 'forged-task' }),
    }
    const { projectionDigest: _balanceDigest, ...balanceBody } = pair.balance
    const forgedBalance = {
      ...balanceBody,
      foundationRevision: 'forged-revision',
      projectionDigest: digestGameIrValue({
        ...balanceBody,
        foundationRevision: 'forged-revision',
      }),
    }
    return {
      ...baseline,
      phase4Authority: {
        gameplay: forgedGameplay,
        balance: forgedBalance,
      },
    }
  }, /unknown or missing fields/)
})

test('rejects Phase 4 mechanical receipt tampering for Gameplay and Balance', () => {
  const authority = buildAuthority()
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        ...authority.phase4Authority,
        gameplay: {
          ...authority.phase4Authority.gameplay,
          mechanical: {
            ...authority.phase4Authority.gameplay.mechanical,
            receiptDigest: digest,
          },
        },
      },
    } as never),
  ).toThrow(/mechanical receipt digest/)
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        ...authority.phase4Authority,
        balance: {
          ...authority.phase4Authority.balance,
          mechanical: {
            ...authority.phase4Authority.balance.mechanical,
            receiptDigest: digest,
          },
        },
      },
    } as never),
  ).toThrow(/mechanical receipt digest/)
})

test('rejects Phase 4 semantic receipt tampering for Gameplay and Balance', () => {
  const authority = buildAuthority()
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
  const gameplaySemantic = {
    ...(authority.phase4Authority.gameplay.semantic as unknown as Record<
      string,
      unknown
    >),
    receiptDigest: digest,
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        ...authority.phase4Authority,
        gameplay: {
          ...authority.phase4Authority.gameplay,
          semantic: gameplaySemantic,
        },
      },
    } as never),
  ).toThrow(/semantic receipt digest/)
  const balanceSemantic = {
    ...(authority.phase4Authority.balance.semantic as unknown as Record<
      string,
      unknown
    >),
    receiptDigest: digest,
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        ...authority.phase4Authority,
        balance: {
          ...authority.phase4Authority.balance,
          semantic: balanceSemantic,
        },
      },
    } as never),
  ).toThrow(/semantic receipt digest/)
})

test('rejects raw Map and real digest-only Phase 4 authority branches', () => {
  const authority = buildAuthority()
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
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
        balance: {
          digest: authority.phase4Authority.balance.source.sourceDigest,
        },
      },
    } as never),
  ).toThrow(/unknown or missing fields/)
})

test('rejects every global namespace pair with the exact owning guard', () => {
  expectMutation(baseline => {
    const semantic = baseline.phase4Authority.balance.semantic as unknown as {
      nodes: readonly FixtureNode[]
    }
    const nodes = semantic.nodes.map(node => ({ ...node, id: 'state-start' }))
    return {
      ...baseline,
      phase4Authority: {
        ...baseline.phase4Authority,
        balance: {
          ...baseline.phase4Authority.balance,
          semantic: reSignSemantic(
            baseline.phase4Authority.balance.semantic,
            nodes,
          ),
        },
      },
    }
  }, /duplicate cross-domain node ID state-start/)
  expectMutation(
    () => buildAuthority({ worldId: 'state-start' }),
    /World\/Gameplay has duplicate global node ID state-start/,
  )
  expectMutation(
    () => buildAuthority({ balanceId: 'world-scene-main' }),
    /World\/Balance has duplicate global node ID world-scene-main/,
  )
  expectMutation(
    () => buildAuthority({ presentationId: 'state-start' }),
    /Presentation\/Gameplay has duplicate global node ID state-start/,
  )
  expectMutation(
    () => buildAuthority({ balanceId: 'presentation-screen-main' }),
    /Presentation\/Balance has duplicate global node ID presentation-screen-main/,
  )
  expectMutation(
    () => buildAuthority({ worldId: 'presentation-screen-main' }),
    /Presentation\/World has duplicate global node ID presentation-screen-main/,
  )
})

test('rejects exact authority shape violations without accepting maps or digest-only branches', () => {
  const authority = buildAuthority()
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
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
  const accessor = { ...authority.phase4Authority.balance }
  Object.defineProperty(accessor, 'semantic', {
    get: () => authority.phase4Authority.balance.semantic,
    enumerable: true,
  })
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: { ...authority.phase4Authority, balance: accessor },
    } as never),
  ).toThrow(/hidden or accessor/)
})

test('rejects stale Phase 4 raw authority and missing World authority before Presentation', () => {
  const authority = buildAuthority()
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
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
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
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

test('rejects a fully valid mixed Phase 4 authority at the cross-source identity guard', () => {
  expectMutation(
    baseline => ({
      ...baseline,
      phase4Authority: buildAuthority({
        profile: makeProfile('phase4-mixed'),
      }).phase4Authority,
    }),
    /all modules must bind one task, revision, READY receipt, compile request, and authority index/,
  )
})

test('rejects a fully valid mixed World authority at the cross-source identity guard', () => {
  expectMutation(
    baseline => ({
      ...baseline,
      worldScene: buildAuthority({
        profile: makeProfile('world-mixed'),
      }).worldScene,
    }),
    /all modules must bind one task, revision, READY receipt, compile request, and authority index/,
  )
})

test('rejects a fully valid mixed Presentation authority at the cross-source identity guard', () => {
  expectMutation(
    baseline => ({
      ...baseline,
      presentation: buildAuthority({
        profile: makeProfile('presentation-mixed'),
      }).presentation,
    }),
    /all modules must bind one task, revision, READY receipt, compile request, and authority index/,
  )
})

test('rejects a legal branch with only task identity changed', () => {
  expectMutation(
    baseline => ({
      ...baseline,
      worldScene: buildAuthority({
        profile: makeProfile('task-only', { task: true }),
      }).worldScene,
    }),
    /all modules must bind one task, revision, READY receipt, compile request, and authority index/,
  )
})

test('rejects a legal branch with only Foundation revision changed', () => {
  expectMutation(
    baseline => ({
      ...baseline,
      worldScene: buildAuthority({
        profile: makeProfile('revision-only', { foundationRevision: true }),
      }).worldScene,
    }),
    /all modules must bind one task, revision, READY receipt, compile request, and authority index/,
  )
})

test('rejects a legal branch with only READY receipt identity changed', () => {
  expectMutation(
    baseline => ({
      ...baseline,
      worldScene: buildAuthority({
        profile: makeProfile('ready-only', { ready: true }),
      }).worldScene,
    }),
    /all modules must bind one task, revision, READY receipt, compile request, and authority index/,
  )
})

test('rejects a legal branch with only a non-foundation compile field changed', () => {
  expectMutation(
    baseline => ({
      ...baseline,
      worldScene: buildAuthority({
        profile: makeProfile('compile-only', { compileRequest: true }),
      }).worldScene,
    }),
    /all modules must bind one task, revision, READY receipt, compile request, and authority index/,
  )
})

test('rejects source-level authority index tampering at source validation', () => {
  expectMutation(baseline => {
    const source = baseline.worldScene.source
    const { sourceDigest: _sourceDigest, ...body } = source
    const authoritySectionIndex = source.authoritySectionIndex.map(
      (section, index) =>
        index === 0
          ? { ...section, heading: `${section.heading}-tampered` }
          : section,
    )
    const tamperedBody = { ...body, authoritySectionIndex }
    return {
      ...baseline,
      worldScene: {
        ...baseline.worldScene,
        source: {
          ...tamperedBody,
          sourceDigest: digestGameIrValue(tamperedBody),
        },
      },
    }
  }, /authority Section Index digest does not match the Foundation receipt/)
})

test('rejects a Phase 4 receipt failure before a simultaneous World failure', () => {
  const authority = buildAuthority()
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
  const invalidMechanical = {
    ...authority.phase4Authority.gameplay.mechanical,
    receiptDigest: digest,
  }
  const invalidWorldSemantic = {
    ...(authority.worldScene.semantic as unknown as Record<string, unknown>),
    receiptDigest: digest,
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        ...authority.phase4Authority,
        gameplay: {
          ...authority.phase4Authority.gameplay,
          mechanical: invalidMechanical,
        },
      },
      worldScene: {
        ...authority.worldScene,
        semantic: invalidWorldSemantic,
      },
    } as never),
  ).toThrow(/mechanical receipt digest/)
})

test('rejects a Phase 4 receipt failure before a simultaneous World fidelity failure', () => {
  const authority = buildAuthority()
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
  const invalidMechanical = {
    ...authority.phase4Authority.balance.mechanical,
    receiptDigest: digest,
  }
  const invalidWorldValidation = {
    ...authority.worldScene.validation,
    packetDigest: digest,
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      phase4Authority: {
        ...authority.phase4Authority,
        balance: {
          ...authority.phase4Authority.balance,
          mechanical: invalidMechanical,
        },
      },
      worldScene: {
        ...authority.worldScene,
        validation: invalidWorldValidation,
      },
    } as never),
  ).toThrow(/mechanical receipt digest/)
})

test('rejects World receipt before a distinct Presentation FAIL', () => {
  expectMutation(baseline => {
    const invalidWorldSemantic = {
      ...(baseline.worldScene.semantic as unknown as Record<string, unknown>),
      receiptDigest: digest,
    }
    const presentationFail = buildAuthority({
      presentationValidationOutcome: 'FAIL',
    }).presentation.validation
    return {
      ...baseline,
      worldScene: { ...baseline.worldScene, semantic: invalidWorldSemantic },
      presentation: {
        ...baseline.presentation,
        validation: presentationFail,
      },
    }
  }, /^invalid Game IR Phase 5 admission: semantic receipt digest is stale or invalid$/)
})

test('rejects World schema before a simultaneous Presentation fidelity failure', () => {
  const authority = buildAuthority()
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
  const invalidWorldSemantic = {
    ...(authority.worldScene.semantic as unknown as Record<string, unknown>),
    schemaVersion: 'wrong-schema',
  }
  const invalidPresentationValidation = {
    ...authority.presentation.validation,
    packetDigest: digest,
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      worldScene: { ...authority.worldScene, semantic: invalidWorldSemantic },
      presentation: {
        ...authority.presentation,
        validation: invalidPresentationValidation,
      },
    } as never),
  ).toThrow(/stale or relabeled/)
})

test('rejects World fidelity before a simultaneous Presentation receipt failure', () => {
  const authority = buildAuthority()
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
  const invalidWorldValidation = {
    ...authority.worldScene.validation,
    packetDigest: digest,
  }
  const invalidPresentationSemantic = {
    ...(authority.presentation.semantic as unknown as Record<string, unknown>),
    receiptDigest: digest,
  }
  expect(() =>
    assembleWorldPresentationClosure({
      ...authority,
      worldScene: {
        ...authority.worldScene,
        validation: invalidWorldValidation,
      },
      presentation: {
        ...authority.presentation,
        semantic: invalidPresentationSemantic,
      },
    } as never),
  ).toThrow(/fidelity PASS packet digest/)
})

test('rejects invalid World receipt, schema, or fidelity before Presentation admission', () => {
  const authority = buildAuthority()
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
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

test('rejects rebuilt World and Presentation schema-invalid semantic graphs', () => {
  expectMutation(baseline => {
    const semantic = baseline.worldScene.semantic as unknown as {
      nodes: readonly FixtureNode[]
    }
    const nodes = semantic.nodes.map(node =>
      node.id === 'world-scene-main'
        ? { ...node, value: { label: 'Main' } }
        : node,
    )
    return {
      ...baseline,
      worldScene: {
        ...baseline.worldScene,
        semantic: reSignSemantic(baseline.worldScene.semantic, nodes),
      },
    }
  }, /node world-scene-main value has unknown or missing fields/)
  expectMutation(baseline => {
    const semantic = baseline.presentation.semantic as unknown as {
      nodes: readonly FixtureNode[]
    }
    const nodes = semantic.nodes.map((node, index) =>
      index === 0 ? { ...node, value: { label: 'Main' } } : node,
    )
    return {
      ...baseline,
      presentation: {
        ...baseline.presentation,
        semantic: reSignSemantic(baseline.presentation.semantic, nodes),
      },
    }
  }, /node presentation-screen-main modal must be boolean/)
})

test('rejects a source-bound World wrong-kind semantic graph', () => {
  expectMutation(baseline => {
    const semantic = baseline.worldScene.semantic as unknown as {
      nodes: readonly FixtureNode[]
    }
    const nodes = semantic.nodes.map(node =>
      node.id === 'world-scene-main'
        ? { ...node, kind: 'gameplay.state' }
        : node,
    )
    return {
      ...baseline,
      worldScene: {
        ...baseline.worldScene,
        semantic: reSignSemantic(baseline.worldScene.semantic, nodes),
      },
    }
  }, /nodes\[1\] has a node kind outside the semantic packet/)
})

test('rejects a source-bound Presentation wrong-kind semantic graph', () => {
  expectMutation(baseline => {
    const semantic = baseline.presentation.semantic as unknown as {
      nodes: readonly FixtureNode[]
    }
    const nodes = semantic.nodes.map((node, index) =>
      index === 0 ? { ...node, kind: 'world-scene.scene' } : node,
    )
    return {
      ...baseline,
      presentation: {
        ...baseline.presentation,
        semantic: reSignSemantic(baseline.presentation.semantic, nodes),
      },
    }
  }, /nodes\[0\] has a node kind outside the semantic packet/)
})

test('rejects a rebuilt Presentation forbidden external target', () => {
  expectMutation(baseline => {
    const semantic = baseline.presentation.semantic as unknown as {
      nodes: readonly FixtureNode[]
    }
    const nodes = semantic.nodes.map(node => ({
      ...node,
      edges: node.edges.map(edge =>
        edge.type === 'driven-by'
          ? { ...edge, targetId: 'balance-unit' }
          : edge,
      ),
    }))
    return {
      ...baseline,
      presentation: {
        ...baseline.presentation,
        semantic: reSignSemantic(baseline.presentation.semantic, nodes),
      },
    }
  }, /node presentation-screen-main edge targets unknown node balance-unit/)
})

test('rejects invalid Presentation receipt or fidelity only after World succeeds', () => {
  const authority = buildAuthority()
  expect(() => assembleWorldPresentationClosure(authority)).not.toThrow()
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

test('rejects admitted World FAIL and AMBIGUOUS validation outcomes', () => {
  expect(() => assembleWorldPresentationClosure(buildAuthority())).not.toThrow()
  expect(() =>
    assembleWorldPresentationClosure(
      buildAuthority({ worldValidationOutcome: 'FAIL' }),
    ),
  ).toThrow(/semantic fidelity must be PASS, received FAIL/)
  expect(() =>
    assembleWorldPresentationClosure(
      buildAuthority({ worldValidationOutcome: 'AMBIGUOUS' }),
    ),
  ).toThrow(/semantic fidelity must be PASS, received AMBIGUOUS/)
})

test('rejects admitted Presentation FAIL and AMBIGUOUS validation outcomes', () => {
  expect(() => assembleWorldPresentationClosure(buildAuthority())).not.toThrow()
  expect(() =>
    assembleWorldPresentationClosure(
      buildAuthority({ presentationValidationOutcome: 'FAIL' }),
    ),
  ).toThrow(/semantic fidelity must be PASS, received FAIL/)
  expect(() =>
    assembleWorldPresentationClosure(
      buildAuthority({ presentationValidationOutcome: 'AMBIGUOUS' }),
    ),
  ).toThrow(/semantic fidelity must be PASS, received AMBIGUOUS/)
})

test('rejects validation evidence crossing the World and Presentation source scopes', () => {
  expect(() => assembleWorldPresentationClosure(buildAuthority())).not.toThrow()
  const baseline = buildAuthority()
  const worldPacket = prepareWorldSceneSemanticValidationPacket({
    source: baseline.worldScene.source,
    mechanical: baseline.worldScene.mechanical,
    semantic: baseline.worldScene.semantic,
    phase4: assembleGameplayBalanceModules(baseline.phase4Authority),
  })
  const worldAuthority = {
    ...baseline,
    worldScene: {
      ...baseline.worldScene,
      validation: admitValidation(worldPacket, 'FAIL'),
    },
  }
  const worldValidation = worldAuthority.worldScene
    .validation as unknown as Record<string, unknown>
  expect(() =>
    assembleWorldPresentationClosure({
      ...worldAuthority,
      worldScene: {
        ...worldAuthority.worldScene,
        validation: {
          ...worldValidation,
          evidencePointers: [
            'section:docs/ART_DIRECTION.md#section-0@' + digest,
          ],
        },
      },
    } as never),
  ).toThrow(/evidence|section/)

  const presentationAuthority = buildAuthority({
    presentationValidationOutcome: 'FAIL',
  })
  const presentationValidation = presentationAuthority.presentation
    .validation as unknown as Record<string, unknown>
  expect(() =>
    assembleWorldPresentationClosure({
      ...presentationAuthority,
      presentation: {
        ...presentationAuthority.presentation,
        validation: {
          ...presentationValidation,
          evidencePointers: [
            'section:docs/LEVEL_SCENE_DESIGN.md#section-0@' + digest,
          ],
        },
      },
    } as never),
  ).toThrow(/evidence|section/)
})

test('rejects stale World external Gameplay validation after replaying changed raw Gameplay', () => {
  const baseline = buildAuthority()
  const changed = buildAuthority({ gameplayLabel: 'Changed' })
  expect(() => assembleWorldPresentationClosure(baseline)).not.toThrow()
  expect(() => assembleWorldPresentationClosure(changed)).not.toThrow()
  expect(() =>
    assembleWorldPresentationClosure({
      ...baseline,
      phase4Authority: changed.phase4Authority,
    }),
  ).toThrow(/fidelity PASS packet digest does not match packet/)
})

test('rejects stale Presentation external World validation after replaying changed raw World', () => {
  const baseline = buildAuthority()
  const changed = buildAuthority({ worldId: 'world-scene-alt' })
  expect(() => assembleWorldPresentationClosure(baseline)).not.toThrow()
  expect(() => assembleWorldPresentationClosure(changed)).not.toThrow()
  expect(() =>
    assembleWorldPresentationClosure({
      ...baseline,
      worldScene: changed.worldScene,
    }),
  ).toThrow(/fidelity PASS packet digest does not match packet/)
})

test('rejects World PASS with only checkIds coverage removed', () => {
  expectMutation(
    baseline => ({
      ...baseline,
      worldScene: {
        ...baseline.worldScene,
        validation: { ...baseline.worldScene.validation, checkIds: [] },
      },
    }),
    /fidelity PASS checkIds has incomplete or extra values/,
  )
})

test('rejects Presentation PASS with only coveredTargets coverage removed', () => {
  expectMutation(
    baseline => ({
      ...baseline,
      presentation: {
        ...baseline.presentation,
        validation: {
          ...baseline.presentation.validation,
          coveredTargets: [],
        },
      },
    }),
    /fidelity PASS coveredTargets has incomplete or extra values/,
  )
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
  expect(
    digestGameIrValue({
      ...closureBody,
      worldScene: { ...closureBody.worldScene, projectionDigest: digest },
    }),
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
