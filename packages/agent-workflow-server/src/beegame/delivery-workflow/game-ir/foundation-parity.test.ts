import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, test } from 'bun:test'
import { createDeliveryWorkflowController } from '../controller'
import { createInitialDeliveryRun } from '../run-store'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../../__tests__/complete-game-document-fixture'
import { withTestDocumentMetadata } from '../../../__tests__/delivery-workflow-test-helpers'
import {
  buildFoundationSectionIndex,
  type SectionRef,
} from '../foundation-section-index'
import {
  loadCommittedFoundationDerivedArtifacts,
  loadFoundationSemanticReview,
} from '../foundation-audit-artifacts'
import {
  extractNormalizedFoundationFacts,
  type FoundationFactPacket,
} from '../foundation-fact-extraction'
import {
  FOUNDATION_FACT_CATALOG,
  type FoundationFactKey,
} from '../foundation-fact-definitions'
import {
  loadFoundationRevisionPacket,
  loadFoundationRevisionSemanticResult,
  revisionTaskReceiptTerminalDigest,
} from '../foundation-revision-stage'
import {
  parseFoundationAuditState,
  type FoundationAuditState,
} from '../foundation-audit-state'
import { loadCommittedFoundationRevisionAuthority } from '../foundation-revision-publication'
import { commitFoundationRevisionDocumentMetadata } from '../../authored-document-receipt'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import type {
  DeliveryWorkerPort,
  FoundationDocumentPath,
  FoundationRevisionDocumentTask,
  FoundationRevisionImpactedFactsTask,
  FoundationRevisionSemanticRecheckTask,
  WorkerDispatchRequest,
} from '../types'
import { GAME_IR_SCHEMA_VERSION, parseGameIrCompileRequest } from './contracts'
import { projectFoundationReadyReceipt } from './foundation-ready-adapter'

const ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../',
)
const BASELINE = '70df2e2c'
const PHASE_STARTED_AT = '2026-08-24T00:00:00.000Z'
const PROTECTED_FILES = [
  'packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts',
] as const
const WORKER_KEY: FoundationFactKey = 'game.win_conditions'
const VALUES: Record<FoundationFactKey, string> = {
  'game.players.max': '4',
  'game.boss.count': '3',
  'game.mechanics': '[move, attack, dash]',
  'game.resources': '[hp, energy]',
  'game.states': '[menu, playing, won, lost]',
  'game.win_conditions': '[boss_defeated]',
  'game.loss_conditions': '[player_defeated]',
  'game.platform': 'quest',
  'level.required_entities': '[Player, Boss_A]',
  'level.required_assets': '[mesh_player, mesh_boss]',
  'level.complexity_budget': '100',
  'balance.entity_ids': '[Player, Boss_A]',
  'balance.variable_ids': '[player_hp, boss_hp]',
  'technical.supported_actions': '[move, attack, dash]',
  'technical.target_fps': '72',
  'technical.content_kinds': '[model, texture, audio]',
  'art.style_constraints': '[low_poly, readable_silhouette]',
  'ui.supported_actions': '[move, attack, dash]',
  'ui.displayed_resources': '[hp, energy]',
  'audio.event_ids': '[boss_spawn, boss_defeated]',
  'asset.inventory_ids': '[mesh_player, mesh_boss]',
  'asset.covered_level_requirements': '[mesh_player, mesh_boss]',
  'asset.boss.count': '3',
  'asset.art_constraint_refs': '[low_poly, readable_silhouette]',
  'asset.formats': '[glb, png, wav]',
}

type Fixture = {
  name: string
  revision: string
  documents: Map<string, string>
  issueDocuments?: Map<string, string>
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableEvidence(value: unknown, key?: string): unknown {
  if (
    key === 'dispatchId' ||
    key === 'runId' ||
    key === 'sessionId' ||
    key === 'workspacePath' ||
    key === 'startedAt' ||
    key === 'finishedAt' ||
    key === 'createdAt' ||
    key === 'updatedAt' ||
    key === 'phaseStartedAt' ||
    key === 'completedAt' ||
    key === 'durationMs' ||
    key === 'terminalDigest'
  )
    return `<${key}>`
  if (Array.isArray(value)) return value.map(item => stableEvidence(item))
  if (typeof value === 'string')
    return value
      .replace(/\/tmp\/game-ir-parity-[^/]+/g, '<workspace>')
      .replace(
        /checklist-candidates\/[0-9a-f-]{36}/g,
        'checklist-candidates/<candidate>',
      )
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      stableEvidence(entryValue, entryKey),
    ]),
  )
}

function sectionText(
  documents: ReadonlyMap<string, string>,
  section: SectionRef,
): string {
  const markdown = documents.get(section.documentPath)
  if (!markdown)
    throw new Error(`missing fixture document: ${section.documentPath}`)
  return markdown
    .split('\n')
    .slice(section.startLine - 1, section.endLine)
    .join('\n')
}

