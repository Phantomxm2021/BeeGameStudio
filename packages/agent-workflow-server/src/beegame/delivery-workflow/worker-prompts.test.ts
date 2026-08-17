import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { buildWorkerPrompt } from './worker-prompts'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import { getGameDocumentContract } from './game-document-contracts'
import type { WorkerDispatchRequest } from './types'

test('has no Foundation remediation prompt path', () => {
  const source = readFileSync(new URL('./worker-prompts.ts', import.meta.url), 'utf8')
  expect(source).not.toContain("authoringMode === 'remediation'")
  expect(source).not.toContain('contract.remediation')
  expect(source).not.toContain('remediationReceipts')
})

test('has no executable post-report Foundation verification contract', () => {
  const sources = [
    './foundation-review.ts',
    './foundation-review-lane-packet.ts',
    './foundation-review-stage.ts',
    './worker-contracts.ts',
    './worker-prompts.ts',
    '../delivery-worker-session-port.ts',
    './controller.ts',
  ].map(path => readFileSync(new URL(path, import.meta.url), 'utf8'))
  const removedIdentifiers = [
    'verificationSourcePaths',
    'priorReviewDigest',
    'priorConflictIds',
    "reviewMode === 'verification'",
    "mode === 'verification'",
    "z.literal('verification')",
    "z.enum(['initial', 'verification'])",
    'assertVerificationAuthority',
  ]
  for (const source of sources)
    for (const identifier of removedIdentifiers)
      expect(source).not.toContain(identifier)
})

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
      revision: 'a'.repeat(64),
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

    expect(prompt).toContain(
      'complete and production-usable when the turn ends',
    )
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
    expect(prompt).not.toContain(
      'four to six bounded native Write/Edit operations',
    )
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
    expect(prompt).not.toContain('native file tools')
    expect(prompt).not.toContain('end the turn normally')
    expect(prompt).toContain(
      'do not launch or wait for an independent review or audit',
    )
    expect(prompt).not.toContain('verify its final bytes')
    expect(prompt).not.toContain('checkpoint')
    expect(prompt).not.toContain('beegame-draft-cursor')
    expect(prompt).not.toContain('targetNativeReplacementBytes')
    expect(prompt).not.toContain('maxNativeReplacementBytes')
    expect(prompt).not.toContain('first native Write')
    expect(prompt).not.toContain('every Edit must')
    expect(prompt).not.toContain('Finish only the active bounded group')
    expect(prompt).not.toContain("Bee Game Studio's normal workflow")
    expect(prompt).toContain(
      'BGS writes those results to workflow audit metadata',
    )
    expect(prompt).not.toContain('CommitCanonicalDocument')
    expect(prompt).not.toContain('document_parts_prepared')
    expect(prompt).not.toContain(
      'Do not write or edit the assigned path directly',
    )
    expect(prompt).toContain('Do not claim verified license')
    expect(prompt).not.toContain('choose the operation count, size, and order')
    expect(prompt).not.toContain(
      'Save meaningful progress during long authoring work',
    )
    expect(prompt).not.toContain('one custom payload')
    expect(prompt).not.toContain(
      'End each bounded turn normally after its write succeeds',
    )
    expect(prompt).not.toContain(
      'one final lightweight structural verification',
    )
    expect(prompt).not.toContain('Read all authorized upstream sections')
    expect(prompt).not.toContain('one batched tool round')
    expect(prompt).not.toContain(
      'BGS mechanically inspects any existing target',
    )
    expect(prompt).not.toContain(
      'do not independently reread or reclassify the target',
    )
    expect(prompt).not.toContain('without an intermediate completion message')
    expect(prompt).toContain(
      'Prefer production-dense tables and matrices over repeated narrative',
    )
    expect(prompt).toContain(
      'Do not restate the confirmed brief, upstream text or another section',
    )
    expect(prompt).toContain('exactly one # document title')
    expect(prompt).toContain(
      '"documentTitle":{"position":"first_non_blank_line","headingPrefix":"# "}',
    )
    expect(prompt).toContain(
      'The first non-blank line must be the single # document title',
    )
    expect(prompt).toContain('canonical structures in order')
    expect(prompt).toContain('## Executive Summary')
    expect(prompt).toContain('Do not author YAML front matter')
    expect(prompt).toContain('BGS injects document_id, version and updated_at')
    expect(prompt).toContain('BGS injects all beegame protocol comments')
    expect(prompt).not.toContain('<!-- beegame-')
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
    expect(prompt).toContain('complete raw Markdown body')
    expect(prompt).toContain('Do not call tools')
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
      revision: 'a'.repeat(64),
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

  test('returns a downstream draft as one text-only Markdown stream', () => {
    const prompt = buildWorkerPrompt({
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
        authoringMode: 'parallel-draft',
        foundationDocumentPath: 'docs/BALANCE_DESIGN.md',
        availableUpstreamPaths: ['docs/GDD.md'],
        completeDocumentContract: getGameDocumentContract(
          'docs/BALANCE_DESIGN.md',
        ),
      },
    })

    expect(prompt).toContain('complete raw Markdown body')
    expect(prompt).toContain('Do not call tools')
    expect(prompt).toContain('genuinely unavailable upstream decisions')
    expect(prompt).toContain(
      'Treat each section as the final decision record, not a derivation transcript',
    )
    expect(prompt).toContain(
      'Production materials are canonical compact views of owned decisions and must not repeat section narrative',
    )
    expect(prompt).toContain(
      'Use no more than one worked example per formula or system boundary unless distinct contract-required cases prove different behavior',
    )
    expect(prompt).toContain(
      'Include only materially distinct boundary and acceptance scenarios; do not enumerate equivalent cases',
    )
    expect(prompt).not.toContain('checkpoint count')
    expect(prompt).not.toContain('forced Edit')
    expect(prompt).not.toContain('API retry')
    expect(prompt).not.toContain('watchdog')
    expect(prompt).not.toContain('whole-file grep')
    expect(prompt).not.toContain('byte count check')
    expect(prompt).not.toContain('docs/UI_UX_SPEC.md')
    expect(prompt).not.toContain('calibrat')
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

    const finalReviewerPrompt = buildWorkerPrompt({
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
        reviewRole: 'synthesis',
        assignment: {
          sourcePaths: [
            '/workspace/.beegame/reviews/foundation/revision/parts/core-design.json',
            '/workspace/.beegame/reviews/foundation/revision/parts/technical-assets.json',
            '/workspace/.beegame/reviews/foundation/revision/parts/presentation.json',
          ],
          stagingOutputPaths: [
            '/workspace/.beegame/reviews/staging/review.json',
          ],
        },
      },
    })
    expect(finalReviewerPrompt).toContain('Read exactly the three accepted lane packets')
    expect(finalReviewerPrompt).not.toContain('Review all eight canonical foundation documents directly')
    expect(finalReviewerPrompt).not.toContain('fixed coverage pass')
    expect(finalReviewerPrompt).toContain('cannot be implemented or verified')
    expect(finalReviewerPrompt).toContain('permits incompatible implementations')
    expect(finalReviewerPrompt).toContain('unambiguous duplicate wording is non-blocking')
    expect(finalReviewerPrompt).toContain('one JSON object')
    expect(finalReviewerPrompt).toContain('version must be the integer 3')
    expect(finalReviewerPrompt).toContain('IDs must be B1, B2, B3')
    expect(finalReviewerPrompt).toContain(
      'evidence must be an array of objects',
    )
    expect(finalReviewerPrompt).toContain(
      'path, location and observed',
    )
    expect(finalReviewerPrompt).not.toContain('priorConflictStatus')
    expect(finalReviewerPrompt).not.toContain('priorReviewDigest')
    expect(finalReviewerPrompt).toContain('requiredOutcome')
    expect(finalReviewerPrompt).toContain('changes')
    expect(finalReviewerPrompt).toContain('acceptance')
    expect(finalReviewerPrompt).not.toContain('review.md')
    expect(finalReviewerPrompt).not.toContain('decision.json')
    expect(finalReviewerPrompt).not.toContain('one non-blocking register')
    expect(finalReviewerPrompt).not.toContain('one preservation list')
    expect(finalReviewerPrompt).not.toContain('Consolidate the committed specialist')
    expect(finalReviewerPrompt).not.toContain('contract-specialist')
    expect(finalReviewerPrompt).not.toContain('integration-specialist')
    expect(finalReviewerPrompt).not.toContain('TaskOutput')
    expect(finalReviewerPrompt).not.toContain('launch both specialists')
    expect(finalReviewerPrompt).toContain('Deduplicate')
    expect(finalReviewerPrompt).toContain('sole canonical version 3 review.json')
    expect(finalReviewerPrompt).toContain('accepted lane packets')
    expect(finalReviewerPrompt).toContain('launch another Agent or task')

    const specialistPrompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'a'.repeat(64),
      contract: {
        reviewScope: 'foundation',
        reviewMode: 'initial',
        reviewRole: 'core-design',
        assignment: {
          sourcePaths: [
            '/workspace/docs/GDD.md',
            '/workspace/.beegame/reviews/foundation/revision/projections/core-design.json',
          ],
          stagingOutputPaths: [
            '/workspace/.beegame/reviews/foundation/revision/.staging/parts/core-design.json',
          ],
        },
      },
    })
    expect(specialistPrompt).toContain(
      'return one bounded Foundation review lane packet JSON object',
    )
    expect(specialistPrompt).toContain('do not decide the final verdict')
    expect(specialistPrompt).toContain('do not modify canonical documents')
    expect(specialistPrompt).toContain(
      'game rules, progression, level structure and balance',
    )
    expect(specialistPrompt).toContain('"version":1')
    expect(specialistPrompt).toContain('"scope":"foundation"')
    expect(specialistPrompt).toContain('"lane":"core-design"')
    expect(specialistPrompt).toContain(
      'title, problem, evidence and blockingReason',
    )
    expect(specialistPrompt).toContain(
      'path, location and observed',
    )
    expect(specialistPrompt).toContain('8 highest-priority proven blockers')
    expect(specialistPrompt).toContain('Never write an absolute path')
    expect(specialistPrompt).toContain(
      'Submit the complete contracted object once through StructuredOutput',
    )
    expect(specialistPrompt).not.toContain(
      'Finish only after every assigned report file is fully written',
    )
    expect(specialistPrompt).toContain(
      'Do not inspect other canonical documents, .beegame workflow state or Bee Game Studio source code',
    )
    expect(specialistPrompt).not.toContain('Write one human-readable Markdown')
    expect(specialistPrompt).not.toContain('TaskOutput')

    const integrationSpecialistPrompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'a'.repeat(64),
      contract: {
        reviewScope: 'foundation',
        reviewMode: 'initial',
        reviewRole: 'technical-assets',
        assignment: {
          sourcePaths: [
            '/workspace/docs/GDD.md',
            '/workspace/.beegame/reviews/foundation/revision/projections/technical-assets.json',
          ],
          stagingOutputPaths: [
            '/workspace/.beegame/reviews/foundation/revision/.staging/parts/technical-assets.json',
          ],
        },
      },
    })
    expect(integrationSpecialistPrompt).toContain(
      'runtime architecture, production feasibility and asset responsibilities',
    )
    expect(integrationSpecialistPrompt).toContain(
      '"lane":"technical-assets"',
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
    expect(prompt).toContain('raw Markdown body for docs/GDD.md')
    expect(prompt).toContain(
      'Markdown body is the sole human document authority',
    )
    expect(prompt).toContain(
      'BGS injects document_id, version and updated_at deterministically',
    )
    expect(prompt).toContain('BGS injects all beegame protocol comments')
    expect(prompt).not.toContain('<!-- beegame-')
    expect(prompt).toContain('BGS injects document_id, version and updated_at')
    expect(prompt).not.toContain('updated_at set to')
    expect(prompt).toContain('complete human development discipline')
    expect(prompt).toContain('sufficient for a human game development team')
    expect(prompt).toContain('BALANCE_DESIGN owns')
    expect(prompt).toContain('LEVEL_SCENE_DESIGN owns')
    expect(prompt).toContain('raw Markdown body for docs/GDD.md')
    expect(prompt).not.toContain('native file-operation sequence')
    expect(prompt).not.toContain('end the turn normally')
    expect(prompt).not.toContain('checkpoint')
    expect(prompt).not.toContain('CommitCanonicalDocument')
    expect(prompt).not.toContain('terminal JSON')
    expect(prompt).not.toContain('then the audit appendix in canonical order')
    expect(prompt).toContain('every production material in canonical order')
    expect(prompt).toContain('Define each authoritative fact once')
    expect(prompt).toContain(
      'Treat each section as the final decision record, not a derivation transcript',
    )
    expect(prompt).toContain(
      'Use no more than one worked example per formula or system boundary unless distinct contract-required cases prove different behavior',
    )
    expect(prompt).toContain(
      'Include only materially distinct boundary and acceptance scenarios; do not enumerate equivalent cases',
    )
    expect(prompt).toContain(
      'Production materials are canonical compact views of owned decisions and must not repeat section narrative',
    )
    expect(prompt).toContain('48,000 UTF-8 bytes')
    expect(prompt).toContain(
      'finish every required section and production material within that single response',
    )
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
