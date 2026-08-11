import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_ARTIFACTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type WorkerDispatchRequest,
} from './types'

export function buildWorkerPrompt(request: WorkerDispatchRequest): string {
  const resourceContentReadPaths =
    request.workerType === 'resource-content-author'
      ? [
          ...(Array.isArray(request.contract.authorityPaths)
            ? request.contract.authorityPaths
            : []),
          ...(Array.isArray(request.contract.repairPaths)
            ? request.contract.repairPaths
            : []),
        ].filter(
          (path, index, paths): path is string =>
            typeof path === 'string' && paths.indexOf(path) === index,
        )
      : []
  const scope = resourceContentReadPaths.length
    ? resourceContentReadPaths.join(', ')
    : request.allowedPaths?.length
      ? request.allowedPaths.join(', ')
      : 'read-only'
  const canonicalArtifacts =
    (request.workerType === 'document-author' &&
      request.contract.documentSet === 'foundation') ||
    (request.workerType === 'document-reviewer' &&
      request.contract.reviewScope === 'foundation')
      ? CANONICAL_FOUNDATION_DOCUMENTS
      : request.workerType === 'document-reviewer' &&
          request.contract.reviewScope === 'checklist'
        ? CANONICAL_PROJECT_DOCUMENTS
        : request.workerType === 'document-author' &&
            request.contract.documentSet === 'checklist'
          ? CANONICAL_PROJECT_DOCUMENTS
          : CANONICAL_PROJECT_ARTIFACTS
  return [
    `BeeGame delivery worker: ${request.workerType}`,
    `Phase: ${request.phase}`,
    `Run: ${request.runId}`,
    `Revision: ${request.revision}`,
    `Workspace root: ${request.workspacePath}`,
    `Allowed paths: ${scope}`,
    `Canonical artifacts: ${canonicalArtifacts.join(', ')}`,
    'Request kind: confirmed_build_brief. The durable confirmed brief context and its digest are the product authority for this run.',
    'Confirmed Brief settings are higher authority than free-form idea text. When they conflict, apply the structured setting selected in the settings interface, state only that resolved authority in project documents, and do not preserve both sides as simultaneous requirements.',
    workerInstruction(request),
    'Use the confirmed contract and task payload as authority. Do not use chat transcript prose as product authority.',
    "Use Claude Code normally. Its native tools, thinking, permissions, context management, and completion behavior remain available. Do not bind a resource decision to a particular game engine or platform unless the approved target explicitly requires it.",
    terminalInstruction(request),
    formatContract(request),
  ].join('\n')
}

function formatContract(request: WorkerDispatchRequest): string {
  if (request.workerType === 'resource-content-author')
    return JSON.stringify(formatResourceContentContract(request.contract))
  if (request.workerType !== 'document-reviewer') {
    const {
      confirmedBriefContext: _confirmedBriefContext,
      ...contractWithoutDuplicatedBrief
    } = request.contract
    return JSON.stringify(contractWithoutDuplicatedBrief)
  }
  const {
    reviewArtifacts,
    referenceIndex,
    currentCheckIds,
    criteriaByCheck,
    artifactPathsByCheck,
    priorFindings,
    activeTarget,
    changedPaths,
    changes,
    ...staticContract
  } = request.contract
  const artifactBlocks = formatReviewArtifacts(reviewArtifacts)
  const changeBlocks = formatReviewChanges(changes)
  const compactChanges = Array.isArray(changes)
    ? changes.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          return value
        const { beforeContent: _beforeContent, ...change } = value as Record<
          string,
          unknown
        >
        return change
      })
    : changes
  const visiblePriorFindings = projectVisiblePriorFindings({
    priorFindings,
    currentCheckIds,
    artifactPathsByCheck,
    mode: staticContract.reviewMode,
  })
  return [
    '--- BEGIN REVIEW STATIC CONTRACT ---',
    JSON.stringify({
      ...staticContract,
      reviewAuthority: structuredReviewAuthority(
        staticContract.reviewAuthority,
      ),
    }),
    '--- END REVIEW STATIC CONTRACT ---',
    ...artifactBlocks,
    '--- BEGIN REVIEW REFERENCE INDEX ---',
    JSON.stringify(referenceIndex),
    '--- END REVIEW REFERENCE INDEX ---',
    '--- BEGIN REVIEW ACTIVE PACKET ---',
    JSON.stringify({
      currentCheckIds,
      criteriaByCheck,
      artifactPathsByCheck,
      ...(visiblePriorFindings.length
        ? { priorFindings: visiblePriorFindings }
        : {}),
      ...(activeTarget !== undefined ? { activeTarget } : {}),
      ...(changedPaths !== undefined ? { changedPaths } : {}),
      ...(compactChanges !== undefined ? { changes: compactChanges } : {}),
    }),
    '--- END REVIEW ACTIVE PACKET ---',
    ...changeBlocks,
  ].join('\n')
}

