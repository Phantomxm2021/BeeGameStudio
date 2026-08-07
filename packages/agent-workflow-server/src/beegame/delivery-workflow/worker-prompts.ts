import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_ARTIFACTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type WorkerDispatchRequest,
} from './types'

export function buildWorkerPrompt(request: WorkerDispatchRequest): string {
  const scope = request.allowedPaths?.length
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
    workerInstruction(request),
    'Use the confirmed contract and task payload as authority. Do not use chat transcript prose as product authority.',
    'Use only the tools supplied for this worker. Do not bind a resource decision to a particular game engine or platform unless the approved target explicitly requires it.',
    terminalInstruction(request),
    formatContract(request),
  ].join('\n')
}

function formatContract(request: WorkerDispatchRequest): string {
  if (request.workerType !== 'document-reviewer')
    return JSON.stringify(request.contract)
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
        request.contract.authoringMode === 'initial'
          ? 'Use the service-projected upstream authority and target baseline without reloading files. Submit the complete Markdown body without YAML front matter through CommitCanonicalDocument exactly once. The service owns document_id, version, updated_at, atomic persistence and the terminal action.'
          : request.contract.authoringMode === 'repair-planning'
            ? 'Act only as the read-only Repair Lead for the complete ordered repair graph in contract.repairPlanTask. Submit one structured plan containing one group decision and the necessary coordinated path decisions per service-owned group; do not write or mutate project files.'
            : 'Use the service-projected current target, apply only the locked repair decision, then submit the complete Markdown body without YAML front matter through CommitCanonicalDocument exactly once. The service owns PATCH version, updated_at, atomic persistence and recovery.',
        request.contract.documentSet === 'checklist'
          ? [
              'Author only docs/acceptance/gameplay-checklist.md from the eight approved foundation documents.',
              'Every acceptance task must be one Markdown checkbox line with a stable ID, observable behavior and evidence expectation. Cover core player paths, critical numeric boundaries, level/scene states, UI/audio feedback, visible resource outcomes and failure/recovery paths from the approved authority.',
              'Before the only file mutation, group the approved scenarios and count the final checklist. Target 24-40 checkbox tasks for an ordinary first delivery; exceed 40 only for additional independently observable approved scenarios, and never exceed 64 checkbox tasks. Group wave, enemy, input, resource, cue and table-row variants when they share one setup, action and observable outcome; do not create one task per document sentence or variant. One task may cite multiple approved facts while remaining independently pass/fail. Never write an oversized draft and rely on a second mutation in the same dispatch.',
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
            : [
                request.contract.authoringMode === 'initial'
                  ? `This is one authoring task in the durable foundation pass. Author exactly ${String(request.contract.foundationDocumentPath)} and no other document. The workflow service has already projected the complete required canonical upstream authority from these checkpoints: ${Array.isArray(request.contract.upstreamDocumentPaths) && request.contract.upstreamDocumentPaths.length ? request.contract.upstreamDocumentPaths.join(', ') : 'none'}. Use the projected target baseline and never reload project files. Write only the smallest decision-level authority needed by downstream documents and later implementation: original design inputs, rules, formulas and directly required boundaries. Do not perform reviewer work, prove complete strategy or numeric feasibility, run full wave/build simulations, enumerate tuning alternatives, optimize for a best solution, create exhaustive derived tables, repair other documents, or attempt to finish the eight-document pass in this session. The Initial Reviewer owns feasibility assessment and an accepted repair cycle owns later corrections.${typeof request.contract.changeRequest === 'string' && request.contract.changeRequest.trim() ? ' Apply the confirmed change request to the projected controlled baseline when this document owns or consumes an affected fact; preserve unrelated valid content. The service owns metadata revision.' : ''}`
                  : 'This is one accepted foundation-remediation batch. Modify only the assigned canonical foundation documents.',
                'The workflow service adds canonical YAML front matter after accepting the Markdown body; never include or edit document_id, version or updated_at.',
                'Use exactly one fact owner: GDD owns player actions, loops, rules, states and outcomes; BALANCE_DESIGN owns units, formulas, economy, costs, growth, relative value and pressure/capability curves; LEVEL_SCENE_DESIGN owns level sequence, world/scene relationships, spatial topology, scale, routes, regions, spawn/goal points, camera design constraints, scene states and placement rules. Technical owns data consumption, runtime boundaries, loading, state/save, recovery and budgets; Art owns visual language and spatial readability; UI/UX owns information, input, interaction and interface states; Audio owns event-to-cue behavior; Asset Plan owns semantic resource responsibilities, format capabilities, source strategy and replaceable-file requirements.',
                'Do not duplicate independently changing facts across documents. Events, waves and numeric configuration will be executable JSON after approval; world, scene, hierarchy and instance placement will be executable YAML after approval. Foundation documents define design intent and stable references only, never engine-specific Prefabs/Scenes/components or final JSON/YAML payloads.',
                'Treat contract.systemDeliveryContract as the fixed BeeGame delivery boundary. Document the project through that one Manifest, those canonical roots, that content schema and those content kinds. Do not define a second Manifest, content root, schema, loader or runtime/source media substitute, even when such alternatives would be internally consistent across all eight documents.',
                'Define the smallest reusable semantic resource responsibility registry in docs/ASSET_PLAN.md and map runtime uses to those IDs separately. Do not create one resource requirement per destination, event, variant, screen or call site.',
                'Resource records and semantic requirements are many-to-many. One independent atlas, bank, model root or other logical asset file may contain reusable subresources and support several requirements; one requirement may use several resources. Never define independence or replacement as one physical file per requirement.',
                'Define exactly one resource loading path. A placeholder, including a programmatic placeholder, is an independent replaceable file under the normal resource root and is loaded through the same manifest and content reference as final media. Never specify a fallback after the placeholder, runtime-created substitute geometry, silent buffers, source-code media, or a second loader branch.',
                'Describe observable duties and target technical constraints. Do not preselect Pack identities, element IDs, source filenames or downloaded paths that have not been observed from the Resource Library.',
                request.contract.authoringMode === 'initial'
                  ? "For the current fact owner, record only the confirmed brief's minimum authoritative design decisions and directly chosen inputs. GDD states choices, tradeoffs and recovery rules; Balance states sources, sinks, base values and formulas; Level/Scene states the required topology and placements. Do not simulate builds or waves, derive a complete outcome table, tune against every scenario, or judge strategy, economy, numeric, pacing or spatial feasibility. The Initial Reviewer owns those comparisons and may create findings for missing or infeasible authority. Keep the design no more complex than the confirmed brief; when a domain truly does not exist, state that fact instead of inventing one."
                  : 'Apply only the accepted findings and their required outcomes. Preserve unrelated approved design authority and do not reopen complete strategy, economy, numeric, pacing or spatial analysis; Closure Reviewer owns the result judgment.',
                ...(request.contract.authoringMode === 'initial'
                  ? [
                      "Write a compact decision contract, not a narrative handbook. Include only this owner's stable IDs, chosen decisions, constraints, formulas, necessary bounds and downstream interface references. Do not repeat the confirmed brief, upstream prose, the fact-owner matrix, the generic system contract, rationale essays, examples, test cases, pseudocode, implementation steps or tuning process. Reference upstream IDs instead of restating their facts. Document completeness is judged across all eight owners by the Initial Reviewer, not by inflating one file.",
                      'A downstream owner may specialize only product behavior already authorized by the Confirmed Brief, GDD, or its legitimate projected upstream owner. Do not invent a new player-visible system, settings surface, state machine, economy mechanism, resource duty, or obligation that another owner would have to implement.',
                    ]
                  : []),
                ...(request.contract.repairTask
                  ? [
                      `Repair exactly ${String(request.contract.foundationDocumentPath)} from contract.repairTask. Treat its groups as locked decisions: do not choose another solution, alter another document, reopen findings, or perform Closure Review. Preserve unrelated content; the service owns metadata and the durable commit.`,
                    ]
                  : []),
                'Do not create the checklist, asset manifest, resources or implementation.',
              ].join(' '),
      ].join(' ')
    case 'document-reviewer':
      return [
        'Use contract.reviewAuthority plus contract.reviewArtifacts as the complete revision-bound source. The systemDeliveryContract review artifact is fixed system authority: project artifacts may apply it but may not redefine or override it. Do not reread workspace files or modify anything.',
        'Review exactly the ordered contract.currentCheckIds packet. Put each check auditable reasoning directly into its criterion derivations, conclusion and findings. Do not inspect checks outside the packet, produce a separate transcript, or rely on max-token continuation.',
        'Keep the structured result decision-dense. A criterion derivation contains only the cited facts and the minimum formula, comparison or state-transition chain needed to prove its status; its conclusion is one direct decision. Do not summarize whole documents, repeat evidence prose, narrate the review process, restate another criterion, or add analysis after the accepted tool call. Findings contain only the distinct root defect, impact and required authority outcome.',
        'Produce exactly one accepted SubmitDocumentReviewPacket in this bounded dispatch. Submit one checks array in contract.currentCheckIds order, without check IDs. The packet is transactional: a rejected call accepts nothing, so correct and resubmit the same complete packet without prose or user confirmation.',
        'Report every material defect that blocks an implementable and reviewable game contract: contradictions, missing observable requirements, incomplete strategy, dominated choices, absent counterplay or recovery, broken economy/progression, infeasible numeric bounds, inconsistent formulas, discontinuous difficulty, or invalid resource plans. READY requires no findings.',
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
        'Create the canonical Resource Production plan from only contract.authorityPaths and the confirmed brief. ASSET_PLAN owns the complete resource duties, ART_DIRECTION owns presentation constraints, and TECHNICAL_DESIGN owns runtime-consumable output formats. Do not reopen review or read other project documents.',
        'Use AssetManifest submit_resource_plan exactly once. The service owns Manifest version, resource policy and canonical roots. Submit runtime target capabilities and complete stable requirements. Every requirement must include one structured acquisition_profile containing only canonical dimensions, asset kinds, usage tags, source-intrinsic required capabilities and approved style values. Composition, placement, scaling, connection, scene assembly and runtime behavior are content or implementation duties, never source-intrinsic acquisition constraints. Never infer this profile from IDs or filenames.',
        'Never use target output formats as source-format admission rules. Source material may use another format when the current target adapter declares a deterministic direct or conversion delivery capability.',
        'Do not browse the Resource Library, create or download files, write JSON/YAML, or implement gameplay. A successful plan submission ends this dispatch.',
      ].join(' ')
    case 'resource-curator':
      return [
        'Acquire or author the complete resource inventory for the established Manifest plan. Read only contract.authorityPaths and the Manifest. Do not modify requirements or content files.',
        'Call ResourceLibrary match_requirements once. Choose one returned bundle per requirement and judge only its authored metadata and technical facts, never filename, keywords, regular expressions, project names or requirement IDs.',
        'A suitable candidate may satisfy its requirement through direct delivery or a declared target conversion adapter. Choose exact candidate identities. Use a placeholder decision for every service-proven no-match group so missing library material never stops delivery.',
        'Submit one complete decision set through CommitResourceInventory. It is the only mutation and terminal operation, preserves exact dependency closure, resumes durable progress after interruption, and derives bindings from the committed inventory. Do not write content or gameplay code.',
      ].join(' ')
    case 'resource-content-author':
      return [
        'Build the complete engine-neutral JSON/YAML content description from contract.authorityPaths and the frozen canonical identities in contract.requiredRequirementIds, contract.verifiedResourceIds and contract.inventoryBindings. Do not read assets/asset-manifest.json or assets/manifest/**, browse the Catalog, download, create or register resources, change the plan, or write gameplay code.',
        'Use exactly contract.schema. JSON owns only contract.jsonKinds and YAML owns only contract.yamlKinds. Every submitted document contains exactly path, schema, id, kind, fulfills, resources and data. One coherent document may fulfill several requirements. fulfills contains only exact contract requirement IDs and resources contains only exact contract resource IDs. The single resource-registry data.bindings is the only requirement-to-resource binding representation and must agree with contract.inventoryBindings. Never duplicate the same fact in JSON and YAML.',
        'Plan the complete project-required content set before mutation, then call CommitResourceContent once with every unlocked document. The service serializes JSON/YAML and validates the merged set before replacing any file. Do not use generic file mutation tools.',
        'contract.preservedPaths are already-valid canonical documents. Read them only when needed as authority and never resubmit or rewrite them. Repair or create only unlocked documents needed to eliminate contract.currentContentIssues and missing coverage.',
        'If verified inventory is genuinely missing, call CommitResourceContent needs_inventory with the exact missing requirement IDs. Do not invent a path, identity or embedded substitute.',
      ].join(' ')
    case 'atomic-task-planner':
      return [
        'Use contract.planningDocuments plus resourceIds and contentIds as the complete authority. Do not read the workspace, edit files or search resources.',
        'Submit one dependency graph through SubmitAtomicTaskPlan. Each task owns durable implementation artifacts and project-owned verification actions. Checklist items have one owner; resource and content IDs are read-only dependencies.',
        'Resources and content are ready before implementation. Tasks consume declared files; they do not download, generate substitute media or mutate assets/asset-manifest.json.',
        'Do not create trailing cleanup, final verification or acceptance tasks. The workflow owns those phases.',
      ].join(' ')
    case 'implementation-worker':
      return [
        'Implement the active atomic task completely within allowedPaths. Use only current source, direct dependencies, verified resources and declared JSON/YAML content.',
        'Do not read canonical design documents, workflow logs or transcripts. Do not search or download resources, generate substitute media or edit assets/asset-manifest.json.',
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
        : 'Submit the assigned complete Markdown body through CommitCanonicalDocument exactly once. Do not include YAML front matter, call generic file tools, return terminal JSON, or add completion prose.'
    case 'document-reviewer':
      return 'Produce exactly one accepted SubmitDocumentReviewPacket containing the complete ordered checks array for contract.currentCheckIds. Use only stable referenceId values. If validation rejects it, correct the same complete packet; do not return prose or author workflow evidence.'
    case 'resource-planner':
      return 'Call AssetManifest submit_resource_plan exactly once. Do not continue after the accepted call.'
    case 'resource-curator':
      return 'Call CommitResourceInventory exactly once with the complete bounded-match decision set. The committed receipt is the terminal; do not return terminal JSON.'
    case 'resource-content-author':
      return 'Call CommitResourceContent exactly once with either the complete canonical commit or the exact needs_inventory requirement IDs. The accepted call is the terminal; do not return terminal JSON or completion prose.'
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
