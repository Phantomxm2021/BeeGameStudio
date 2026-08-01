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
        'Read each assigned document once, plan its complete change, then mutate that document at most once with Write or MultiEdit. Include every content change plus the required version and updated_at update in that single mutation. Do not reread a document after mutating it. Submit the structured result immediately after all assigned documents are mutated.',
        request.contract.documentSet === 'checklist'
        ? [
            'Author only docs/acceptance/gameplay-checklist.md from the six approved foundation documents.',
            'Every acceptance task must be one Markdown checkbox line with a stable ID, observable behavior and evidence expectation.',
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
        : [
            'Author only the six foundation documents. Each begins with YAML front matter containing document_id, a MAJOR.MINOR.PATCH version and an ISO 8601 UTC updated_at.',
            'Treat contract.systemDeliveryContract as the fixed BeeGame delivery boundary. Document the project through that one Manifest, those canonical roots, that content schema and those content kinds. Do not define a second Manifest, content root, schema, loader or runtime/source media substitute, even when such alternatives would be internally consistent across all six documents.',
            ...(Array.isArray(request.contract.existingDocumentPaths) &&
            request.contract.existingDocumentPaths.length
              ? [
                  `The following canonical documents are durable checkpoints from this same initial drafting pass: ${request.contract.existingDocumentPaths.join(', ')}. Read and preserve their completed content; finish the missing foundation documents and change an existing checkpoint only when required for cross-document consistency.`,
                ]
              : []),
            'Define the smallest reusable semantic resource responsibility registry in docs/ASSET_PLAN.md and map runtime uses to those IDs separately. Do not create one resource requirement per destination, event, variant, screen or call site.',
            'Resource records and semantic requirements are many-to-many. One independent atlas, bank, model root or other logical asset file may contain reusable subresources and support several requirements; one requirement may use several resources. Never define independence or replacement as one physical file per requirement.',
            'Define exactly one resource loading path. A placeholder, including a programmatic placeholder, is an independent replaceable file under the normal resource root and is loaded through the same manifest and content reference as final media. Never specify a fallback after the placeholder, runtime-created substitute geometry, silent buffers, source-code media, or a second loader branch.',
            'Describe observable duties and target technical constraints. Do not preselect Pack identities, element IDs, source filenames or downloaded paths that have not been observed from the Resource Library.',
            ...(request.contract.remediation
              ? [
                  'Resolve the complete active finding batch in contract.remediation. Increment each changed document PATCH version exactly once and update its updated_at.',
                ]
              : []),
            'Do not create the checklist, asset manifest, resources or implementation.',
          ].join(' '),
      ].join(' ')
    case 'document-reviewer':
      return [
        'Use contract.reviewAuthority plus contract.reviewArtifacts as the complete revision-bound source. The systemDeliveryContract review artifact is fixed system authority: project artifacts may apply it but may not redefine or override it. Do not reread workspace files or modify anything.',
        'Perform one bounded review pass and call SubmitDocumentReviewResult exactly once in this turn. Do not narrate the review, defer submission, or return prose instead of the tool call.',
        'Report only blocking contradictions, missing observable requirements, impossible calculations or invalid resource plans. READY requires no findings.',
        'Submit every contract.requiredCheckId exactly once with pass/block, a concise conclusion, evidence, and referenced findingIds. Every finding has one stable findingId, one checkId, one owner, exact artifact subjects, an observable conflict, blocking reason, required action and closure condition. Markdown anchors copy an exact heading; JSON anchors are exact JSON Pointers; YAML content anchors use its exact stable content id. Resource findings name current requirement, resource or content IDs on their subjects; foundation and checklist findings cannot carry resource IDs.',
        'Whenever present, cross_document_consistency, technical_feasibility, content_structure_fitness and resource_content_consistency must cite an exact JSON Pointer from the systemDeliveryContract artifact in evidence. Finding subjects still point to the project artifact that must change.',
        request.contract.reviewScope === 'foundation'
          ? 'Review only the six foundation documents with the seven fixed checks. brief_alignment compares the confirmed brief and language contract. cross_document_consistency rejects contradictory or duplicated authority and blocks project documents that agree with each other but conflict with systemDeliveryContract. gameplay_completeness covers the complete player loop, state transitions, mechanics and outcomes. technical_feasibility compares every documented Manifest, root, schema and loading path against systemDeliveryContract; it covers target constraints, deterministic rules and one resource loading path: a programmatic placeholder is itself an independent replaceable file under the normal resource root, never a runtime/source substitute or second loader. art_direction_coherence covers visual duties and style. ui_audio_consistency covers UI, interaction and audio duties across documents. acceptance_observability requires every approved behavior to have an observable outcome without requiring a checklist that does not exist yet. Also confirm one many-to-many semantic resource responsibility registry and no speculative Resource Library identity.'
          : 'Perform the comprehensive pre-implementation review with all twelve fixed checks: rerun the seven foundation checks against the now-complete contract, then checklist_traceability, resource_semantic_fitness, content_structure_fitness, resource_content_consistency and implementation_readiness. Compare all seven documents, the Manifest and supplied JSON/YAML content against systemDeliveryContract; agreement among project artifacts does not excuse a conflicting Manifest, root, schema, content kind, fact owner or loading path. Confirm each checklist item traces to approved behavior; resources semantically fulfill duties; content fact ownership follows the contract; Manifest, files and content references agree; every resource is verified and referenced; provenance is exact; and the contract is sufficient to plan implementation. Placeholders are standalone files loaded through the same sole path as final media. Block second Manifests, content roots, schemas or loaders, runtime/source substitutes, duplicate ownership and engine-specific demands. Do not require code, builds or runtime evidence before implementation.',
        request.contract.reviewMode === 'closure'
          ? 'This is a bounded Closure Review. Recheck only contract.priorFindings and server-provided changes against contract.requiredCheckIds. An unresolved finding preserves the same findingId. A direct repair regression uses a new findingId and lists only paths from contract.changedPaths in regressionPaths. Do not reopen unrelated review dimensions.'
          : 'This is the one open review for the revision. Return the complete blocking set once.',
        typeof request.contract.transportCorrection === 'string'
          ? 'The prior structured submission was rejected for the exact protocol reason in contract.transportCorrection. Correct that protocol error in this submission; do not relax evidence or subject identity and do not change a semantic conclusion merely to pass validation.'
          : '',
      ].join(' ')
    case 'resource-preparer':
      return [
        'Own the single Resource Production lane. Read the approved ASSET_PLAN and ART_DIRECTION, then submit the canonical v7 plan, acquire suitable Resource Library material, and author independent placeholders for remaining needs.',
        'Use ResourceLibrary as the Catalog and download authority. Browse Pack facts broadly and choose from observed metadata, previews, dependency and technical facts. Never infer suitability from filenames, keywords, regular expressions, project names or requirement IDs.',
        'Prepare all resources before implementation. Keep real PNG, JPEG, SVG, glTF, FBX, audio, font and other target-supported files under runtime_asset_root. A placeholder is a normal independent provisional file in the same inventory and must remain replaceable without a gameplay-code branch.',
        'Write resource mappings, entities, UI, audio, events, waves and numeric configuration as JSON under content_root, using only these kinds: resource-registry, entity-definitions, ui-configuration, audio-configuration, event-definitions, wave-definitions, numeric-configuration. Write only world, scene, hierarchy and instance placement as YAML under content_root, using only these kinds: world-definition, scene-definitions, hierarchy-definition, placement-definitions. Every file uses schema beegame-content-v1 plus id, kind, fulfills, resources and data; one coherent file may fulfill several requirements. Never duplicate the same fact in JSON and YAML.',
        'Use generated_asset_root only for disposable target-adapter output. Do not hard-code Web, Unity, Godot, Unreal, Prefab, TSX or WOFF2 requirements in the shared contract.',
        'Persist only the v7 resource inventory and schema-valid JSON/YAML content files. Keep substitutable media out of gameplay source, and do not implement gameplay in this phase.',
        ...(request.contract.remediation ? ['Resolve the complete current resource or content finding batch in place. Preserve stable IDs and unaffected files; do not create a parallel repair path.'] : []),
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
      return request.contract.remediation
        ? 'Call SubmitDocumentAuthorResult exactly once with resolvedFindingIds containing exactly the findingId of every finding in contract.remediation.findings and no other value. Do not return terminal JSON or author workflow evidence.'
        : 'Call SubmitDocumentAuthorResult exactly once with resolvedFindingIds: []. Deterministic checklistRemediation issue text is not a semantic finding ID. Do not return terminal JSON or author workflow evidence.'
    case 'document-reviewer':
      return 'Call SubmitDocumentReviewResult exactly once with verdict and findings. Do not return terminal JSON or author workflow evidence.'
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