function fixtureDocuments(variant: string): Map<string, string> {
  const documents = new Map(
    CANONICAL_PATHS.map(path => {
      const submission = completeTestSubmission(path)
      submission.sections = submission.sections.map(section => {
        const definitions = FOUNDATION_FACT_CATALOG.filter(
          definition =>
            definition.owner.documentPath === path &&
            definition.owner.sectionId === section.sectionId &&
            definition.key !== WORKER_KEY,
        )
        const lines = definitions.map(
          definition => `${definition.key}: ${VALUES[definition.key]}`,
        )
        const workerLine =
          path === 'docs/GDD.md' && section.sectionId === 'states_flow'
            ? ['win condition labels: [boss_defeated]']
            : []
        return {
          ...section,
          body: `${section.body}\nvariant: ${variant}\n${[...lines, ...workerLine].join('\n')}`,
        }
      })
      submission.productionMaterials = submission.productionMaterials.map(
        material => {
          if (!('body' in material)) return material
          const definitions = FOUNDATION_FACT_CATALOG.filter(
            definition =>
              definition.owner.documentPath === path &&
              definition.owner.sectionId === `material.${material.materialId}`,
          )
          const lines = definitions.map(
            definition => `${definition.key}: ${VALUES[definition.key]}`,
          )
          return { ...material, body: `${material.body}\n${lines.join('\n')}` }
        },
      )
      return [
        path,
        withTestDocumentMetadata(
          path,
          renderTestCompleteGameDocument(path, submission),
        ),
      ]
    }),
  )
  if (variant === 'issue')
    documents.set(
      'docs/ASSET_PLAN.md',
      documents
        .get('docs/ASSET_PLAN.md')!
        .replace('asset.boss.count: 3', 'asset.boss.count: 4'),
    )
  return documents
}

const CANONICAL_PATHS = [
  'docs/GDD.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/LEVEL_SCENE_DESIGN.md',
  'docs/BALANCE_DESIGN.md',
  'docs/UI_UX_SPEC.md',
  'docs/ART_DIRECTION.md',
  'docs/AUDIO_DESIGN.md',
  'docs/ASSET_PLAN.md',
] as const

function makeFixture(name: string): Fixture {
  const documents = fixtureDocuments(name === 'issue' ? 'rules' : name)
  const issueDocuments =
    name === 'issue' ? fixtureDocuments('issue') : undefined
  return {
    name,
    revision: `foundation-${name}`,
    documents,
    issueDocuments,
  }
}

function factPacketResults(
  packet: FoundationFactPacket,
  documents: ReadonlyMap<string, string>,
  index: readonly SectionRef[],
) {
  return packet.keys.map(key => {
    const definition = FOUNDATION_FACT_CATALOG.find(item => item.key === key)!
    const section = index.find(
      item =>
        item.documentPath === definition.owner.documentPath &&
        item.sectionId === definition.owner.sectionId,
    )!
    const lines = sectionText(documents, section).split('\n')
    const lineOffset = lines.findIndex(line =>
      line.startsWith('win condition labels:'),
    )
    if (key !== WORKER_KEY || lineOffset < 0)
      throw new Error(`fixture worker evidence is missing: ${key}`)
    const lineNumber = section.startLine + lineOffset
    return {
      key,
      status: 'present' as const,
      value: ['boss_defeated'],
      evidence: {
        documentPath: section.documentPath,
        sectionId: section.sectionId,
        startLine: lineNumber,
        endLine: lineNumber,
        digest: sha256(lines[lineOffset]!),
      },
    }
  })
}

async function writeDocuments(
  workspacePath: string,
  documents: ReadonlyMap<string, string>,
): Promise<void> {
  await mkdir(join(workspacePath, 'docs'), { recursive: true })
  await Promise.all(
    [...documents].map(([path, body]) =>
      writeFile(join(workspacePath, path), body, 'utf8'),
    ),
  )
}

function parityWorkerPort(
  requests: WorkerDispatchRequest[],
): DeliveryWorkerPort {
  return {
    async start(request) {
      requests.push(request)
      return { sessionId: request.dispatchId!, dispatchId: request.dispatchId! }
    },
    async submit() {},
    async stop() {},
    async close() {},
    async status(dispatchId) {
      return {
        dispatchId,
        workerType: 'foundation-fact-extractor',
        phase: 'DOCUMENT_REVIEW',
        taskId: 'parity-status',
        revision: 'foundation-issue',
        status: 'interrupted',
        startedAt: PHASE_STARTED_AT,
      }
    },
  }
}

