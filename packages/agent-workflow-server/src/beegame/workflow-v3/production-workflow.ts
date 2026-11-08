import { ProductionBlockedError } from '../production-blocked'
import { createHash } from 'node:crypto'
import { constants, lstatSync, openSync, closeSync, fstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod/v4'
import { readDesignSections } from '../design-source-reading'
import type { Run, AgentTurn } from './state'
import { confirmedResourceLibraryUsage } from '../confirmed-brief-context'
import { readBeeGameAssetManifestSync } from '../asset-contracts'
import { requiredLibraryDeliverySources } from '../asset-contract-audit'
import { designAuthorResultSchema, designAuthorOutputSchema } from './design-review'

// Historical assignment fields retain their original discipline names.
export type DesignDiscipline = 'gameplay' | 'levels' | 'balance' | 'art' | 'ui' | 'audio' | 'resources' | 'technical'
export type ProductionAssignment = {
  stage: 'discovery' | 'direction' | 'design' | 'visual' | 'resources' | 'implementation' | 'verification'
  // Exact settled implementation whose outputs this fresh-context task verifies.
  verificationOf?: string
  // Archived assignments may carry this retired marker; it no longer controls execution.
  browserVerification?: 1
  stopAfter?: 'visual' | 'resources' | 'implementation'
  // Historical fields remain readable; current design work follows its assignment.
  discipline?: DesignDiscipline
  completedDesigns?: DesignDiscipline[]
  originRequestKey: string
}
export type ProductionHandoff = {
  request: { action: 'advance' | 'visual' | 'resources' | 'implement' | 'select-visual'; summary: string; sections: string[]; files: string[]; nextDesign?: DesignDiscipline; coveredDesigns?: Partial<Record<DesignDiscipline, string[]>> }
  next?: ProductionAssignment
  sources: Array<{ path: string; sha256: string }>
}
const researchPath = 'docs/ResearchBrief.md'
const discoveryAssignment = [
  'Investigate an unresolved question that could change the creative direction. Deliver the observed evidence and its limits to Creative Direction + Taste Engine, which develops and compares candidate expressions and makes their visual studies.',
  'Start from the confirmed choices, constraints and approved references. Reuse relevant evidence already available, and retain precise source locations for outside observations. In docs/ResearchBrief.md connect the pending question to traceable sources, what you actually observed, your inference and its limits. Retain the local material the direction author needs to inspect.',
  'Once the evidence supports a meaningful comparison, return ready with sections:[] and the brief, sources and research images needed by its consumer. Use the handoff summary for the research conclusion and remaining uncertainty. Creative Direction develops the candidate treatments and their visual presentation from these inputs.',
].join(' ')

export function discoveryRecoveryContext(workspace: string) {
  // The draft is a pointer for the author, not a validated handoff. Its text and
  // reference files may still be incomplete after interruption.
  const draft = lstatSync(resolve(workspace, researchPath), {throwIfNoEntry:false})
  const resume = draft?.isFile()
    ? 'Continue from the saved draft at ' + researchPath + ' and the references it cites.'
    : 'Continue from the observations and reference material already retained in this session and workspace.'
  return discoveryAssignment + '\n' + resume + ' Reuse what already answers the pending choice; investigate only a gap that would change the comparison.'
}

const directionPath = 'docs/VisualContract.md'
const selectedMedia = /\.(?:svg|png|jpe?g|webp|gif|pdf|html|mp4|webm)$/i
const visualSourcePattern = /\.(svg|png|jpe?g|webp|gif|pdf)$/i

// References are source records, independent of a production-stage transition.
// Historical settled visual handoffs retain their original authority.
export function selectedProductionVisualSources(run: Run) {
  if (run.creation?.creativeStages) {
    const direction = settledCreativeHandoff(run,'direction')
    return direction?.sources.filter(s => s.path !== directionPath) ?? []
  }
  let sources: ProductionHandoff['sources'] = []
  for (const turn of run.agentTurns ?? []) {
    if (turn.production?.stage === 'visual' && turn.status === 'ended' && turn.quiescedAt &&
        turn.productionHandoff?.request.action === 'advance')
      sources = turn.productionHandoff.sources.filter(file => visualSourcePattern.test(file.path))
    if (turn.visualSelection) sources = turn.visualSelection.sources
  }
  return sources
}

export function initialProductionAssignment(run: Run): ProductionAssignment | undefined {
  if (run.productionWorkflow !== 1) return undefined
  if (run.creation?.creativeStages) return {stage:'discovery',originRequestKey:run.requestKey}
  if (run.creation?.initialDelivery === 'complete-game' && run.creation.verification !== 'isolated')
    return {stage:'implementation',originRequestKey:run.requestKey}
  return { stage: 'design', originRequestKey: run.requestKey,
    ...(['complete-game','design-led-first-version'].includes(run.creation?.initialDelivery ?? '')
      ? {stopAfter:'implementation' as const} : {}) }
}
// Saved design-first and explicitly isolated tasks keep their existing boundaries.
export function isContinuousGameAuthor(run: Run, task: ProductionAssignment) {
  return task.stage === 'implementation' && run.creation?.initialDelivery === 'complete-game' &&
    run.creation.verification !== 'isolated' && task.originRequestKey === run.requestKey &&
    (run.agentTurns?.find(turn => turn.production)?.production?.stage ?? task.stage) === 'implementation'
}
// Current work uses the existing turn and application context, retained by
// native history and compaction. Host evidence carries small assignment facts.
export const PRODUCTION_WORKFLOW_GUIDANCE = 'This preparation task has no native Goal. Return the final result required by the current stage; no separate advance call is needed. BGS checks the saved sources before advancing. Missing inputs required by this assignment remain blockers; document completion does not certify game quality.'

/** Small host-owned navigation facts retained by the existing runtime context.
 * Source pointers are not source content or evidence of Skill application. */
export function productionAssignmentFacts(run: Run, task: ProductionAssignment, attemptId?: string) {
  const turns = run.agentTurns ?? []
  const boundary = attemptId ? Math.max(0, turns.findIndex(t => t.attemptId === attemptId)) : Math.max(0, turns.length - 1)
  const preceding = turns.slice(0,boundary)
  if (run.creation?.creativeStages) {
    const inputs: ProductionAssignment['stage'][] = task.stage === 'direction' ? ['discovery']
      : task.stage === 'design' ? ['direction'] : task.stage === 'resources' ? ['direction','design']
      : ['implementation','verification'].includes(task.stage) ? ['direction','design','resources'] : []
    const files = inputs.flatMap(stage => settledCreativeHandoff(run,stage,preceding)?.sources.map(s=>s.path) ?? [])
    if (task.stage==='verification') {
      const author=preceding.find(turn=>turn.attemptId===task.verificationOf)
      if (author?.productionHandoff) files.push(...author.productionHandoff.sources.map(s=>s.path))
    }
    return {...task,...(files.length ? {precedingSources:{sections:[] as string[],files:[...new Set(files)]}} : {})}
  }
  const stages:readonly ProductionAssignment['stage'][] = ['design', 'visual', 'resources', 'implementation', 'verification']
  const prerequisites = stages.slice(0,stages.indexOf(task.stage)).map(stage => preceding.findLast(t =>
    t.production?.stage === stage && t.status === 'ended' && t.quiescedAt && t.productionHandoff?.request.action === 'advance')?.productionHandoff)
  const entry = preceding.findLast(t => t.productionHandoff?.next?.originRequestKey === task.originRequestKey &&
    t.productionHandoff.next.stage === task.stage)?.productionHandoff
  const selection = preceding.findLast(turn => turn.visualSelection)?.visualSelection
  const sources = [...prerequisites, entry, selection].flatMap(handoff => handoff ? [handoff] : [])
  const visualHandoffs = new Set(preceding.filter(t => t.production?.stage === 'visual').map(t => t.productionHandoff))
  const {browserVerification:_retiredBrowserPolicy,...assignment}=task
  return { ...assignment,
    ...(sources.length ? { precedingSources: {
      sections: [...new Set(sources.flatMap(h => h.request.sections))],
      files: [...new Set(sources.flatMap(h => h.sources
        .filter(s => !visualHandoffs.has(h) || s.path === 'docs/GDD.md' || visualSourcePattern.test(s.path))
        .map(s => s.path)))],
    } } : {}),
  }
}

// Scope shared by design, implementation and resumed work, including review inputs.
// It carries no write command, result schema or Skill-loading instruction.
export const DESIGN_DECISION_SCOPE = 'The confirmed brief and explicit user changes define required scope. The default first release is a small-scope game with a complete core experience: representative content, responsive controls and coherent presentation and feedback appropriate to the game, rather than a fully expanded product. Explicitly requested scope takes precedence. The GDD develops the gameplay, presentation and feedback for that scope. User-specified layouts and selected visual designs remain constraints; an author’s initial layout proposal remains to be developed in concrete visual work, not confirmed by document completion or review. Author-proposed new mechanics, systems or content expansion do not become authorized merely because the document is finalized or reviewed; presentation and feedback for the agreed gameplay remain implementation work. Adjustable starting values and open experience questions remain provisional rather than acceptance obligations.'

/** Tool discovery describes this assignment; the existing handler owns authorization. */
export function productionWorkflowToolDescription(task?: ProductionAssignment, separateVerification = false, adoptedDirection = false): string {
  const preview = 'status reads the current assignment; preview start/status returns its managed runtime URL without running tests.'
  switch (task?.stage) {
    case 'direction':
      return preview + ' Submit only the adopted direction through the final result.'
    case 'discovery':
      return 'Submit the research brief and its references through the final result.'
    case 'verification':
      return preview + ' This assignment is read-only verification. Return observations through its final JSON contract.'
    case 'design':
      if (adoptedDirection) return 'status reads the current assignment. Submit the saved GDD through its final JSON contract.'
      return 'status reads the current assignment; select-visual retains chosen project images without ending design or registering runtime assets. Submit the saved design through its final JSON contract, not advance.'
    case 'visual':
      return 'status reads the current assignment. Return saved design results through its final JSON contract, not advance.'
    case 'resources':
      if (adoptedDirection) return 'status reads the current assignment. Submit registered runtime resources through the final result.'
      return 'status reads the current assignment; select-visual retains chosen reference files without registering runtime assets. Return produced resources through its final JSON contract.'
    case 'implementation':
      return preview + (adoptedDirection ? '' : ' select-visual retains chosen reference files without ending work.') + (separateVerification
        ? ' advance hands runnable implementation to independent verification with summary, sections and actual entry/output files; it is not a test verdict.'
        : ' Complete the authorized implementation through native completion.')
    default:
      return preview + ' Other actions follow the current user-authorized assignment.'
  }
}

// Isolated production roles supplement the native coding contract through current context.
// Permissions, AGENTS.md, tools and Skills are still supplied by native paths.
export function productionAssignmentBaseInstructions(run: Run, task: ProductionAssignment): string | undefined {
  if (task.stage === 'verification') return [
    'You are the independent runtime verifier for a delivered game implementation.',
    'Determine whether the delivered implementation meets the confirmed scope and relevant design decisions, collecting reproducible product defects for the author. This assignment is runtime verification, not implementation, general source-code diagnosis or a new design review.',
    'Use the supplied design snapshot, author observations and referenced scripts/results to choose checks for required player outcomes and their adopted presentation and feedback; reuse observations whose source and conditions remain valid. Observe whether those decisions are realized in play, rather than inferring completion from object or control presence. Ordinary aesthetic alternatives within a satisfied treatment are not product defects. Read additional source definitions only for a concrete unresolved question. Provisional tuning is not a precision acceptance threshold, and an author claim alone is not a passing observation.',
    'Do not edit game sources, GDD, assets or dependencies. Use each tool’s configured output location; Shell scratch work may use the assigned writable temporary directory. Use the current platform’s delivered runtime and user-configured tools; do not assume Chrome or a particular engine exists. Do not generate artwork or start a broader experience study.',
    ...(run.creation?.creativeStages ? ['Verify the adopted player behavior. A missing device, listening setup or suggested test method is a coverage-limit if the required outcome is otherwise evidenced; if the behavior itself remains unobserved or the user requires that specific condition, report unverified. Keep different outcomes separate.'] : []),
    'Return the final observation report for the required player outcomes in this assignment: passed records an observed result, failed records a reproducible product defect, and unverified records a required outcome that could not be established. Give the actual conditions and evidence for each outcome; provisional tuning and optional improvements are not required outcomes. Put reusable results and other observation limits in summary. BGS derives the existing pass, repair or blocked outcome from these observations; do not supply a separate overall verdict.',
  ].join('\n\n')
  if (task.stage === 'implementation' && run.creation?.verification === 'isolated') return [
    'You are the implementation author for one assignment in a game project. Implement the authorized behavior and artwork. Your deliverable is runnable code and integrated resources for a separate verification assignment, not a game acceptance verdict.',
    'Deliver the runnable implementation for independent verification: complete the authorized code and resource integration, including adopted presentation and feedback, build/start it, and resolve concrete construction failures. Then submit BgsWorkflow({action:"advance",summary,sections:[],files:[actual entry/output paths]}); saved sessions without that tool use workflow.mjs --advance with the same fields. Include the runtime entry, checks actually performed with their conditions and outcomes, known defects, unimplemented adopted decisions and unverified behavior in summary; reference existing reusable scripts/results in files when available. Checks not performed remain unverified; readiness does not require creating a report or performing the separate verification assignment. This readiness handoff ends implementation; it does not claim tests passed. The separate verification assignment owns the systematic gameplay, input, state, layout and visual checks. Browser use here serves a concrete implementation defect or construction question, not a first full acceptance pass. If required inputs prevent implementation, report that blocker instead of declaring readiness.',
  ].join('\n\n')
  return undefined
}

export function productionAssignmentPrompt(run: Run, task: ProductionAssignment): string {
  if (task.stage === 'verification') return 'Current verification source: '+JSON.stringify({implementationAttemptId:task.verificationOf,design:'docs/GDD.md',selectedDesigns:selectedProductionVisualSources(run)})+'\nBGS current production stage: verification.'
  const original = run.agentTurns?.find(t => t.requestKey === task.originRequestKey)?.message
  const scope = original ? 'Original authorized assignment:\n' + original.text : 'Use the full confirmed new-game brief in bgsConfirmedBrief.'
  const facts = productionAssignmentFacts(run, task)
  const sources = facts.precedingSources ? 'Preceding source handoffs: '+JSON.stringify(facts.precedingSources)+' . These are source pointers; inspect only the sections or actual assets needed by this assignment.' : ''
  const continuousAuthor = isContinuousGameAuthor(run,task)
  const implementationFinish = run.creation?.verification === 'isolated' ? '' : 'Judge remaining work against those requirements and repair observed deviations. Finish this native turn with the result, checks actually performed and any remaining defects, unverified behavior or external blockers.'
  if (run.creation?.creativeStages && task.stage !== 'visual') {
    const work = {
      discovery: discoveryAssignment,
      direction: 'Use the research summary, brief and referenced material to develop candidate expressions and their visual studies. Compare different ways the same representative passage could unfold for the player, keeping confirmed rules and design choices fixed, not unresolved staging or interface behavior. Compare the observable candidates for distinctiveness, coherence, gameplay fit, craft and feasibility. Reuse approved designs. Use a game-view study for composition; use a sequence, audio or small prototype where its result could change the direction or an important composition, UI or transition decision. When those decisions are supportable, hand off the existing adopted study and record the decisions and outstanding production or implementation work in docs/VisualContract.md. Respect the existing budget; if no direction is supportable within it, retain exploration and return blocked. Keep exploratory alternatives outside assets/reference/selected/; save the adopted study and its dependencies together under assets/reference/selected/. Save docs/VisualContract.md describing only the adopted concept, spatial/UI, movement, sound, supporting sources, tradeoffs and observable player outcomes. Return files containing this contract and only the chosen study and its necessary media, with sections:[]. Do not submit alternatives. GDD defines the rules next; resource production makes the independent parts, and implementation integrates and verifies their behavior.',
      design: 'Finalize docs/GDD.md from the confirmed gameplay and the adopted Visual Contract. Define the needed rules, player states, transitions, and feedback. Adopt player outcomes; a research suggestion about test equipment or procedure is not a delivery requirement unless explicitly requested. Refer to the selected treatment rather than deciding it again. Submit the saved GDD for the existing independent rule review.',
      resources: 'Produce usable runtime art, animation and audio for the representative passage from the reviewed GDD and selected direction, respecting the confirmed resource configuration. Register and hand off the files the runtime will consume, their required companions and the relevant GDD headings. Retain production sources separately; alternative exports are only deliverables when they serve another real consumer. Identify outstanding needs. Design studies are references, not produced runtime assets.',
      implementation: 'Integrate the delivered resources and reviewed rules into a runnable game. Develop the representative passage first, adjust timing, composition and feedback in the first preview, then complete the agreed scope. Submit the actual runtime entry and reusable observations for independent verification.',
    }[task.stage]
    return [scope,sources,'BGS current production stage: '+task.stage+'.',work].filter(Boolean).join('\n\n')
  }
  const work = task.stage === 'design'
    ? "Develop the currently authorized player experience from the confirmed brief and existing work. Choose the design methods and the content, structure and depth of docs/GDD.md for that work. Develop a representative player situation with its scene, subjects, interface, soundscape and feedback together, and record the resulting decisions rather than specifying unresolved layout details in advance. Preserve user requirements and selected designs. Use available references or optional system imagegen work where they help develop the concrete treatment. Retain chosen project images with BgsWorkflow({action:\"select-visual\",summary,sections:[],files:[actual project-relative image paths]}); this neither ends design nor registers runtime assets. Save the resulting design record in docs/GDD.md and return ready or blocked through the current final contract. A document-only commission answers its requested design questions without expanding the deliverables. This assignment does not produce game code or runtime assets."
    : task.stage === 'visual'
      ? "Complete the current authorized visual-design assignment from the confirmed brief and current GDD. Deliver the requested player-visible screens/states with their necessary subjects, information, actions, trigger conditions and confirmed visual direction. Coverage is not a panel count: variants may share a composition when their copy, values, control visibility and triggers are defined and no new layout or artwork is needed; a distinct composition or an unrepresented key element/action needs its own visual representation.\n\nRequest compositions at the project target aspect ratio. New generation requests receive a text-only check of the final compiled prompt and applicable confirmed requirements before image billing; resolve returned input contradictions or ambiguity before generating. Respect source rights.\n\nInspect concepts against the requested scope at concept fidelity. Repair consequential omissions or contradictions and retain usable compositions, leaving production details to the affected resource/runtime work. Keep usable concepts despite ratio deviation. Describe requested proportions as targets; report actual dimensions only from existing decoded metadata. Do not repeat the same whole-atlas request.\n\nSubmit selected image paths, exact existing GDD requirement headings and a concise selection summary through the final ready/blocked JSON result. Keep the GDD unchanged when realizing its agreed design; revise affected definitions only for an actual design contradiction or user-authorized change. Keep consequential observations and downstream adaptations in the existing handoff. Return blocked when progress needs external input or authorization. There is no separate image-acceptance Agent after generation. This stage does not implement the game or establish runtime behavior."
      : task.stage === 'resources'
        ? (task.stopAfter === 'resources' ? 'Complete the authorized standalone resource set. ' : 'Prepare the independent parts needed for one coherent player situation; leave the remaining approved resource needs planned for the implementation that follows. ') + 'Deliver the required resources from the confirmed art/audio direction and retained sources, preserving functionality, explicit source preferences and rights. Register actual delivered paths and provenance through the existing resource contract. Disclose unmet resource dependencies. Resource-only work does not authorize runtime implementation.'
        : `${continuousAuthor ? 'Develop and implement the authorized game as one continuous authoring task. Choose its design methods, and develop the scene, subjects, interface, soundscape and feedback in concrete playable work; record the resulting decisions in docs/GDD.md, choosing its content, structure and depth for this game. The existing rule review applies to that saved record when this game task is complete.' : 'Implement or resume the current authorized assignment from the confirmed requirements, relevant GDD decisions and existing work.'} Before specialist work, read the applicable Skills and necessary references from the available catalog, reusing relevant methods already retained in the current context. When existing evidence is insufficient for the current question, use available search tools to consult relevant public examples or primary sources; retain the adopted basis and source with the corresponding design or implementation decision. Preserve confirmed targets, user-specified and selected visual designs, including their composition, subject proportions and spatial relationships. Production and implementation choices belong to this assignment; an actual design correction or authorized change may revise its owning design, but an implementation defect does not redefine the required result. For a new game, build a representative passage of play first: let the player act, pass into the resulting state and perceive the consequence. In the first available preview of that passage, follow the action at play speed and listen when available; use what happens to adjust your provisional layout, transfer of control and feedback before extending the game. For ongoing work or a local repair, build on the established passage and reuse relevant observations. Integrate the required code and resources, and register delivered asset paths and provenance through the existing resource contract. If adopting a design image, record its source through BgsWorkflow({action:"select-visual",summary,sections,files}) or workflow.mjs --select-visual without ending this task; selecting a reference is not runtime asset registration. ${run.creation?.verification === 'isolated' ? 'Deliver the runnable implementation for the separate verification assignment through the current readiness handoff.' : implementationFinish}`
  return [scope, sources, 'BGS current production stage: ' + task.stage + '.', work].filter(Boolean).join('\n\n')
}
const requiredObservation = z.object({
  outcome: z.string().trim().min(1).describe('Player outcome or coverage condition being reported'),
  status: z.enum(['passed', 'failed', 'unverified']),
  evidence: z.string().trim().min(1).describe('Actual conditions and observed result, or the concrete reason this outcome could not be verified'),
}).strict()
const implementationVerificationSchema = z.object({
  summary: z.string().trim().min(1).describe('Checks performed, reusable results and other observation limits; not an overall verdict'),
  observations: z.array(requiredObservation).min(1),
}).strict()
// Persist the existing result shape. Older receipts remain observations of their
// original runs; only new reports use the current observation contract.
export type ImplementationVerificationResult = {
  status: 'passed' | 'needs-repair' | 'blocked' | 'incomplete'
  summary: string
  findings: string[]
}
const creativeVerificationSchema = implementationVerificationSchema.extend({
  observations: z.array(requiredObservation.extend({
    status: z.enum(['passed','failed','unverified','coverage-limit']).describe('coverage-limit: additional observation conditions not required by the confirmed scope; never a substitute for a missing player outcome')
  })).min(1),
  externalBlocker:z.string().trim().min(1).nullable().describe('Concrete unavailable external input or permission preventing a required observation; null for optional coverage or unfinished checks.')
})
export function implementationVerificationOutputSchema(creative = false) {
  return z.toJSONSchema(creative ? creativeVerificationSchema : implementationVerificationSchema, {target:'draft-7'})
}
export function parseImplementationVerification(value: unknown, creative = false): ImplementationVerificationResult {
  const report = creative ? creativeVerificationSchema.parse(value) : implementationVerificationSchema.parse(value)
  const blocker='externalBlocker' in report && typeof report.externalBlocker==='string' ? report.externalBlocker : undefined
  const observations: z.infer<typeof creativeVerificationSchema>['observations'] = report.observations
  const failed = observations.filter(item => item.status === 'failed')
  const unverified = observations.filter(item => item.status === 'unverified')
  const limits = observations.filter(item => item.status === 'coverage-limit')
  const describe = (item: typeof observations[number]) => item.outcome + ': ' + item.evidence
  return {
    status: failed.length ? 'needs-repair' : blocker ? 'blocked'
      : unverified.length || limits.length === observations.length ? (creative ? 'incomplete' : 'blocked') : 'passed',
    summary: [report.summary, ...(blocker?[blocker]:[]), ...unverified.map(item => '[unverified] ' + describe(item)), ...limits.map(item => '[coverage-limit] ' + describe(item))].join('\n'),
    findings: failed.map(describe),
  }
}
export function verificationImplementation(run: Run, task: ProductionAssignment): AgentTurn {
  const source = run.agentTurns?.find(turn => turn.attemptId === task.verificationOf)
  if (task.stage !== 'verification' || !source || source.production?.stage !== 'implementation' ||
      (source.status !== 'ended' && !settledAdvance(run,source)) || !source.quiescedAt || run.creation?.verification !== 'isolated' ||
      source.production.originRequestKey !== task.originRequestKey)
    throw Error('Verification requires its settled implementation')
  return source
}
export function implementationVerificationHandoff(run: Run, turn: AgentTurn, summary: string): ProductionHandoff {
  if (turn.production?.stage !== 'implementation' || run.creation?.verification !== 'isolated')
    throw Error('This implementation has no separate verification assignment')
  const files = requiredLibraryDeliverySources(run.workspacePath, confirmedResourceLibraryUsage(run.requirements.text))
  return {request:{action:'advance',summary,sections:[],files},sources:files.map(path => sourceVersion(run.workspacePath,path)),
    next:{...turn.production,stage:'verification',verificationOf:turn.attemptId}}
}

// Preparation returns final JSON; local validation owns handoff, not API sampling constraints.
function productionResultSchema(task: ProductionAssignment, allowAnswer = false) {
  const base = z.object({
    status: z.enum(allowAnswer ? ['ready', 'blocked', 'answered'] : ['ready', 'blocked']),
    summary: z.string().trim().min(1).describe('User-facing outcome or concrete blocker in the response language'),
  }).strict()
  if (task.stage === 'design' || task.stage === 'implementation') return designAuthorResultSchema()
  const output = base.extend({
    sections: z.array(z.string()).describe(task.stage === 'discovery' || task.stage === 'direction' ? 'Empty: creative work precedes the GDD' : 'Exact existing GDD headings for this assignment' + (allowAnswer ? '; empty when only answering' : '')),
    files: z.array(z.string()).describe(task.stage === 'visual'
      ? 'Project-relative paths of the selected design images; BGS retains the existing GDD source' + (allowAnswer ? '; empty when only answering' : '')
      : 'Actual project-relative outputs' + (allowAnswer ? '; empty when only answering' : '')),
  })
  return output
}

export function productionOutputSchema(task: ProductionAssignment, allowAnswer = false) {
  return task.stage === 'design' || task.stage === 'implementation' ? designAuthorOutputSchema(allowAnswer)
    : z.toJSONSchema(productionResultSchema(task, allowAnswer), {target:'draft-7'})
}
export function parseProductionResult(task: ProductionAssignment, value: unknown) {
  // Saved visual authors may still return their old disposition field. It is
  // historical text, not authority to restart the retired image review.
  if (task.stage === 'visual' && value && typeof value === 'object' && !Array.isArray(value) && 'reviewResponses' in value) {
    const { reviewResponses: _historical, ...current } = value
    value = current
  }
  const parsed = productionResultSchema(task).safeParse(value)
  if (!parsed.success) throw Error('BGS final result is missing or invalid; no stage was advanced.')
  const result = parsed.data
  if (result.status === 'blocked') throw new ProductionBlockedError(result.summary)
  const {status, ...request} = result
  return {action:'advance' as const, ...request}
}

const handoffSchema = z.object({ action: z.enum(['advance', 'visual', 'resources', 'implement', 'select-visual']), summary: z.string().trim().min(1),
  sections: z.array(z.string().trim().min(1)), files: z.array(z.string().trim().min(1)),
}).strict()
function readHandoffSource(workspace: string, path: string) {
  if (isAbsolute(path) || path.includes('\\') || path.split('/').some(p => !p || p.startsWith('.') || ['node_modules', 'transcripts'].includes(p)))
    throw Error('Handoff sources must be public project-relative files')
  const file = resolve(realpathSync(workspace), path)
  if (realpathSync(file) !== file) throw Error('Handoff source cannot redirect through a symlink')
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!fstatSync(fd).isFile()) throw Error('Handoff source must be a regular file')
    const data = readFileSync(fd)
    if (!data.length) throw Error('Handoff source cannot be empty')
    return { source: { path, sha256: createHash('sha256').update(data).digest('hex') }, data }
  } finally { closeSync(fd) }
}


