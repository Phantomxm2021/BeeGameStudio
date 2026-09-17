import {
  CANONICAL_PROJECT_ARTIFACTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type WorkerDispatchRequest,
} from './types'
import { assertSharedDocumentWorker } from './retired-foundation-author'


export function buildWorkerPrompt(request: WorkerDispatchRequest): string {
  assertSharedDocumentWorker(request)
  const pathScope = request.allowedPaths?.length
      ? request.allowedPaths.join(', ')
      : 'read-only'
  const canonicalArtifacts =
    (request.workerType === 'document-author' &&
          request.contract.documentSet === 'checklist'
        ? CANONICAL_PROJECT_DOCUMENTS
        : CANONICAL_PROJECT_ARTIFACTS)
  return [
    `BeeGame delivery worker: ${request.workerType}`,
    `Phase: ${request.phase}`,
    `Run: ${request.runId}`,
    `Revision: ${request.revision}`,
    `Workspace root: ${request.workspacePath}`,
    `Writable paths: ${pathScope}`,
    `Canonical artifacts: ${canonicalArtifacts.join(', ')}`,
    'The accepted Foundation documents and their published revision are the product authority for this run.',
    'Read the accepted documents directly when requirements are needed.',
    undefined,
    undefined,
    workerInstruction(request),
    'Use the confirmed contract and task payload as authority. Do not use chat transcript prose as product authority.',
    'Use Bee Game Studio normally. Its native tools, thinking, permissions, context management, and completion behavior remain available. Do not bind a resource decision to a particular game engine or platform unless the approved target explicitly requires it.',
    terminalInstruction(request),
    formatContract(request),
    undefined,
  ].join('\n')
}

function formatContract(request: WorkerDispatchRequest): string {
  const { confirmedBriefContext: _confirmedBriefContext, ...contract } = request.contract
  return JSON.stringify(contract)
}

function workerInstruction(request: WorkerDispatchRequest): string {
  switch (request.workerType) {
    case 'document-author':
      if (request.contract.documentSet !== 'checklist')
        throw new Error('Foundation author must use the dedicated authoring prompt')
      return [
        '',
        `Author only the Checklist candidate at ${documentAuthorTargetPath(request)} from the injected frozen Checklist Authority Projection.`,
              'Every acceptance task must be one Markdown checkbox line with a stable ID, source tag, observable behavior and evidence expectation. Create a task only for a distinct, independently observable acceptance condition explicitly present in a SCENARIO block. Do not expand sentences, table rows, variants, prior checklist entries, or generic best practice into new work.',
              'Merge equivalent variants when they share one setup, action and observable outcome. Keep each task independently pass/fail and cite its one owning source block.',
              'Use the canonical form `- [ ] <stable-id> [docs/path.md#source_block] <observable check and evidence expectation>`. For a GATE REFERENCE use exactly `Owner gate passes; evidence: linked owner validation.` after its source tag; never copy or expand its owner details. Tables may add context but cannot replace checkbox tasks.',
              'Do not modify foundation documents, resources, the asset manifest or implementation files.',
        '',
      ].join(' ')
    case 'resource-planner':
      if (
        Array.isArray(request.contract.currentResourceIssues) &&
        request.contract.currentResourceIssues.length > 0
      )
        return [
          'Continue the same direct CLI resource task using the accepted Foundation documents.',
          'Fix the deterministic contract errors in contract.currentResourceIssues, preserve valid work, and finish the resource delivery normally.',
        ].join(' ')
      return [
        'Complete resource delivery in one normal CLI turn. Read the accepted Foundation documents, then autonomously search for, select or make the real runtime assets the game needs.',
        'Create the canonical Asset Manifest at contract.manifestPath and the referenced files under assets/. Record source and license facts for any web asset. Keep Scene/UI/VFX content and implementation for their later stages.',
        'Run contract.validationCommand once near the end and use its diagnostics to correct the delivery. The host performs the final deterministic validation after the CLI turn.',
        'End normally with a concise summary.',
      ].join(' ')
    case 'content-author':
      if (
        Array.isArray(request.contract.currentContentIssues) &&
        request.contract.currentContentIssues.length > 0
      )
        return [
          'Continue the same direct CLI Scene/UI/VFX content task.',
          'Use contract.output.format as the exact strict file shape. Fix the deterministic package errors in contract.currentContentIssues while preserving valid game decisions.',
          'Run contract.validationCommand once near the end, correct its diagnostics, and finish normally.',
        ].join(' ')
      return [
        'Create the engine-neutral Scene, UI and VFX content package in one normal CLI turn from the accepted Foundation documents and Asset Manifest.',
        'Use contract.output.format as the exact strict file shape. Write content/index.json, Scene files under content/scenes/, UI files under content/ui/, and VFX files under content/vfx/. Keep world-space Scene, screen-space UI and effects separate.',
        'Reference verified Manifest resources through assetRefs. Keep asset paths and URLs out of content data; leave target-engine implementation for the following stage.',
        'Run contract.validationCommand once near the end and use its diagnostics to correct the package. The host performs the same deterministic validation after the CLI turn.',
        'Finish after the coherent Content package is complete.',
      ].join(' ')
    case 'implementation-worker':
      if (
        Array.isArray(request.contract.currentImplementationIssues) &&
        request.contract.currentImplementationIssues.length > 0
      )
        return [
          'Continue the same direct CLI implementation task using the accepted Foundation documents.',
          'Fix the deterministic host errors in contract.currentImplementationIssues, preserve valid work, run only the relevant checks, and finish normally.',
        ].join(' ')
      return [
        'Complete contract.task within allowedPaths in one normal CLI turn. Implement the accepted Foundation documents and contract.gameContent package for the selected target, and use the Manifest only to locate their referenced runtime assets.',
        'The running game must load content/index.json and its registered Scene/UI documents as runtime data. Do not copy their editable values into source code or a second generated configuration.',
        'Read the specific accepted document sections needed for implementation and keep the content package as the editable source of Scene/UI data.',
        'Work normally with native tools. Audit the completed implementation once against the accepted Foundation documents, content package and checklist and correct substantive functional conflicts. Run existing non-runtime checks once when they exist; do not create a new verification framework or large one-off harness. If no check exists, perform only brief targeted static sanity checks. Runtime acceptance is a separate phase.',
      ].join(' ')
    case 'acceptance-validator':
      return [
        'Run the implemented game and verify the accepted Foundation documents, Scene/UI package and checklist as a read-only acceptance pass. Use the project\'s existing runtime and test tooling; do not modify project files.',
        'In the final response, report one evidence line for every ID in contract.taskIds, contract.checklistIds, contract.contentIds and contract.resourceIds, using exactly `TASK <id>: PASS|FAIL — <observation>`, `CHECKLIST <id>: PASS|FAIL — <observation>`, `CONTENT <id>: PASS|FAIL — <observation>`, or `ASSET <id>: PASS|FAIL — <observation>`. Do not claim an ID without observing it.',
        'After those evidence lines, end with exactly ACCEPTANCE: PASS only when every reported item passed; otherwise end with exactly ACCEPTANCE: FAIL.',
      ].join(' ')
    case 'change-impact-analyzer':
      return 'Review the requested change against the project as a read-only worker. Decide its actual impact autonomously; do not modify project files.'
    case 'question-answerer':
      return 'Answer the requested project question as a read-only worker. Do not modify project files.'
    default:
      throw new Error(`retired delivery worker: ${request.workerType}`)
  }
}


