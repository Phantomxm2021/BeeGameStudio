import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, test } from 'bun:test'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../../__tests__/complete-game-document-fixture'
import { withTestDocumentMetadata } from '../../../__tests__/delivery-workflow-test-helpers'
import {
  buildFoundationSectionIndex,
  digestSectionIndex,
  type SectionRef,
} from '../foundation-section-index'
import {
  buildFoundationFactPackets,
  extractNormalizedFoundationFacts,
  mergeFoundationFactResults,
  validateFoundationFactResults,
  type FoundationFactPacket,
} from '../foundation-fact-extraction'
import {
  FOUNDATION_FACT_CATALOG,
  type FoundationFactKey,
} from '../foundation-fact-definitions'
import { runProductionDeterministicFoundationAudit } from '../foundation-audit-production-manifest'
import { compileFoundationIssueRegistry } from '../foundation-audit-check-definitions'
import { analyzeFoundationImpact } from '../foundation-impact-analysis'
import { buildFoundationRevisionBatches } from '../foundation-revision-batches'
import {
  buildFoundationRevisionAuthority,
  type PatchOperation,
} from '../foundation-revision-stage'
import { buildFoundationSemanticRecheckPacket } from '../foundation-patch-validation'
import {
  FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
  admitFoundationSemanticResult,
  buildFoundationSemanticPacket,
  type FoundationSemanticPacket,
} from '../foundation-semantic-audit'
import {
  admitFoundationSemanticTerminal,
  claimFoundationSemanticTasks,
  createFoundationSemanticTaskCollection,
  type FoundationSemanticTask,
} from '../foundation-semantic-runtime'
import {
  createFoundationAuditState,
  parseFoundationAuditState,
  summarizeFoundationIssues,
  type FoundationAuditState,
} from '../foundation-audit-state'
import type { FoundationDocumentPath } from '../types'
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
  sectionIndex: SectionRef[]
  documentDigests: Record<FoundationDocumentPath, string>
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
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
  const documents = fixtureDocuments(name)
  return {
    name,
    revision: `foundation-${name}`,
    documents,
    sectionIndex: buildFoundationSectionIndex({ documents }),
    documentDigests: Object.fromEntries(
      [...documents].map(([path, body]) => [path, sha256(body)]),
    ) as Record<FoundationDocumentPath, string>,
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

function buildFactPlan(fixture: Fixture) {
  const extraction = extractNormalizedFoundationFacts({
    documents: fixture.documents,
    sectionIndex: fixture.sectionIndex,
  })
  const packets = buildFoundationFactPackets({
    revision: fixture.revision,
    documents: fixture.documents,
    sectionIndex: fixture.sectionIndex,
    unresolvedKeys: extraction.unresolvedKeys,
  })
  const workerFacts = packets.flatMap(
    packet =>
      validateFoundationFactResults({
        packet,
        expectedRevision: fixture.revision,
        documents: fixture.documents,
        sectionIndex: fixture.sectionIndex,
        results: factPacketResults(
          packet,
          fixture.documents,
          fixture.sectionIndex,
        ),
      }).facts,
  )
  const factStore = mergeFoundationFactResults({
    mechanicalFacts: extraction.facts,
    workerFacts,
    workerReceipts: packets.flatMap(
      packet =>
        validateFoundationFactResults({
          packet,
          expectedRevision: fixture.revision,
          documents: fixture.documents,
          sectionIndex: fixture.sectionIndex,
          results: factPacketResults(
            packet,
            fixture.documents,
            fixture.sectionIndex,
          ),
        }).receipts,
    ),
  })
  return { extraction, packets, factStore }
}

function buildSemanticPlan(
  fixture: Fixture,
  factStore: ReturnType<typeof buildFactPlan>['factStore'],
  issues: ReturnType<typeof runProductionDeterministicFoundationAudit>,
) {
  const sectionBytes = new Map(
    fixture.sectionIndex.map(section => [
      `${section.documentPath}#${section.sectionId}`,
      sectionText(fixture.documents, section),
    ]),
  )
  const packets = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check =>
    buildFoundationSemanticPacket({
      revision: fixture.revision,
      checkId: check.checkId,
      sectionIndex: fixture.sectionIndex,
      sectionBytes,
      factStore,
      deterministicIssuePrefix: issues,
      deterministicReviewDigest: sha256(`${fixture.revision}:deterministic`),
    }),
  )
  const tasks = packets.map(
    (packet, index): FoundationSemanticTask => ({
      taskId: `${fixture.revision}.semantic.${index}`,
      kind: 'semantic',
      revision: fixture.revision,
      checkId: packet.checkId,
      packetDigest: packet.identity,
      modelTier: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks[index]!.modelTier,
      status: 'pending',
      attempt: 0,
    }),
  )
  return {
    packets,
    tasks: createFoundationSemanticTaskCollection({
      revision: fixture.revision,
      phaseStartedAt: PHASE_STARTED_AT,
      tasks,
    }),
  }
}