function formatResourceContentContract(
  contract: Record<string, unknown>,
): Record<string, unknown> {
  const allowedKeys = [
    'task',
    'contentRoot',
    'schema',
    'jsonKinds',
    'yamlKinds',
    'authorityPaths',
    'repairPaths',
    'currentContentIssues',
    'requiredRequirementIds',
    'verifiedResourceIds',
    'inventoryBindings',
    'inventoryRevision',
    'baselineResourceRevision',
  ] as const
  const projection = Object.fromEntries(
    allowedKeys.flatMap(key =>
      Object.prototype.hasOwnProperty.call(contract, key)
        ? [[key, contract[key]]]
        : [],
    ),
  )
  const remediation = contract.remediation
  if (remediation && typeof remediation === 'object' && !Array.isArray(remediation)) {
    const findings = (remediation as Record<string, unknown>).findings
    if (Array.isArray(findings)) {
      const paths = new Set(
        Array.isArray(contract.repairPaths)
          ? contract.repairPaths.filter(
              (path): path is string => typeof path === 'string',
            )
          : [],
      )
      projection.remediation = {
        kind: (remediation as Record<string, unknown>).kind,
        cycleId: (remediation as Record<string, unknown>).cycleId,
        findings: findings
          .filter(value => {
            if (!value || typeof value !== 'object' || Array.isArray(value))
              return false
            const subjects = (value as Record<string, unknown>).subjects
            return (
              Array.isArray(subjects) &&
              subjects.some(subject => {
                if (!subject || typeof subject !== 'object' || Array.isArray(subject))
                  return false
                const subjectPath = (subject as Record<string, unknown>).path
                return typeof subjectPath === 'string' && paths.has(subjectPath)
              })
            )
          })
          .map(value => {
            const finding = value as Record<string, unknown>
            return {
              findingId: finding.findingId,
              rootCause: finding.rootCause,
              impact: finding.impact,
              requiredOutcome: finding.requiredOutcome,
              subjects: finding.subjects,
            }
          }),
      }
    }
  }
  return projection
}

function projectVisiblePriorFindings(input: {
  priorFindings: unknown
  currentCheckIds: unknown
  artifactPathsByCheck: unknown
  mode: unknown
}): unknown[] {
  if (!Array.isArray(input.priorFindings)) return []
  const currentCheckIds = new Set(
    Array.isArray(input.currentCheckIds)
      ? input.currentCheckIds.filter(
          (value): value is string => typeof value === 'string',
        )
      : [],
  )
  const activePaths = new Set<string>()
  if (
    input.artifactPathsByCheck &&
    typeof input.artifactPathsByCheck === 'object' &&
    !Array.isArray(input.artifactPathsByCheck)
  )
    for (const paths of Object.values(input.artifactPathsByCheck))
      if (Array.isArray(paths))
        for (const path of paths)
          if (typeof path === 'string') activePaths.add(path)
  return input.priorFindings.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const finding = value as Record<string, unknown>
    if (finding.open !== true) return []
    const references = [finding.evidence, finding.subjects].flatMap(items =>
      Array.isArray(items) ? items : [],
    )
    const relevant =
      (typeof finding.checkId === 'string' &&
        currentCheckIds.has(finding.checkId)) ||
      references.some(
        reference =>
          reference &&
          typeof reference === 'object' &&
          !Array.isArray(reference) &&
          typeof (reference as Record<string, unknown>).path === 'string' &&
          activePaths.has(
            (reference as Record<string, unknown>).path as string,
          ),
      )
    if (!relevant) return []
    const { open: _open, ...visible } = finding
    const currentOwnerCheck =
      input.mode === 'closure' &&
      typeof visible.checkId === 'string' &&
      currentCheckIds.has(visible.checkId)
    if (currentOwnerCheck) return [visible]
    const {
      observation: _observation,
      blockingImpact: _blockingImpact,
      regressionPaths: _regressionPaths,
      ...dedupeProjection
    } = visible
    return [dedupeProjection]
  })
}

