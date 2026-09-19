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
      return [
        'Read the accepted Foundation documents and the Asset Manifest authoring contract at contract.contractPath, then autonomously obtain or make the runtime assets the game needs.',
        'Write the Asset Manifest at contract.manifestPath and its referenced files under assets/. Record source and license facts for web assets.',
        'Finish normally with a concise summary. The host validates the persisted manifest after the turn.',
        'contract.validationCommand runs the same read-only interface check as the host. Use it as needed; contract.validationIssues reports current interface issues to address while preserving usable assets. No separate verification agent is required.',
      ].join(' ')
    case 'content-author':
      if (
        Array.isArray(request.contract.currentContentIssues) &&
        request.contract.currentContentIssues.length > 0
      )
        return [
          'Continue the same direct CLI Scene/UI/VFX content task.',
          'Use contract.output.format as the exact strict file shape. Fix the deterministic package errors in contract.currentContentIssues while preserving valid game decisions.',
          'Use contract.validationCommand and contract.previewCommand as needed to inspect the result and correct substantive package, visual, or spatial mismatches autonomously.',
        ].join(' ')
      return [
        'Create the engine-neutral Scene, UI and VFX content package from the accepted Foundation documents and Asset Manifest.',
        'Use contract.output.format as the exact strict file shape. Write content/index.json, Scene files under content/scenes/, UI files under content/ui/, and VFX files under content/vfx/. Keep world-space Scene, screen-space UI and effects separate.',
        'Reference verified Manifest resources through assetRefs. Keep asset paths and URLs out of content data; leave target-engine implementation for the following stage.',
        'Use contract.validationCommand and contract.previewCommand as useful evidence while you inspect the rendered Scene images in contract.previewCommand.outputRoot. Judge the actual composition against the accepted Foundation documents and assets, and correct substantive visual or spatial mismatches autonomously.',
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
        'Complete contract.task within allowedPaths. Implement the accepted Foundation documents and contract.gameContent package for the selected target, and use the Manifest only to locate their referenced runtime assets.',
        'The running game must load content/index.json and its registered Scene/UI documents as runtime data. Do not copy their editable values into source code or a second generated configuration.',
        'Read the specific accepted document sections needed for implementation and keep the content package as the editable source of Scene/UI data.',
        'Work normally with native tools. Run the game and inspect the relevant visual and interaction results before finishing. Correct substantive functional, production-build, visual, or content conflicts you find. Choose the checks and workflow that are useful for this task; do not add a framework solely to satisfy this request. End with a concise account of what you observed and anything that remains unresolved.',
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
      return 'Summarize the produced assets, the checks you used, and any unresolved issue. The host validates the persisted contract and records the receipt.'
    case 'content-author':
      return 'Finish the Scene/UI/VFX package under content/ and end normally with a concise summary. The host validates the package and creates its receipt.'
    case 'implementation-worker':
      return 'Finish the implementation and end normally with a concise summary. The host confirms artifact identity and persists workflow evidence.'
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