function controllerFactResults(
  packet: FoundationFactPacket,
  documents: ReadonlyMap<string, string>,
  sectionIndex: readonly SectionRef[],
) {
  const mechanical = extractNormalizedFoundationFacts({
    documents,
    sectionIndex,
  })
  const workerResult = new Map(
    packet.keys.includes(WORKER_KEY)
      ? factPacketResults(packet, documents, sectionIndex).map(result => [
          result.key,
          result,
        ])
      : [],
  )
  return packet.keys.map(key => {
    const worker = workerResult.get(key)
    if (worker) return worker
    const fact = mechanical.facts.find(item => item.key === key)
    if (!fact) return { key, status: 'absent' as const }
    return {
      key,
      status: 'present' as const,
      value: fact.value,
      evidence: fact.evidence,
    }
  })
}

async function completeControllerFacts(
  controller: ReturnType<typeof createDeliveryWorkflowController>,
  documents: ReadonlyMap<string, string>,
  sectionIndex: readonly SectionRef[],
): Promise<void> {
  while (true) {
    const current = await controller.store.load()
    const running =
      current?.foundationAuditState?.tasks.filter(
        task => task.kind === 'document-facts' && task.status === 'running',
      ) ?? []
    if (running.length === 0) return
    await Promise.all(
      running.map(async task => {
        const packet = task.dispatch!.request!.contract
          .packet as FoundationFactPacket
        await controller.dispatcher.completeDispatch(
          task.dispatch!.dispatchId,
          {
            workerType: 'foundation-fact-extractor',
            status: 'completed',
            runId: current!.runId,
            dispatchId: task.dispatch!.dispatchId,
            taskId: task.taskId,
            revision: task.revision,
            packetDigest: task.packetDigest,
            results: controllerFactResults(packet, documents, sectionIndex),
          },
        )
      }),
    )
  }
}

async function completeControllerSemanticTasks(
  controller: ReturnType<typeof createDeliveryWorkflowController>,
  status: 'semantic_review' | 'semantic_recheck',
  issueSectionKey?: string,
): Promise<void> {
  let issueAdmitted = false
  while (true) {
    const current = await controller.store.load()
    const running =
      current?.foundationAuditState?.tasks.filter(
        task =>
          task.status === 'running' &&
          (status === 'semantic_review'
            ? task.kind === 'semantic' || task.kind === 'confirmation'
            : task.kind === 'semantic-recheck'),
      ) ?? []
    if (running.length === 0) return
    await Promise.all(
      running.map(async task => {
        const packet = task.dispatch?.request?.contract.packet as {
          sections?: Array<{ sectionKey: string }>
        }
        const issue =
          status === 'semantic_review' &&
          !issueAdmitted &&
          issueSectionKey &&
          packet.sections?.some(
            section => section.sectionKey === issueSectionKey,
          )
        if (issue) issueAdmitted = true
        await controller.dispatcher.completeDispatch(
          task.dispatch!.dispatchId,
          {
            workerType: 'foundation-semantic-reviewer',
            status: 'completed',
            runId: current!.runId,
            dispatchId: task.dispatch!.dispatchId,
            taskId: task.taskId,
            revision: task.revision,
            packetDigest: task.packetDigest,
            outcome: issue ? 'ISSUES' : 'PASS',
            ...(issue
              ? {
                  issues: [
                    {
                      problem: 'asset inventory count is inconsistent',
                      expected: 'asset.boss.count agrees with the GDD',
                      actual: 'asset.boss.count is 4 while the GDD declares 3',
                      sourceSectionKey: issueSectionKey,
                      remediation: {
                        kind: 'patch' as const,
                        sectionKeys: [issueSectionKey],
                      },
                    },
                  ],
                }
              : {}),
          },
        )
      }),
    )
  }
}