function structuredReviewAuthority(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const authority = value as Record<string, unknown>
  if (typeof authority.confirmedBriefContext !== 'string') return value
  try {
    return {
      ...authority,
      confirmedBriefContext: JSON.parse(authority.confirmedBriefContext),
    }
  } catch {
    throw new Error('document review confirmed brief context is invalid')
  }
}

function formatReviewArtifacts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((artifact, index) => {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact))
      throw new Error(`document review artifact ${index} is invalid`)
    const record = artifact as Record<string, unknown>
    if (typeof record.path !== 'string' || typeof record.content !== 'string')
      throw new Error(`document review artifact ${index} is incomplete`)
    return [
      `--- BEGIN REVIEW ARTIFACT ${record.path} ---`,
      record.content,
      `--- END REVIEW ARTIFACT ${record.path} ---`,
    ]
  })
}

function formatReviewChanges(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((change, index) => {
    if (!change || typeof change !== 'object' || Array.isArray(change))
      return []
    const record = change as Record<string, unknown>
    if (
      typeof record.path !== 'string' ||
      typeof record.beforeContent !== 'string'
    )
      return []
    return [
      `--- BEGIN REVIEW CHANGE BEFORE ${index} ${record.path} ---`,
      record.beforeContent,
      `--- END REVIEW CHANGE BEFORE ${index} ${record.path} ---`,
    ]
  })
}

