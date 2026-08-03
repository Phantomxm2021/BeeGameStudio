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
  const { reviewArtifacts, changes, ...contract } = request.contract
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
  return [
    JSON.stringify({
      ...contract,
      ...(compactChanges !== undefined ? { changes: compactChanges } : {}),
    }),
    ...artifactBlocks,
    ...changeBlocks,
  ].join('\n')
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
          ? 'Use the service-projected upstream authority without reloading it. Follow the target-state instruction: read only the assigned target once when it already exists, otherwise write the new target directly. Perform the assigned document Write exactly once with the complete document, required version and updated_at. The completed Write is the terminal action.'
          : request.contract.authoringMode === 'repair-planning'
            ? 'Act only as the read-only Repair Lead for the single accepted finding in contract.repairDecisionTask. Submit one structured repair decision; the service owns its identity, subjects, order and durable plan ledger. Do not write or mutate project files.'
            : 'Read only the assigned current target exactly once, apply the locked repair decision, then perform exactly one Write for that document. Include every required content change plus the PATCH version and updated_at update in that mutation.',
        request.contract.documentSet === 'checklist'
          ? [
              'Author only docs/acceptance/gameplay-checklist.md from the eight approved foundation documents.',
              'Every acceptance task must be one Markdown checkbox line with a stable ID, observable behavior and evidence expectation. Cover core player paths, critical numeric boundaries, level/scene states, UI/audio feedback, visible resource outcomes and failure/recovery paths from the approved authority.',
              'Before the only file mutation, group the approved scenarios and count the final checklist. Target 24-40 checkbox tasks for an ordinary first delivery; exceed 40 only for additional independently observable approved scenarios, and never exceed 64 checkbox tasks. Group wave, enemy, input, resource, cue and table-row variants when they share one setup, action and observable outcome; do not create one task per document sentence or variant. One task may cite multiple approved facts while remaining independently pass/fail. Never write an oversized draft and rely on a second mutation in the same dispatch.',
              'Use the canonical form `- [ ] <stable-id> <observable check and evidence expectation>`; tables may add context but cannot replace checkbox tasks.',
              ...(request.contract.checklistRemediation
                ? [
                    'This is a bounded checklist correction. Resolve only contract.checklistRemediation issues and increment the checklist PATCH version exactly once with a new updated_at.',
                  ]
                : []),
              ...(request.contract.remediation
                ? [
                    'Resolve the complete active finding batch in contract.remediation. Increment the checklist PATCH version exactly once and update updated_at.',
                  ]
                : []),
              'Do not modify foundation documents, resources, the asset manifest or implementation files.',
            ].join(' ')
          : request.contract.authoringMode === 'repair-planning'
            ? [
                'This is the sole planning task for contract.repairDecisionTask.finding.',
                'Preserve its immutable authority and choose one minimal repair decision that closes its stated condition. The service owns identity, subjects, ordering and plan-ledger persistence.',
                'Do not add unrelated systems, broaden scope, reopen review, calculate exhaustive scenarios, write files, or create a second plan or finding queue.',
                'Submit the decision through SubmitDocumentRepairDecision exactly once.',
              ].join(' ')
            : [
                request.contract.authoringMode === 'initial'
                  ? `This is one authoring task in the durable foundation pass. Author exactly ${String(request.contract.foundationDocumentPath)} and no other document. The workflow service has already projected the complete required canonical upstream authority from these checkpoints: ${Array.isArray(request.contract.upstreamDocumentPaths) && request.contract.upstreamDocumentPaths.length ? request.contract.upstreamDocumentPaths.join(', ') : 'none'}. Follow the projected target-state instruction, never read another path, and never reload upstream documents. Write only the smallest decision-level authority needed by downstream documents and later implementation: original design inputs, rules, formulas and directly required boundaries. Do not perform reviewer work, prove complete strategy or numeric feasibility, run full wave/build simulations, enumerate tuning alternatives, optimize for a best solution, create exhaustive derived tables, repair other documents, or attempt to finish the eight-document pass in this session. The Initial Reviewer owns feasibility assessment and an accepted repair cycle owns later corrections.${typeof request.contract.changeRequest === 'string' && request.contract.changeRequest.trim() ? ' Read the existing target once as the controlled change baseline. Apply the confirmed change request to this document when it owns or consumes an affected fact; preserve unrelated valid content and increment this existing document PATCH version exactly once.' : ''}`
                  : 'This is one accepted foundation-remediation batch. Modify only the assigned canonical foundation documents.',
                'Every foundation document begins with YAML front matter containing document_id, a MAJOR.MINOR.PATCH version and an ISO 8601 UTC updated_at.',
                'Use exactly one fact owner: GDD owns player actions, loops, rules, states and outcomes; BALANCE_DESIGN owns units, formulas, economy, costs, growth, relative value and pressure/capability curves; LEVEL_SCENE_DESIGN owns level sequence, world/scene relationships, spatial topology, scale, routes, regions, spawn/goal points, camera design constraints, scene states and placement rules. Technical owns data consumption, runtime boundaries, loading, state/save, recovery and budgets; Art owns visual language and spatial readability; UI/UX owns information, input, interaction and interface states; Audio owns event-to-cue behavior; Asset Plan owns semantic resource responsibilities, format capabilities, source strategy and replaceable-file requirements.',
                'Do not duplicate independently changing facts across documents. Events, waves and numeric configuration will be executable JSON after approval; world, scene, hierarchy and instance placement will be executable YAML after approval. Foundation documents define design intent and stable references only, never engine-specific Prefabs/Scenes/components or final JSON/YAML payloads.',
                'Treat contract.systemDeliveryContract as the fixed BeeGame delivery boundary. Document the project through that one Manifest, those canonical roots, that content schema and those content kinds. Do not define a second Manifest, content root, schema, loader or runtime/source media substitute, even when such alternatives would be internally consistent across all eight documents.',
                'Define the smallest reusable semantic resource responsibility registry in docs/ASSET_PLAN.md and map runtime uses to those IDs separately. Do not create one resource requirement per destination, event, variant, screen or call site.',
                'Resource records and semantic requirements are many-to-many. One independent atlas, bank, model root or other logical asset file may contain reusable subresources and support several requirements; one requirement may use several resources. Never define independence or replacement as one physical file per requirement.',
                'Define exactly one resource loading path. A placeholder, including a programmatic placeholder, is an independent replaceable file under the normal resource root and is loaded through the same manifest and content reference as final media. Never specify a fallback after the placeholder, runtime-created substitute geometry, silent buffers, source-code media, or a second loader branch.',
                'Describe observable duties and target technical constraints. Do not preselect Pack identities, element IDs, source filenames or downloaded paths that have not been observed from the Resource Library.',
                request.contract.authoringMode === 'initial'
                  ? "For the current fact owner, record only the confirmed brief's minimum authoritative design decisions and directly chosen inputs. GDD states choices, tradeoffs and recovery rules; Balance states sources, sinks, base values and formulas; Level/Scene states the required topology and placements. Do not simulate builds or waves, derive a complete outcome table, tune against every scenario, or judge strategy, economy, numeric, pacing or spatial feasibility. The Initial Reviewer owns those comparisons and may create findings for missing or infeasible authority. Keep the design no more complex than the confirmed brief; when a domain truly does not exist, state that fact instead of inventing one."
                  : 'Apply only the accepted findings and their closure conditions. Preserve unrelated approved design authority and do not reopen complete strategy, economy, numeric, pacing or spatial analysis; Closure Reviewer owns the result judgment.',
                ...(request.contract.authoringMode === 'initial'
                  ? [
                      "Write a compact decision contract, not a narrative handbook. Include only this owner's stable IDs, chosen decisions, constraints, formulas, necessary bounds and downstream interface references. Do not repeat the confirmed brief, upstream prose, the fact-owner matrix, the generic system contract, rationale essays, examples, test cases, pseudocode, implementation steps or tuning process. Reference upstream IDs instead of restating their facts. Document completeness is judged across all eight owners by the Initial Reviewer, not by inflating one file.",
                    ]
                  : []),
                ...(request.contract.repairTask
                  ? [
                      `Repair exactly ${String(request.contract.foundationDocumentPath)} from contract.repairTask. Treat its groups as locked decisions: do not choose another solution, alter another document, reopen findings, or perform Closure Review. Preserve unrelated content and increment this document PATCH version exactly once with a new updated_at.`,
                    ]
                  : []),
                'Do not create the checklist, asset manifest, resources or implementation.',
              ].join(' '),
      ].join(' ')
    case 'document-reviewer':
      return [
        'Use contract.reviewAuthority plus contract.reviewArtifacts as the complete revision-bound source. The systemDeliveryContract review artifact is fixed system authority: project artifacts may apply it but may not redefine or override it. Do not reread workspace files or modify anything.',
        'Review only contract.currentCheckId. Put its auditable reasoning directly into criterion derivations, the check conclusion and findings, then submit that one check. Do not inspect or decide later checks, produce a separate transcript, or rely on max-token continuation.',
        'Produce exactly one accepted SubmitDocumentReviewCheck in this bounded dispatch. A rejected call is not accepted: correct only the current check and resubmit without prose or user confirmation.',
        'Report every material defect that blocks an implementable and reviewable game contract: contradictions, missing observable requirements, incomplete strategy, dominated choices, absent counterplay or recovery, broken economy/progression, infeasible numeric bounds, inconsistent formulas, discontinuous difficulty, or invalid resource plans. READY requires no findings.',
        'Submit contract.currentCheckId with pass/block, a concise conclusion, evidence and findingIds. Evidence and subjects must use only stable referenceId values from contract.referenceIndex.references; never submit path or anchor text. Every finding belongs to the current check and has one stable findingId, exact subjects, observable conflict, blocking reason, required action and closure condition. Subjects are exactly what requiredAction must change; contextual or already-correct artifacts remain evidence only. Do not submit owner, severity, a cycle verdict or another check.',
        'A subject reference must declare the owner derived for that reference in contract.referenceIndex. Foundation documents may be evidence for a resource defect but cannot be resource repair subjects. Foundation and checklist findings cannot carry resource IDs.',
        'Every check must include assessments. Only gameplay_strategy_viability, economy_progression_integrity, numeric_balance_feasibility, pacing_difficulty_coherence and level_scene_design_integrity use their exact three non-empty criterion assessments; every other check must use assessments: []. Every resource-owned finding must carry at least one current requirementId, resourceId or contentId on the corresponding Manifest/content subject.',
        'contract.priorFindings is the accepted unique-ownership ledger. If the same root defect is already represented by an equal, narrower, or broader canonical subject set under the same owner, cite it as context and do not create another finding ID. Report only a new defect uniquely owned by the current check.',
        'For every projected content file, fulfills may contain only exact current Manifest requirement IDs and resources may contain only exact current Manifest resource IDs. Requirement IDs are the sole content-to-approved-duty trace; never request document names, headings, prose labels or invented duty IDs in fulfills, and never request physical paths in either reference array.',
        'Whenever present, cross_document_consistency, technical_feasibility, content_structure_fitness and resource_content_consistency must cite an exact JSON Pointer from the systemDeliveryContract artifact in evidence. Finding subjects still point to the project artifact that must change.',
        request.contract.reviewScope === 'foundation'
          ? 'Review only the eight foundation documents with the twelve fixed checks. brief_alignment compares the confirmed brief and language contract. cross_document_consistency rejects contradictory or duplicated authority and blocks project documents that agree with each other but conflict with systemDeliveryContract. gameplay_completeness covers the complete player loop, state transitions, mechanics and outcomes. The four gameplay/balance checks must submit their exact structured criterion sets: gameplay_strategy_viability proves meaningful choices, checks dominant-strategy risk, and traces counterplay/recovery using GDD rules and Level/Scene spatial support; economy_progression_integrity reconciles Balance sources/sinks, affordability/growth, and exploit/deadlock risk; numeric_balance_feasibility derives Balance outcome bounds, relative value, and formula consistency; pacing_difficulty_coherence compares Balance pressure/capability curves against the Level/Scene sequence plus spikes/recovery. level_scene_design_integrity must submit spatial_gameplay_support, level_progression_coherence and scene_state_completeness, proving that topology, routes, regions, camera constraints, progression and scene states support the approved game. Use only cited document facts, show calculations or comparisons in derivation, and create a blocking finding when missing authoritative inputs prevent a central conclusion. A domain explicitly absent from the approved game may pass only by deriving that no hidden rule or resource flow is needed; do not invent a new subsystem. These checks establish a feasible design interval, not final feel or empirical balance. technical_feasibility compares every documented Manifest, root, schema and loading path against systemDeliveryContract; it covers target constraints, deterministic rules and one resource loading path: a programmatic placeholder is itself an independent replaceable file under the normal resource root, never a runtime/source substitute or second loader. art_direction_coherence covers visual duties, style and Level/Scene spatial readability. ui_audio_consistency covers UI, interaction and audio duties across documented gameplay and scene states. acceptance_observability requires every approved behavior, numeric boundary and scene state to have an observable outcome without requiring a checklist that does not exist yet. Also confirm one many-to-many semantic resource responsibility registry and no speculative Resource Library identity.'
          : 'Perform the comprehensive pre-implementation review with all seventeen fixed checks: rerun the twelve foundation checks, including every structured gameplay, balance, pacing and level/scene criterion, against the approved documents, then checklist_traceability, resource_semantic_fitness, content_structure_fitness, resource_content_consistency and implementation_readiness against the complete contract. Compare all nine project documents, the Manifest and supplied JSON/YAML content against systemDeliveryContract; agreement among project artifacts does not excuse a conflicting Manifest, root, schema, content kind, fact owner or loading path. Keep remediation ownership exact: a foundation finding targets only a foundation document, a checklist finding targets only the checklist, and every defect whose repair target is the Manifest or JSON/YAML content belongs to the appropriate resource_semantic_fitness, content_structure_fitness, resource_content_consistency or implementation_readiness check with its current semantic IDs. Do not duplicate one content or resource defect under a foundation check. Re-derive the approved game-design criteria from current JSON/YAML numeric, event, wave, world, scene, hierarchy and placement facts where present, but report a disagreement in those derived files through the resource-owned checks; do not replace document authority with implementation or runtime assumptions. Confirm each checklist item traces to approved behavior; resources semantically fulfill duties; content fact ownership follows the contract; Manifest, files and content references agree; every resource is verified and referenced; provenance is exact; and the contract is sufficient to plan implementation. Placeholders are standalone files loaded through the same sole path as final media. Block second Manifests, content roots, schemas or loaders, runtime/source substitutes, duplicate ownership and engine-specific demands. Do not require code, builds or runtime evidence before implementation.',
        request.contract.reviewMode === 'closure'
          ? 'This is one check in a bounded Closure Review. Recheck only the current check responsibilities, relevant prior findings and server-provided changes. An unresolved finding preserves the same findingId. A direct repair regression uses a new findingId and only changed paths. Do not reopen unrelated dimensions.'
          : 'This is one serial check in the single review cycle. Record every blocking defect owned by this check once; the service will continue to the next check and derive the final verdict after all checks.',
      ].join(' ')
    case 'resource-preparer':
      return [
        'Own the single Resource Production lane. Read the complete eight-document approved Foundation set once. Respect its fact owners: ASSET_PLAN and ART_DIRECTION provide resource and presentation responsibilities; LEVEL_SCENE_DESIGN provides YAML spatial facts; GDD, BALANCE_DESIGN, UI_UX_SPEC, AUDIO_DESIGN and TECHNICAL_DESIGN provide only the facts required by their JSON or loading projections. Do not read unapproved or parallel documents. Then submit the canonical v7 plan, acquire suitable Resource Library material, and author independent placeholders for remaining needs.',
        'Use ResourceLibrary as the Catalog and download authority. Browse Pack facts broadly and choose from observed metadata, previews, dependency and technical facts. Never infer suitability from filenames, keywords, regular expressions, project names or requirement IDs.',
        'Prepare all resources before implementation. Keep real PNG, JPEG, SVG, glTF, FBX, audio, font and other target-supported files under runtime_asset_root. A placeholder is a normal independent provisional file in the same inventory and must remain replaceable without a gameplay-code branch.',
        'The shell and nested agents are not available in this lane. Create placeholders only with AssetManifest author_provisional_resources: model duties use glTF/model, visual and UI duties use PNG with a visual asset_kind, and audio duties use WAV/audio-bank with the approved cue IDs. Declare these selected placeholder formats in project_target when submitting the resource plan. The tool writes and registers compact independent files in one operation. Use scoped Write only for JSON/YAML content under content_root. Acquire final or binary media through ResourceLibrary. Never retry or invent Bash, shell, terminal, Python or package-manager tools, and never hand-author runtime files.',
        'Write resource mappings, entities, UI, audio, events, waves and numeric configuration as JSON under content_root, using only these kinds: resource-registry, entity-definitions, ui-configuration, audio-configuration, event-definitions, wave-definitions, numeric-configuration. Write only world, scene, hierarchy and instance placement as YAML under content_root, using only these kinds: world-definition, scene-definitions, hierarchy-definition, placement-definitions. Every file uses schema beegame-content-v1 plus id, kind, fulfills, resources and data; one coherent file may fulfill several requirements. fulfills contains only exact requirement IDs from the current Manifest, never document names, headings or prose; use [] when a content file does not itself cover a resource requirement. resources contains only exact current Manifest resource IDs. Across the complete content set, cover every required requirement ID and reference every Manifest resource ID, including each separately imported library element. Never duplicate the same fact in JSON and YAML.',
        'Plan the complete JSON/YAML file set, fact owners, IDs and references before the first content mutation. Submit all independent Write calls in one parallel tool batch. Start another model/tool round only for a specific failed write; never write one file, reconsider the complete context, and then serially write the next file. Each content file still has exactly one successful mutation.',
        'Use generated_asset_root only for disposable target-adapter output. Do not hard-code Web, Unity, Godot, Unreal, Prefab, TSX or WOFF2 requirements in the shared contract.',
        'Persist only the v7 resource inventory and schema-valid JSON/YAML content files. Keep substitutable media out of gameplay source, and do not implement gameplay in this phase.',
        ...(request.contract.remediation
          ? [
              'Resolve the complete accepted resource finding batch in contract.remediation. Preserve requirement resource IDs and unaffected files; do not create a parallel repair path. When an approved replacement needs a file extension missing from the established target, author_provisional_resources adds only that extension in the same replacement commit. Remove content references first, then use prune_unbound_resources only for semantically invalid or superseded inventory whose resource ID is not a requirement ID.',
            ]
          : []),
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
        ? 'Call SubmitDocumentRepairDecision exactly once. Do not write files, return terminal JSON, or add completion prose.'
        : request.contract.authoringMode === 'remediation'
          ? 'After the one assigned Write, call SubmitDocumentAuthorResult exactly once with resolvedFindingIds: []. Closure remains owned by the Reviewer.'
          : 'Write the assigned document exactly once as the only mutation. Read only that target once first when the target-state instruction says it exists. The workflow service derives completion from the durable Write; do not submit a result, return terminal JSON, or add completion prose.'
    case 'document-reviewer':
      return 'Produce exactly one accepted SubmitDocumentReviewCheck with check and findings for contract.currentCheckId. Use only stable referenceId values. If validation rejects it, correct the same check; do not return prose or author workflow evidence.'
    case 'resource-preparer':
      return 'Do not author workflow evidence or terminal JSON. End with one concise completion or blocker summary; the workflow derives resourceIds and contentIds from canonical files.'
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