async function controllerIssuePlan(fixture: Fixture, workspacePath: string) {
  const documents = fixture.issueDocuments ?? fixture.documents
  const sectionIndex = buildFoundationSectionIndex({ documents })
  await writeDocuments(workspacePath, documents)
  const confirmedBriefContext = '{"game":"bee"}'
  const confirmedBriefDigest = sha256(confirmedBriefContext)
  const run = createInitialDeliveryRun({
    projectId: `project-${fixture.name}`,
    ownerId: 'parity-owner',
    confirmedBriefContext,
    confirmedBriefDigest,
    documentRevision: fixture.revision,
    workspaceRevision: `workspace-${fixture.name}`,
  })
  const seeded = {
    ...run,
    phase: 'DOCUMENT_DRAFTING' as const,
    documentStep: 'FOUNDATION_DRAFTING' as const,
    foundationDraftState: {
      completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
    },
    revision: { ...run.revision, document: fixture.revision },
  }
  const requests: WorkerDispatchRequest[] = []
  const controller = createDeliveryWorkflowController({
    workspacePath,
    ownerId: seeded.ownerId,
    workerPort: parityWorkerPort(requests),
  })
  await controller.store.save(seeded)
  await controller.resume(seeded)
  await completeControllerFacts(controller, documents, sectionIndex)

  let current = await controller.store.load()
  let semanticTaskEvidence: FoundationRevisionSemanticRecheckTask | undefined
  let semanticBundleEvidence:
    | NonNullable<FoundationAuditState['revisionBundles']>[number]
    | undefined
  const preRevisionFingerprints = new Set<string>()
  while (true) {
    if (!current?.foundationAuditState)
      throw new Error('controller lost Foundation audit state')
    const state = current.foundationAuditState
    const hasReviewAuthority =
      state.review?.reviewDigest !== undefined ||
      state.roundBefore?.issueAuthority.kind === 'review'
    if (
      hasReviewAuthority &&
      ['audit_ready', 'planning', 'revising'].includes(state.status)
    )
      break
    const fingerprint = sha256(JSON.stringify(stableEvidence(state)))
    if (!preRevisionFingerprints.add(fingerprint))
      throw new Error(
        'controller made no progress toward pre-revision audit_ready',
      )
    if (state.status === 'semantic_review') {
      await completeControllerSemanticTasks(
        controller,
        'semantic_review',
        'ASSET#inventory',
      )
    } else {
      await controller.resume(current)
    }
    current = await controller.store.load()
  }
  if (!current?.foundationAuditState)
    throw new Error(
      `controller did not publish pre-revision audit_ready: ${current?.foundationAuditState?.status ?? 'missing'} ${current?.blockedReason ?? ''}`,
    )
  const preRevisionState = current.foundationAuditState
  if (
    !['audit_ready', 'planning', 'revising'].includes(
      preRevisionState.status,
    ) ||
    (!preRevisionState.review && !preRevisionState.authority?.issueAuthority)
  )
    throw new Error('controller did not preserve pre-revision review authority')
  const preRevision = preRevisionState.revision
  const preReviewDigest =
    preRevisionState.review?.reviewDigest ??
    (preRevisionState.roundBefore?.issueAuthority?.kind === 'review'
      ? preRevisionState.roundBefore.issueAuthority.reviewDigest
      : undefined)
  if (!preReviewDigest)
    throw new Error('controller pre-revision review digest is missing')
  const preReview = await loadFoundationSemanticReview({
    workspacePath,
    revision: preRevision,
    reviewDigest: preReviewDigest,
  })
  if (!preReview)
    throw new Error('controller review publication was not loadable')
  const preDerived = await loadCommittedFoundationDerivedArtifacts({
    workspacePath,
    revision: preRevision,
  })
  if (!preDerived)
    throw new Error('controller pre-revision derived authority is missing')
  if (preReview.issues.length === 0)
    throw new Error('issue fixture did not produce a published review issue')

  const revisionFingerprints = new Set<string>()
  while (true) {
    const state = current.foundationAuditState
    if (!state) throw new Error('controller lost revision audit state')
    if (
      state.status === 'revising' &&
      state.tasks.some(
        task => task.kind === 'document-revision' && task.status === 'running',
      )
    )
      break
    const fingerprint = sha256(JSON.stringify(stableEvidence(state)))
    if (!revisionFingerprints.add(fingerprint))
      throw new Error('controller made no progress toward revision dispatch')
    await controller.resume(current)
    current = await controller.store.load()
    if (!current) throw new Error('controller revision run disappeared')
  }
  const planningState = current.foundationAuditState
  const documentTask = planningState?.tasks.find(
    (task): task is FoundationRevisionDocumentTask =>
      task.kind === 'document-revision' && task.status === 'running',
  )
  if (!documentTask)
    throw new Error('controller did not dispatch the revision task')
  const packet = (await loadFoundationRevisionPacket({
    workspacePath,
    revision: documentTask.revision,
    round: documentTask.round,
    taskId: documentTask.taskId,
    documentPath: documentTask.documentPath,
    packetDigest: documentTask.packetDigest,
  })) as {
    sections: Array<{
      sectionId: string
      startLine: number
      endLine: number
      text: string
    }>
  }
  const section = packet.sections.find(candidate =>
    documentTask.sectionIds.includes(candidate.sectionId),
  )
  if (!section)
    throw new Error('controller revision packet has no target section')
  const stagedPath = join(workspacePath, documentTask.stagedPath)
  const stagedBefore = await readFile(stagedPath, 'utf8')
  const stagedAfter = stagedBefore.replace(
    'asset.boss.count: 4',
    'asset.boss.count: 3',
  )
  if (stagedAfter === stagedBefore)
    throw new Error('controller revision fixture did not expose the issue')
  await writeFile(stagedPath, stagedAfter, 'utf8')
  await commitFoundationRevisionDocumentMetadata({
    workspacePath,
    canonicalPath: documentTask.documentPath,
    stagedPath: documentTask.stagedPath,
    expectedCanonicalDigest: documentTask.baseDocumentDigest,
  })
  const receiptCore = {
    taskId: documentTask.taskId,
    round: documentTask.round,
    documentPath: documentTask.documentPath,
    issueIds: [...documentTask.issueIds],
    baseDocumentDigest: documentTask.baseDocumentDigest,
    stagedDocumentDigest: sha256(await readFile(stagedPath)),
    changedSectionIds: [...documentTask.sectionIds],
    stagedPath: documentTask.stagedPath,
  }
  const receipt = {
    ...receiptCore,
    terminalDigest: revisionTaskReceiptTerminalDigest(receiptCore),
  }
  const revisionRun = current
  await controller.dispatcher.completeDispatch(
    documentTask.dispatch!.dispatchId,
    {
      workerType: 'foundation-document-reviser',
      status: 'completed',
      runId: revisionRun.runId,
      dispatchId: documentTask.dispatch!.dispatchId,
      taskId: documentTask.taskId,
      revision: documentTask.revision,
      packetDigest: documentTask.packetDigest,
      round: documentTask.round,
      documentPath: documentTask.documentPath,
      declaration: { status: 'APPLIED', receipt },
    },
  )

  const postRevisionFingerprints = new Set<string>()
  while (true) {
    current = await controller.store.load()
    if (!current?.foundationAuditState)
      throw new Error('controller lost revision audit state')
    const state = current.foundationAuditState
    if (state.status === 'revision_ready') break
    const fingerprint = sha256(JSON.stringify(stableEvidence(state)))
    if (!postRevisionFingerprints.add(fingerprint))
      throw new Error('controller made no progress toward revision_ready')
    if (state.status === 'semantic_recheck') {
      await controller.resume(current)
      await completeControllerSemanticTasks(controller, 'semantic_recheck')
      const completed = await controller.store.load()
      const completedState = completed?.foundationAuditState
      const completedTask = completedState?.tasks.find(
        (task): task is FoundationRevisionSemanticRecheckTask =>
          task.kind === 'semantic-recheck' && task.status === 'completed',
      )
      if (completedTask) {
        semanticTaskEvidence = completedTask
        semanticBundleEvidence = completedState?.revisionBundles?.find(
          bundle => bundle.bundleId === completedTask.bundleId,
        )
      }
      continue
    }
    const impactedFacts = state.tasks.filter(
      (task): task is FoundationRevisionImpactedFactsTask =>
        task.kind === 'impacted-facts' && task.status === 'running',
    )
    if (impactedFacts.length > 0) {
      const currentDocuments = new Map(
        await Promise.all(
          CANONICAL_PATHS.map(
            async path =>
              [
                path,
                await readFile(join(workspacePath, path), 'utf8'),
              ] as const,
          ),
        ),
      )
      const currentIndex = buildFoundationSectionIndex({
        documents: currentDocuments,
      })
      await Promise.all(
        impactedFacts.map(async task => {
          const packet = JSON.parse(
            await readFile(join(workspacePath, task.packetPath), 'utf8'),
          ) as FoundationFactPacket
          await controller.dispatcher.completeDispatch(
            task.dispatch!.dispatchId,
            {
              workerType: 'foundation-fact-extractor',
              status: 'completed',
              runId: current!.runId,
              dispatchId: task.dispatch!.dispatchId,
              taskId: task.taskId,
              revision: task.revision,
              packetDigest: task.packetDigest,
              results: controllerFactResults(
                packet,
                currentDocuments,
                currentIndex,
              ),
            },
          )
        }),
      )
      continue
    }
    await controller.resume(current)
  }
  const revisionReadyState = current.foundationAuditState
  if (!revisionReadyState || revisionReadyState.status !== 'revision_ready')
    throw new Error('controller did not reach revision_ready')
  const publicationAuthority = revisionReadyState.authority?.issueAuthority
  if (!publicationAuthority || publicationAuthority.kind !== 'publication')
    throw new Error('controller revision_ready lacks publication authority')
  const publication = await loadCommittedFoundationRevisionAuthority({
    workspacePath,
    revision: publicationAuthority.baseRevision,
  })
  const resultingDerived = await loadCommittedFoundationDerivedArtifacts({
    workspacePath,
    revision: revisionReadyState.revision,
  })
  if (!resultingDerived)
    throw new Error('controller revision_ready derived authority is missing')
  const revisionTask = revisionReadyState.tasks.find(
    (task): task is FoundationRevisionDocumentTask =>
      task.kind === 'document-revision',
  )
  const semanticTask = semanticTaskEvidence
  if (!revisionTask || !semanticTask || !semanticBundleEvidence)
    throw new Error(
      `controller revision evidence is incomplete: final=${revisionReadyState.tasks.map(task => `${task.kind}:${task.status}`).join(',')}`,
    )
  const bundle = revisionReadyState.revisionBundles?.find(
    candidate => candidate.bundleId === revisionReadyState.activeBundleId,
  )
  if (!bundle)
    throw new Error('controller revision_ready active bundle is missing')
  const semanticResult = await loadFoundationRevisionSemanticResult({
    workspacePath,
    revision: semanticTask.revision,
    round: semanticTask.round,
    taskId: semanticTask.taskId,
    issueId: semanticTask.issueId,
    packetDigest: semanticTask.packetDigest,
    resultDigest: semanticTask.resultDigest!,
    resultPath: semanticTask.resultPath!,
  })
  return {
    preRevision,
    preReview,
    preDerived,
    readyState: revisionReadyState,
    publication,
    revisionTask,
    semanticTask,
    semanticResult,
    bundle: semanticBundleEvidence,
    readyBundle: bundle,
    identity: stableEvidence({
      dispatches: requests,
      preRevisionState,
      preReview,
      preDerived,
      readyState: revisionReadyState,
      publication,
      resultingDerived,
      revisionTask,
      semanticTask,
      semanticResult,
      bundle: semanticBundleEvidence,
      readyBundle: bundle,
    }),
  }
}

