import {
  CANONICAL_PROJECT_ARTIFACTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type WorkerDispatchRequest,
} from './types'

const DOCUMENT_AUTHORING_DENSITY_INSTRUCTION =
  'Treat each section as the final decision record, not a derivation transcript. The complete Markdown response must not exceed 48,000 UTF-8 bytes and must finish every required section and production material within that single response; compact earlier sections rather than omit or truncate any later required content. Production materials are canonical compact views of owned decisions and must not repeat section narrative. Use no more than one worked example per formula or system boundary unless distinct contract-required cases prove different behavior. Include only materially distinct boundary and acceptance scenarios; do not enumerate equivalent cases.'

export function buildWorkerPrompt(request: WorkerDispatchRequest): string {
  const initialFoundationAuthor =
    request.workerType === 'document-author' &&
    request.contract.documentSet === 'foundation' &&
    request.contract.authoringMode === 'initial'
  const streamedFoundationAuthor =
    request.workerType === 'document-author' &&
    request.contract.documentSet === 'foundation' &&
    (request.contract.authoringMode === 'initial' ||
      request.contract.authoringMode === 'parallel-draft')
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
  const pathScopeLabel = resourceContentReadPaths.length
    ? 'Readable task paths'
    : 'Writable paths'
  const pathScope = resourceContentReadPaths.length
    ? resourceContentReadPaths.join(', ')
    : request.allowedPaths?.length
      ? request.allowedPaths.join(', ')
      : 'read-only'
  const foundationAuthorArtifacts =
    request.workerType === 'document-author' &&
    request.contract.documentSet === 'foundation' &&
    ['initial', 'parallel-draft'].includes(
      String(request.contract.authoringMode),
    ) &&
    typeof request.contract.foundationDocumentPath === 'string'
      ? [
          ...(Array.isArray(request.contract.availableUpstreamPaths)
            ? request.contract.availableUpstreamPaths
            : Array.isArray(request.contract.upstreamDocumentPaths)
              ? request.contract.upstreamDocumentPaths
              : []),
          request.contract.foundationDocumentPath,
        ].filter(
          (path, index, paths): path is string =>
            typeof path === 'string' && paths.indexOf(path) === index,
        )
      : undefined
  const canonicalArtifacts =
    foundationAuthorArtifacts ??
    (request.workerType === 'document-author' &&
          request.contract.documentSet === 'checklist'
        ? CANONICAL_PROJECT_DOCUMENTS
        : CANONICAL_PROJECT_ARTIFACTS)
  return [
    `BeeGame delivery worker: ${request.workerType}`,
    initialFoundationAuthor ? undefined : `Phase: ${request.phase}`,
    `Run: ${request.runId}`,
    initialFoundationAuthor ? undefined : `Revision: ${request.revision}`,
    initialFoundationAuthor
      ? undefined
      : `Workspace root: ${request.workspacePath}`,
    `${pathScopeLabel}: ${pathScope}`,
    `Canonical artifacts: ${canonicalArtifacts.join(', ')}`,
    'The durable confirmed brief context and its digest are the product authority for this run.',
    'Confirmed Brief settings are higher authority than free-form idea text; on conflict, do not preserve both sides as simultaneous requirements.',
    workerInstruction(request),
    initialFoundationAuthor
      ? undefined
      : 'Use the confirmed contract and task payload as authority. Do not use chat transcript prose as product authority.',
    streamedFoundationAuthor
      ? undefined
      : 'Use Bee Game Studio normally. Its native tools, thinking, permissions, context management, and completion behavior remain available. Do not bind a resource decision to a particular game engine or platform unless the approved target explicitly requires it.',
    terminalInstruction(request),
    formatContract(request),
  ].join('\n')
}