function workerInstruction(request: WorkerDispatchRequest): string {
  switch (request.workerType) {
    case 'document-author':
      return [
        request.contract.documentSet === 'checklist'
          ? 'Author the approved gameplay checklist directly at docs/acceptance/gameplay-checklist.md using Claude Code\'s normal workflow.'
          : request.contract.authoringMode === 'initial'
          ? `Use the service-projected upstream authority and target baseline. Author the complete assigned Markdown game document directly at ${String(request.contract.foundationDocumentPath)} using Claude Code's normal workflow.`
          : request.contract.authoringMode === 'repair-planning'
            ? 'Act only as the read-only Repair Lead for the complete ordered repair graph in contract.repairPlanTask. Submit one structured plan containing one group decision and the necessary coordinated path decisions per service-owned group; do not write or mutate project files.'
            : `Use the service-projected current target, apply only the locked repair decision, and write the complete revised Markdown document directly at ${String(request.contract.foundationDocumentPath)} using Claude Code's normal workflow.`,
        request.contract.documentSet === 'checklist'
          ? [
              'Author only docs/acceptance/gameplay-checklist.md from the eight approved foundation documents.',
              'Every acceptance task must be one Markdown checkbox line with a stable ID, observable behavior and evidence expectation. Cover core player paths, critical numeric boundaries, level/scene states, UI/audio feedback, visible resource outcomes and failure/recovery paths from the approved authority.',
              'Group the approved scenarios before authoring. Target 24-40 checkbox tasks for an ordinary first delivery; exceed 40 only for additional independently observable approved scenarios, and never exceed 64 checkbox tasks. Group wave, enemy, input, resource, cue and table-row variants when they share one setup, action and observable outcome; do not create one task per document sentence or variant. One task may cite multiple approved facts while remaining independently pass/fail.',
              'Use the canonical form `- [ ] <stable-id> <observable check and evidence expectation>`; tables may add context but cannot replace checkbox tasks.',
              ...(request.contract.remediation
                ? [
                    'Resolve the complete active finding batch in contract.remediation. The service owns checklist metadata and durable completion.',
                  ]
                : []),
              'Do not modify foundation documents, resources, the asset manifest or implementation files.',
            ].join(' ')
          : request.contract.authoringMode === 'repair-planning'
            ? [
                'This is the sole planning task for every ordered group in contract.repairPlanTask.groups.',
                'Produce exactly one minimum groupDecision per group in the supplied order, plus one pathDecision for each subject path and each candidate path that must change to preserve downstream consistency. Evidence, subjects, blocking impacts and required outcomes are immutable service-owned constraints; do not restate them.',
                'Respect each group dependsOn edge while deciding later groups; preserve earlier outcomes and do not reopen them.',
                'Do not add unrelated systems, broaden scope, reopen review, calculate exhaustive scenarios, write files, or create a second plan or finding queue.',
                'Authority direction is irreversible: when a lower-authority document invented an unapproved product-visible system or obligation, remove or narrow that declaration; do not expand other consumers to support it unless Confirmed Brief, GDD, or the legitimate upstream owner explicitly requires it.',
                'Submit the complete ordered plan through SubmitDocumentRepairPlan exactly once.',
              ].join(' ')
            : request.contract.authoringMode === 'initial'
              ? [
                  `This is one complete human development discipline assignment. Author exactly ${String(request.contract.foundationDocumentPath)} and no other file. The eight documents together must be sufficient for a human game development team to plan, build, produce, test, release and operate the approved game. Resolve this discipline's design work now; do not delegate completeness to a reviewer.`,
                  'Document metadata is service-owned. Begin with exactly one # document title and do not write YAML front matter.',
                  'Use exactly one fact owner: GDD owns player actions, loops, rules, states and outcomes; BALANCE_DESIGN owns units, sources, sinks, base values, formulas, bounds and tuning evidence; LEVEL_SCENE_DESIGN owns topology, placements, pacing and production acceptance; Technical owns runtime and data boundaries; Art owns visual language; UI/UX owns interaction; Audio owns event-to-cue behavior; Asset Plan owns resource responsibilities and production sourcing.',
                  'Write the four document-level layers in order: <!-- beegame-executive-summary --> followed by exactly ## Executive Summary; every exact contract section marker and title; <!-- beegame-production-materials --> followed by exactly ## Production Materials and every contract.productionMaterials marker with its required mechanical format; then <!-- beegame-audit-appendix --> followed by exactly ## Audit Appendix and one non-empty ### Acceptance Criteria list. These three document-layer headings are protocol labels and remain in English even when the document body uses another language. Define each authoritative fact once and reference projected upstream authority instead of copying it.',
                  'Read all authorized upstream sections in one batched tool round before authoring; do not spend one model round per section. If the target already exists, first make one lightweight structural and authority check. When it is structurally complete and still agrees with the current brief and upstream authority, repair only the missing or invalid parts; do not rewrite a complete current-authority document.',
                  'Prefer production-dense tables and matrices over repeated narrative. Every section must add new implementation authority. Do not restate the confirmed brief, upstream text or another section; reference its stable authority instead. Keep rationale to the shortest explanation needed for a production decision, and make Acceptance Criteria verify the contract without paraphrasing the document.',
                  'Write the complete document using three to eight contiguous ordered content writes as needed for its actual size. No native write or edit input may exceed 12 KiB of UTF-8 content. Chunk boundaries are transport boundaries, not one-operation-per-section rules; if completeness requires more chunks, continue bounded writes instead of omitting content. Do not serialize the complete document into one tool-call argument, and do not reread the complete file after each chunk. After the final chunk, perform one final lightweight structural verification and end the turn normally; do not repeat equivalent verification commands after a successful check. Keep Claude Code thinking, tools, context management and normal completion behavior unchanged.',
                  'Provide enough concrete choices, tradeoffs, examples, units, boundaries and observable criteria for the assigned discipline to be implementable and testable. A downstream owner may specialize only behavior already authorized by the Confirmed Brief, GDD or its projected upstream owner.',
                  ...(request.contract.foundationDocumentPath === 'docs/ASSET_PLAN.md'
                    ? [
                        'Define a reusable many-to-many semantic resource responsibility registry, source and license evidence, dependency and milestone ownership. Do not create one physical file per destination or invent Resource Library identities that were not observed.',
                      ]
                    : []),
                  ...(request.contract.foundationDocumentPath === 'docs/TECHNICAL_DESIGN.md'
                    ? [
                        'Apply contract.systemDeliveryContract as the fixed delivery boundary and define one Manifest, one content root, one schema and one resource loading path without binding an unapproved engine or platform.',
                      ]
                    : []),
                  ...(typeof request.contract.changeRequest === 'string' && request.contract.changeRequest.trim()
                    ? ['Apply the confirmed change request to the controlled baseline and preserve unrelated valid content.']
                    : []),
                  'Do not create the checklist, asset manifest, resources or implementation.',
                ].join(' ')
              : [
                  'This is one accepted foundation-remediation batch. Modify only the assigned canonical foundation document.',
                  'Apply only the locked repair decision, preserve unrelated approved authority, and do not reopen review.',
                  ...(request.contract.repairTask
                    ? [
                        `Repair exactly ${String(request.contract.foundationDocumentPath)} from contract.repairTask.`,
                      ]
                    : []),
                ].join(' '),
      ].join(' ')
    case 'document-reviewer':
      return [
        'Use contract.reviewAuthority plus contract.reviewArtifacts as the complete revision-bound source. The systemDeliveryContract review artifact is fixed system authority: project artifacts may apply it but may not redefine or override it. Do not reread workspace files or modify anything.',
        'Review exactly the ordered contract.currentCheckIds packet. Put each check auditable reasoning directly into its criterion derivations, conclusion and findings. Do not inspect checks outside the packet, produce a separate transcript, or rely on max-token continuation.',
        'Keep the structured result decision-dense. A criterion derivation contains only the cited facts and the minimum formula, comparison or state-transition chain needed to prove its status; its conclusion is one direct decision. Do not summarize whole documents, repeat evidence prose, narrate the review process, restate another criterion, or add analysis after the accepted tool call. Findings contain only the distinct root defect, impact and required authority outcome.',
        'Produce exactly one accepted SubmitDocumentReviewPacket in this bounded dispatch. Submit one checks array in contract.currentCheckIds order, without check IDs. The packet is transactional: a rejected call accepts nothing, so correct and resubmit the same complete packet without prose or user confirmation.',
        'Report every material defect that blocks an implementable and reviewable game contract: contradictions, missing observable requirements, incomplete strategy, dominated choices, absent counterplay or recovery, broken economy/progression, infeasible numeric bounds, inconsistent formulas, discontinuous difficulty, or invalid resource plans. READY requires no findings.',
        'For cross-document consistency and content structure, reject repeated authority prose within one document as well as duplicated ownership across documents. A stable reference is sufficient after the first authoritative definition; repeated scope, rationale, Brief prose, delivery-boundary prose, acceptance wording, or resolved decisions are defects when they add no new local derivation.',
        'Apply authority direction before completeness expansion: a lower-authority document cannot authorize a new product-visible system or impose a new obligation on another owner. When it does, subject the overreaching declaration and require deletion or narrowing. Require another consumer to expand only when the Confirmed Brief, GDD, or legitimate upstream fact owner already authorizes that behavior.',
        'Submit one top-level checks array and never submit a check ID. For a design check, submit exactly assessments and findings; the service derives check-level status, evidence and conclusion. For a non-design check, additionally submit conclusion and evidence and use an empty assessments array. Each assessment contains exactly criterion, status, evidence, derivation and conclusion, using the exact criterion IDs in contract.criteriaByCheck for that ordered check. Every evidence or subject entry contains exactly referenceId; result, note, copied paths and copied anchors are invalid. The service derives each check ID, check status and check findingIds. For each item, evidence and subjects may reference only artifacts listed for that check in contract.artifactPathsByCheck and must use stable referenceId values from contract.referenceIndex.references. Every finding submits one stable findingId, its own exact evidence and exact subjects plus observation, blockingImpact and one authority-preserving requiredOutcome. A subject is current content that violates authority and must change to reach requiredOutcome; contextual or already-correct authority remains finding evidence only. requiredOutcome states one result, never alternative repairs or editing steps. Do not submit checkId, owner, severity, a cycle verdict or a check outside the packet.',
        'For each subject, submit its referenceId and only any applicable requirementId, resourceId or contentId; never submit subjectOwner. The service derives ownership from contract.referenceIndex and rejects a reference owned by another repair domain. Foundation documents may be evidence for a resource defect but cannot be resource repair subjects. Foundation and checklist findings cannot carry resource IDs.',
        'Every check must include assessments. Only gameplay_strategy_viability, economy_progression_integrity, numeric_balance_feasibility, pacing_difficulty_coherence and level_scene_design_integrity use their exact three non-empty criterion assessments; every other check must use assessments: []. Every resource-owned finding must carry at least one current requirementId, resourceId or contentId on the corresponding Manifest/content subject.',
        'contract.priorFindings is the accepted unique-ownership ledger. Within this packet, assign a root defect only to the earliest responsible check in contract.currentCheckIds and do not duplicate it in later packet items. If the same root defect is already represented by an accepted finding under the same owner, cite it as context and do not create another finding ID.',
        'For every projected content file, fulfills may contain only exact current Manifest requirement IDs and resources may contain only exact current Manifest resource IDs. Requirement IDs are the sole content-to-approved-duty trace; never request document names, headings, prose labels or invented duty IDs in fulfills, and never request physical paths in either reference array.',
        'Whenever present, cross_document_consistency, technical_feasibility, content_structure_fitness and resource_content_consistency must cite an exact JSON Pointer from the systemDeliveryContract artifact in evidence. Finding subjects still point to the project artifact that must change.',
        request.contract.reviewScope === 'foundation'
          ? 'Review only the eight foundation documents with the twelve fixed checks. brief_alignment compares the confirmed brief and language contract. cross_document_consistency rejects contradictory or duplicated authority and blocks project documents that agree with each other but conflict with systemDeliveryContract. gameplay_completeness covers the complete player loop, state transitions, mechanics and outcomes. The four gameplay/balance checks must submit their exact structured criterion sets: gameplay_strategy_viability proves meaningful choices, checks dominant-strategy risk, and traces counterplay/recovery using GDD rules and Level/Scene spatial support; economy_progression_integrity reconciles Balance sources/sinks, affordability/growth, and exploit/deadlock risk; numeric_balance_feasibility derives Balance outcome bounds, relative value, and formula consistency; pacing_difficulty_coherence compares Balance pressure/capability curves against the Level/Scene sequence plus spikes/recovery. level_scene_design_integrity must submit spatial_gameplay_support, level_progression_coherence and scene_state_completeness, proving that topology, routes, regions, camera constraints, progression and scene states support the approved game. Use only cited document facts, show calculations or comparisons in derivation, and create a blocking finding when missing authoritative inputs prevent a central conclusion. A domain explicitly absent from the approved game may pass only by deriving that no hidden rule or resource flow is needed; do not invent a new subsystem. These checks establish a feasible design interval, not final feel or empirical balance. technical_feasibility compares every documented Manifest, root, schema and loading path against systemDeliveryContract; it covers target constraints, deterministic rules and one resource loading path: a programmatic placeholder is itself an independent replaceable file under the normal resource root, never a runtime/source substitute or second loader. art_direction_coherence covers visual duties, style and Level/Scene spatial readability. ui_audio_consistency covers UI, interaction and audio duties across documented gameplay and scene states. acceptance_observability requires every approved behavior, numeric boundary and scene state to have an observable outcome without requiring a checklist that does not exist yet. Also confirm one many-to-many semantic resource responsibility registry and no speculative Resource Library identity.'
          : request.contract.reviewScope === 'checklist'
            ? 'Review the frozen gameplay checklist once, after Foundation approval and before Resource Production. checklist_traceability verifies that every approved behavior, numeric boundary and scene state has an observable checklist item and that the checklist adds no new product requirement. Findings may target only the checklist. Do not reopen or rewrite Foundation documents.'
            : 'Complete the comprehensive pre-implementation approval ledger of fifteen fixed checks. The service carries the twelve Foundation checks only when every Foundation evidence digest is still current; in that normal case this cycle dispatches three additions in two serial packets: resource_semantic_fitness, then content_structure_fitness with resource_content_consistency. If contract.currentCheckIds contains Foundation checks, their approval was stale and the service is explicitly rebuilding the ordered Foundation prefix. Always review only contract.currentCheckIds. The checklist is frozen approved input and cannot be a finding subject. Compare the artifacts assigned to each packet check against systemDeliveryContract; agreement among project artifacts does not excuse a conflicting Manifest, root, schema, content kind, fact owner or loading path. Keep remediation ownership exact: a foundation finding targets only a foundation document, and every defect whose repair target is the Manifest or JSON/YAML content belongs to resource_semantic_fitness, content_structure_fitness or resource_content_consistency with its current semantic IDs. Do not duplicate one content or resource defect under a foundation check. For resource_semantic_fitness, reject acquisition profiles that encode composition or runtime duties as source-intrinsic capabilities; placement, scaling, connection, scene assembly and behavior belong to content or implementation. Resource-owned checks re-derive approved design expectations from current JSON/YAML numeric, event, wave, world, scene, hierarchy and placement facts where needed, but report disagreement in those derived files through the resource-owned check; do not replace document authority with implementation or runtime assumptions. Confirm only the active packet responsibilities: semantic resource fitness, or content fact ownership, structure and Manifest/file/content consistency. Placeholders are standalone files loaded through the same sole path as final media. Block second Manifests, content roots, schemas or loaders, runtime/source substitutes, duplicate ownership and engine-specific demands. Do not require code, builds or runtime evidence before implementation. The Workflow deterministically enters task planning only after every required check is accepted.',
        request.contract.reviewMode === 'closure'
          ? 'This is one transactional packet in a bounded Closure Review. Recheck only the packet responsibilities, relevant prior findings and server-provided changes. An unresolved prior finding preserves the same findingId, check, owner and exact requiredOutcome. A different defect found inside an active check uses a new findingId even when its subject was unchanged. regressionPaths is declared only for a defect directly introduced by the server-provided changed paths. Do not reopen unrelated checks.'
          : 'This is one serial packet in the single review cycle. Record every blocking defect once under the earliest responsible packet check; the service will continue to the next packet and derive the final verdict after all checks.',
      ].join(' ')
    case 'resource-planner':
      return [
        request.contract.remediation
          ? 'This is one accepted resource-plan repair batch. Apply only the supplied Manifest finding outcomes, preserve all unrelated approved requirements and resource records, and submit the complete corrected plan through AssetManifest. Do not repair inventory or content findings in this dispatch.'
          : 'Create the canonical Resource Production plan from only contract.authorityPaths and the confirmed brief. ASSET_PLAN owns the complete resource duties, ART_DIRECTION owns presentation constraints, and TECHNICAL_DESIGN owns runtime-consumable output formats. Do not reopen review or read other project documents.',
        'Use AssetManifest submit_resource_plan exactly once. The service owns Manifest version, resource policy and canonical roots. Submit runtime target capabilities and complete stable requirements. Every requirement must include one structured acquisition_profile containing only canonical dimensions, asset kinds, usage tags, source-intrinsic required capabilities and approved style values. Composition, placement, scaling, connection, scene assembly and runtime behavior are content or implementation duties, never source-intrinsic acquisition constraints. Never infer this profile from IDs or filenames.',
        'Never use target output formats as source-format admission rules. Source material may use another format when the current target adapter declares a deterministic direct or conversion delivery capability.',
        'Do not browse the Resource Library, create or download files, write JSON/YAML, or implement gameplay. A successful plan submission ends this dispatch.',
      ].join(' ')
    case 'resource-curator':
      return [
        request.contract.remediation
          ? 'This is one accepted resource-inventory repair batch. Resolve only the supplied inventory findings against the established Manifest and approved Resource Library facts. Do not modify requirements or content files.'
          : 'Acquire or author the complete resource inventory for the established Manifest plan. Read only contract.authorityPaths and the Manifest. Do not modify requirements or content files.',
        'Call ResourceLibrary match_requirements once. For a matched requirement, choose one returned bundle and judge only its authored metadata and technical facts, never filename, keywords, regular expressions, project names or requirement IDs. A no-match requirement may use one or more independently replaceable placeholders when its declared duties need separate resources; never mix library and placeholder decisions for one requirement.',
        'A suitable candidate may satisfy its requirement through direct delivery or a declared target conversion adapter. Choose exact candidate identities. Use a placeholder decision for every service-proven no-match group so missing library material never stops delivery.',
        'Submit one complete decision set through CommitResourceInventory. If a prior submission created a prepared or applying durable receipt, submit decisions: [] to resume that exact receipt instead of reconstructing decisions. It is the only mutation and terminal operation, preserves exact dependency closure, resumes durable progress after interruption, and derives bindings from the committed inventory. Do not write content or gameplay code.',
      ].join(' ')
    case 'resource-content-author': {
      const writablePaths = Array.isArray(request.contract.repairPaths)
        ? request.contract.repairPaths.filter(
            (path): path is string => typeof path === 'string',
          )
        : []
      return [
        `Build the engine-neutral JSON/YAML documents at the exact writable paths in contract.repairPaths: ${writablePaths.length ? writablePaths.join(', ') : '<none>'}. Submit one documents object keyed by those exact paths. Claude Code's native tools remain available for inspection, reasoning, and verification. Use contract.authorityPaths, contract.requiredRequirementIds, contract.verifiedResourceIds, and contract.inventoryBindings as the task authority. CommitResourceContent is the atomic delivery interface for the final document set and preserves every canonical document outside the writable path list.`,
        'Use exactly contract.schema. JSON owns only contract.jsonKinds and YAML owns only contract.yamlKinds. Every submitted document contains exactly path, schema, id, kind, fulfills, resources and data. One coherent document may fulfill several requirements. fulfills contains only exact contract requirement IDs and resources contains only exact contract resource IDs. The single resource-registry data.bindings is the only requirement-to-resource binding representation and must agree with contract.inventoryBindings. Never duplicate the same fact in JSON and YAML.',
        request.contract.remediation
          ? 'This is one accepted resource-content repair batch. Resolve only the supplied content findings and preserve the protected canonical content. Do not attempt to repair Manifest, inventory or Resource Library findings.'
          : 'When the complete writable set is ready, call CommitResourceContent once. The service serializes JSON/YAML and validates the merged set before replacing any file.',
        'The service preserves every canonical document outside the exact writable path list during the atomic commit; never read, resubmit or rewrite those documents.',
        'If verified inventory is genuinely missing, call CommitResourceContent needs_inventory with the exact missing requirement IDs. Do not invent a path, identity or embedded substitute.',
      ].join(' ')
    }
    case 'atomic-task-planner':
      return [
        'Use contract.planningDocuments plus resourceIds and contentIds as the acceptance authority. Claude Code may inspect the current workspace and use its native tools as needed to produce a correct plan.',
        'Submit one dependency graph through SubmitAtomicTaskPlan. Each task owns durable implementation artifacts and project-owned verification actions. Checklist items have one owner; resource and content IDs are read-only dependencies.',
        'Resources and content are ready before implementation. Tasks consume declared files; they do not download, generate substitute media or mutate assets/asset-manifest.json.',
        'Do not create trailing cleanup, final verification or acceptance tasks. The workflow owns those phases.',
      ].join(' ')
    case 'implementation-worker':
      return [
        'Implement the active atomic task completely within allowedPaths. Treat current source, direct dependencies, verified resources, declared JSON/YAML content, and canonical design documents as available context.',
        'Claude Code may inspect the project and use its native tools as needed. Keep changes within the active task deliverables; resource acquisition and manifest changes remain separate workflow deliverables.',
        'Execute every deterministic test, build, file and asset verification with project-owned tooling. Runtime checks are deferred to acceptance.',
      ].join(' ')
    case 'implementation-auditor':
    case 'acceptance-validator':
    case 'change-impact-analyzer':
    case 'question-answerer':
      return 'Perform the assigned review or analysis as a read-only worker. Do not modify project files.'
  }
}

