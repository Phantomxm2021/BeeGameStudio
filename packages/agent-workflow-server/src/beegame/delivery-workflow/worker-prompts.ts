import {
  CANONICAL_PROJECT_ARTIFACTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type WorkerDispatchRequest,
} from './types'
import { assertSharedDocumentWorker } from './retired-foundation-author'


export function buildWorkerPrompt(request: WorkerDispatchRequest): string {
  assertSharedDocumentWorker(request)
  const consumesPublishedIr = [
    'resource-planner',
    'content-author',
    'implementation-worker',
    'acceptance-validator',
  ].includes(request.workerType)
  const pathScope = request.allowedPaths?.length
      ? request.allowedPaths.join(', ')
      : 'read-only'
  const canonicalArtifacts =
    (request.workerType === 'document-author' &&
          request.contract.documentSet === 'checklist'
        ? CANONICAL_PROJECT_DOCUMENTS
        : CANONICAL_PROJECT_ARTIFACTS)
  const gameIrInstruction = formatGameIrInstruction(request)
  return [
    `BeeGame delivery worker: ${request.workerType}`,
    `Phase: ${request.phase}`,
    `Run: ${request.runId}`,
    `Revision: ${request.revision}`,
    `Workspace root: ${request.workspacePath}`,
    `Writable paths: ${pathScope}`,
    `Canonical artifacts: ${canonicalArtifacts.join(', ')}`,
    consumesPublishedIr
      ? ''
      : 'The durable confirmed brief context and its digest are the product authority for this run.',
    consumesPublishedIr
      ? ''
      : 'Confirmed Brief settings are higher authority than free-form idea text; on conflict, do not preserve both sides as simultaneous requirements.',
    undefined,
    undefined,
    workerInstruction(request),
    'Use the confirmed contract and task payload as authority. Do not use chat transcript prose as product authority.',
    'Use Bee Game Studio normally. Its native tools, thinking, permissions, context management, and completion behavior remain available. Do not bind a resource decision to a particular game engine or platform unless the approved target explicitly requires it.',
    gameIrInstruction,
    terminalInstruction(request),
    formatContract(request),
    undefined,
  ].join('\n')
}

function formatContract(request: WorkerDispatchRequest): string {
  const { confirmedBriefContext: _confirmedBriefContext, ...contract } = request.contract
  return JSON.stringify(contract)
}

function formatGameIrInstruction(request: WorkerDispatchRequest): string {
  const gameIr = request.contract.gameIr
  if (gameIr === undefined) return ''
  if (typeof gameIr !== 'object' || Array.isArray(gameIr))
    throw new Error('gameIr contract must be an object')
  return [
    'The injected contract.gameIr is the sole fixed Game IR version for this dispatch. Use its resultId, foundationRevision and publicationId to identify the stable publication, and use its module values, node IDs, references and edges exactly as authority.',
    'Source documents and other prose explain design only; they must not silently produce a second specification. If they conflict with contract.gameIr, report the contradiction as an actionable finding for this worker and do not recompile, regenerate or mutate Game IR.',
  ].join(' ')
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
          'Continue the same direct CLI resource task using the complete injected Game IR.',
          'Fix the deterministic contract errors in contract.currentResourceIssues, preserve valid work, and finish the resource delivery normally.',
        ].join(' ')
      return [
        'Complete resource delivery in one normal CLI turn. Use the complete injected Game IR, contract.systemDeliveryContract and contract.resourceLibraryUsage as the product and output contract. Work autonomously with the available native tools and choose how to search, inspect, select, create and combine resources.',
        'Deliver real runtime assets that satisfy the IR together as one coherent game presentation. Do not use arbitrary placeholders. This stage owns only runtime assets and the canonical Manifest, including requirement-to-resource bindings. Scene, UI, VFX, gameplay configuration and source code belong to later stages.',
        'Keep all durable output under assets/ and follow contract.systemDeliveryContract for Manifest paths, fields, bindings, hashes and provenance. Do not create assets/content or another resource registry. Do not download executable code or install packages. Use a web resource only when its source and commercial-use/web-redistribution license can be recorded.',
        'When Resource Library usage is required, reuse only verified library resources already materialized in the project; if none exist, never fabricate library provenance. The host will report the missing user-provided library selection as needs_action.',
        'End normally with a concise summary. The host performs only deterministic contract validation after the CLI turn.',
      ].join(' ')
    case 'content-author':
      if (
        Array.isArray(request.contract.currentContentIssues) &&
        request.contract.currentContentIssues.length > 0
      )
        return [
          'Continue the same direct CLI Scene/UI content task.',
          'Fix only the deterministic package errors in contract.currentContentIssues, preserve valid work, and finish normally.',
        ].join(' ')
      return [
        'Create the engine-neutral Scene2D and UI content package in one normal CLI turn from the injected fixed Game IR and Asset Manifest.',
        'Write content/index.json, scene files under content/scenes/, and UI files under content/ui/. Keep world-space Scene content and screen-space UI content separate.',
        'Reference IR nodes through irRefs and verified Manifest resources through assetRefs. Do not embed asset paths or URLs, create a second resource registry, write target-engine code, or expand into VFX, characters, animation, audio or gameplay implementation.',
        'Finish after the coherent Scene/UI package is complete. The host performs deterministic schema, revision, reference and hierarchy validation.',
      ].join(' ')
    case 'implementation-worker':
      if (
        Array.isArray(request.contract.currentImplementationIssues) &&
        request.contract.currentImplementationIssues.length > 0
      )
        return [
          'Continue the same direct CLI implementation task using the complete injected Game IR.',
          'Fix the deterministic host errors in contract.currentImplementationIssues, preserve valid work, run only the relevant checks, and finish normally.',
        ].join(' ')
      return [
        'Complete contract.task within allowedPaths in one normal CLI turn. Implement the injected fixed Game IR and contract.gameContent package for the selected target, and use the Manifest only to locate their referenced runtime assets.',
        'The running game must load content/index.json and its registered Scene/UI documents as runtime data. Do not copy their editable values into source code or a second generated configuration.',
        'Do not proactively reread all canonical documents, recompile the IR, or redesign the Scene/UI package. Consult only the specific referenced source needed when an exact IR fact is missing or contradictory, and report that contradiction without creating a second specification.',
        'Work normally with native tools. Audit the completed implementation once against the published IR and checklist and correct substantive functional or IR conflicts. Run existing non-runtime checks once when they exist; do not create a new verification framework or large one-off harness. If no check exists, perform only brief targeted static sanity checks. Runtime acceptance is a separate phase.',
      ].join(' ')
    case 'acceptance-validator':
      return [
        'Run the implemented game and verify the published IR, accepted Scene/UI package and checklist as a read-only acceptance pass. Use the project\'s existing runtime and test tooling; do not modify project files.',
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
      return 'Finish the complete assets/ resource contract, verify the Manifest and local resources, then end the turn normally. The host owns deterministic acceptance and receipt generation.'
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
