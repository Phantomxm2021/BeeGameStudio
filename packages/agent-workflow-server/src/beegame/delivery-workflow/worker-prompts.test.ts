import { describe, expect, test } from 'bun:test'
import { buildWorkerPrompt } from './worker-prompts'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import { getGameDocumentContract } from './game-document-contracts'
import type { WorkerDispatchRequest } from './types'

describe('resource-content worker prompts', () => {
  test('requires complete structured human-discipline documents', () => {
    const completeDocumentContract = getGameDocumentContract('docs/GDD.md')
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      contract: {
        confirmedBriefContext: '{"idea":"authoritative idea"}',
        confirmedBriefDigest: 'brief-digest',
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/GDD.md',
        upstreamDocumentPaths: [],
        completeDocumentContract,
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })

    expect(prompt).toContain('complete and production-usable when the turn ends')
    expect(prompt).toContain('human development discipline')
    for (const section of completeDocumentContract.sections)
      expect(prompt).toContain(`"sectionId":"${section.sectionId}"`)
    expect(prompt).not.toContain('smallest decision-level authority')
    expect(prompt).not.toContain('compact decision contract')
    expect(prompt).not.toContain('Initial Reviewer owns')
    expect(prompt).not.toContain('one complete native write')
    expect(prompt).not.toContain('authoritative idea')
    expect(prompt).toContain('"confirmedBriefDigest":"brief-digest"')
    expect(prompt).not.toContain(
      'one contract section per native file operation',
    )
    expect(prompt).not.toContain('12 KiB')
    expect(prompt).not.toContain('four to six bounded native Write/Edit operations')
    expect(prompt).not.toContain('efficiency guidance, not a tool restriction')
    expect(prompt).not.toContain(
      'Do not buffer the complete document inside one file-tool argument',
    )
    expect(prompt).not.toContain('Create the target early')
    expect(prompt).not.toContain(
      'The first file mutation must persist the title and one coherent production-ready portion',
    )
    expect(prompt).not.toContain(
      'must not attempt to carry the complete document body',
    )
    expect(prompt).not.toContain('BGS does not prescribe sections')
    expect(prompt).not.toContain('chunk boundaries')
    expect(prompt).not.toContain('You own the read, write, edit, verification')
    expect(prompt).not.toContain(
      'Write the complete assigned Markdown document directly',
    )
    expect(prompt).not.toContain('Write one complete Markdown file')
    expect(prompt).toContain('native file tools')
    expect(prompt).toContain('end the turn normally')
    expect(prompt).not.toContain('verify its final bytes')
    expect(prompt).not.toContain('checkpoint')
    expect(prompt).not.toContain('beegame-draft-cursor')
    expect(prompt).not.toContain('targetNativeReplacementBytes')
    expect(prompt).not.toContain('maxNativeReplacementBytes')
    expect(prompt).not.toContain('first native Write')
    expect(prompt).not.toContain('every Edit must')
    expect(prompt).not.toContain('Finish only the active bounded group')
    expect(prompt).toContain("Bee Game Studio's normal workflow")
    expect(prompt).toContain('BGS writes those results to workflow audit metadata')
    expect(prompt).not.toContain('CommitCanonicalDocument')
    expect(prompt).not.toContain('document_parts_prepared')
    expect(prompt).not.toContain('Do not write or edit the assigned path directly')
    expect(prompt).toContain('Do not claim verified license')
    expect(prompt).not.toContain('choose the operation count, size, and order')
    expect(prompt).not.toContain('Save meaningful progress during long authoring work')
    expect(prompt).not.toContain('one custom payload')
    expect(prompt).not.toContain(
      'End each bounded turn normally after its write succeeds',
    )
    expect(prompt).not.toContain('one final lightweight structural verification')
    expect(prompt).not.toContain('Read all authorized upstream sections')
    expect(prompt).not.toContain('one batched tool round')
    expect(prompt).not.toContain('BGS mechanically inspects any existing target')
    expect(prompt).not.toContain('do not independently reread or reclassify the target')
    expect(prompt).not.toContain('without an intermediate completion message')
    expect(prompt).toContain(
      'Prefer production-dense tables and matrices over repeated narrative',
    )
    expect(prompt).toContain(
      'Do not restate the confirmed brief, upstream text or another section',
    )
    expect(prompt).toContain('exactly one # document title')
    expect(prompt).toContain('canonical structures in order')
    expect(prompt).toContain('## Executive Summary')
    expect(prompt).toContain('Do not author YAML front matter')
    expect(prompt).toContain('BGS injects document_id, version and updated_at')
    expect(prompt).toContain('Do not add an Audit Appendix')
    expect(prompt).not.toContain('handwrite protocol markers')
    for (const material of completeDocumentContract.productionMaterials)
      expect(prompt).toContain(material.materialId)
    expect(prompt).not.toContain('### Authoritative Decisions')
    expect(prompt).not.toContain('### Production Details')
    expect(prompt).not.toContain('No unresolved section decisions.')
    expect(prompt).not.toContain('never reload project files')
    expect(prompt).not.toContain('disable thinking')
    expect(prompt).not.toContain('disable reasoning')
    expect(prompt).not.toContain('disable tools')
    expect(prompt).toContain(
      'Confirmed Brief settings are higher authority than free-form idea text',
    )
    expect(prompt).toContain(
      'do not preserve both sides as simultaneous requirements',
    )
    expect(prompt).not.toContain('Return one Markdown body')
    expect(prompt).toContain('Canonical artifacts: docs/GDD.md')
    expect(prompt).toContain('Writable paths: read-only')
    expect(prompt).not.toContain('Allowed paths:')
    expect(prompt).not.toContain('docs/TECHNICAL_DESIGN.md')
    expect(prompt).not.toContain('docs/ASSET_PLAN.md')
    expect(prompt).not.toContain('"systemDeliveryContract"')
    expect(prompt).not.toContain('assets/asset-manifest.json')
    expect(prompt).not.toContain('"upstreamDocumentPaths"')
    expect(prompt).not.toContain('"allowedUpstreamPaths"')
    expect(prompt).not.toContain('"upstreamSections"')
  })

  test('never forwards native Write limit controls from workflow contracts', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      revision: 'revision',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      contract: {
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/GDD.md',
        completeDocumentContract: getGameDocumentContract('docs/GDD.md'),
        maxNativeWriteContentChars: 12_288,
        nativeWriteLimit: 12_288,
      },
    } as never)

    expect(prompt).not.toContain('maxNativeWriteContentChars')
    expect(prompt).not.toContain('nativeWriteLimit')
    expect(prompt).not.toContain('12288')
  })

  test('keeps draft and calibration prompts inside the native authoring boundary', () => {
    const prompts = (['parallel-draft', 'calibration'] as const).map(
      authoringMode =>
        buildWorkerPrompt({
          runId: 'run',
          ownerId: 'owner',
          projectId: 'project',
          workspacePath: '/workspace',
          workerType: 'document-author',
          phase: 'DOCUMENT_DRAFTING',
          taskId: 'docs/BALANCE_DESIGN.md',
          revision: 'revision',
          allowedPaths: ['docs/BALANCE_DESIGN.md'],
          contract: {
            documentSet: 'foundation',
            authoringMode,
            foundationDocumentPath: 'docs/BALANCE_DESIGN.md',
            availableUpstreamPaths:
              authoringMode === 'parallel-draft'
                ? ['docs/GDD.md']
                : ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
            completeDocumentContract: getGameDocumentContract(
              'docs/BALANCE_DESIGN.md',
            ),
          },
        }),
    )

    expect(prompts[0]).toContain('one complete production-usable discipline document')
    expect(prompts[0]).toContain('genuinely unavailable upstream decisions')
    expect(prompts[1]).toContain('Revise only statements whose authority changed')
    expect(prompts[1]).toContain('limit changes to affected authority')
    for (const prompt of prompts) {
      expect(prompt).not.toContain('checkpoint count')
      expect(prompt).not.toContain('forced Edit')
      expect(prompt).not.toContain('API retry')
      expect(prompt).not.toContain('watchdog')
      expect(prompt).not.toContain('whole-file grep')
      expect(prompt).not.toContain('byte count check')
      expect(prompt).not.toContain('docs/UI_UX_SPEC.md')
    }
  })

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
    expect(prompt).toContain("Bee Game Studio's native tools remain available")
    expect(prompt).toContain('call CommitResourceContent once')
    expect(prompt).toContain(
      'CommitResourceContent is the atomic delivery interface',
    )
    expect(prompt).not.toContain('The only available tools')
    expect(prompt).not.toContain('Never call Write')
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
      'Readable task paths: docs/TECHNICAL_DESIGN.md, assets/content/ui-configuration.json',
    )
    expect(prompt).not.toContain('Allowed paths:')
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
        foundationDocumentPath: 'docs/TECHNICAL_DESIGN.md',
        upstreamDocumentPaths: [
          'docs/GDD.md',
          'docs/LEVEL_SCENE_DESIGN.md',
          'docs/BALANCE_DESIGN.md',
        ],
        completeDocumentContract: getGameDocumentContract(
          'docs/TECHNICAL_DESIGN.md',
        ),
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })
    expect(authorPrompt).toContain('one resource loading path')
    expect(authorPrompt).toContain('contract.systemDeliveryContract')
    expect(authorPrompt).toContain('assets/asset-manifest.json')
    expect(authorPrompt).toContain('beegame-content-v1')
    expect(authorPrompt).toContain(
      'Canonical artifacts: docs/GDD.md, docs/LEVEL_SCENE_DESIGN.md, docs/BALANCE_DESIGN.md, docs/TECHNICAL_DESIGN.md',
    )
    expect(authorPrompt).not.toContain('docs/ART_DIRECTION.md')
    expect(authorPrompt).not.toContain('"upstreamDocumentPaths"')
    expect(authorPrompt).not.toContain('"allowedUpstreamPaths"')
    expect(authorPrompt).not.toContain('"upstreamSections"')

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
    expect(reviewerPrompt).toContain(
      'reject repeated authority prose within one document',
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
    expect(prompt).toContain(
      'Composition, placement, scaling, connection, scene assembly and runtime behavior',
    )
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
        completeDocumentContract: getGameDocumentContract('docs/GDD.md'),
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })
    expect(prompt).toContain('Author exactly docs/GDD.md')
    expect(prompt).toContain('Markdown body is the sole human document authority')
    expect(prompt).toContain(
      'BGS injects document_id, version and updated_at deterministically',
    )
    expect(prompt).toContain('BGS injects document_id, version and updated_at')
    expect(prompt).not.toContain('updated_at set to')
    expect(prompt).toContain('complete human development discipline')
    expect(prompt).toContain('sufficient for a human game development team')
    expect(prompt).toContain('BALANCE_DESIGN owns')
    expect(prompt).toContain('LEVEL_SCENE_DESIGN owns')
    expect(prompt).toContain('Author exactly docs/GDD.md')
    expect(prompt).toContain('You own the native file-operation sequence')
    expect(prompt).toContain('end the turn normally')
    expect(prompt).not.toContain('checkpoint')
    expect(prompt).not.toContain('CommitCanonicalDocument')
    expect(prompt).not.toContain('terminal JSON')
    expect(prompt).not.toContain('then the audit appendix in canonical order')
    expect(prompt).toContain('every production material in canonical order')
    expect(prompt).toContain('Define each authoritative fact once')
    expect(prompt).not.toContain('No unresolved section decisions')
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
        completeDocumentContract: getGameDocumentContract(
          'docs/BALANCE_DESIGN.md',
        ),
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })
    expect(prompt).toContain('units, sources, sinks, base values, formulas')
    expect(prompt).toContain('bounds and tuning evidence')
    expect(prompt).toContain('implementable and testable')
    expect(prompt).not.toContain('Initial Reviewer owns')
    expect(prompt).not.toContain('Do not simulate builds or waves')
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
    expect(ownerPrompt).toContain('locked repair decision')
    expect(ownerPrompt).not.toContain(
      'write the complete revised Markdown document directly',
    )
    expect(ownerPrompt).toContain(
      'The assigned Markdown file must be complete when the turn ends',
    )
    expect(ownerPrompt).toContain(
      'The native runtime owns the file-operation sequence',
    )
    expect(ownerPrompt).toContain('end the turn normally')
    expect(ownerPrompt).not.toContain('verify its final bytes')
    expect(ownerPrompt).not.toContain('CommitCanonicalDocument')
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
    expect(prompt).toContain('never exceed 64 checkbox tasks')
    expect(prompt).toContain(
      'do not create one task per document sentence or variant',
    )
    expect(prompt).toContain('docs/acceptance/gameplay-checklist.md')
    expect(prompt).toContain('end the turn normally')
    expect(prompt).not.toContain('verify its final bytes')
    expect(prompt).not.toContain('undefined')
    expect(prompt).not.toContain('only file mutation')
    expect(prompt).not.toContain('CommitCanonicalDocument')
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
    expect(prompt).toContain("Bee Game Studio's native tools remain available")
    expect(prompt).toContain('When the complete writable set is ready')
    expect(prompt).toContain(
      'validates the merged set before replacing any file',
    )
    expect(prompt).not.toContain('Do not use generic file mutation tools')
  })
})
