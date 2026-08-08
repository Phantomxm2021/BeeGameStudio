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
      workerType: 'resource-content-author',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision',
      contract: {},
    }
    const prompt = buildWorkerPrompt(request)
    expect(prompt).toContain('JSON')
    expect(prompt).toContain('YAML')
    expect(prompt).toContain('engine-neutral JSON/YAML documents')
    expect(prompt).toContain('JSON owns only contract.jsonKinds')
    expect(prompt).toContain('YAML owns only contract.yamlKinds')
    expect(prompt).toContain('contract.requiredRequirementIds')
    expect(prompt).toContain('contract.verifiedResourceIds')
    expect(prompt).toContain('browse the Catalog')
    expect(prompt).toContain('CommitResourceContent exactly once')
    expect(prompt).toContain(
      'The only available tools for this worker are Read and CommitResourceContent',
    )
    expect(prompt).toContain(
      'Never call Write, Edit, MultiEdit, NotebookEdit, Bash, or any other generic',
    )
    expect(prompt).toContain(
      'Do not emit DSML/XML/tool-call markup as text',
    )
    expect(prompt).toContain('Build the submission in memory')
    expect(prompt).toContain(
      'Read only contract.authorityPaths and these exact contract.repairPaths supplied by the workflow boundary',
    )
    expect(prompt).toContain(
      'The CommitResourceContent service reads and preserves protected canonical content',
    )
    expect(prompt).toContain('Do not submit any other path')
  })

  test('projects only readable resource content paths', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'resource-content-author',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision',
      allowedPaths: ['assets/content/'],
      contract: {
        authorityPaths: ['docs/TECHNICAL_DESIGN.md'],
        repairPaths: ['assets/content/ui-configuration.json'],
      },
    })
    expect(prompt).toContain(
      'Allowed paths: docs/TECHNICAL_DESIGN.md, assets/content/ui-configuration.json',
    )
    expect(prompt).not.toContain('assets/content/resource-registry.json')
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
    expect(reviewerPrompt).toContain(
      'referenceId values from contract.referenceIndex.references',
    )
    expect(reviewerPrompt).toContain('never submit subjectOwner')
    expect(reviewerPrompt).toContain('service derives ownership')
    expect(reviewerPrompt).toContain('cannot be resource repair subjects')
    expect(reviewerPrompt).toContain(
      'exactly one accepted SubmitDocumentReviewPacket',
    )
    expect(reviewerPrompt).toContain('a rejected call accepts nothing')
    expect(reviewerPrompt).toContain(
      'Put each check auditable reasoning directly into its criterion derivations',
    )
    expect(reviewerPrompt).toContain('produce a separate transcript')
    expect(reviewerPrompt).toContain(
      'evidence and subjects may reference only artifacts listed for that check',
    )
    expect(reviewerPrompt).toContain(
      'A subject is current content that violates authority',
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
    expect(prompt).toContain(
      'Each assessment contains exactly criterion, status, evidence, derivation and conclusion',
    )
    expect(prompt).toContain(
      'Every evidence or subject entry contains exactly referenceId',
    )
    expect(prompt).toContain(
      'result, note, copied paths and copied anchors are invalid',
    )
  })

  test('keeps immutable review context before the active-check suffix', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision',
      contract: {
        reviewScope: 'foundation',
        reviewMode: 'initial',
        reviewAuthority: {
          confirmedBriefContext: '{"idea":"defend"}',
          confirmedBriefDigest: 'brief-digest',
        },
        reviewArtifacts: [
          { path: 'docs/GDD.md', content: '# Rules\nStable body' },
        ],
        referenceIndex: {
          references: [{ referenceId: 'ref-1', path: 'docs/GDD.md' }],
        },
        currentCheckIds: ['brief_alignment'],
        criteriaByCheck: { brief_alignment: [] },
        priorFindings: [],
      },
    })
    const staticStart = prompt.indexOf('--- BEGIN REVIEW STATIC CONTRACT ---')
    const artifactStart = prompt.indexOf(
      '--- BEGIN REVIEW ARTIFACT docs/GDD.md ---',
    )
    const referenceStart = prompt.indexOf(
      '--- BEGIN REVIEW REFERENCE INDEX ---',
    )
    const activeStart = prompt.indexOf('--- BEGIN REVIEW ACTIVE PACKET ---')
    expect(staticStart).toBeGreaterThan(-1)
    expect(artifactStart).toBeGreaterThan(staticStart)
    expect(referenceStart).toBeGreaterThan(artifactStart)
    expect(activeStart).toBeGreaterThan(referenceStart)
    expect(prompt.slice(staticStart, activeStart)).not.toContain(
      '"currentCheckIds"',
    )
    expect(prompt.slice(activeStart)).toContain('brief_alignment')
    expect(prompt.slice(activeStart)).toContain('"criteriaByCheck"')
    expect(prompt).toContain('"confirmedBriefContext":{"idea":"defend"}')
  })

  test('projects only relevant open findings into the active Reviewer packet', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision',
      contract: {
        reviewScope: 'foundation',
        reviewMode: 'closure',
        reviewAuthority: {
          confirmedBriefContext: '{"idea":"defend"}',
          confirmedBriefDigest: 'brief-digest',
        },
        reviewArtifacts: [
          { path: 'docs/GDD.md', content: '# Rules\nStable body' },
        ],
        referenceIndex: { references: [] },
        currentCheckIds: ['brief_alignment'],
        criteriaByCheck: { brief_alignment: [] },
        artifactPathsByCheck: {
          brief_alignment: ['docs/GDD.md'],
        },
        priorFindings: [
          {
            findingId: 'visible-open',
            checkId: 'brief_alignment',
            open: true,
            subjects: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          },
          {
            findingId: 'hidden-closed',
            checkId: 'brief_alignment',
            open: false,
            subjects: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          },
          {
            findingId: 'hidden-unrelated',
            checkId: 'resource_semantic_fitness',
            open: true,
            subjects: [
              { path: 'assets/asset-manifest.json', anchor: '/requirements' },
            ],
          },
        ],
      },
    })
    expect(prompt).toContain('visible-open')
    expect(prompt).not.toContain('hidden-closed')
    expect(prompt).not.toContain('hidden-unrelated')
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
    expect(prompt).toContain(
      'reject acquisition profiles that encode composition or runtime duties as source-intrinsic capabilities',
    )
    expect(prompt).toContain(
      'three additions in two serial packets: resource_semantic_fitness, then content_structure_fitness with resource_content_consistency',
    )
  })

  test('keeps resource remediation inside the same Curator task', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision',
      contract: {
        remediation: {
          kind: 'document_review',
          findings: [{ findingId: 'resource-finding' }],
        },
      },
    })
    expect(prompt).toContain('ResourceLibrary match_requirements')
    expect(prompt).toContain('CommitResourceInventory exactly once')
    expect(prompt).toContain('resource-finding')
  })

  test('separates resource source profiles from runtime output formats', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'resource-planner',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision',
      contract: {},
    })

    expect(prompt).toContain('structured acquisition_profile')
    expect(prompt).toContain('source-intrinsic')
    expect(prompt).toContain('Composition, placement, scaling, connection, scene assembly and runtime behavior')
    expect(prompt).toContain('runtime-consumable output formats')
    expect(prompt).toContain('Never use target output formats as source-format')
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
    expect(prompt).toContain('CommitCanonicalDocument exactly once')
    expect(prompt).toContain('service owns document_id, version, updated_at')
    expect(prompt).toContain('compact decision contract')
    expect(prompt).toContain('Reference upstream IDs instead of restating')
    expect(prompt).not.toContain(
      'Submit the structured result immediately after all assigned documents are mutated',
    )
    expect(prompt).not.toContain('resolvedFindingIds')
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
        repairPlanTask: {
          groups: [{ findings: [{ findingId: 'finding' }], dependsOn: [] }],
        },
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })
    expect(planningPrompt).toContain('contract.repairPlanTask.groups')
    expect(planningPrompt).toContain('dependsOn')
    expect(planningPrompt).not.toContain('single accepted finding')
    expect(planningPrompt).toContain('complete ordered repair graph')
    expect(planningPrompt).toContain('SubmitDocumentRepairPlan exactly once')
    expect(planningPrompt).toContain('do not write or mutate project files')

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
    expect(ownerPrompt).toContain('CommitCanonicalDocument exactly once')
    expect(ownerPrompt).toContain('service owns metadata')
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

  test('gives Content Author the complete approved fact-owner set', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'resource-content-author',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision',
      contract: {},
    })
    expect(prompt).toContain('contract.authorityPaths')
    expect(prompt).toContain('browse the Catalog')
    expect(prompt).toContain('Plan only the exact writable paths listed above')
    expect(prompt).toContain(
      'validates the merged set before replacing any file',
    )
    expect(prompt).toContain('Do not use generic file mutation tools')
  })
})
