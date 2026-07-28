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
  return [
    `BeeGame delivery worker: ${request.workerType}`,
    `Phase: ${request.phase}`,
    `Run: ${request.runId}`,
    `Revision: ${request.revision}`,
    `Allowed paths: ${scope}`,
    `Canonical artifacts: ${canonicalArtifacts.join(', ')}`,
    'Request kind: confirmed_build_brief. The persisted brief digest is the product authority for this run.',
    workerInstruction(request.workerType, request.contract),
    'Use the confirmed contract and task payload as authority. Do not use chat transcript prose as product authority.',
    'For atomic-task-planner results, every resource import and composition ID in the contract must be copied into the matching task resourceImportIds or resourceCompositionIds array.',
    terminalContractInstruction(request.workerType),
    'Return exactly one strict JSON terminal object matching the worker contract. Do not wrap it in prose or markdown fences.',
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
              ]),
        ]
      : []),
    ...(request.workerType === 'document-reviewer'
      ? [
          'Classify every finding structurally. Any unresolved contradiction between canonical artifacts, missing behavior needed for a unique implementation, or missing acceptance definition is blocking. A READY verdict is valid only when there are zero blocking findings. Do not resolve a contradiction by choosing one document as authority; return NEEDS_REVISION so the documents can be reconciled.',
          request.contract.reviewScope === 'foundation'
            ? 'This is the foundation review substep. Review only the six foundation documents listed in the current workspace; do not require or review docs/acceptance/gameplay-checklist.md yet. Return reviewedDocumentPaths for those six documents and an empty checklistIds array.'
            : 'This is the final comprehensive review substep. Review all six approved foundation documents, docs/acceptance/gameplay-checklist.md, and assets/asset-manifest.json together. Verify their cross-artifact consistency and return all eight paths in reviewedDocumentPaths plus coverage for every checklist ID.',
          ...(request.contract.priorRemediation
            ? [
                'This is a remediation follow-up review. Verify every priorRemediation finding against the current files and record the outcome in the evidence. Do not return READY unless every prior finding is actually corrected and the current review has no blocking findings.',
              ]
            : []),
        ]
      : []),
    ...(request.workerType === 'resource-preparer'
      ? [
          'Resource preparation approves inventory and an integration plan; it does not claim implementation that has not happened. New imports must remain available, requirements that implementation has not fulfilled must remain planned, and compositions without an existing target-native recipe must remain planned. Never report satisfied, assembled, integrated, usage_evidence, integration_evidence, or recipe.path unless the referenced project files already exist and the evidence is current.',
          'The manifest must preserve project_target.resource_library_usage and declare the real target-supported asset_format_capabilities plus a concrete workspace-relative project_target.runtime_asset_root. Imported files may be written under that declared runtime root even when it is outside assets/.',
          ...(request.contract.remediation
            ? [
                'This is a repair pass over existing resources. Preserve every import and composition ID listed by contract.remediation, preserve valid imported files, and correct only the reported deterministic issues. Do not browse, select, or import replacement resources during this pass; a separate explicit resource-selection request is required if an existing file is genuinely missing. If native provenance is missing after restart, invoke refresh_import_metadata exactly once to verify the pinned imports and rebuild current provenance without downloading or replacing them.',
              ]
            : []),
        ]
      : []),
    ...(request.workerType === 'implementation-worker'
      ? [
          'Do not edit assets/asset-manifest.json. Report every actual imported-resource reference, composition integration, and requirement satisfaction in the terminal resource arrays. The workflow service validates those paths against the active task and updates the manifest after task completion.',
        ]
      : []),
    JSON.stringify(request.contract),
  ].join('\n')
}