function terminalInstruction(request: WorkerDispatchRequest): string {
  switch (request.workerType) {
    case 'document-author':
      return request.contract.authoringMode === 'repair-planning'
        ? 'Call SubmitDocumentRepairPlan exactly once. Do not write files, return terminal JSON, or add completion prose.'
        : request.contract.authoringMode === 'initial'
          ? `Write the assigned complete Markdown game document at ${documentAuthorTargetPath(request)}, verify it, and end the turn normally.`
          : `Write the assigned complete Markdown document at ${documentAuthorTargetPath(request)}, verify it, and end the turn normally.`
    case 'document-reviewer':
      return 'Produce exactly one accepted SubmitDocumentReviewPacket containing the complete ordered checks array for contract.currentCheckIds. Use only stable referenceId values. If validation rejects it, correct the same complete packet; do not return prose or author workflow evidence.'
    case 'resource-planner':
      return 'Call AssetManifest submit_resource_plan exactly once. Do not continue after the accepted call.'
    case 'resource-curator':
      return 'Call CommitResourceInventory exactly once with the complete bounded-match decision set, or with decisions: [] when resuming an existing prepared/applying receipt. The committed receipt is the terminal; do not return terminal JSON.'
    case 'resource-content-author':
      return 'Call CommitResourceContent exactly once with exactly the frozen writable document paths, or with the exact needs_inventory requirement IDs. The accepted call is the terminal; do not return terminal JSON or completion prose.'
    case 'atomic-task-planner':
      return 'Call SubmitAtomicTaskPlan exactly once. Assign every checklist ID to one task and declare resource/content dependencies directly on tasks.'
    case 'implementation-worker':
      return 'Call SubmitImplementationResult exactly once with status, changedPaths and one concise verification observation per task verification. Do not submit resource-binding arrays, verifiedArtifacts, terminal JSON or workflow evidence.'
    case 'implementation-auditor':
    case 'acceptance-validator':
      return 'Call SubmitValidationResult exactly once with status and findings. Passed requires no findings; failed or blocked requires actionable findings. Do not submit ownership IDs, terminal JSON or workflow evidence.'
    case 'change-impact-analyzer':
      return 'Call SubmitChangeImpactResult exactly once with classification, affected IDs and rationale.'
    case 'question-answerer':
      return 'Call SubmitQuestionAnswerResult exactly once with only the answer.'
  }
}

function documentAuthorTargetPath(request: WorkerDispatchRequest): string {
  return request.contract.documentSet === 'checklist'
    ? 'docs/acceptance/gameplay-checklist.md'
    : String(request.contract.foundationDocumentPath)
}
