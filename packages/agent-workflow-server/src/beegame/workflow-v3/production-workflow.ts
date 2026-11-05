import { ProductionBlockedError } from '../production-blocked'
import { createHash } from 'node:crypto'
import { constants, openSync, closeSync, fstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod/v4'
import { readDesignSections } from '../design-source-reading'
import type { Run, AgentTurn } from './state'
import { designReviewDispositionSchema } from './design-review'

// Historical assignment fields retain their original discipline names.
export type DesignDiscipline = 'gameplay' | 'levels' | 'balance' | 'art' | 'ui' | 'audio' | 'resources' | 'technical'
export type ProductionAssignment = {
  stage: 'design' | 'visual' | 'resources' | 'implementation'
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
const visualSourcePattern = /\.(svg|png|jpe?g|webp|gif|pdf)$/i

// References are source records, independent of a production-stage transition.
// Historical settled visual handoffs retain their original authority.
export function selectedProductionVisualSources(run: Run) {
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
  return { stage: 'design', originRequestKey: run.requestKey,
    ...(['complete-game','design-led-first-version'].includes(run.creation?.initialDelivery ?? '')
      ? {stopAfter:'implementation' as const} : {}) }
}
// Current work uses the existing turn and application context, retained by
// native history and compaction. Host evidence carries small assignment facts.
export const PRODUCTION_WORKFLOW_GUIDANCE = 'This preparation task has no native Goal. Return the final result required by the current stage; no separate advance call is needed. BGS checks the saved sources and continues only after cleanup. Missing inputs required by this assignment remain blockers; document completion does not certify game quality.'

/** Small host-owned navigation facts retained by the existing runtime context.
 * Source pointers are not source content or evidence of Skill application. */
export function productionAssignmentFacts(run: Run, task: ProductionAssignment, attemptId?: string) {
  const turns = run.agentTurns ?? []
  const boundary = attemptId ? Math.max(0, turns.findIndex(t => t.attemptId === attemptId)) : Math.max(0, turns.length - 1)
  const preceding = turns.slice(0,boundary)
  const stages = ['design', 'visual', 'resources', 'implementation'] as const
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

// Scope shared by initial authors, ordinary design messages and review inputs.
// It carries no write command, result schema or Skill-loading instruction.
export const DESIGN_DECISION_SCOPE = 'The confirmed brief and explicit user changes define required scope. The default first release is a playable MVP with representative content and the controls, visual treatment and feedback needed to judge the core experience; it does not require a fully expanded product. Explicitly requested scope takes precedence. The GDD records additional product decisions; adjustable starting values and open experience questions remain provisional rather than acceptance obligations.'

export function productionAssignmentPrompt(run: Run, task: ProductionAssignment): string {
  const original = run.agentTurns?.find(t => t.requestKey === task.originRequestKey)?.message
  const scope = original ? 'Original authorized assignment:\n' + original.text : 'Use the full confirmed new-game brief in bgsConfirmedBrief.'
  const facts = productionAssignmentFacts(run, task)
  const sources = facts.precedingSources ? 'Preceding source handoffs: '+JSON.stringify(facts.precedingSources)+' . These are source pointers; inspect only the sections or actual assets needed by this assignment.' : ''
  const work = task.stage === 'design'
    ? "Determine the product decisions still needed to begin the current authorized work. Use the confirmed brief as source data; if it already supplies those decisions, record that conclusion directly. For document-only work, answer the requested design questions. Choose the content, structure and depth of docs/GDD.md for those questions, preserving unrelated confirmed decisions in existing work. Use applicable Skills for an unresolved design question. Implementation tuning and resource production belong to implementation. Save through WriteProjectFile/EditProjectFile and return the required ready or blocked result. This assignment produces the design record, not game code or assets."
    : task.stage === 'visual'
      ? "Complete the current authorized visual-design assignment from the confirmed brief and current GDD. Deliver the requested player-visible screens/states with their necessary subjects, information, actions, trigger conditions and confirmed visual direction. Coverage is not a panel count: variants may share a composition when their copy, values, control visibility and triggers are defined and no new layout or artwork is needed; a distinct composition or an unrepresented key element/action needs its own visual representation.\n\nUse applicable visual-design guidance for production methods and suitable supplied references. Request compositions at the project target aspect ratio. New generation requests receive a text-only check of the final compiled prompt and applicable confirmed requirements before image billing; resolve returned input contradictions or ambiguity before generating. Respect source rights.\n\nInspect concepts against the requested scope at concept fidelity. Repair consequential omissions or contradictions and retain usable compositions, leaving production details to the affected resource/runtime work. Keep usable concepts despite ratio deviation. Describe requested proportions as targets; report actual dimensions only from existing decoded metadata. Do not repeat the same whole-atlas request.\n\nSubmit selected image paths, exact existing GDD requirement headings and a concise selection summary through the final ready/blocked JSON result. Keep the GDD unchanged when realizing its agreed design; revise affected definitions only for an actual design contradiction or user-authorized change. Keep consequential observations and downstream adaptations in the existing handoff. Return blocked when progress needs external input or authorization. There is no separate image-acceptance Agent after generation. This stage does not implement the game or establish runtime behavior."
      : task.stage === 'resources'
        ? (task.stopAfter === 'resources' ? 'Complete the authorized standalone resource set. ' : 'Prepare the independent parts needed for one coherent player situation; leave the remaining approved resource needs planned for the implementation that follows. ') + 'Use $game-content-pipeline-engineer to realize that resource scope from the confirmed art/audio direction and any retained references. Where selected pictures define the appearance, inspect them and separate the required game parts and UI artwork from live text, values and interaction. For 2D artwork, reuse or extract suitable parts; where a flat picture cannot supply a complete usable part, produce a derivative using the actual selected image as reference through existing tools. Do not substitute newly coded drawings for distinctive subjects or UI skins. Other representations follow the confirmed target and selected design. Inspect parts against their corresponding design subjects and register actual paths and provenance through the existing resource contract; same-theme labels and successful registration do not establish visual agreement. Preserve functionality, explicit source preferences and rights. Keep unmet artwork dependencies explicit. Resource-only work does not authorize runtime implementation.'
        : `Implement or resume the current authorized assignment. Choose task organization from the current scope and dependencies. Reuse a usable existing plan. On resume, preserve completed work and address unfinished or affected work. Implement the confirmed user scope and settled product decisions, using saved references where present. Adjust provisional tuning to realize the required behavior; open experience questions do not by themselves require experiments. Resolve concrete appearance questions with suitable supplied references, targeted concepts or representative target-engine scenes within this task; a complete concept atlas is not an implementation prerequisite. Image-led 2D artwork can use concepts to establish composition and resource families. For 3D, pictures can guide subject/material/UI treatment while the target-engine scene establishes scale, camera, occlusion and interaction; temporary blockouts need representative artwork as the playable situation develops. When adopting new design images, retain them through BgsWorkflow({action:"select-visual",summary,sections,files}) or workflow.mjs --select-visual without ending this task. This records sources, not runtime asset registration or visual quality approval. Preserve confirmed requirements and any selected design's composition, subject proportions, spatial relationships and material/typographic treatment. Adapt layout and resource representation for actual text, viewport and interaction while retaining that intent; revise the owning design for a supported design correction, not to describe away an implementation defect. Scene/UI assembly, runtime consumption and gameplay belong here. Use applicable professional guidance for implementation methods; confirmed requirements and adopted design decisions specify the required result and explicit constraints. Produce the resources needed for one coherent playable situation from the confirmed art direction and any selected designs, including UI skins separately from live text and interaction. Reuse delivered parts and connect them to Scene/UI and gameplay. Observe player input through resulting feedback before expanding to later approved resource families and states. Register delivered asset paths and provenance through the existing resource contract; dimensions and anchors remain in their owning resource metadata or consuming code. Reuse relevant sources and observations still valid for the current inputs. Obtain later resources or repair affected designs within this implementation assignment without restarting earlier stages. Choose implementation and verification methods for the required behavior, adopted visual treatment and affected risks. Judge remaining work against those requirements and repair observed deviations. Alternative cosmetic preferences within an already satisfied treatment remain follow-up suggestions unless refinement is requested. Finish this native turn with the result, checks actually performed and any remaining defects, unverified behavior or external blockers.`
  return [scope, sources, 'BGS current production stage: ' + task.stage + '.', work].filter(Boolean).join('\n\n')
}
// Preparation ends with one locally validated JSON result. The same schema
// describes its source pointers in context, without an API format constraint.
function productionResultSchema(task: ProductionAssignment) {
  const base = z.object({
    status: z.enum(['ready', 'blocked']),
    summary: z.string().trim().min(1).describe('User-facing outcome or concrete blocker in the response language'),
  }).strict()
  if (task.stage === 'design') return base.extend({
    reviewResponses: z.array(designReviewDispositionSchema).optional().describe('Omit before review; after review, respond to every current revision finding by its 1-based index with evidence from the saved definitions'),
  })
  const output = base.extend({
    sections: z.array(z.string()).describe('Exact existing GDD headings for this assignment'),
    files: z.array(z.string()).describe(task.stage === 'visual'
      ? 'Project-relative paths of the selected design images; BGS retains the existing GDD source'
      : 'Actual project-relative outputs'),
  })
  return output
}

export function productionOutputSchema(task: ProductionAssignment) {
  if (task.stage === 'implementation') throw Error('Implementation ends through native completion, not a preparation result')
  return z.toJSONSchema(productionResultSchema(task), {target:'draft-7'})
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
  const reviewResponses = 'reviewResponses' in result ? result.reviewResponses : undefined
  return {action:'advance' as const, ...request, ...(reviewResponses ? { reviewResponses } : {})}
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
export function prepareDesignDocumentHandoff(workspace: string, summary: string): ProductionHandoff {
  return {
    request: {action: 'advance', summary, sections: [], files: ['docs/GDD.md']},
    sources: [designDocumentSource(workspace)],
  }
}
// Only settled source handoffs establish prerequisites. Code files, a native
// Goal and an assistant summary cannot substitute for the selected visual handoff.
// Full implementation produces and integrates its resources; an independent
// resource task is not a prerequisite. Saved pending assignments keep their scope.
export function nextProductionStage(run: Run): ProductionAssignment['stage'] {
  if (run.productionWorkflow !== 1) return 'implementation'
  // Existing tasks that began in implementation retain that assignment on resume.
  const first = run.agentTurns?.find(turn => turn.production)?.production
  let next: ProductionAssignment['stage'] = first?.stage === 'implementation'
    ? 'implementation' : initialProductionAssignment(run)!.stage
  for (const turn of run.agentTurns ?? []) {
    if (turn.status !== 'ended' || !turn.quiescedAt || !turn.productionHandoff || turn.productionHandoff.request.action !== 'advance') continue
    const stage = turn.production?.stage
    if (stage === 'design') next = turn.productionHandoff.next?.stage ?? 'visual'
    else if (stage === 'visual' && next !== 'design') next = turn.productionHandoff.next?.stage ?? 'resources'
    else if (stage === 'resources' && next === 'resources') next = 'implementation'
  }
  return next
}

// Bind follow-ups before starting the runtime, including ordinary Chat. This
// supplies task context; it does not turn a question into a production request.
export function messageProductionAssignment(run: Run, requestKey: string, resumingImplementation = false): ProductionAssignment | undefined {
  if (run.productionWorkflow !== 1) return undefined
  const stage = nextProductionStage(run)
  const previous = run.agentTurns?.findLast(turn => turn.production)
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
  if (pending && pending.stage !== 'design') {
    const stages = ['visual', 'resources', 'implementation'] as const
    if (stages.indexOf(pending.stage) <= stages.indexOf(stage)) return pending
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
  if (request.action === 'select-visual') {
    if (!current || !['implementation', 'resources'].includes(current.stage)) throw Error('Select visual sources within the current implementation/resource task; visual tasks use their ready result')
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
  let next: ProductionAssignment | undefined
  if (request.action !== 'advance') {
    if (!(request.action === 'implement' && current?.stage === 'implementation') &&
        (!turn.message || !['message', 'work', 'change', 'continue'].includes(turn.message.intent) || current && turn.message.intent === 'continue'))
      throw Error('Production entry is for a current authorized work assignment; production stages use advance')
    const target = request.action === 'implement' ? 'implementation' : request.action
    const pending = nextProductionStage(run)
    if (pending === 'design') throw Error('Complete the current GDD document task before entering production')
    const stages = ['visual', 'resources', 'implementation'] as const
    const stage = target === 'implementation' && pending !== 'visual'
      ? target : stages[Math.min(stages.indexOf(target), stages.indexOf(pending))]!
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
