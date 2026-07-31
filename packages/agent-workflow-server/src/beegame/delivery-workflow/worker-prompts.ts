import { RESOURCE_ASSET_MANIFEST_VOCABULARY } from '@bee-game-studio/beegame-resource-core'
import {
  BEEGAME_ASSET_INTEGRATION_MODES,
  BEEGAME_REQUIREMENT_STATUSES,
  BEEGAME_RESOURCE_NO_MATCH_OUTCOMES,
} from '../asset-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  CANONICAL_PROJECT_ARTIFACTS,
} from './types'
import type { WorkerDispatchRequest } from './types'

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
  const resourceAttemptMode = request.contract.resourceAttemptMode
  const resourceSelectionDispatch =
    resourceAttemptMode === 'selection' || resourceAttemptMode === 'reselection'
  return [
    `BeeGame delivery worker: ${request.workerType}`,
    `Phase: ${request.phase}`,
    `Run: ${request.runId}`,
    `Revision: ${request.revision}`,
    `Workspace root: ${request.workspacePath}`,
    `Allowed paths: ${scope}`,
    `Canonical artifacts: ${canonicalArtifacts.join(', ')}`,
    'Request kind: confirmed_build_brief. The persisted brief digest is the product authority for this run.',
    workerInstruction(request.workerType, request.contract),
    'Use the confirmed contract and task payload as authority. Do not use chat transcript prose as product authority.',
    'Do not use WebSearch or WebFetch. Resolve the assigned contract from approved project artifacts and deterministic workflow evidence; never pause an automated worker for interactive external-web permission.',
    'For atomic-task-planner results, assign every approved ID once through the canonical ownership object; tasks must not duplicate ownership arrays.',
    ...(request.workerType === 'atomic-task-planner'
      ? [
          'Implementation tasks must never include canonical project documents or assets/asset-manifest.json in allowedPaths or expectedArtifacts. Those artifacts remain workflow-service owned. Put delivery-wide manifest checks in the deterministic resource gate or independent auditors, not in an implementation task.',
          'SubmitAtomicTaskPlan ownership uses four flat arrays. Every entry has exactly {"id":"<approved id>","taskId":"<owner task id>"}; never submit dynamic map properties or schema-description objects.',
          'Every test, build, file, or asset verification must name one exact action executable with tooling already declared by the project dependency manifest at the point that task runs. Never require an ad-hoc temporary script, an undeclared runner, a new dependency install, or a choice between several possible checks. A runtime verification belongs only on a task whose dependency closure already provides the runnable integrated target and must state one concrete interaction plus its observable result; otherwise give the owning task a durable project test artifact and use a test verification.',
        ]
      : []),
    terminalContractInstruction(request.workerType),
    ...(request.workerType === 'document-author'
      ? [
          'Document-author terminal results must not contain evidencePath; the server creates review evidence after the author is finished.',
          ...(request.contract.remediation
            ? [
                'This is a required remediation pass. Treat every structured finding in contract.remediation.findings as mandatory. Apply each requiredAction to the listed documents, do not merely bump versions or timestamps, and return every corresponding finding id in resolvedFindingIds only after the correction is present in the files.',
              ]
            : [
                'This is not a remediation pass; return an empty resolvedFindingIds array.',
              ]),
          ...(request.contract.documentSet === 'checklist'
            ? [
                'This is the checklist substep. The six approved foundation documents are read-only authority. Create or update only docs/acceptance/gameplay-checklist.md with observable gameplay checks that cover those approved documents. Every acceptance task must be a Markdown checkbox on its own line using exactly `- [ ] <stable-id> <observable check and evidence expectation>`. Tables may supplement these tasks but must not replace the checkbox task lines. Do not modify any other document, source code, assets or manifest.',
                ...(request.contract.checklistRemediation
                  ? [
                      'This is a bounded checklist-structure remediation pass. Correct every deterministic issue in contract.checklistRemediation while preserving the approved gameplay semantics and stable IDs. Rewrite non-task representations into the canonical checkbox task lines; do not modify the six approved foundation documents.',
                    ]
                  : []),
              ]
            : [
                'This is the foundation-document substep. Create or update only the six foundation documents: docs/GDD.md, docs/TECHNICAL_DESIGN.md, docs/ART_DIRECTION.md, docs/UI_UX_SPEC.md, docs/AUDIO_DESIGN.md and docs/ASSET_PLAN.md. Do not create or modify docs/acceptance/gameplay-checklist.md; it is generated only after foundation review is READY.',
                'Foundation documents define logical asset responsibilities, observable intended uses, art direction and target technical constraints before Resource Library selection. Do not invent or preselect a Pack version, element ID, source filename, destination filename, runtime path, license, or exact Pack contents that are not literal facts in the confirmed brief. A user-named Pack may be recorded only as a discovery target, never as proof that a particular element exists or fulfills a responsibility. Use stable logical responsibility IDs across the six documents; the later resource phase alone records exact catalog provenance and copied paths. When remediating an earlier finding that asks foundation documents to reconcile speculative resource filenames, remove the premature identities consistently and reconcile the underlying logical responsibility instead.',
                'Model the smallest reusable set of asset responsibilities that the confirmed product behavior actually requires. A responsibility is a semantic duty such as enemy visual, weapon visual, environment structure, aiming UI, gameplay feedback audio, or interface typography; it is not one requirement per event, variant, screen, destination file, or runtime call site. Reuse one responsibility across every compatible use. Split it only when the confirmed brief or an observable gameplay distinction requires genuinely different source material. Supporting effects or variants invented during design must use an explicit authored/runtime-generated/system-provided/silent plan instead of silently expanding Resource Library scope.',
                'In docs/ASSET_PLAN.md, make this boundary explicit with one canonical responsibility registry and a separate runtime-use mapping. Each registry row must contain one stable responsibility ID, its observable duty, its source policy (Resource Library or exactly one non-library source type), and the concrete reason a distinct source is necessary. Every planned runtime use or destination must reference one registry ID; it must not create another source requirement. Other foundation documents reference those same registry IDs instead of defining parallel inventories.',
              ]),
        ]
      : []),
    ...(request.workerType === 'document-reviewer'
      ? [
          'Classify every finding structurally. Give each finding a short stable code derived from its affected requirement or artifact rule, and preserve that code in follow-up reviews. Any unresolved contradiction between canonical artifacts, missing behavior needed for a unique implementation, or missing acceptance definition is blocking. A READY verdict is valid only when there are zero blocking findings. Do not resolve a contradiction by choosing one document as authority; return NEEDS_REVISION so the documents can be reconciled.',
          'Assign every finding exactly one remediationTarget: foundation when its required action can be completed only by editing the six foundation documents, checklist when it can be completed only in docs/acceptance/gameplay-checklist.md, or resource when it requires assets/asset-manifest.json or imported resource files. Choose the worker that can actually perform requiredAction, not every artifact cited as evidence. The workflow may execute mixed targets in separate bounded passes.',
          'For every resource-target finding, also set resourceAction to repair when existing canonical inventory can be preserved, or reselection when one or more existing imports must be replaced. A reselection finding must list the exact current import IDs in resourceImportIds; repair findings must omit resourceImportIds. Do not encode this decision only in prose.',
          'In a complete review, every resource-target finding must list the exact current manifest requirement IDs in resourceRequirementIds. A repair finding is valid only when at least one listed required responsibility currently lacks both a durable source_decision and a current manifest binding. A reselection finding is valid only when every listed resourceImportId currently exists and is bound to one of those requirements. Do not continue a prior finding after the current canonical manifest has resolved it.',
          'Review the current canonical files, not superseded workflow evidence, old manifest snapshots, orphaned files, or prior import counts. Historical evidence may explain provenance but cannot override the current manifest or prove a current requirement unresolved.',
          request.contract.reviewScope === 'foundation'
            ? 'This is the foundation review substep. Review only the six foundation documents listed in the current workspace; do not require or review docs/acceptance/gameplay-checklist.md yet. Foundation documents must agree on stable logical asset responsibilities and constraints, but must not claim unselected Resource Library filenames, element identities, versions, copied paths, licenses or Pack contents. Treat any such unsupported preselection as a blocking foundation issue whose required action is to replace it with the logical responsibility and constraints, never to standardize the speculative filename. Also block Resource Library scope inflation: docs/ASSET_PLAN.md must have one canonical responsibility registry plus a separate runtime-use mapping, every use must reference one registry ID, and multiple event, variant, screen, destination-file or call-site entries must share one reusable semantic responsibility unless the confirmed brief or an observable gameplay distinction proves that distinct source material is required. Design-invented supporting output must declare one non-library source plan instead of becoming an external-resource requirement. Other foundation documents may reference but must not duplicate that registry. A user-named Pack is only a discovery target until the resource phase returns exact catalog facts. The workflow service derives the reviewed document set and checklist coverage.'
            : 'This is the final pre-implementation comprehensive review substep. Review all six approved foundation documents, docs/acceptance/gameplay-checklist.md, and assets/asset-manifest.json together. Verify their cross-artifact consistency; the workflow service derives all reviewed paths and checklist coverage. The manifest requirement set must correspond to the canonical responsibility registry in docs/ASSET_PLAN.md, not to its runtime-use rows; reject duplicated requirements created from destinations, events, variants, screens or call sites. Resource preparation approves source inventory and one exact fulfillment type; it does not claim that authored assets, runtime-generated output, system-provided behavior, silent behavior, converted assets, or integrated runtime outputs already exist. Do not block on those future outputs when the current manifest has a durable source_decision and the approved documents/checklist define an implementable and testable plan. Verify that each Resource Library import has a concrete catalog identity, an evidence-based selection reason, and bindings only to requirements it can actually fulfill; reject unrelated or merely format-compatible imports. Such files and runtime evidence belong to implementation and acceptance. A resource finding must be actionable by manifest edits or ResourceLibrary operations alone; never require the resource worker to run shell conversion, generate binary media, write source code, or complete implementation work.',
          ...(request.contract.priorRemediation
            ? [
                'This is a remediation follow-up review. Verify every priorRemediation finding against the current files and record the outcome in the evidence. Do not return READY unless every prior finding is actually corrected and the current review has no blocking findings.',
              ]
            : []),
        ]
      : []),
    ...(request.workerType === 'resource-preparer'
      ? [
          resourceAttemptMode === 'fresh'
            ? 'ResourceLibrary is intentionally unavailable during manifest planning. Do not search for, wrap, or invoke a catalog tool through any other lane.'
            : 'ResourceLibrary is loaded as the one first-class resource tool in this worker. Call it directly; do not search for it, wrap it, invoke it through another tool, or look for an MCP/CLI alternative.',
          'Resource preparation approves inventory and an integration plan; it does not claim implementation that has not happened. New imports must remain available, requirements that implementation has not fulfilled must remain planned, and compositions without an existing target-native recipe must remain planned. Never report satisfied, assembled, integrated, usage_evidence, integration_evidence, or recipe.path unless the referenced project files already exist and the evidence is current.',
          'The manifest must preserve project_target.resource_library_usage and declare the real target-supported asset_format_capabilities plus a concrete workspace-relative project_target.runtime_asset_root. Format capabilities and every accepted_formats entry are lowercase file extensions such as glb, png, ogg or ttf, never MIME types such as model/gltf-binary. Imported files may be written under that declared runtime root even when it is outside assets/.',
          `Canonical Resource Library manifest vocabulary (machine authority): ${JSON.stringify(
            {
              ...RESOURCE_ASSET_MANIFEST_VOCABULARY,
              projectTargetFields: [
                'platform',
                'runtime',
                'integration_mode',
                'mcp_server',
                'asset_format_capabilities',
                'resource_library_usage',
                'runtime_asset_root',
              ],
              projectTargetFieldShapes: {
                integration_mode: BEEGAME_ASSET_INTEGRATION_MODES,
                mcp_server:
                  'optional trimmed non-empty string; omit when unavailable, never null',
                asset_format_capabilities: 'non-empty string[]',
                resource_library_usage:
                  RESOURCE_ASSET_MANIFEST_VOCABULARY.resourceLibraryUsage,
                runtime_asset_root:
                  'required concrete workspace-relative directory',
              },
              requirementFields: [
                'id',
                'name',
                'purpose',
                'required',
                'resource_requirement',
                'source_decision',
                'satisfied_by',
                'status',
              ],
              requirementFieldShapes: {
                id: 'required stable non-empty string',
                name: 'optional string',
                purpose: 'optional string',
                required: 'optional boolean',
                resource_requirement:
                  'required while selecting library content; forbidden with a final non-library source_decision',
                source_decision:
                  'optional before selection; when present, reasons is a required non-empty string array and basis identifies its authority; omit decided_at because the workflow service records it; resource-library requires resource_requirement plus a current import binding; every non-library type forbids resource_requirement',
                satisfied_by: 'optional binding object',
                status: 'planned during resource preparation',
              },
              requirementStatuses: BEEGAME_REQUIREMENT_STATUSES,
              resourceRequirementFields: [
                'category',
                'dimension',
                'accepted_formats',
                'styles',
                'game_types',
                'tags',
                'asset_kinds',
                'capabilities',
                'subresources',
                'relations',
                'purpose',
                'import_budget',
                'no_match',
              ],
              resourceRequirementFieldShapes: {
                import_budget: 'required non-negative integer',
                no_match: {
                  required: true,
                  enum: BEEGAME_RESOURCE_NO_MATCH_OUTCOMES,
                },
              },
              resourceNoMatchOutcomes: BEEGAME_RESOURCE_NO_MATCH_OUTCOMES,
            },
          )}. Before selection, a file-backed requirement has resource_requirement and no source_decision. A successful ResourceLibrary import may add source_decision.type=resource-library only together with its current import binding; this records the selected source and is not a second selection lane. Every non-library source_decision must omit resource_requirement. name, purpose, required and satisfied_by are optional. Every resource_requirement must contain import_budget and no_match. In each resource_requirement, category is zero or one enum string, never an array; dimension and no_match are also singular strings. accepted_formats, tags, asset_kinds and capabilities are arrays. tags may contain only vocabulary.usageTags; do not add subject names, filenames, gameplay roles or descriptive words. Do not invent fields or plural aliases.`,
          request.contract.resourceAttemptMode === 'fresh'
            ? 'This dispatch plans the canonical manifest only. Submit it through SubmitAssetManifest with content containing the complete valid JSON text; do not write assets/asset-manifest.json directly. project_target.asset_format_capabilities must be a non-empty array of non-empty strings, project_target.runtime_asset_root must be concrete and workspace-relative, and imports and compositions must be initialized as arrays. Never persist a placeholder value. Do not call ResourceLibrary in this dispatch. End after SubmitAssetManifest accepts the manifest; the workflow service will derive selectionPlan and start a separate bounded selection dispatch.'
            : 'The canonical manifest already exists. Do not rebuild its requirements or rediscover work from prose; operate only on the authoritative responsibilities in contract.selectionPlan or the explicit repair contract.',
          'Create manifest requirements only from the canonical responsibility registry in docs/ASSET_PLAN.md, never from its runtime-use mapping or file lists. Create one canonical requirement per approved reusable semantic responsibility, not per planned destination file, event, variant, screen, or runtime reference. Preserve distinct requirements only when the registry establishes a genuinely distinct observable duty. If approved documents still contain duplicated file-slot rows for one responsibility, represent them once in the manifest and leave destination naming to implementation; do not multiply Resource Library searches.',
          'Before importing new inventory, declare a non-negative resource_requirement.import_budget for every current file-backed requirement from the approved asset plan. Keep each resource_requirement to the minimum exact constraints actually required by the approved documents: do not add category, dimension, capability, style, game type, relation, or subresource constraints merely because they sound plausible or duplicate an asset-kind, usage-tag, or format constraint. Use only canonical enum and facet values supplied by the approved target and Resource Library contract; never derive matching with regexes, keyword lists, translated free-text filters, a particular Pack name, or a platform-specific rule. purpose is explanatory text and is not a catalog filter. The sum of import budgets is a hard project inventory ceiling. Every imported ID must be bound by at least one requirement satisfied_by.import_ids entry or an explicit composition import member before completion; do not import speculative or unclaimed Pack contents.',
          'A responsibility that the approved plan intentionally keeps out of library selection must omit resource_requirement entirely and record exactly one source_decision.type: authored-asset, runtime-generated, system-provided, silent, or unavailable; use source_decision.basis approved-project-plan with concrete document reasons. Never collapse these outcomes into a generic authored category. Keep future implementation output planned during resource preparation. A later implementation worker may add exact existing workspace-relative project_references after delivering the declared outcome; never invent a future path, append prose to a path, or represent this case with an empty accepted_formats array.',
          'Review remediation may cite a final authored asset, runtime-generated, system-provided, silent, converted, or integrated outcome. Resource preparation must not create implementation output, binary media, or source code. Preserve or add its one durable source decision, leave it planned, and let the later implementation and acceptance workers create and verify it. Only resource inventory replacement explicitly encoded as remediation.mode=reselection may remove and reselect current imports.',
          resourceSelectionDispatch
            ? 'Treat contract.selectionPlan as the authoritative unresolved responsibility set for the existing canonical manifest. Each group shares exact Resource Library query constraints; use its responsibilities to decide whether one semantically suitable element can genuinely satisfy several requirement IDs. Do not browse for requirements absent from that set, and do not read the full canonical manifest to rediscover work already resolved by the workflow service.'
            : '',
          request.contract.resourceAttemptMode === 'selection'
            ? 'This is a continuation over valid partial inventory. Preserve every existing import, composition, binding, receipt and local file exactly; make source decisions only for the unresolved requirements in contract.selectionPlan. Do not refresh, replace, re-download, or delete current inventory.'
            : '',
          resourceSelectionDispatch
            ? 'Browse the Resource Library by Pack coherence, not one requirement at a time: start with browse_packs and inspect relevant Packs. Issue exactly one catalog read per model turn and use its catalog_budget before deciding the next action. The first index_pack_elements call for a chosen Pack must be unfiltered so its authored elements and exact facets are observed before any refinement; paginate that Pack or apply only observed, necessary exact filters afterward. Select a small reusable inventory that covers the unresolved responsibility set. One import_elements selection may list multiple requirement_ids when the same element genuinely fulfills them; provide exactly one locator, a new non-conflicting import_id and destination_path, and concrete selection reasons. As soon as one inspected Pack yields a coherent batch of proven selections, import that batch immediately before inspecting another Pack. Each successful import is the durable checkpoint from which the workflow service derives a smaller next selectionPlan.'
            : '',
          resourceSelectionDispatch
            ? 'Semantic suitability is mandatory in addition to technical compatibility. Element usageTags are the Resource Library authority for gameplay and art responsibility; Pack dimension, style and game type establish shared compatibility context, while element category, format, assetKind, capabilities and contentProfile establish objective technical fit. Element names, paths, folders and Pack tags are identity or discovery data only and must never establish semantic suitability. Never reinterpret an unrelated shape, promise to retexture or remodel it later, or import a merely format-compatible element to make progress.'
            : '',
          resourceSelectionDispatch
            ? 'If exact filters return no Packs or elements, use the returned facets to correct unsupported manifest constraints once, then browse again. If the catalog has no genuinely suitable element after bounded Pack inspection, return a concrete blocked result instead of fabricating a match or silently switching to a second selection path.'
            : '',
          resourceSelectionDispatch
            ? 'Resource preparation has strict wall-clock, token, tool-call, catalog-page, and repeated-result limits. Reuse selected imports across responsibilities and stop with the concrete catalog blocker when the approved resource requirement cannot be fulfilled.'
            : '',
          'Do not create source-code stubs to make a composition recipe path exist. Resource preparation must leave a composition planned and omit recipe.path until a later implementation worker creates a real target-native recipe.',
          ...(request.contract.remediation &&
          request.contract.resourceAttemptMode !== 'selection'
            ? isResourceReselection(request.contract.remediation)
              ? [
                  'This is a targeted resource reselection pass. The workflow service already removed contract.remediation.reselectImportIds and their dangling bindings from the canonical inventory while preserving their old local files. Do not re-add or delete those old files. Preserve every current ID in contract.remediation.preserveImportIds. Select target-compatible material only for the entries in contract.selectionPlan; do not replace removed imports one-for-one. Use new non-conflicting import IDs and destination paths. Do not broaden project_target.asset_format_capabilities to make an incompatible source appear valid. Refresh metadata only after the resulting canonical manifest passes every deterministic check.',
                ]
              : [
                  'This is a repair pass over existing resources. Preserve every import and composition ID listed by contract.remediation, preserve valid imported files, and correct only the reported deterministic issues. Do not browse, select, or import replacement resources during this pass; a separate explicit resource-selection request is required if an existing file is genuinely missing. Finish every manifest correction first. Only after the canonical manifest passes target-format, inventory-budget, import-binding, and planned-composition checks may you invoke refresh_import_metadata exactly once as the final resource operation; do not mutate the manifest after that refresh.',
                ]
            : []),
        ]
      : []),
    ...(request.workerType === 'atomic-task-planner' &&
    Array.isArray(request.contract.documentAdvisories) &&
    request.contract.documentAdvisories.length
      ? [
          'Non-blocking documentAdvisories do not invalidate the approved review. Carry each advisory into an existing implementation task that already owns the affected checklist or resource responsibility when action is still required; never create an advisory-only task and never reinterpret an advisory as a reason to return to document drafting.',
        ]
      : []),
    ...(request.workerType === 'implementation-worker'
      ? [
          'Do not edit assets/asset-manifest.json. Report every actual imported-resource reference, composition integration, and requirement satisfaction in the terminal resource arrays. The workflow service validates those paths against the active task and updates the manifest after task completion.',
          'Run every deterministic task verification action as written using project-owned tooling. Do not create substitute temporary test scripts or install undeclared runners. Runtime checks are always owned by final acceptance: report the implementation observation, but do not claim or submit a runtime status.',
          implementationResourceContractInstruction(request.contract),
        ]
      : []),
    JSON.stringify(request.contract),
  ].join('\n')
}