function productionSources(): string[] {
  const root = resolve(
    ROOT,
    'packages/agent-workflow-server/src/beegame/delivery-workflow',
  )
  const paths: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'game-ir' || entry.name.endsWith('.test.ts')) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name.endsWith('.ts')) paths.push(path)
    }
  }
  visit(root)
  return paths.sort()
}

function forbiddenSyntax(source: string): string[] {
  const file = ts.createSourceFile(
    'synthetic.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const violations: string[] = []
  const gameIrModule = (value: string) => /(?:^|\/)game-ir(?:\/|$)/.test(value)
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      gameIrModule(node.moduleSpecifier.text)
    )
      violations.push(`import:${node.moduleSpecifier.text}`)
    else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      gameIrModule(node.moduleSpecifier.text)
    )
      violations.push(`export:${node.moduleSpecifier.text}`)
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression) &&
      gameIrModule(node.moduleReference.expression.text)
    )
      violations.push(`import-equals:${node.moduleReference.expression.text}`)
    else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        gameIrModule(node.arguments[0].text)
      )
        violations.push(`dynamic-import:${node.arguments[0].text}`)
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        gameIrModule(node.arguments[0].text)
      )
        violations.push(`require:${node.arguments[0].text}`)
    }
    if (
      ts.isIdentifier(node) &&
      (/^(?:GameIr|gameIr)[A-Za-z0-9_]*$/.test(node.text) ||
        /^GAME_IR[A-Za-z0-9_]*$/.test(node.text) ||
        /(?:enable|switch).*gameir|gameir.*(?:enable|switch)/i.test(node.text))
    )
      violations.push(`identifier:${node.text}`)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return violations
}