function formatContract(request: WorkerDispatchRequest): string {
  if (request.workerType === 'resource-content-author')
    return JSON.stringify(formatResourceContentContract(request.contract))
  const {
    confirmedBriefContext: _confirmedBriefContext,
    ...contractWithoutDuplicatedBrief
  } = request.contract
  const initialFoundationAuthor =
    request.workerType === 'document-author' &&
    request.contract.documentSet === 'foundation' &&
    ['initial', 'parallel-draft'].includes(
      String(request.contract.authoringMode),
    )
  if (initialFoundationAuthor) {
    delete contractWithoutDuplicatedBrief.maxNativeWriteContentChars
    delete contractWithoutDuplicatedBrief.nativeWriteLimit
    delete contractWithoutDuplicatedBrief.upstreamDocumentPaths
    const completeDocumentContract =
      contractWithoutDuplicatedBrief.completeDocumentContract
    if (
      completeDocumentContract &&
      typeof completeDocumentContract === 'object' &&
      !Array.isArray(completeDocumentContract)
    ) {
      const {
        allowedUpstreamPaths: _allowedUpstreamPaths,
        upstreamSections: _upstreamSections,
        sections,
        productionMaterials,
        ...authorDocumentContract
      } = completeDocumentContract as Record<string, unknown>
      contractWithoutDuplicatedBrief.completeDocumentContract = {
        ...authorDocumentContract,
        mechanicalMarkdownProtocol: {
          documentTitle: {
            position: 'first_non_blank_line',
            headingPrefix: '# ',
          },
          executiveSummary: {
            heading: '## Executive Summary',
          },
          sections: Array.isArray(sections)
            ? sections.map(value => {
                const section = value as Record<string, unknown>
                return {
                  ...section,
                  heading: `## ${section.title}`,
                }
              })
            : sections,
          productionMaterials: {
            heading: '## Production Materials',
            entries: Array.isArray(productionMaterials)
              ? productionMaterials.map(value => {
                  const material = value as Record<string, unknown>
                  return {
                    ...material,
                    heading: `### ${material.title}`,
                  }
                })
              : productionMaterials,
          },
        },
      }
    }
    if (request.contract.foundationDocumentPath !== 'docs/TECHNICAL_DESIGN.md')
      delete contractWithoutDuplicatedBrief.systemDeliveryContract
  }
  return JSON.stringify(contractWithoutDuplicatedBrief)
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
      Object.hasOwn(contract, key) ? [[key, contract[key]]] : [],
    ),
  )
  return projection
}