function isResourceReselection(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).mode === 'reselection',
  )
}

function implementationResourceContractInstruction(
  contract: Record<string, unknown>,
): string {
  const task =
    contract.task &&
    typeof contract.task === 'object' &&
    !Array.isArray(contract.task)
      ? (contract.task as Record<string, unknown>)
      : {}
  const requirementIds = stringArray(task.resourceRequirementIds)
  const importIds = stringArray(task.resourceImportIds)
  const compositionIds = stringArray(task.resourceCompositionIds)
  const resourceBindings = Array.isArray(contract.resourceBindings)
    ? contract.resourceBindings
    : []
  return [
    `Active task resource IDs: ${JSON.stringify({ requirementIds, importIds, compositionIds })}.`,
    `contract.resourceBindings is the sole fulfillment authority for this task: ${JSON.stringify(resourceBindings)}. authored-asset creates durable asset files under contract.runtimeAssetRoot; runtime-generated implements runtime source without asset files; system-provided references the target or operating-system capability without bundled asset files; silent implements the approved no-output behavior without placeholder files; resource-library integrates only its existing imports/compositions.`,
    `requirementSatisfactions must contain exactly one entry for every requirementId in ${JSON.stringify(requirementIds)} and no other requirement IDs. Each entry must cite at least one existing projectReferences path created or used by this task; its importIds and compositionIds may be empty for authored-asset, runtime-generated, system-provided, or silent fulfillment. requirementSatisfactions may be empty only when this exact requirement ID list is empty.`,
    `resourceReferences must cover exactly ${JSON.stringify(importIds)}; compositionIntegrations must cover exactly ${JSON.stringify(compositionIds)}.`,
  ].join(' ')
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function terminalContractInstruction(
  workerType: WorkerDispatchRequest['workerType'],
): string {
  switch (workerType) {
    case 'document-author':
      return 'After writing the assigned documents, call SubmitDocumentAuthorResult exactly once with only resolvedFindingIds. Use an empty array outside remediation. Do not return terminal JSON or write workflow evidence. The workflow service derives written paths from completed file mutations and owns revisions.'
    case 'document-reviewer':
      return 'After reviewing the active canonical set, call SubmitDocumentReviewResult exactly once with only verdict and findings. Do not return terminal JSON or write workflow evidence. The workflow service owns revision, reviewed paths, checklist coverage, finding persistence, and canonical evidence. READY requires zero blocking findings; NEEDS_REVISION requires at least one blocking finding.'
    case 'resource-preparer':
      return 'Do not author or modify any workflow evidence file, do not author a terminal contract file, and do not enumerate the complete import inventory in the response. The workflow service exclusively derives and writes the resource terminal contract and evidence directly from the canonical manifest. End with one concise completion or blocker summary.'
    case 'atomic-task-planner':
      return 'Use contract.planningDocuments as the complete revision-bound document source. Do not call Bash, Read, Grep, Glob, Write, or any exploration/file tool; do not reread those files from the workspace. Submit exactly one complete plan through SubmitAtomicTaskPlan. Keep every task atomic with no more than 8 durable artifacts and 9 verification conditions; split larger feature groups along artifact ownership boundaries and connect them with dependencies. Every task must use exactly these fields: {"id":"<stable task id>","title":"<title>","dependsOn":["<task id>"],"allowedPaths":["<workspace-relative writable path or directory>"],"expectedArtifacts":["<workspace-relative artifact path>"],"verification":[{"kind":"test|build|runtime|file|asset","commandOrAction":"<concrete action>","expectedResult":"<observable result>"}]}. Do not put resourceRequirementIds, checklistIds, resourceImportIds, or resourceCompositionIds inside tasks. The ownership maps are the only ownership authority and structurally assign each approved ID to exactly one task. contract.resourceBindings is the sole resource authority and supplies an exact sourceType for every requirement. Never combine different sourceTypes in one task. authored-asset tasks must deliver durable files under contract.runtimeAssetRoot. runtime-generated, system-provided, and silent tasks must deliver target-native source or tests outside contract.runtimeAssetRoot and must never invent asset files or placeholders. resource-library tasks integrate only the listed existing imports/compositions. Each task must declare at least one expected artifact. expectedArtifacts are durable project source files or assets that the implementation worker authors or verifies, not disposable outputs produced by build, test, coverage, packaging, cache, or preview commands; record those derived outputs only as verification observations and never put them in expectedArtifacts or allowedPaths. Every verification may cover only artifacts owned by that task or artifacts produced by its transitive dependency closure. It must never require, name, inline, duplicate, or integrate a subsystem owned by a later or unrelated task; add the owning task as a dependency when the integration is genuinely part of the current task. Verification must state only observable behavior, an executable check, or an artifact fact already required by the approved documents. Never introduce an implementation mechanism, framework primitive, storage pattern, class shape, or architecture term that the approved documents do not require; the implementation worker owns the simplest target-native design that produces the observable result. The same artifact may appear in later tasks only along one explicit dependency lineage; tasks with no transitive dependency relationship must never share an expected artifact. Assign an ID to the task that produces or integrates its final observable artifact; consumers depend on that owner. An unowned scaffold, shared-state, or configuration task is allowed only when it is a prerequisite of owned work. Every executable project must include its target-native runnable entrypoint, dependency manifest, and build configuration as durable artifacts in prerequisite tasks; do not assume they already exist. Never create a trailing final-verification, acceptance, cleanup, detached-test, or delivery task: the workflow service performs final audit and acceptance, and implementation tasks must never write canonical documents or assets/asset-manifest.json. Fold each behavior test and build check into the task that owns that behavior, including its durable artifacts and writable paths. Every expected artifact must be inside one allowed path. Group responsibilities by implementation artifact boundary and submit one graph immediately. Do not draft alternate graphs, enumerate coverage in reasoning, run coverage scripts, write temporary scripts, or submit more than once. Do not write execution-state or legacy fields inside tasks. Do not read assets/asset-manifest.json. Cover every approved resource requirement, checklist item, import, and composition in its ownership map, with no unknown IDs, task IDs, dependencies, or cycles. End with one concise completion summary and do not duplicate the graph in the response.'
    case 'implementation-worker':
      return 'After implementing and verifying the task, call SubmitImplementationResult exactly once with status, changedPaths, and verificationObservations. Include resourceReferences, compositionIntegrations, and requirementSatisfactions only for IDs explicitly listed by the active task; omit each field when its active ID list is empty. Do not return a terminal JSON object. Treat each verification as an observable acceptance condition, not permission to invent an additional architecture. When the contract does not mandate a mechanism, use the simplest target-native implementation and do not speculate about alternate designs. Once every expected artifact exists and every active deterministic verification has concrete evidence, submit immediately; do not reread already verified files or broaden the task into a design review. verificationObservations must contain one concise entry per task verification in the same order; do not supply verificationIndex or verificationStatuses because the workflow service derives both. test, build, file, and asset checks must be executed during implementation; runtime checks are deferred by the workflow service to final runtime acceptance. changedPaths must contain only project files actually changed in this attempt and must never include workflow evidence. Do not submit verifiedArtifacts because the workflow service derives the complete set from the active task. Never author workflow evidence; the workflow service creates one canonical dispatch-scoped evidence file from the structured submission.'
    case 'implementation-auditor':
      return 'After auditing the complete implementation, call SubmitValidationResult exactly once with only status and findings. Each finding contains only artifactPaths, description, and requiredAction; never submit taskIds or checklistIds because the workflow service derives ownership from the active task graph. Do not author workflow evidence and do not return terminal JSON. The workflow service owns revision, complete task/checklist/import/composition coverage, and canonical evidence persistence. A passed result requires empty findings; failed or blocked requires at least one actionable finding. A passed audit requires a target-native dependency manifest, runnable entrypoint, build configuration, a successful clean build/typecheck using project-owned tooling, and source integration of all implemented subsystems; source files that cannot be built and launched must fail the audit.'
    case 'acceptance-validator':
      return 'After validating the complete delivery, call SubmitValidationResult exactly once with only status and findings. Each finding contains only artifactPaths, description, and requiredAction; never submit taskIds or checklistIds because the workflow service derives ownership from the active task graph. Do not author workflow evidence and do not return terminal JSON. The workflow service owns revision, complete task/checklist/import/composition coverage, and canonical evidence persistence. A passed result requires empty findings; failed or blocked requires at least one actionable finding. Acceptance must run the project-owned build and launch the target in its real runtime, then validate observable checklist behavior and imported resources; static source inspection alone can never pass.'
    case 'change-impact-analyzer':
      return 'After analyzing the requested change, call SubmitChangeImpactResult exactly once with classification, affectedRequirementIds, affectedChecklistIds, and rationale. Do not return terminal JSON or write workflow evidence.'
    case 'question-answerer':
      return 'After answering the active delivery question, call SubmitQuestionAnswerResult exactly once with only answer. Do not return terminal JSON or write workflow evidence.'
  }
}

function workerInstruction(
  workerType: WorkerDispatchRequest['workerType'],
  contract?: Record<string, unknown>,
): string {
  switch (workerType) {
    case 'document-reviewer':
    case 'implementation-auditor':
    case 'acceptance-validator':
    case 'change-impact-analyzer':
    case 'question-answerer':
      return 'Perform the assigned review or analysis as a read-only worker. Do not modify project files.'
    case 'document-author':
      return contract?.documentSet === 'checklist'
        ? 'Author only docs/acceptance/gameplay-checklist.md from the approved foundation documents. Every checklist item must be an observable gameplay check with a stable identifier and evidence expectation and must use its own canonical `- [ ] <stable-id> <observable check and evidence expectation>` Markdown task line. Do not modify any foundation document, source code, assets or manifest.'
        : 'Author only the six foundation documents required by the confirmed brief: GDD, technical design, art direction, UI/UX, audio design and asset plan. Every document must begin with YAML front matter declaring document_id, version in MAJOR.MINOR.PATCH form, and updated_at as an ISO 8601 UTC timestamp. Do not create or edit docs/acceptance/gameplay-checklist.md, search Resource Library, create or edit assets/asset-manifest.json, import resources, or implement runtime code. The checklist is generated only after foundation document review.'
    case 'resource-preparer':
      return contract?.resourceAttemptMode === 'fresh'
        ? 'Prepare resources only after the six foundation documents passed foundation review and the gameplay checklist was created. Read those approved documents and technical constraints, then create and validate only the canonical manifest with empty inventory arrays. Do not call ResourceLibrary, write source code or docs, or use placeholders. End after the valid manifest is persisted; the workflow service starts selection from its canonical plan.'
        : 'Continue resource preparation from the service-owned selection or repair contract. Use ResourceLibrary sequentially, import proven candidates in durable batches, and do not rebuild requirements from prose. Do not write source code or docs, use placeholders, or repeat the complete manifest inventory in the response. The final comprehensive review happens only after this manifest is complete.'
    case 'atomic-task-planner':
      return 'Convert the approved gameplay checklist and validated resource bindings into a complete atomic task graph. Resource requirements describe only resource responsibilities; never attach an unrelated gameplay or infrastructure task to one merely to satisfy schema. Use contract.resourceBindings as the resource authority; do not read the full asset manifest, search Resource Library, import resources, edit the manifest, or modify project files.'
    case 'implementation-worker':
      return 'Implement the assigned atomic task completely within its declared allowed paths and use only the approved resource manifest. The active task already contains the approved acceptance conditions: read its existing expected artifacts and only the direct project dependencies needed to implement them; do not reread canonical design documents, workflow logs, transcripts, or historical evidence. For file tools, use the exact Workspace root from this prompt once and append the workspace-relative path without reconstructing, abbreviating, or duplicating any directory segment. Do not search Resource Library, change the manifest, invent an MVP, or skip required artifacts.'
  }
}
