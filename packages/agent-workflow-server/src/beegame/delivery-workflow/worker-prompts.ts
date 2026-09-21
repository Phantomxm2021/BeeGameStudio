import {
  CANONICAL_PROJECT_ARTIFACTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type WorkerDispatchRequest,
} from './types'
import { assertSharedDocumentWorker } from './retired-foundation-author'
import { CONTENT_COORDINATE_CONTRACT } from '../../../../scene-editor/src/content-coordinates'
import { runtimeAcceptancePath } from './runtime-acceptance'


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
    'Writable paths are workspace-relative. File mutations, including temporary files, must stay within these paths and the project workspace.',
    ...(request.protectedPaths?.length
      ? [`Protected paths (read-only, even inside writable paths): ${request.protectedPaths.join(', ')}`]
      : []),
    `Canonical artifacts: ${canonicalArtifacts.join(', ')}`,
    'The accepted Foundation documents describe the product within the confirmed user scope; their elaborations do not authorize extra gameplay or scope expansion beyond that request.',
    'Read the accepted documents directly when requirements are needed.',
    ...(request.workerType === 'implementation-worker' ? [`Content coordinate semantics: ${JSON.stringify(CONTENT_COORDINATE_CONTRACT)}`] : []),
    undefined,
    undefined,
    workerInstruction(request),
    ...(request.workerType === 'implementation-worker' ? [
      'The content format is available at contract.gameContent.authoringContractPath. Its inspectionCommand provides a compact file/node index or an exact authored node without reading a whole large Scene document. Its validationCommand checks the content contract and references, not game playability or rendered correctness; choose runtime verification yourself.',
      'When an issue does not block implementation, briefly record its symptom/evidence, impact, repair owner and outcome in .beegame/implementation-issues.md and finish the game logic first. Address issues that truly block implementation when discovered; do not build on invalid assumptions. No empty report is needed.',
      'After implementation, resolve the recorded issues by responsibility: source-asset defects belong to a targeted resource repair task; loading/rendering/interaction defects belong to implementation. Coordinate resource repair using native delegation as useful, without restarting resource production. The implementation role must not silently rewrite source assets as a rendering fix; if handoff cannot be completed, report the unresolved issue.',
      'The resource repair owner must keep changed assets, Manifest hashes/metadata and processing provenance consistent. Do not blindly refresh hashes to pass validation. Existing resource capabilities are available for this handoff, not an instruction to generate new assets.',
      'Use contract.resourceValidationCommand for the same read-only resource check as the host, then verify the affected build/runtime behavior after repairs. Update the issue notes with outcomes; do not reuse a pre-repair PASS or report passed while required fixes remain unresolved. No extra audit agent or automatic retry loop is required.',
      'Implement consumers from the actual Content data, including VFX/behavior fields, component types, events and resource members; do not assume a different field vocabulary. Keep parsing/types and focused tests in this project, and exercise the affected event paths. A package schema check alone does not prove its runtime consumers agree. Reuse useful project tests; no platform-fixed gameplay script or new engine adapter is required.',
    ] : []),
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
        'Required sourcing priority for visual asset groups: built-in resource library -> licensed internet assets -> AI image generation -> programmatic drawing. Move to the next source only when the preceding source cannot supply suitable usable assets; record the concrete evidence or access failure. Suitable existing assets may be retained only with provenance showing that this sourcing requirement was met. Do not skip internet search after a library miss or AI failure.',
        'Choose search queries, sources and tools autonomously; no fixed search count or tool sequence is required. Missing deferred tools or an unavailable library do not mean no suitable internet assets exist. Use the supplied library endpoint and native web/search/browser or Bash HTTP capabilities as available.',
        'Record actual sources checked and concrete suitability or access limitations in existing selection_reason/source fields. Do not claim no matching assets without a real search, silently substitute provisional assets for required final formats, or treat schema acceptance as visual/audio quality verification.',
        'Reusing previously generated assets does not waive the sourcing priority. For each visual asset group record actual library checks and internet queries, candidate/page URLs, retrieval dates and suitability/license or access findings in selection_reason; shared searches may be referenced across a group. For selected web assets record verified license facts in source. A built-in-library search is not an internet search. Agent-authored ASSET_PLAN wording such as self-drawn/original is a style requirement, not user permission to bypass sourcing. Only an explicit user source constraint can override this priority; cite it. Procedural effects and non-image assets should use applicable capabilities, not an image-generation API.',
        'If AI generation is unavailable or unsuccessful, preserve its structured error/receipt facts and do not silently downgrade required visual quality to geometric placeholders. Programmatic drawing is the last option and must still meet the accepted visual requirements; otherwise report the unresolved asset group. Unknown receipts are not evidence of another upstream attempt.',
        'Write the Asset Manifest at contract.manifestPath and its referenced files under assets/. Record source and license facts for web assets. Only selected usable resources belong in the final Manifest/runtime asset set. Keep inspection downloads and rejected candidates in task scratch space, and remove your unreferenced rejected candidates before delivery; preserve user files and provenance records.',
        'Choose independently whether to delegate independent resource groups or verification to native subagents. Shared manifests and final integration remain the parent task’s responsibility; parallel work must not overwrite another task’s files.',
        'Generated image dimensions are source-canvas dimensions, not a required game layout. Choose reusable tiles, sprites, layers or separate frames and compose them when appropriate for scrolling/platform games; no particular composition method is required.',
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
          'Read the exact file format from contract.authoringContractPath and the resource index at contract.assetManifestPath as needed. Fix the deterministic package errors in contract.currentContentIssues while preserving valid game decisions.',
          'Use contract.validationCommand and contract.previewCommand as needed to inspect the result and correct substantive package, visual, or spatial mismatches autonomously.',
        ].join(' ')
      return [
        'Create the engine-neutral Scene, UI and VFX content package from the accepted Foundation documents and Asset Manifest.',
        'The exact file format is in contract.authoringContractPath; resources are indexed at contract.assetManifestPath. Read these references and relevant document sections as needed; all accepted documents remain accessible. Write content/index.json, Scene files under content/scenes/, UI files under content/ui/, and VFX files under content/vfx/. Keep world-space Scene, screen-space UI and effects separate.',
        'Reference verified Manifest resources through assetRefs. Keep asset paths and URLs out of content data; leave target-engine implementation for the following stage.',
        'Use contract.validationCommand and contract.previewCommand as useful evidence while you inspect the rendered Scene images in contract.previewCommand.outputRoot. Judge the actual composition against the accepted Foundation documents and assets, and correct substantive visual or spatial mismatches autonomously.',
        'Distinguish invalid content/assets from preview renderer defects. Fix invalid inputs; for renderer defects report the failing node and diagnostic instead of changing valid authored opacity, blend or layout to work around the tool.',
        'Finish after the coherent Content package is complete.',
      ].join(' ')
    case 'implementation-worker':
      if (typeof request.contract.changeRequest === 'string' && request.contract.changeRequest.trim())
        return [
          'Address contract.changeRequest in the existing project. contract.changeRationale is the prior diagnosis, not a replacement for the original request.',
          'Preserve unrelated working behavior. Read the relevant files, investigate and fix the reported problem, and verify it in the affected runtime environment.',
          'Coordinate source-asset repairs separately from implementation fixes; do not suppress errors to accommodate defects. Finish normally and report observations and unresolved issues.',
        ].join(' ')
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
        'Keep Content references consistent with the accepted resources. Verify that authored transforms and resource references are actually consumed by the running game, and distinguish failed resource loading from source-asset defects.',
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
      return [
        'Finish normally with a concise summary. Choose your own verification methods; no additional audit Agent or fixed test sequence is required.',
        'Automated browser tests must not play audible sound on the host: launch test Chromium with --mute-audio (headless alone does not mute). Preserve the game audio implementation. Use bounded waits and reject protocol errors. In finally, close the actual test pages/contexts and any browser process you started; disconnecting CDP alone does not close a page. Never stop an unrelated user browser.',
        'Before finishing, reconcile your TodoWrite list with the observed results. Mark only verified work completed; explicitly leave failed or blocked work unresolved. A final prose summary does not update TodoWrite.',
        request.dispatchId ? `Save a short JSON result at ${runtimeAcceptancePath(request.dispatchId)}: {"status":"passed|failed|blocked","summary":"observations and unresolved issues","environment":"actual runtime surface tested","evidencePaths":["workspace-relative saved screenshot or test report"]}. Report passed only for observed success on the actual target environment, including the host iframe for Web Preview, with saved evidence. Report failed for observed defects or blocked when verification could not be completed. The host records your conclusion and checks evidence identity; it does not infer success from your final prose.` : '',
      ].filter(Boolean).join(' ')
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