function readTextHandoffSource(workspace: string, path: string) {
  const { source, data } = readHandoffSource(workspace, path)
  let text: string
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(data) }
  catch { throw Error('Handoff source must be valid UTF-8 text') }
  if (!text.trim()) throw Error('Handoff source cannot be empty or whitespace-only')
  if (text.includes('\u0000')) throw Error('Handoff source must be text, not binary data')
  return { source, text }
}
function sourceVersion(workspace: string, path: string, requireText = false) {
  return (requireText ? readTextHandoffSource(workspace, path) : readHandoffSource(workspace, path)).source
}

export function settledAdvance(run:Run, turn:AgentTurn) {
  return Boolean(turn.quiescedAt && turn.productionHandoff?.request.action==='advance' &&
    (turn.status==='ended' || (run.creation?.creativeStages && turn.status==='interrupted' && !turn.error)))
}

function settledCreativeHandoff(run:Run, stage:ProductionAssignment['stage'], turns=run.agentTurns ?? []) {
  return turns.findLast(t=>t.production?.stage===stage && t.production.originRequestKey===run.requestKey &&
    settledAdvance(run,t))?.productionHandoff
}

/** Only the research turn feeds exploration. Subsequent stages receive the selected contract and its files. */
export function creativeStageInput(run:Run, task:ProductionAssignment) {
  if (!run.creation?.creativeStages || task.stage==='discovery') return ''
  const research=task.stage==='direction'
  const handoff=settledCreativeHandoff(run,research?'discovery':'direction')
  if (!handoff) throw Error('Missing settled creative input for '+task.stage)
  verifyProductionHandoff(run.workspacePath,handoff)
  if (['resources','implementation','verification'].includes(task.stage)) {
    const design=settledCreativeHandoff(run,'design')
    if (!design) throw Error('Missing reviewed GDD input')
    verifyProductionHandoff(run.workspacePath,design)
  }
  if (['implementation','verification'].includes(task.stage)) {
    const resources=settledCreativeHandoff(run,'resources')
    if (!resources) throw Error('Missing settled resource input')
    verifyProductionHandoff(run.workspacePath,resources)
  }
  const record=readTextHandoffSource(run.workspacePath,research?researchPath:directionPath)
  return 'Saved creative input (source data):\n'+JSON.stringify({...(research ? {summary:handoff.request.summary} : {}),...record,files:handoff.sources.map(s=>s.path)})
}