function terminalInstruction(request: WorkerDispatchRequest): string {
  switch (request.workerType) {
    case 'document-author':
      return request.contract.documentSet === 'foundation' &&
        (request.contract.authoringMode === 'initial' ||
          request.contract.authoringMode === 'parallel-draft')
        ? ''
        : request.contract.authoringMode === 'initial'
          ? `Ensure the assigned Markdown game document at ${documentAuthorTargetPath(request)} is complete and end the turn normally. The native runtime owns the file-operation sequence.`
          : `Ensure the assigned Markdown document at ${documentAuthorTargetPath(request)} is complete and end the turn normally. The native runtime owns the file-operation sequence.`
    case 'resource-planner':
      return 'The contract includes a read-only validation command using the host checks. Use its diagnostics when checking the delivery. Summarize the produced assets and observed validation result; final stage acceptance and receipt generation belong to the host.'
    case 'content-author':
      return 'Finish the Scene2D and UI package under content/, then end the turn normally. The host validates the package and creates its receipt.'
    case 'implementation-worker':
      return 'Finish the implementation and deterministic checks, then end the turn normally with a concise summary. The host verifies expected artifacts and persists workflow evidence.'
    case 'acceptance-validator':
      return 'Run runtime acceptance normally, report the required per-ID evidence lines, and finish with the required plain-text ACCEPTANCE verdict line.'
    case 'change-impact-analyzer':
      return 'End with exactly four plain-text lines: `CLASSIFICATION: question|implementation_only|documents_required`, `AFFECTED_REQUIREMENTS: <comma-separated IDs or NONE>`, `AFFECTED_CHECKLIST: <comma-separated IDs or NONE>`, and `RATIONALE: <concise single-line rationale>`.'
    case 'question-answerer':
      return 'End normally with the answer in the final response.'
    default:
      throw new Error(`retired delivery worker: ${request.workerType}`)
  }
}

function documentAuthorTargetPath(request: WorkerDispatchRequest): string {
  return request.contract.documentSet === 'checklist'
    ? String(request.allowedPaths?.[0])
    : String(request.contract.foundationDocumentPath)
}