function workerInstruction(request: WorkerDispatchRequest): string {
  switch (request.workerType) {
    case 'foundation-fact-extractor':
      return [
        'Extract only the declared fact keys from the exact packet sections. The packet is the sole input; do not read project files, call Read, Grep or Glob, write files, mutate the platform, or emit issues.',
        'Account for every assigned key exactly once as present, absent, or uncertain. Present values must be typed and cite exact evidence lines from the packet. Do not return section prose or values not declared by the packet.',
      ].join(' ')
    case 'foundation-semantic-reviewer':
      return [
        'Review only the exact semantic packet sections, normalized facts, and deterministic references. Do not read project files, call Read, Grep or Glob, write files, mutate the platform, or expand context.',
        'Return only PASS, ISSUES, or UNDECIDABLE in the supplied StructuredOutput schema. Issue drafts must use only assigned section keys and contain no IDs. Do not return Markdown, prose explanations, or additional fields.',
      ].join(' ')
    case 'foundation-document-reviser':
      return [
        'Revise only the assigned staged canonical Markdown document and exact target sections for the supplied Issue Registry issue IDs. Read and write only the staged path; never modify the canonical document or unrelated paths.',
        'Preserve all section markers and document structure. After the bounded revision is complete, call SubmitFoundationRevisionResult exactly once with only changedSectionIds; the service owns task identity, round, document and issue authority.',
      ].join(' ')
    case 'document-author':
      return [
        request.contract.documentSet === 'checklist'
          ? "Author the approved gameplay checklist directly at docs/acceptance/gameplay-checklist.md using Bee Game Studio's normal workflow."
          : request.contract.authoringMode === 'initial' ||
              request.contract.authoringMode === 'parallel-draft'
            ? 'Return exactly one complete raw Markdown body as the visible response. Do not call tools, do not return JSON, do not use a code fence, and do not add text before or after the document.'
            : 'Unsupported Foundation document authoring mode.',
        request.contract.documentSet === 'checklist'
          ? [
              'Author only docs/acceptance/gameplay-checklist.md from the eight approved foundation documents.',
              'Every acceptance task must be one Markdown checkbox line with a stable ID, observable behavior and evidence expectation. Cover core player paths, critical numeric boundaries, level/scene states, UI/audio feedback, visible resource outcomes and failure/recovery paths from the approved authority.',
              'Group the approved scenarios before authoring. Target 24-40 checkbox tasks for an ordinary first delivery; exceed 40 only for additional independently observable approved scenarios, and never exceed 64 checkbox tasks. Group wave, enemy, input, resource, cue and table-row variants when they share one setup, action and observable outcome; do not create one task per document sentence or variant. One task may cite multiple approved facts while remaining independently pass/fail.',
              'Use the canonical form `- [ ] <stable-id> <observable check and evidence expectation>`; tables may add context but cannot replace checkbox tasks.',
              'Do not modify foundation documents, resources, the asset manifest or implementation files.',
            ].join(' ')
          : request.contract.authoringMode === 'parallel-draft'
            ? [
                `Return exactly one complete raw Markdown body for ${String(request.contract.foundationDocumentPath)} as the visible response. Do not call tools, return JSON, use a code fence, or add a completion explanation.`,
                'Use only the available committed upstream authority named by the contract. Record genuinely unavailable upstream decisions as explicit assumptions in the existing dependency and risk sections; do not invent a second document track.',
                DOCUMENT_AUTHORING_DENSITY_INSTRUCTION,
                'Write the complete canonical Markdown body without YAML front matter or beegame protocol comments. BGS injects all beegame protocol comments and performs mechanical contract validation after the turn, so do not add a redundant final verification or explanation pass.',
              ].join(' ')
            : request.contract.authoringMode === 'initial'
              ? [
                  `This is one complete human development discipline assignment. Return exactly the complete raw Markdown body for ${String(request.contract.foundationDocumentPath)} as the visible response. Do not call tools, return JSON, use a code fence, or add a completion explanation. Together, the eight documents must be sufficient for a human game development team to plan, build, produce, test, release and operate the approved game. Resolve this discipline now rather than delegating completeness to review.`,
                  'The assigned Markdown must be complete and production-usable when the turn ends. The Markdown body is the sole human document authority and contains exactly one # document title. The first non-blank line must be the single # document title. Follow canonical structures in order: ## Executive Summary, every contract section, then every production material in canonical order. Do not author YAML front matter or beegame protocol comments. BGS injects document_id, version and updated_at deterministically. BGS injects all beegame protocol comments after the turn. Do not add an Audit Appendix; BGS writes those results to workflow audit metadata.',
                  'Use exactly one fact owner: GDD owns player actions, loops, rules, states and outcomes; BALANCE_DESIGN owns units, sources, sinks, base values, formulas, bounds and tuning evidence; LEVEL_SCENE_DESIGN owns topology, placements, pacing and production acceptance; Technical owns runtime and data boundaries; Art owns visual language; UI/UX owns interaction; Audio owns event-to-cue behavior; Asset Plan owns resource responsibilities and production sourcing.',
                  'Define each authoritative fact once. Prefer production-dense tables and matrices over repeated narrative; every section must add implementation authority. Do not restate the confirmed brief, upstream text or another section; reference stable authority. Keep rationale to the minimum needed for a production decision.',
                  DOCUMENT_AUTHORING_DENSITY_INSTRUCTION,
                  'Provide concrete choices, tradeoffs, examples, units, boundaries and observable criteria so the discipline is implementable and testable. A downstream owner may specialize only already-authorized behavior. Do not author .beegame metadata. Do not claim verified license status without concrete evidence.',
                  'BGS performs mechanical contract validation after the turn and the dedicated Review stage owns independent audit; do not launch or wait for an independent review or audit.',
                  ...(request.contract.foundationDocumentPath ===
                  'docs/ASSET_PLAN.md'
                    ? [
                        'Define a reusable many-to-many semantic resource responsibility registry, source and license evidence, dependency and milestone ownership. Do not create one physical file per destination or invent Resource Library identities that were not observed.',
                      ]
                    : []),
                  ...(request.contract.foundationDocumentPath ===
                  'docs/TECHNICAL_DESIGN.md'
                    ? [
                        'Apply contract.systemDeliveryContract as the fixed delivery boundary and define one Manifest, one content root, one schema and one resource loading path without binding an unapproved engine or platform.',
                      ]
                    : []),
                  ...(typeof request.contract.changeRequest === 'string' &&
                  request.contract.changeRequest.trim()
                    ? [
                        'Apply the confirmed change request to the controlled baseline and preserve unrelated valid content.',
                      ]
                    : []),
                  'Do not create the checklist, asset manifest, resources or implementation.',
                ].join(' ')
              : 'Unsupported Foundation document authoring mode.',
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
        `Build the engine-neutral JSON/YAML documents at the exact writable paths in contract.repairPaths: ${writablePaths.length ? writablePaths.join(', ') : '<none>'}. Submit one documents object keyed by those exact paths. Bee Game Studio's native tools remain available for inspection, reasoning, and verification. Use contract.authorityPaths, contract.requiredRequirementIds, contract.verifiedResourceIds, and contract.inventoryBindings as the task authority. CommitResourceContent is the atomic delivery interface for the final document set and preserves every canonical document outside the writable path list.`,
        'Use exactly contract.schema. JSON owns only contract.jsonKinds and YAML owns only contract.yamlKinds. Every submitted document contains exactly path, schema, id, kind, fulfills, resources and data. One coherent document may fulfill several requirements. fulfills contains only exact contract requirement IDs and resources contains only exact contract resource IDs. The single resource-registry data.bindings is the only requirement-to-resource binding representation and must agree with contract.inventoryBindings. Never duplicate the same fact in JSON and YAML.',
        'When the complete writable set is ready, call CommitResourceContent once. The service serializes JSON/YAML and validates the merged set before replacing any file.',
        'The service preserves every canonical document outside the exact writable path list during the atomic commit; never read, resubmit or rewrite those documents.',
        'If verified inventory is genuinely missing, call CommitResourceContent needs_inventory with the exact missing requirement IDs. Do not invent a path, identity or embedded substitute.',
      ].join(' ')
    }
    case 'atomic-task-planner':
      return [
        'Use contract.planningDocuments plus resourceIds and contentIds as the acceptance authority. Bee Game Studio may inspect the current workspace and use its native tools as needed to produce a correct plan.',
        'Submit one dependency graph through SubmitAtomicTaskPlan. Each task owns durable implementation artifacts and project-owned verification actions. Checklist items have one owner; resource and content IDs are read-only dependencies.',
        'Resources and content are ready before implementation. Tasks consume declared files; they do not download, generate substitute media or mutate assets/asset-manifest.json.',
        'Do not create trailing cleanup, final verification or acceptance tasks. The workflow owns those phases.',
      ].join(' ')
    case 'implementation-worker':
      return [
        'Implement the active atomic task completely within allowedPaths. Treat current source, direct dependencies, verified resources, declared JSON/YAML content, and canonical design documents as available context.',
        'Bee Game Studio may inspect the project and use its native tools as needed. Keep changes within the active task deliverables; resource acquisition and manifest changes remain separate workflow deliverables.',
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
    case 'foundation-fact-extractor':
      return 'Return exactly one native StructuredOutput value conforming to the supplied foundation fact schema with taskId, revision, packetDigest, and the complete bounded result set. Do not call project tools, return terminal JSON as prose, or add completion text.'
    case 'foundation-semantic-reviewer':
      return 'Return exactly one native StructuredOutput value conforming to the supplied semantic schema. Use only PASS, ISSUES, or UNDECIDABLE; do not return Markdown or explanatory text.'
    case 'foundation-document-reviser':
      return 'Complete the assigned staged Markdown revision, call SubmitFoundationRevisionResult exactly once, and end the turn normally.'
    case 'document-author':
      return request.contract.documentSet === 'foundation' &&
        (request.contract.authoringMode === 'initial' ||
          request.contract.authoringMode === 'parallel-draft')
        ? ''
        : request.contract.authoringMode === 'initial'
          ? `Ensure the assigned Markdown game document at ${documentAuthorTargetPath(request)} is complete and end the turn normally. The native runtime owns the file-operation sequence.`
          : `Ensure the assigned Markdown document at ${documentAuthorTargetPath(request)} is complete and end the turn normally. The native runtime owns the file-operation sequence.`
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