export function designDocumentSnapshot(workspace: string) {
  return readTextHandoffSource(workspace, 'docs/GDD.md')
}

/**
 * Bind a design handoff to the bytes already saved by the current design
 * writer. The model supplies only the readiness summary; the host owns the
 * fixed path and computes the source identity from the same validated bytes.
 */
export function designDocumentSource(workspace: string) {
  return sourceVersion(workspace, 'docs/GDD.md', true)
}
export function prepareDesignDocumentHandoff(workspace: string, summary: string, visualSources: ProductionHandoff['sources'] = []): ProductionHandoff {
  for (const source of visualSources) if (sourceVersion(workspace, source.path).sha256 !== source.sha256)
    throw Error('Selected visual source bytes changed: ' + source.path)
  return {
    request: {action: 'advance', summary, sections: [], files: ['docs/GDD.md', ...visualSources.map(source => source.path)]},
    sources: [designDocumentSource(workspace), ...visualSources],
  }
}
// Only settled source handoffs establish prerequisites. Code files, a native
// Goal and an assistant summary cannot substitute for the selected visual handoff.
// Full implementation produces and integrates its resources; an independent
// resource task is not a prerequisite. Saved pending assignments keep their scope.
export function nextProductionStage(run: Run): ProductionAssignment['stage'] {
  if (run.productionWorkflow !== 1) return 'implementation'
  if (run.creation?.creativeStages) {
    let stage: ProductionAssignment['stage']='discovery'
    for (const turn of run.agentTurns ?? []) {
      if (settledAdvance(run,turn) && turn.productionHandoff?.next)
        stage=turn.productionHandoff.next.stage
      if (turn.implementationVerification?.status==='passed' && turn.status==='ended' && turn.quiescedAt) stage='implementation'
    }
    return stage
  }
  // Existing tasks that began in implementation retain that assignment on resume.
  const first = run.agentTurns?.find(turn => turn.production)?.production
  let next: ProductionAssignment['stage'] = first?.stage === 'implementation' || first?.stage === 'design'
    ? first.stage : initialProductionAssignment(run)!.stage
  for (const turn of run.agentTurns ?? []) {
    if (turn.status === 'ended' && turn.quiescedAt && turn.production?.stage === 'verification' && turn.implementationVerification?.status === 'passed') {
      next = 'implementation'
      continue
    }
    if (turn.status !== 'ended' || !turn.quiescedAt || !turn.productionHandoff || turn.productionHandoff.request.action !== 'advance') continue
    const stage = turn.production?.stage
    if (stage === 'design') next = turn.productionHandoff.next?.stage ?? 'visual'
    else if (stage === 'visual' && next !== 'design') next = turn.productionHandoff.next?.stage ?? 'resources'
    else if (stage === 'resources' && next === 'resources') next = 'implementation'
    else if (stage === 'implementation' && turn.productionHandoff.next?.stage === 'verification') next = 'verification'
    else if (stage === 'verification') next = turn.productionHandoff.next?.stage ?? 'implementation'
  }
  return next
}