function terminalContractInstruction(
  workerType: WorkerDispatchRequest['workerType'],
): string {
  switch (workerType) {
    case 'document-author':
      return 'Terminal JSON contract (exact keys): {"workerType":"document-author","status":"completed","writtenPaths":["<workspace-relative path>"],"resolvedFindingIds":["<review finding id>"]}. The server computes revisions from the written files; do not return revision or documentRevision. Use an empty resolvedFindingIds array outside remediation passes. Do not use worker, succeeded, or changedPaths.'
    case 'document-reviewer':
      return 'Terminal JSON contract (exact keys): {"workerType":"document-reviewer","revision":"<dispatch revision>","verdict":"READY|NEEDS_REVISION|BLOCKED","reviewedDocumentPaths":["<workspace-relative path>"],"checklistIds":["<stable checklist id>"],"findings":[{"severity":"blocking|non_blocking","category":"cross_document_conflict|missing_spec|calculation|other","documents":["<workspace-relative path>"],"description":"<finding>","requiredAction":"<required correction>"}],"evidencePath":".beegame/workflow/evidence/<file>"}. READY requires zero blocking findings.'
    case 'resource-preparer':
      return 'Terminal JSON contract (exact keys): {"workerType":"resource-preparer","revision":"<dispatch revision>","status":"completed|failed|blocked","writtenPaths":["<workspace-relative path>"],"importIds":["<import id>"],"compositionIds":["<composition id>"],"evidencePath":".beegame/workflow/evidence/<file>"}.'
    case 'atomic-task-planner':
      return 'Terminal JSON contract: use exactly the keys workerType, status, revision, tasks, and evidencePath; status is completed, tasks is a non-empty array of complete atomic task objects, and evidencePath is under .beegame/workflow/evidence/.'
    case 'implementation-worker':
      return 'Terminal JSON contract (exact keys): {"workerType":"implementation-worker","taskId":"<task id>","status":"completed|failed|blocked","revision":"<dispatch revision>","changedPaths":["<workspace-relative path>"],"evidenceRefs":["<evidence path>"],"evidencePath":".beegame/workflow/evidence/<file>","resourceReferences":[{"importId":"<task resource import id>","references":["<existing project usage path>"],"runtimeEventIds":[]}],"compositionIntegrations":[{"compositionId":"<task composition id>","recipePath":"<existing target-native recipe path>","references":["<existing integration evidence path>"],"runtimeEventIds":[]}],"requirementSatisfactions":[{"requirementId":"<task source requirement id>","importIds":["<task import id>"],"compositionIds":["<task composition id>"],"projectReferences":["<existing implementation path>"]}]}. Use empty arrays when the task has no corresponding resource facts.'
    case 'implementation-auditor':
      return 'Terminal JSON contract (exact keys): {"workerType":"implementation-auditor","status":"passed|failed|blocked","revision":"<dispatch revision>","auditedTaskIds":["<task id>"],"checklistIds":["<stable checklist id>"],"importIds":["<import id>"],"compositionIds":["<composition id>"],"findings":["<finding>"],"evidencePath":".beegame/workflow/evidence/<file>"}.'
    case 'acceptance-validator':
      return 'Terminal JSON contract (exact keys): {"workerType":"acceptance-validator","status":"passed|failed|blocked","revision":"<dispatch revision>","checklistIds":["<stable checklist id>"],"importIds":["<import id>"],"compositionIds":["<composition id>"],"findings":["<finding>"],"evidencePath":".beegame/workflow/evidence/<file>"}.'
    case 'change-impact-analyzer':
      return 'Terminal JSON contract (exact keys): {"workerType":"change-impact-analyzer","classification":"question|implementation_only|documents_required","affectedRequirementIds":["<requirement id>"],"affectedChecklistIds":["<checklist id>"],"rationale":"<reason>","evidencePath":".beegame/workflow/evidence/<file>"}.'
    case 'question-answerer':
      return 'Terminal JSON contract (exact keys): {"workerType":"question-answerer","answer":"<answer>","evidencePath":".beegame/workflow/evidence/<file>"}.'
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
      return 'Prepare resources only after the six foundation documents passed foundation review and the gameplay checklist was created. Read those approved documents and technical constraints, search the Resource Library with bounded requests, import only selected resources, and write a valid assets/asset-manifest.json. Do not write source code or docs, do not use placeholders, and report every manifest import and composition ID in the terminal result. The final comprehensive review happens only after this manifest is complete.'
    case 'atomic-task-planner':
      return 'Convert every approved document requirement and every validated resource import/composition into a complete atomic task graph. Use the approved resource manifest as read-only input; do not search Resource Library, import resources, edit the manifest, or modify project files.'
    case 'implementation-worker':
      return 'Implement the assigned atomic task completely within its declared allowed paths and use only the approved resource manifest. Do not search Resource Library, change the manifest, invent an MVP, or skip required artifacts.'
  }
}
