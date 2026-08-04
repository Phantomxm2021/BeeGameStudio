import { describe, expect, test } from 'bun:test'
import { buildWorkerPrompt } from './worker-prompts'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import type { WorkerDispatchRequest } from './types'

describe('resource-content worker prompts', () => {
  test('instructs one JSON/YAML resource lane', () => {
    const request: WorkerDispatchRequest = {
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision',
      contract: {},
    }
    const prompt = buildWorkerPrompt(request)
    expect(prompt).toContain('JSON')
    expect(prompt).toContain('YAML')
    expect(prompt).toContain('schema-valid JSON/YAML content files')
    expect(prompt).toContain('events, waves and numeric configuration as JSON')
    expect(prompt).toContain(
      'world, scene, hierarchy and instance placement as YAML',
    )
    expect(prompt).toContain('event-definitions, wave-definitions')
    expect(prompt).toContain('fulfills contains only exact requirement IDs')
    expect(prompt).toContain('reference every Manifest resource ID')
    expect(prompt).toContain('shell and nested agents are not available')
    expect(prompt).toContain('AssetManifest author_provisional_resources')
    expect(prompt).toContain('Use scoped Write only for JSON/YAML content')
    expect(prompt).toContain('Never retry or invent Bash')
    expect(prompt).toContain('never hand-author runtime files')
  })

  test('requires authors and reviewers to keep one resource loading path', () => {
    const authorPrompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      contract: {
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/GDD.md',
        upstreamDocumentPaths: [],
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })
    expect(authorPrompt).toContain('exactly one resource loading path')
    expect(authorPrompt).toContain(
      'Never specify a fallback after the placeholder',
    )
    expect(authorPrompt).toContain('contract.systemDeliveryContract')
    expect(authorPrompt).toContain('assets/asset-manifest.json')
    expect(authorPrompt).toContain('beegame-content-v1')

    const reviewerPrompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision',
      contract: { reviewScope: 'foundation', reviewMode: 'initial' },
    })
    expect(reviewerPrompt).toContain('technical_feasibility')
    expect(reviewerPrompt).toContain(
      'never a runtime/source substitute or second loader',
    )
    expect(reviewerPrompt).toContain(
      'project documents that agree with each other but conflict with systemDeliveryContract',
    )
    expect(reviewerPrompt).toContain(
      'fulfills may contain only exact current Manifest requirement IDs',
    )
    expect(reviewerPrompt).toContain(
      'never request document names, headings, prose labels or invented duty IDs',
    )
    expect(reviewerPrompt).toContain('referenceId values from contract.referenceIndex.references')
    expect(reviewerPrompt).toContain('subject reference must declare the owner')
    expect(reviewerPrompt).toContain('cannot be resource repair subjects')
    expect(reviewerPrompt).toContain(
      'exactly one accepted SubmitDocumentReviewCheck',
    )
    expect(reviewerPrompt).toContain(
      'A rejected call is not accepted',
    )
    expect(reviewerPrompt).toContain(
      'Put its auditable reasoning directly into criterion derivations',
    )
    expect(reviewerPrompt).toContain(
      'produce a separate transcript',
    )
    expect(reviewerPrompt).toContain(
      'Evidence and subjects must use only stable referenceId values',
    )
    expect(reviewerPrompt).toContain(
      'Subjects are exactly what requiredAction must change',
    )
  })

  test('requires structured strategy, economy, numeric and pacing derivations', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision',
      contract: { reviewScope: 'foundation', reviewMode: 'initial' },
    })
    expect(prompt).toContain('gameplay_strategy_viability')
    expect(prompt).toContain('economy_progression_integrity')
    expect(prompt).toContain('numeric_balance_feasibility')
    expect(prompt).toContain('pacing_difficulty_coherence')
    expect(prompt).toContain('level_scene_design_integrity')
    expect(prompt).toContain('spatial_gameplay_support')
    expect(prompt).toContain('scene_state_completeness')
    expect(prompt).toContain('Use only cited document facts')
    expect(prompt).toContain('not final feel or empirical balance')
  })

  test('routes complete-review defects to the artifact owner without duplicate findings', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision',
      contract: { reviewScope: 'complete', reviewMode: 'initial' },
    })
    expect(prompt).toContain(
      'every defect whose repair target is the Manifest or JSON/YAML content belongs to',
    )
    expect(prompt).toContain(
      'Do not duplicate one content or resource defect under a foundation check',
    )
  })

  test('keeps resource remediation on the single replacement and pruning lane', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision',
      contract: {
        remediation: {
          kind: 'document_review',
          findings: [{ findingId: 'resource-finding' }],
        },
      },
    })
    expect(prompt).toContain('same replacement commit')
    expect(prompt).toContain('prune_unbound_resources')
    expect(prompt).toContain('resource ID is not a requirement ID')
  })

  test('assigns one initial foundation document while retaining fact ownership', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      contract: {
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/GDD.md',
        upstreamDocumentPaths: [],
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })
    expect(prompt).toContain('Author exactly docs/GDD.md')
    expect(prompt).toContain('attempt to finish the eight-document pass')
    expect(prompt).toContain('Initial Reviewer owns feasibility assessment')
    expect(prompt).toContain('BALANCE_DESIGN owns')
    expect(prompt).toContain('LEVEL_SCENE_DESIGN owns')
    expect(prompt).toContain('Events, waves and numeric configuration')
    expect(prompt).toContain('world, scene, hierarchy and instance placement')
    expect(prompt).toContain('exactly once as the only mutation')
    expect(prompt).toContain('Follow the projected target-state instruction')
    expect(prompt).toContain('compact decision contract')
    expect(prompt).toContain('Reference upstream IDs instead of restating')
    expect(prompt).not.toContain(
      'Submit the structured result immediately after all assigned documents are mutated',
    )
    expect(prompt).not.toContain(
      'Call SubmitDocumentAuthorResult exactly once with resolvedFindingIds: []',
    )
  })

  test('keeps initial numeric authoring separate from review and repair calculation', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      contract: {
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/BALANCE_DESIGN.md',
        upstreamDocumentPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })
    expect(prompt).toContain('smallest decision-level authority')
    expect(prompt).toContain('Do not perform reviewer work')
    expect(prompt).toContain('run full wave/build simulations')
    expect(prompt).toContain('Initial Reviewer owns feasibility assessment')
    expect(prompt).toContain('Do not simulate builds or waves')
    expect(prompt).toContain('The Initial Reviewer owns those comparisons')
    expect(prompt).not.toContain(
      'Document enough authoritative game-design facts to audit strategy',
    )
  })

  test('separates read-only repair planning from one-document owner repair', () => {
    const planningPrompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      contract: {
        documentSet: 'foundation',
        authoringMode: 'repair-planning',
        repairDecisionTask: { finding: { findingId: 'finding' } },
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })
    expect(planningPrompt).toContain('contract.repairDecisionTask.finding')
    expect(planningPrompt).toContain('service owns its identity, subjects, order')
    expect(planningPrompt).toContain('SubmitDocumentRepairDecision exactly once')
    expect(planningPrompt).toContain('Do not write or mutate project files')

    const ownerPrompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'remediation',
        foundationDocumentPath: 'docs/GDD.md',
        repairTask: { groups: [], findings: [] },
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })
    expect(ownerPrompt).toContain('Repair exactly docs/GDD.md')
    expect(ownerPrompt).toContain('locked decisions')
    expect(ownerPrompt).toContain('resolvedFindingIds: []')
  })

  test('keeps the checklist minimal and scenario-level', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      contract: { documentSet: 'checklist' },
    })
    expect(prompt).toContain('Target 24-40 checkbox tasks')
    expect(prompt).toContain('Before the only file mutation')
    expect(prompt).toContain('never exceed 64 checkbox tasks')
    expect(prompt).toContain(
      'do not create one task per document sentence or variant',
    )
    expect(prompt).toContain('Never write an oversized draft')
  })

  test('gives resource production the complete approved fact-owner set', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision',
      contract: {},
    })
    expect(prompt).toContain('complete eight-document approved Foundation set')
    expect(prompt).toContain('Respect its fact owners')
    expect(prompt).toContain('Do not read unapproved or parallel documents')
    expect(prompt).toContain('Plan the complete JSON/YAML file set')
    expect(prompt).toContain('one parallel tool batch')
    expect(prompt).toContain('only for a specific failed write')
  })
})
