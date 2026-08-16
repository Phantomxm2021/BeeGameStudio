import {
  CANONICAL_PROJECT_ARTIFACTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type WorkerDispatchRequest,
} from './types'

const DOCUMENT_AUTHORING_DENSITY_INSTRUCTION =
  'Treat each section as the final decision record, not a derivation transcript. The complete Markdown response must not exceed 48,000 UTF-8 bytes and must finish every required section and production material within that single response; compact earlier sections rather than omit or truncate any later required content. Production materials are canonical compact views of owned decisions and must not repeat section narrative. Use no more than one worked example per formula or system boundary unless distinct contract-required cases prove different behavior. Include only materially distinct boundary and acceptance scenarios; do not enumerate equivalent cases.'

function hasPriorReviewSource(request: WorkerDispatchRequest): boolean {
  const assignment = request.contract.assignment as
    | Record<string, unknown>
    | undefined
  return Array.isArray(assignment?.sourcePaths) && assignment.sourcePaths.length > 0
}

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
    (request.workerType === 'document-reviewer'
      ? reviewerContractPaths(request)
      : request.workerType === 'document-author' &&
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
  if (request.workerType === 'document-reviewer') {
    const verification = request.contract.revisionVerification
    const verificationRecord =
      verification &&
      typeof verification === 'object' &&
      !Array.isArray(verification)
        ? (verification as Record<string, unknown>)
        : undefined
    const prerequisiteReports = verificationRecord?.prerequisiteReports
    const priorReport =
      Array.isArray(prerequisiteReports) && prerequisiteReports.length === 1
        ? prerequisiteReports[0]
        : undefined
    const priorReportRecord =
      priorReport && typeof priorReport === 'object' && !Array.isArray(priorReport)
        ? (priorReport as Record<string, unknown>)
        : undefined
    const priorReviewDigest =
      typeof priorReportRecord?.digest === 'string'
        ? priorReportRecord.digest
        : undefined
    return JSON.stringify({
      reviewScope: request.contract.reviewScope,
      reviewRole: request.contract.reviewRole,
      ...(priorReviewDigest ? { priorReviewDigest } : {}),
      assignment: request.contract.assignment,
      partDigests: request.contract.partDigests,
      allowedAffectedPaths: request.contract.allowedAffectedPaths,
    })
  }
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
  const remediation = contract.remediation
  if (
    remediation &&
    typeof remediation === 'object' &&
    !Array.isArray(remediation)
  ) {
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
                if (
                  !subject ||
                  typeof subject !== 'object' ||
                  Array.isArray(subject)
                )
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

function reviewerContractPaths(request: WorkerDispatchRequest): string[] {
  const assignment = request.contract.assignment
  if (
    !assignment ||
    typeof assignment !== 'object' ||
    Array.isArray(assignment)
  )
    return []
  const record = assignment as Record<string, unknown>
  return [
    ...(Array.isArray(record.sourcePaths) ? record.sourcePaths : []),
    ...(Array.isArray(record.verificationSourcePaths)
      ? record.verificationSourcePaths
      : []),
  ].filter((path): path is string => typeof path === 'string')
}

function workerInstruction(request: WorkerDispatchRequest): string {
  switch (request.workerType) {
    case 'document-author':
      return [
        request.contract.documentSet === 'checklist'
          ? "Author the approved gameplay checklist directly at docs/acceptance/gameplay-checklist.md using Bee Game Studio's normal workflow."
          : request.contract.authoringMode === 'initial' ||
              request.contract.authoringMode === 'parallel-draft'
            ? 'Return exactly one complete raw Markdown body as the visible response. Do not call tools, do not return JSON, do not use a code fence, and do not add text before or after the document.'
            : 'Use the accepted Foundation review JSON and current target bytes projected by the workflow service. Apply every conflict change across exactly contract.remediation.affectedPaths in one coordinated turn, preserve unrelated approved content, and leave every authorized Markdown document complete when the turn ends.',
        request.contract.documentSet === 'checklist'
          ? [
              'Author only docs/acceptance/gameplay-checklist.md from the eight approved foundation documents.',
              'Every acceptance task must be one Markdown checkbox line with a stable ID, observable behavior and evidence expectation. Cover core player paths, critical numeric boundaries, level/scene states, UI/audio feedback, visible resource outcomes and failure/recovery paths from the approved authority.',
              'Group the approved scenarios before authoring. Target 24-40 checkbox tasks for an ordinary first delivery; exceed 40 only for additional independently observable approved scenarios, and never exceed 64 checkbox tasks. Group wave, enemy, input, resource, cue and table-row variants when they share one setup, action and observable outcome; do not create one task per document sentence or variant. One task may cite multiple approved facts while remaining independently pass/fail.',
              'Use the canonical form `- [ ] <stable-id> <observable check and evidence expectation>`; tables may add context but cannot replace checkbox tasks.',
              ...(request.contract.remediation
                ? [
                    'Read contract.remediation.reviewReportPath and resolve only the accepted checklist outcomes for docs/acceptance/gameplay-checklist.md.',
                  ]
                : []),
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
              : [
                  'This is one accepted report-driven Foundation remediation. Modify exactly the canonical documents in contract.remediation.affectedPaths and no others.',
                  'Use the projected review JSON as the complete conflict list. Apply every conflict changes[].action to its named path so the shared requiredOutcome and all acceptance conditions hold across documents. Preserve unrelated approved authority; do not reinterpret, rewrite, summarize or expand the review.',
                  'For each accepted conflict, locate only the cited and directly dependent occurrences of the affected authority, state, formula, count, budget or reference before editing. Perform one targeted closure check against that conflict after editing. Do not launch a broad new review.',
                ].join(' '),
      ].join(' ')
    case 'document-reviewer':
      return [
        'Act as the single specialist role named by contract.reviewRole. Read only contract.assignment.sourcePaths and contract.assignment.verificationSourcePaths.',
        'Write only the exact paths in contract.assignment.stagingOutputPaths. Do not modify source documents, workflow state, resources, implementation files, or any other path.',
        request.contract.reviewRole === 'final'
          ? request.contract.reviewScope === 'foundation'
            ? [
                'Review all eight canonical foundation documents directly as one connected production contract.',
                'Before choosing a verdict, run one fixed coverage pass in this order: (1) authority, enumeration and cardinality; (2) state and outcome totality; (3) arithmetic, units, formulas and budgets; (4) owner-to-consumer references and duplicated facts; (5) runtime, production, asset and acceptance constraints; (6) player-facing art, UI, audio and accessibility mappings; (7) unresolved assumptions and external dependencies; (8) redundancy and human/agent usability. Keep the checking process internal; do not emit coverage prose or a checklist self-attestation.',
                'A finding is blocking only when the delivered contract cannot be implemented or verified, permits incompatible implementations, violates an authoritative state/formula/budget/ownership boundary, or omits evidence required to accept delivery. Cosmetic polish, optional clarification, or unambiguous duplicate wording is non-blocking. Do not promote a non-blocking issue merely because it occurs in an important section.',
                'Write exactly one JSON object to the sole contract.assignment.stagingOutputPaths entry. The object must contain only version, scope, revision, verdict, optional priorReviewDigest, priorConflictStatus and conflicts. Each conflict must contain only id, title, problem, evidence, requiredOutcome, changes and acceptance. Do not write Markdown, a decision file, audit narrative, correct-item summary, non-blocking register, preservation list, introduction or conclusion.',
                'Each conflict must tell the repair Agent what is wrong, the exact evidence location, every canonical path whose bytes must change, the required action for each path, one shared requiredOutcome and mechanically checkable acceptance conditions. Do not draft replacement document prose.',
                ...(hasPriorReviewSource(request)
                  ? [
                      'The assignment sourcePaths contain the prior accepted review JSON as byte-bound read-only verification input, not current product authority. Set output priorReviewDigest exactly to contract.priorReviewDigest and account for every prior conflict in priorConflictStatus. Every open prior conflict must retain the same ID in conflicts; every closed prior conflict must be absent. New conflicts use new IDs.',
                    ]
                  : []),
                'READY requires conflicts: []; NEEDS_REVISION requires at least one conflict. Do not output affectedPaths; the server derives write authority from conflicts[].changes[].path. Read each assigned canonical document once unless exact evidence needs a targeted reread.',
              ].join(' ')
            : 'Consolidate the committed specialist Markdown reports into one complete review.md containing one verdict, one deduplicated owner-grouped blocking register, one non-blocking register, explicit specialist disagreements, and one preservation list. Verify cited evidence against the supplied read-only verification paths only when needed. Do not restate each specialist report before the consolidated result. Write decision.json with exactly version, scope, revision, verdict, affectedPaths and reportPath. READY requires affectedPaths: []; NEEDS_REVISION requires only the exact canonical project paths that must change.'
          : 'Review only the responsibility and evidence assigned by contract.reviewRole. Write one human-readable Markdown specialist report with reviewed scope and verdict, one blocking-finding table, one non-blocking-finding table, and a concise list of load-bearing contracts confirmed correct. Use one finding row per distinct defect with owner path, exact evidence location, defect, downstream impact, and required outcome. Include only calculations or proof needed to support a finding. Do not reproduce source sections, repeat a finding in prose, or add a second summary of the tables. If none block delivery, say so explicitly. Do not produce JSON, a finding packet, criteria arrays, reference IDs, or a server-facing summary.',
        'Review production usability, completeness, clarity, ownership, redundancy, feasibility and verification evidence within this role. Do not invent product requirements or silently repair source documents.',
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
        `Build the engine-neutral JSON/YAML documents at the exact writable paths in contract.repairPaths: ${writablePaths.length ? writablePaths.join(', ') : '<none>'}. Submit one documents object keyed by those exact paths. Bee Game Studio's native tools remain available for inspection, reasoning, and verification. Use contract.authorityPaths, contract.requiredRequirementIds, contract.verifiedResourceIds, and contract.inventoryBindings as the task authority. CommitResourceContent is the atomic delivery interface for the final document set and preserves every canonical document outside the writable path list.`,
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
    case 'document-author':
      return request.contract.documentSet === 'foundation' &&
        (request.contract.authoringMode === 'initial' ||
          request.contract.authoringMode === 'parallel-draft')
        ? ''
        : request.contract.authoringMode === 'remediation' &&
            request.contract.documentSet === 'foundation'
          ? 'Ensure every Markdown document in contract.remediation.affectedPaths is complete and committed, then end the turn normally. The native runtime owns the file-operation sequence.'
        : request.contract.authoringMode === 'initial'
          ? `Ensure the assigned Markdown game document at ${documentAuthorTargetPath(request)} is complete and end the turn normally. The native runtime owns the file-operation sequence.`
          : `Ensure the assigned Markdown document at ${documentAuthorTargetPath(request)} is complete and end the turn normally. The native runtime owns the file-operation sequence.`
    case 'document-reviewer':
      return 'Finish only after every assigned report file is fully written. End the turn normally; the committed report bytes, not response prose or a structured submission tool, are the completion authority.'
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