// Bind follow-ups before starting the runtime, including ordinary Chat. This
// supplies task context; it does not turn a question into a production request.
export function messageProductionAssignment(run: Run, requestKey: string, resumingImplementation = false): ProductionAssignment | undefined {
  if (run.productionWorkflow !== 1) return undefined
  const pendingStage = nextProductionStage(run)
  // New user work is not an implicit replay of a pending verification task.
  const stage = pendingStage === 'verification' ? 'implementation' : pendingStage
  const previous = run.agentTurns?.findLast(turn => turn.production)
  if (run.creation?.creativeStages) return {stage,originRequestKey:previous?.production?.originRequestKey ?? run.requestKey}
  if (stage === 'design') return {stage, originRequestKey: previous?.production?.originRequestKey ?? run.requestKey,
    ...(previous?.production?.stopAfter ? {stopAfter:previous.production.stopAfter} : {}),
  }
  if(stage === 'implementation' && resumingImplementation && previous?.production?.stage === 'implementation')
    return previous.production
  const pending = previous?.productionHandoff
    ? previous.status === 'ended' && previous.quiescedAt
      ? previous.productionHandoff.next ?? (previous.productionHandoff.request.action === 'implement' ? previous.production : undefined)
      : previous.production
    : previous?.production
  if (stage === 'discovery' || stage === 'direction') throw Error('Creative assignment requires a creative Run')
  if (pending && pending.stage !== 'design') {
    const stages = ['visual', 'resources', 'implementation', 'verification'] as const
    if ((stages as readonly string[]).indexOf(pending.stage) <= (stages as readonly string[]).indexOf(stage)) return pending
    // Historical implementation may have skipped preparation. Bind a new turn
    // to the missing stage without rewriting history or inferring wider scope.
    return {stage, originRequestKey: pending.originRequestKey, stopAfter: stage}
  }
  return {stage, originRequestKey: requestKey, stopAfter: stage}
}