function completeSemanticState(
  tasks: ReturnType<typeof buildSemanticPlan>['tasks'],
  packets: readonly FoundationSemanticPacket[],
) {
  let state = tasks
  const results = new Map(
    packets.map(packet => [
      packet.checkId,
      admitFoundationSemanticResult(packet, {
        checkId: packet.checkId,
        packetIdentity: packet.identity,
        outcome: 'PASS',
      }),
    ]),
  )
  while (state.tasks.some(task => task.status === 'pending')) {
    state = claimFoundationSemanticTasks(state, {
      now: PHASE_STARTED_AT,
      configuredTiers: { fast: true, balanced: true },
      dispatchIdFor: task => `${task.taskId}.dispatch`,
    })
    for (const task of state.tasks.filter(item => item.status === 'running')) {
      const terminal = {
        workerType: 'foundation-semantic-reviewer' as const,
        status: 'completed' as const,
        runId: `${task.taskId}.run`,
        dispatchId: task.dispatch!.dispatchId,
        taskId: task.taskId,
        revision: task.revision,
        packetDigest: task.packetDigest,
        outcome: 'PASS' as const,
      }
      state = admitFoundationSemanticTerminal(state, {
        taskId: task.taskId,
        dispatchId: task.dispatch!.dispatchId,
        revision: task.revision,
        packetDigest: task.packetDigest,
        terminal,
        usage: {
          input_tokens: 0,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        durationMs: 0,
        now: PHASE_STARTED_AT,
      }).state
    }
  }
  return {
    ...state,
    tasks: state.tasks.map(task => ({
      ...task,
      admittedResult: results.get(task.checkId),
    })),
  }
}

function readyState(
  fixture: Fixture,
  semantic: ReturnType<typeof completeSemanticState>,
  factStore: ReturnType<typeof buildFactPlan>['factStore'],
  issues: readonly unknown[],
): FoundationAuditState {
  const indexDigest = digestSectionIndex(fixture.sectionIndex)
  const factDigest = sha256(JSON.stringify(factStore))
  const issueDigest = sha256(JSON.stringify(issues))
  const derivedRoot = `.beegame/audit/foundation/${fixture.revision}/derived`
  const reviewDigest = sha256(`${fixture.revision}:review:${issueDigest}`)
  const base = createFoundationAuditState({
    revision: fixture.revision,
    documentDigests: CANONICAL_PATHS.map(path => ({
      path,
      digest: fixture.documentDigests[path]!,
    })),
    manifest: {
      revision: fixture.revision,
      status: 'index_staged',
      catalogVersion: 'foundation-facts.v2',
      sectionIndexDigest: indexDigest,
    },
  })
  return parseFoundationAuditState({
    ...base,
    status: 'audit_ready',
    phaseStartedAt: PHASE_STARTED_AT,
    tasks: semantic.tasks,
    derived: {
      manifestPath: `${derivedRoot}/manifest.json`,
      manifestDigest: sha256(`${fixture.revision}:manifest`),
      markerPath: `${derivedRoot}/COMMITTED.json`,
      markerDigest: sha256(`${fixture.revision}:marker`),
      factStorePath: `${derivedRoot}/fact-store.json`,
      factStoreDigest: factDigest,
      sectionIndexPath: `${derivedRoot}/section-index.json`,
      sectionIndexDigest: indexDigest,
    },
    deterministic: {
      reviewDigest: issueDigest,
      issueRegistryPath: `.beegame/audit/foundation/${fixture.revision}/staging/review/issue-registry.json`,
      issueRegistryDigest: issueDigest,
      manifestPath: `.beegame/audit/foundation/${fixture.revision}/staging/review/manifest.json`,
      manifestDigest: sha256(`${fixture.revision}:manifest`),
      markerPath: `.beegame/audit/foundation/${fixture.revision}/staging/review/COMMITTED.json`,
      markerDigest: sha256(`${fixture.revision}:marker`),
      catalogVersion: 'foundation-facts.v2',
      contractGraphDigest: sha256(`${fixture.revision}:contracts`),
      sectionIndexDigest: indexDigest,
      factStoreDigest: factDigest,
    },
    semantic: { aggregateUsage: semantic.aggregateUsage },
    review: {
      reviewDigest,
      issueRegistryPath: `.beegame/audit/foundation/${fixture.revision}/review/${reviewDigest}/issue-registry.json`,
      issueRegistryDigest: issueDigest,
      manifestPath: `.beegame/audit/foundation/${fixture.revision}/review/${reviewDigest}/manifest.json`,
      manifestDigest: sha256(`${fixture.revision}:review-manifest`),
      markerPath: `.beegame/audit/foundation/${fixture.revision}/review/${reviewDigest}/COMMITTED.json`,
      markerDigest: sha256(`${fixture.revision}:review-marker`),
      sectionIndexDigest: indexDigest,
      factStoreDigest: factDigest,
      semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest,
      issueSummary: summarizeFoundationIssues(issues as never[]),
    },
  })
}

function foundationPlan(fixture: Fixture) {
  const fact = buildFactPlan(fixture)
  const issues = runProductionDeterministicFoundationAudit({
    sectionIndex: fixture.sectionIndex,
    factStore: fact.factStore,
  })
  const semantic = buildSemanticPlan(fixture, fact.factStore, issues)
  const completedSemantic = completeSemanticState(
    semantic.tasks,
    semantic.packets,
  )
  const state = readyState(fixture, completedSemantic, fact.factStore, issues)
  return {
    factPackets: fact.packets,
    factStore: fact.factStore,
    issueRegistry: issues,
    semanticPackets: semantic.packets,
    semanticTasks: semantic.tasks,
    readyState: state,
    readyInputs: {
      revision: state.revision,
      documentDigests: state.documentDigests,
      sectionIndexDigest: state.sectionIndexDigest,
      issueSummary: state.review?.issueSummary,
    },
  }
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

async function issuePlan(fixture: Fixture, workspacePath: string) {
  const sectionIndex = buildFoundationSectionIndex({
    documents: fixture.documents,
  })
  const fact = buildFactPlan({ ...fixture, sectionIndex })
  const productionIssues = runProductionDeterministicFoundationAudit({
    sectionIndex,
    factStore: fact.factStore,
  })
  if (productionIssues.length === 0)
    throw new Error('issue fixture did not produce a deterministic issue')
  const source = sectionIndex.find(
    section =>
      section.documentPath === 'docs/ASSET_PLAN.md' &&
      section.sectionId === 'inventory',
  )!
  const issues = compileFoundationIssueRegistry({
    sectionIndex,
    factStore: fact.factStore,
    drafts: [
      {
        checkId: 'fixture.boss-count',
        severity: 'HIGH',
        type: 'semantic',
        source,
        expected: 'asset boss count agrees with the GDD',
        actual: 'asset boss count intentionally diverges from the GDD',
        remediation: {
          kind: 'patch',
          documentPath: source.documentPath,
          sectionIds: ['inventory'],
        },
        conflictIdentity: { fixture: fixture.name, source: source.digest },
      },
    ],
  })
  const batches = buildFoundationRevisionBatches({
    issues,
    registry: {
      validated: true,
      section: (documentPath, sectionId) =>
        sectionIndex.find(
          section =>
            section.documentPath === documentPath &&
            section.sectionId === sectionId,
        ),
    },
  })
  const batch = batches[0]!
  const authority = await buildFoundationRevisionAuthority({
    workspacePath,
    revision: `${fixture.revision}.issue`,
    taskId: `${fixture.revision}.revision.0`,
    round: 1,
    batch,
    issues,
    sourceAuthorityDigest: sha256(`${fixture.revision}:authority`),
    sourceIssueRegistryDigest: sha256(JSON.stringify(issues)),
    sourceDerivedDigests: {
      sectionIndex: digestSectionIndex(sectionIndex),
      factStore: sha256(JSON.stringify(fact.factStore)),
      manifest: sha256(`${fixture.revision}:manifest`),
    },
    sourceDocumentDigests: CANONICAL_PATHS.map(path => ({
      path,
      digest: fixture.documentDigests[path]!,
    })),
    normalizedFacts: fact.factStore,
  })
  const changed = sectionIndex.find(
    section =>
      section.documentPath === batch.documentPath &&
      section.sectionId === batch.sectionIds[0],
  )!
  const operation: PatchOperation = {
    kind: 'REPLACE',
    documentPath: changed.documentPath,
    sectionId: changed.sectionId,
    issueIds: batch.issueIds,
    beforeDigest: authority.baseDocumentDigest,
    afterDigest: changed.digest,
  }
  const targeted = buildFoundationSemanticRecheckPacket({
    issue: issues[0]!,
    patchOperation: operation,
    sectionIndex,
    documents: fixture.documents,
    impact: analyzeFoundationImpact([operation]),
    factStore: fact.factStore,
  })
  return { issueRegistry: issues, batches, authority, targeted }
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
  const routeNames = new Set(['GAME_IR_COMPILATION', 'gameIrState'])
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /(?:^|\/)game-ir(?:\/|$)/.test(node.moduleSpecifier.text)
    )
      violations.push(`import:${node.moduleSpecifier.text}`)
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      /(?:^|\/)game-ir(?:\/|$)/.test(node.arguments[0].text)
    )
      violations.push(`dynamic-import:${node.arguments[0].text}`)
    if (ts.isIdentifier(node) && routeNames.has(node.text))
      violations.push(`route:${node.text}`)
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

  test('runs real complete-document Foundation planning around the strict READY boundary', () => {
    for (const fixture of [makeFixture('rules'), makeFixture('scene')]) {
      const beforeDocuments = JSON.stringify([...fixture.documents])
      const before = foundationPlan(fixture)
      const beforeState = JSON.stringify(before.readyState)
      const receipt = projectFoundationReadyReceipt({
        state: before.readyState,
        projectId: `project-${fixture.name}`,
        confirmedBriefDigest: sha256(`${fixture.name}:brief`),
      })
      const request = parseGameIrCompileRequest({
        schemaVersion: 'game-ir-compile-request.v1',
        taskId: `${fixture.revision}.compile`,
        publicationId: `${fixture.revision}.publication`,
        gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
        foundation: receipt,
      })
      expect(request.foundation).toEqual(receipt)
      expect(
        projectFoundationReadyReceipt({
          state: before.readyState,
          projectId: `project-${fixture.name}`,
          confirmedBriefDigest: sha256(`${fixture.name}:brief`),
        }),
      ).toEqual(receipt)
      expect(JSON.stringify([...fixture.documents])).toBe(beforeDocuments)
      expect(JSON.stringify(before.readyState)).toBe(beforeState)
      const after = foundationPlan(fixture)
      expect(after).toEqual(before)
      expect(JSON.stringify([...fixture.documents])).toBe(beforeDocuments)
      expect(JSON.stringify(after.readyState)).toBe(beforeState)
      expect(request.foundation.documentDigests).toEqual(
        fixture.documentDigests,
      )
      expect(request.foundation.sectionIndexDigest).toBe(
        digestSectionIndex(fixture.sectionIndex),
      )
    }
  })

  test('keeps real issue registry, revision authority, batches, and targeted recheck stable across READY parsing', async () => {
    const fixture = makeFixture('issue')
    const workspacePath = await mkdtemp(join('/tmp', 'game-ir-parity-'))
    try {
      await writeDocuments(workspacePath, fixture.documents)
      const beforeDocuments = JSON.stringify([...fixture.documents])
      const before = await issuePlan(fixture, workspacePath)
      const ready = foundationPlan(makeFixture('rules')).readyState
      const readyStateBytes = JSON.stringify(ready)
      const receipt = projectFoundationReadyReceipt({
        state: ready,
        projectId: 'project-issue',
        confirmedBriefDigest: sha256('issue:brief'),
      })
      parseGameIrCompileRequest({
        schemaVersion: 'game-ir-compile-request.v1',
        taskId: 'foundation-issue.compile',
        publicationId: 'foundation-issue.publication',
        gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
        foundation: receipt,
      })
      expect(JSON.stringify([...fixture.documents])).toBe(beforeDocuments)
      expect(JSON.stringify(ready)).toBe(readyStateBytes)
      const after = await issuePlan(fixture, workspacePath)
      expect(after).toEqual(before)
      expect(after.authority.packetDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(after.targeted.packetDigest).toMatch(/^[a-f0-9]{64}$/)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('AST boundary scan catches real imports/routes but ignores comments and strings', () => {
    expect(
      forbiddenSyntax(
        "import { x } from './game-ir/model'; const state = GAME_IR_COMPILATION; const old = gameIrState",
      ),
    ).toEqual([
      'import:./game-ir/model',
      'route:GAME_IR_COMPILATION',
      'route:gameIrState',
    ])
    expect(forbiddenSyntax("void import('./game-ir/publication')")).toEqual([
      'dynamic-import:./game-ir/publication',
    ])
    expect(
      forbiddenSyntax(
        "// import './game-ir/model'\nconst text = 'GAME_IR_COMPILATION gameIrState'; /* import('./game-ir') */",
      ),
    ).toEqual([])
    const violations = productionSources().flatMap(path =>
      forbiddenSyntax(readFileSync(path, 'utf8')).map(
        item => `${path}:${item}`,
      ),
    )
    expect(violations).toEqual([])
  })
})