describe('Foundation parity against stable baseline 70df2e2c', () => {
  test('uses a repository-root baseline and protects Stage 3/4 bytes', () => {
    for (const path of PROTECTED_FILES) {
      const baseline = Bun.spawnSync([
        'git',
        '-C',
        ROOT,
        'show',
        `${BASELINE}:${path}`,
      ])
      if (baseline.exitCode !== 0)
        throw new Error(
          `Git baseline ${BASELINE} is unavailable for ${path}: ${Buffer.from(baseline.stderr).toString('utf8')}`,
        )
      expect(Buffer.from(baseline.stdout)).toEqual(
        readFileSync(resolve(ROOT, path)),
      )
    }
  })

  test('keeps real issue registry, revision authority, batches, and targeted recheck stable across READY parsing', async () => {
    const fixture = makeFixture('issue')
    const workspacePath = await mkdtemp(join('/tmp', 'game-ir-parity-'))
    const secondWorkspacePath = await mkdtemp(join('/tmp', 'game-ir-parity-'))
    try {
      const issueDocuments = fixture.issueDocuments ?? fixture.documents
      const beforeDocuments = JSON.stringify([...issueDocuments])
      const before = await controllerIssuePlan(fixture, workspacePath)
      expect(before.preReview.issues).toHaveLength(2)
      expect(before.semanticTask.resultDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(before.semanticTask.terminalDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(before.semanticTask.terminalDigest).toBe(
        sha256(JSON.stringify(before.semanticTask.dispatch?.terminalResult)),
      )
      expect(before.semanticTask.terminalDigest).not.toBe(
        before.semanticTask.resultDigest,
      )
      expect(before.semanticTask.resultPath).toMatch(/result\.json/)
      expect(before.semanticTask.dispatch?.terminalResult).toMatchObject({
        status: 'completed',
        outcome: 'PASS',
      })
      expect(before.revisionTask.dispatch?.terminalResult).toMatchObject({
        status: 'completed',
        declaration: { status: 'APPLIED' },
      })
      expect(before.bundle.taskIds).toEqual([
        before.revisionTask.taskId,
        before.semanticTask.taskId,
      ])
      const ready = before.readyState
      expect(before.readyBundle.taskIds).toContain(before.semanticTask.taskId)
      const readySemanticTask = ready.tasks.find(
        (task): task is FoundationRevisionSemanticRecheckTask =>
          task.taskId === before.semanticTask.taskId &&
          task.kind === 'semantic-recheck',
      )
      expect(readySemanticTask).toMatchObject({
        kind: 'semantic-recheck',
        resultDigest: before.semanticTask.resultDigest,
        terminalDigest: before.semanticTask.terminalDigest,
      })
      expect(readySemanticTask?.dispatch?.terminalResult).toEqual(
        before.semanticTask.dispatch?.terminalResult,
      )
      expect(readySemanticTask?.resultPath).toBe(before.semanticTask.resultPath)
      expect(ready.status).toBe('revision_ready')
      expect(ready.issueSummary).toEqual({
        total: 0,
        blocker: 0,
        high: 0,
        medium: 0,
        low: 0,
      })
      expect(ready.roundBefore?.documentRevision).toBe(before.preRevision)
      expect(ready.roundBefore?.issueAuthority).toEqual({
        kind: 'review',
        reviewDigest: before.preReview.reviewDigest,
        issueRegistryDigest: before.preReview.digests.issueRegistry,
      })
      expect(before.publication.baseRevision).toBe(before.preRevision)
      expect(before.bundle.baseDocumentRevision).toBe(before.preRevision)
      expect(before.readyBundle.baseDocumentRevision).toBe(before.preRevision)
      expect(ready.authority?.issueAuthority).toEqual({
        kind: 'publication',
        baseRevision: before.publication.baseRevision,
        authorityDigest: before.publication.authorityDigest,
        issueRegistryDigest: before.publication.resultingIssueRegistryDigest,
      })
      const readyDerived = ready.derived
      if (!readyDerived)
        throw new Error('revision-ready derived evidence is missing')
      expect(ready.publication).toEqual({
        preparedPath: expect.stringContaining('/revision/PREPARED.json'),
        journalPath: expect.stringContaining('/revision/JOURNAL.json'),
        committedPath: expect.stringContaining('/revision/COMMITTED.json'),
        authorityDigest: before.publication.authorityDigest,
        resultingRevision: before.publication.resultingRevision,
        resultingIssueRegistryDigest:
          before.publication.resultingIssueRegistryDigest,
      })
      expect(readyDerived.manifestPath).toBe(
        `.beegame/audit/foundation/${before.publication.resultingRevision}/derived/manifest.json`,
      )
      expect(readyDerived.markerPath).toBe(
        `.beegame/audit/foundation/${before.publication.resultingRevision}/derived/COMMITTED.json`,
      )
      expect(readyDerived.factStorePath).toBe(
        `.beegame/audit/foundation/${before.publication.resultingRevision}/derived/fact-store.json`,
      )
      expect(readyDerived.sectionIndexPath).toBe(
        `.beegame/audit/foundation/${before.publication.resultingRevision}/derived/section-index.json`,
      )
      expect(readyDerived).toMatchObject({
        manifestDigest: ready.authority?.derivedDigests.manifest,
        factStoreDigest: ready.authority?.derivedDigests.factStore,
        sectionIndexDigest: ready.authority?.derivedDigests.sectionIndex,
      })
      const receipt = projectFoundationReadyReceipt({
        state: ready,
        projectId: 'project-issue',
        confirmedBriefDigest: sha256('{"game":"bee"}'),
      })
      const request = parseGameIrCompileRequest({
        schemaVersion: 'game-ir-compile-request.v1',
        taskId: 'foundation-issue.compile',
        publicationId: 'foundation-issue.publication',
        gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
        foundation: receipt,
      })
      expect(receipt.authority).toEqual({
        kind: 'revision_publication',
        baseRevision: before.publication.baseRevision,
        authorityDigest: before.publication.authorityDigest,
        issueRegistryDigest: before.publication.resultingIssueRegistryDigest,
      })
      expect(receipt.foundationRevision).toBe(
        before.publication.resultingRevision,
      )
      expect(receipt.documentDigests).toEqual(
        before.publication.documentDigests as Record<
          FoundationDocumentPath,
          string
        >,
      )
      expect(receipt.sectionIndexDigest).toBe(
        before.readyState.sectionIndexDigest,
      )
      expect(request.foundation).toEqual(receipt)

      const publicationCommittedPath = join(
        workspacePath,
        before.publication.committedPath,
      )
      const publicationCommittedBytes = await readFile(publicationCommittedPath)
      await rm(publicationCommittedPath)
      await expect(
        loadCommittedFoundationRevisionAuthority({
          workspacePath,
          revision: before.publication.baseRevision,
        }),
      ).rejects.toThrow(/committed|publication|authority/i)
      await writeFile(publicationCommittedPath, publicationCommittedBytes)
      await expect(
        loadCommittedFoundationRevisionAuthority({
          workspacePath,
          revision: before.publication.baseRevision,
        }),
      ).resolves.toEqual(before.publication)
      const staleDigest = '0'.repeat(64)
      const sectionIndexPath = join(
        workspacePath,
        readyDerived.sectionIndexPath,
      )
      const sectionIndexBytes = await readFile(sectionIndexPath, 'utf8')
      const sectionIndex = JSON.parse(sectionIndexBytes) as {
        digest?: unknown
        [key: string]: unknown
      }
      expect(sectionIndex.digest).toBe(readyDerived.sectionIndexDigest)
      sectionIndex.digest = staleDigest
      await writeFile(
        sectionIndexPath,
        `${JSON.stringify(sectionIndex, null, 2)}\n`,
      )
      await expect(
        loadCommittedFoundationDerivedArtifacts({
          workspacePath,
          revision: ready.revision,
        }),
      ).rejects.toThrow(
        'committed foundation derived artifact binding is invalid',
      )
      await writeFile(sectionIndexPath, sectionIndexBytes)
      await expect(
        loadCommittedFoundationDerivedArtifacts({
          workspacePath,
          revision: ready.revision,
        }),
      ).resolves.toBeDefined()
      await expect(
        loadFoundationSemanticReview({
          workspacePath,
          revision: before.preRevision,
          reviewDigest: staleDigest,
        }),
      ).rejects.toThrow(/review|publication|digest|missing/i)
      expect(() =>
        parseFoundationAuditState({
          ...ready,
          authority: {
            ...ready.authority!,
            issueAuthority: {
              ...ready.authority!.issueAuthority,
              authorityDigest: staleDigest,
            },
          },
        }),
      ).toThrow(
        'published foundation state must bind the resulting revision and exact publication authority',
      )
      expect(JSON.stringify([...issueDocuments])).toBe(beforeDocuments)
      await writeDocuments(secondWorkspacePath, issueDocuments)
      const after = await controllerIssuePlan(fixture, secondWorkspacePath)
      expect(after.identity).toEqual(before.identity)
      expect(after.publication).toEqual(before.publication)
      expect(after.publication.resultingIssues).toEqual(
        before.publication.resultingIssues,
      )
      expect(after.revisionTask.packetDigest).toBe(
        before.revisionTask.packetDigest,
      )
      expect(after.semanticTask.resultDigest).toBe(
        before.semanticTask.resultDigest,
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
      await rm(secondWorkspacePath, { recursive: true, force: true })
    }
  })

  test('AST boundary scan catches real imports/routes but ignores comments and strings', () => {
    expect(
      forbiddenSyntax(
        "import { x } from './game-ir/model'; const state = GAME_IR_COMPILATION; const old = gameIrState",
      ),
    ).toEqual([
      'import:./game-ir/model',
      'identifier:GAME_IR_COMPILATION',
      'identifier:gameIrState',
    ])
    expect(forbiddenSyntax("void import('./game-ir/publication')")).toEqual([
      'dynamic-import:./game-ir/publication',
    ])
    expect(
      forbiddenSyntax(
        "export { x } from './game-ir/model'; import x = require('./game-ir/model'); const y = require('./game-ir/model')",
      ),
    ).toEqual([
      'export:./game-ir/model',
      'import-equals:./game-ir/model',
      'require:./game-ir/model',
    ])
    expect(
      forbiddenSyntax(
        "// import './game-ir/model'\nconst text = 'GAME_IR_COMPILATION gameIrState'; /* import('./game-ir') */",
      ),
    ).toEqual([])
    expect(
      forbiddenSyntax(
        'const object = { GameIrState: "x" }; const value = object.GameIrState; const run = { gameIrState: value }; const config = { enableGameIr: true }',
      ),
    ).toEqual([
      'identifier:GameIrState',
      'identifier:GameIrState',
      'identifier:gameIrState',
      'identifier:enableGameIr',
    ])
    const violations = productionSources().flatMap(path =>
      forbiddenSyntax(readFileSync(path, 'utf8')).map(
        item => `${path}:${item}`,
      ),
    )
    expect(violations).toEqual([])
  })
})