export function prepareProductionHandoff(run: Run, turn: AgentTurn, value: unknown): ProductionHandoff {
  const request = handoffSchema.parse(value), current = turn.production
  if (turn.message?.intent === 'discuss' || turn.message?.intent === 'message' && !current && request.action === 'advance')
    throw Error('Discussion cannot advance production')
  if (run.creation?.creativeStages && current) {
    if (['discovery','direction'].includes(current.stage)) {
      if (request.action !== 'advance' || request.sections.length) throw Error('Creative handoff requires its final result without GDD sections')
      const research = current.stage === 'discovery'
      const record = research ? researchPath : directionPath
      if (!request.files.includes(record)) throw Error('Creative handoff is missing '+record)
      if (!research && request.files.some(p=>p!==record && !p.startsWith('assets/reference/selected/')))
        throw Error('Submit only the adopted direction under assets/reference/selected/')
      if (!research && !request.files.some(p=>selectedMedia.test(p))) throw Error('Direction needs a selected visual study or prototype')
      const sources = [...new Set(request.files)].map(p=>sourceVersion(run.workspacePath,p,p===record))
      if (research) {
        const brief=readTextHandoffSource(run.workspacePath,record).text
        if (!/https?:\/\/[^\s/<>]+/i.test(brief) && !sources.some(s=>s.path!==record && brief.includes(s.path)))
          throw Error('Discovery needs a traceable source in its brief: a source URL or a referenced local evidence file')
      }
      return {request,sources,next:{...current,stage:research?'direction':'design'}}
    }
    if (request.action==='select-visual') throw Error('The selected direction belongs to the settled creative direction handoff')
    if (request.action!=='advance' && !(request.action==='implement' && current.stage==='implementation'))
      throw Error('Complete the current creative project assignment first')
    if (current.stage==='resources' && request.action==='advance') {
      const paths=request.files.filter(path=>path.startsWith('assets/runtime/'))
      const registered=readBeeGameAssetManifestSync(run.workspacePath).resources
      if (!paths.length || paths.some(path=>!registered.some(r=>r.status==='verified' && !r.provisional && r.file_paths.includes(path))))
        throw Error('Resource handoff needs actual registered runtime files for the representative passage')
    }
  }
  if (request.action === 'select-visual') {
    if (!current || !['design', 'implementation', 'resources'].includes(current.stage)) throw Error('Select visual sources within the current design/implementation/resource task; visual tasks use their ready result')
    if (!request.files.length || request.files.some(path => !visualSourcePattern.test(path)))
      throw Error('Select actual project-relative design images, not reports or runtime resource registrations')
    if (request.sections.length) readDesignSections(run.workspacePath, [{ document: 'GDD.md', sections: request.sections }])
    const previous = turn.visualSelection
    const inherited = previous?.sources ?? (turn.message?.intent === 'change' ? [] : selectedProductionVisualSources(run))
    const sources = [...inherited]
    for (const path of request.files) {
      const source = sourceVersion(run.workspacePath, path), saved = sources.find(file => file.path === path)
      if (saved && saved.sha256 !== source.sha256) throw Error('Selected visual source bytes changed: ' + path)
      if (!saved) sources.push(source)
    }
    return { request: { ...request, files: sources.map(file => file.path),
      sections: [...new Set([...(previous?.request.sections ?? []), ...request.sections])] }, sources }
  }
  if (request.action === 'advance' && current?.stage === 'implementation' && run.creation?.verification === 'isolated' &&
      (!turn.message || turn.message.intent === 'continue' && !turn.message.text && !turn.message.attachmentDigests?.length)) {
    const handoff=implementationVerificationHandoff(run,turn,request.summary)
    return {...handoff,request:{...request,files:[...new Set([...request.files,...handoff.request.files])]},sources:[...new Set(['docs/GDD.md',...request.files,...handoff.request.files])].map(path=>sourceVersion(run.workspacePath,path,path==='docs/GDD.md'))}
  }
  let next: ProductionAssignment | undefined
  if (request.action !== 'advance') {
    if (!(request.action === 'implement' && current?.stage === 'implementation') &&
        (!turn.message || !['message', 'work', 'change', 'continue'].includes(turn.message.intent) || current && turn.message.intent === 'continue'))
      throw Error('Production entry is for a current authorized work assignment; production stages use advance')
    const target = request.action === 'implement' ? 'implementation' : request.action
    const pendingStage = nextProductionStage(run)
    const pending = pendingStage === 'verification' ? 'implementation' : pendingStage
    if (pending === 'design') throw Error('Complete the current GDD document task before entering production')
    const stages = ['visual', 'resources', 'implementation'] as const
    const stage = target === 'implementation' && pending !== 'visual'
      ? target : stages[Math.min(stages.indexOf(target), (stages as readonly string[]).indexOf(pending))]!
    // An implementation already owns its writer and prerequisites. Enter the
    // current request in place rather than ending it to schedule itself again.
    if (!(stage === 'implementation' && current?.stage === 'implementation'))
      next = {stage, originRequestKey: turn.requestKey, ...(stage !== 'implementation' ? {stopAfter: target} : {})}
  } else {
    if (!current || current.stage === 'implementation') throw Error('No preparatory production stage to advance')
    if (!request.sections.length) throw Error('Cite the existing GDD sections defining the requirements for this assignment')
    if (current.stage === 'design') throw Error('Design handoff uses the saved docs/GDD.md source and ready/blocked metadata; do not use the generic production handoff tool')
    readDesignSections(run.workspacePath, [{ document: 'GDD.md', sections: request.sections }])
    if (current.stage === 'visual' && !request.files.some(p => visualSourcePattern.test(p)))
      throw Error('Visual handoff needs an actual saved design image')
    if (current.stopAfter !== current.stage) next = {
      ...current, stage: current.stage === 'visual' && current.stopAfter !== 'implementation' ? 'resources' : 'implementation',
    }
  }
  if (request.action === 'advance' && current?.stage === 'resources')
    request.files = [...new Set([...request.files, ...requiredLibraryDeliverySources(run.workspacePath, confirmedResourceLibraryUsage(run.requirements.text))])]
  const inPlace = request.action === 'implement' && !next
  const paths = [...new Set([...(!inPlace && (request.action === 'advance' || next?.stage !== 'implementation' || run.productionWorkflow === 1) ? ['docs/GDD.md'] : []), ...request.files])]
  const sources = paths.map(path => sourceVersion(run.workspacePath, path, path === 'docs/GDD.md'))
  // In-place entry records scope, not frozen output: authorized implementation
  // can still update the GDD. Selected visual sources remain bound separately.
  return { request, ...(next ? {next} : {}), sources: inPlace ? [] : sources }
}
export function verifyProductionHandoff(workspace: string, handoff: ProductionHandoff) {
  for (const source of handoff.sources) if (sourceVersion(workspace, source.path, source.path === 'docs/GDD.md').sha256 !== source.sha256)
    throw Error('Production handoff source changed after submission: ' + source.path + '; no automatic continuation')
}
