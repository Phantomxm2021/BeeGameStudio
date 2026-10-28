import { createHash } from 'node:crypto'
import { constants, openSync, closeSync, fstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod/v4'
import { readDesignSections } from '../design-source-reading'
import type { Run, AgentTurn } from './state'
import { designReviewDispositionSchema } from './design-review'

// These are eight responsibilities of one document, not workflow stages.
export const DESIGN_ASSIGNMENTS = {
  gameplay: { skills: ['game-creative-director-expert', 'game-systems-designer-expert'], question: 'Decide the player goal, repeatable actions and outcomes, and rule/state boundaries needed to implement the loop. Hand off these rules; numerical tuning, spatial layout and presentation belong to their owning chapters.' },
  levels: { skills: ['game-level-designer-expert'], question: 'Choose the playable space, encounter flow and teaching needed by the rules. Hand off spatial relationships and consequential scale/visibility limits; decorative placement and final scene composition belong to visual production.' },
  balance: { skills: ['game-balance-designer-expert'], question: 'Resolve initial parameter choices and quantitative feasibility questions left by the rules and space. Hand off values and units, and support consequential derived claims with a computed relationship; playtest-dependent pacing and fairness remain hypotheses.' },
  art: { skills: ['game-art-director-expert'], question: 'Choose visual identity, subject/background hierarchy and recognizable gameplay cues. Hand off direction for complete-screen visual design; exact palettes, pixel dimensions and animation specifications belong to visual/resource production.' },
  ui: { skills: ['game-ui-ux-designer'], question: 'Choose required screens/states, information and action hierarchy, input/navigation and recovery flows. Hand off behavior and play-area/overlay relationships; final geometry, typography metrics and decorative motion belong to visual production. Use spatial UX for XR.' },
  audio: { skills: ['game-audio-designer'], question: 'Choose audible identity and map gameplay events to cue meaning, priority, timing and start/stop/repeat behavior. Hand off these roles for production; exact synthesis, file and mix settings depend on actual audio.' },
  resources: { skills: ['game-content-pipeline-engineer'], question: 'Choose representation families, shared/independent parts and source/rights constraints that determine feasibility. Hand off production dependencies; actual file lists, frame counts and dimensions follow selected visual/audio designs.' },
  technical: { skills: ['game-implementation-planning'], question: 'Choose the engine/platform approach, state/data ownership and interfaces connecting the selected rules, presentation and resources. Hand off the implementation starting point and concrete risks; detailed tasks, code and runtime checks belong to implementation.' },
} as const
export type DesignDiscipline = keyof typeof DESIGN_ASSIGNMENTS
const disciplines = Object.keys(DESIGN_ASSIGNMENTS) as DesignDiscipline[]
export type ProductionAssignment = {
  stage: 'design' | 'visual' | 'resources' | 'implementation'
  // Retained only to read historical assignments; design execution now covers the whole document.
  discipline?: DesignDiscipline
  completedDesigns?: DesignDiscipline[]
  originRequestKey: string
}
export type ProductionHandoff = {
  request: { action: 'advance' | 'implement'; summary: string; sections: string[]; files: string[]; nextDesign?: DesignDiscipline; coveredDesigns?: Partial<Record<DesignDiscipline, string[]>> }
  next?: ProductionAssignment
  sources: Array<{ path: string; sha256: string }>
}
export function initialProductionAssignment(run: Run): ProductionAssignment | undefined {
  return run.productionWorkflow === 1 ? { stage: 'design', originRequestKey: run.requestKey } : undefined
}
// Shared rules use the existing application context, reused by native history
// and retained across compaction. Per-turn input carries the full assignment;
// small current assignment facts also travel in the existing host evidence.
export const PRODUCTION_WORKFLOW_GUIDANCE = [
  'Preparation stages use bounded tasks without a native Goal. A design task maintains the authoritative docs/GDD.md through the existing protected file tools and ends with a small ready or blocked summary; other preparation tasks return their exact existing GDD sections and actual output paths. This is the handoff; no separate advance call is needed. GDD readiness requires the completed source-bound independent review described in its assignment. BGS checks source identity, not design quality, and continues only after cleanup.',
  'Keep affected design decisions in docs/GDD.md consistent with actual production outputs. Correct concrete contradictions; reopen a settled decision only for new evidence or a changed requirement. Unavailable inputs needed by the current assignment are blockers.',
  'Research answers an unresolved decision. Reuse current evidence; fetch known sources directly and search when discovery is needed. Inspect returned content, not just HTTP status. Do not guess URLs or exhaust retrieval methods. Unavailable sources leave an evidence gap; an Exa quota limit is not a reason to retry that service.',
].join('\n\n')

/** Small host-owned navigation facts retained by the existing runtime context.
 * Source pointers are not source content or evidence of Skill application. */
export function productionAssignmentFacts(run: Run, task: ProductionAssignment, attemptId?: string) {
  const settings = run.requirements.constraints
  const spatialUi = (settings.platform === 'VR/AR' || settings.dimension === 'VR' || settings.dimension === 'AR')
  const turns = run.agentTurns ?? []
  const boundary = attemptId ? Math.max(0, turns.findIndex(t => t.attemptId === attemptId)) : Math.max(0, turns.length - 1)
  const previous = turns.slice(0,boundary).findLast(t => t.productionHandoff?.next?.originRequestKey === task.originRequestKey)?.productionHandoff
  return { ...task,
    ...(task.stage === 'design' ? { directions: Object.fromEntries(disciplines.map(name => [name, DESIGN_ASSIGNMENTS[name].question])),
      requiredSkills: disciplines.flatMap(name => name === 'ui' && spatialUi ? ['spatial-computing-ux-designer-expert'] : [...DESIGN_ASSIGNMENTS[name].skills]) } : {}),
    ...(task.stage === 'implementation' ? { requiredSkills: ['game-plan-execution'] } : {}),
    ...(previous ? { precedingSources: { sections: previous.request.sections, files: previous.sources.map(s => s.path) } } : {}),
  }
}

export function productionAssignmentPrompt(run: Run, task: ProductionAssignment): string {
  const original = run.agentTurns?.find(t => t.requestKey === task.originRequestKey)?.message
  const scope = original ? 'Original authorized assignment:\n' + original.text : 'Use the full confirmed new-game brief in bgsConfirmedBrief.'
  const previous = run.agentTurns?.slice(0,-1).findLast(t => t.productionHandoff?.next?.originRequestKey === task.originRequestKey)?.productionHandoff
  const sources = previous ? 'Preceding author handoff: '+JSON.stringify({summary:previous.request.summary,sections:previous.request.sections,files:previous.sources.map(s=>s.path)})+' . These are source pointers, not certification; inspect only the sections or actual assets needed by this assignment.' : ''
  const skills = productionAssignmentFacts(run, task).requiredSkills
  const assignedSkills = skills?.map(name => '$' + name).join(', ')
  const work = task.stage === 'design'
    ? `Complete one GDD covering gameplay, levels, balance, art, ui, audio, resources and technical for the confirmed brief. These are design responsibilities within one document, not separate tasks or handoffs. Apply the necessary design guidance from these Skills: ${assignedSkills}. Read references for concrete unresolved decisions; reuse guidance already in context.\n${disciplines.map(name => name + ': ' + DESIGN_ASSIGNMENTS[name].question).join('\n')}\nUse one authoritative definition per decision and reference it elsewhere. Explain briefly when a direction is inapplicable. Preserve confirmed requirements, distinguish initial choices from playtest hypotheses, and leave production-dependent details for their actual inputs. Maintain the authoritative docs/GDD.md through WriteProjectFile/EditProjectFile; inspect existing text and revise only the affected sections as needed. Do not implement the game or produce assets. BGS independently reviews the saved candidate before accepting readiness. End with only the required ready or blocked status and a concrete summary; do not repeat the document body or claim quality certification. BGS records the fixed source after cleanup and ends this task. If a required input is unavailable, return status blocked with its reason in summary.`
    : task.stage === 'visual'
      ? 'Use the relevant GDD art, level and UI/UX decisions. Select applicable Skills from the installed catalog as needed for the current visual work and platform. Reuse suitable supplied designs, or generate the overview board directly with bgs-imagegen (assets.mjs, purpose reference, prompt or uiReference), covering required screens and key states with Scene and HUD together. Check the quote and authorized budget; unavailable capability or authorization is a blocker. Use HTML design capture only for a user-supplied or explicitly requested HTML design. Inspect the pictures and reconcile selected designs, resource representations and affected GDD chapters. Image errors do not authorize changing confirmed requirements. Reuse suitable supplied pictures; do not regenerate for minor lettering/count errors. Save image paths and consequential unresolved issues.'
      : task.stage === 'resources'
        ? 'Use the selected visual/audio designs and resource/technical GDD chapters. Select applicable Skills from the installed catalog as needed for the current resource work. Acquire or produce, inspect and register the resources needed for the first complete implementation unit. Follow source, rights and charge authorization. Record actual paths and metrics in the Manifest; leave unrelated resources planned. Do not require all game assets in advance and do not assemble runtime Scene/UI yet. Core artwork may use procedural drawing only when the user explicitly chooses that aesthetic; an Agent-authored design does not authorize it. Simple controls and geometric effects may still use code.'
        : `Use ${assignedSkills} to execute or resume the implementation plan. Implement the confirmed user scope using the current GDD and selected pictures. Preserve confirmed requirements, design decisions and selected visuals; revise incidental Agent-authored decoration or asset-production choices in their owning sections when implementation requires it. Scene/UI assembly, runtime consumption and gameplay belong here. Select applicable Skills when starting each concrete professional task, reuse guidance still in context, and check the method against actual code/resources and runtime observations. Record unresolved application gaps in existing verification notes. Acquire or produce, inspect and register resources for the first playable loop, then connect them to Scene/UI and gameplay and observe player input through resulting feedback before expanding. Follow source, rights and charge authorization; keep actual asset paths and metrics in the Manifest. Record implemented outcomes and evidence links in the existing progress record at each meaningful checkpoint. Reuse relevant sources still in context; verify affected behavior and integration when inputs change. Obtain later resources or repair affected designs within this Goal without restarting earlier stages. Submit the current acceptance report through BgsFinishDelivery (or measure.mjs --finish when the native tool is unavailable): validated passed delivery completes the task; an explicit blocked/failed report ends execution as blocked when further authorized progress needs external action. Retain the remaining scope and concrete blocker. Native Goal completion alone is not delivery.`
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
    reviewResponses: z.array(designReviewDispositionSchema).optional().describe('Omit before review; after review, respond to every original finding by its 1-based index with evidence from the saved definitions'),
  })
  return base.extend({
    sections: z.array(z.string()).describe('Exact existing GDD headings for this assignment'),
    files: z.array(z.string()).describe('Actual project-relative outputs; visual work includes the selected design image'),
  })
}

export function productionOutputSchema(task: ProductionAssignment) {
  if (task.stage === 'implementation') throw Error('Implementation uses validated delivery, not a preparation result')
  return z.toJSONSchema(productionResultSchema(task), {target:'draft-7'})
}
export function parseProductionResult(task: ProductionAssignment, value: unknown) {
  const parsed = productionResultSchema(task).safeParse(value)
  if (!parsed.success) throw Error('BGS final result is missing or invalid; no stage was advanced.')
  const result = parsed.data
  if (result.status === 'blocked') throw Error('Production blocked: ' + result.summary)
  const {status, ...request} = result
  return {action:'advance' as const, ...request}
}

const handoffSchema = z.object({ action: z.enum(['advance', 'implement']), summary: z.string().trim().min(1),
  sections: z.array(z.string().trim().min(1)), files: z.array(z.string().trim().min(1)),
}).strict()
function sourceVersion(workspace: string, path: string, requireText = false) {
  if (isAbsolute(path) || path.includes('\\') || path.split('/').some(p => !p || p.startsWith('.') || ['node_modules', 'transcripts'].includes(p)))
    throw Error('Handoff sources must be public project-relative files')
  const file = resolve(realpathSync(workspace), path)
  if (realpathSync(file) !== file) throw Error('Handoff source cannot redirect through a symlink')
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!fstatSync(fd).isFile()) throw Error('Handoff source must be a regular file')
    const data = readFileSync(fd)
    if (!data.length) throw Error('Handoff source cannot be empty')
    if (requireText) {
      let text: string
      try { text = new TextDecoder('utf-8', {fatal: true}).decode(data) }
      catch { throw Error('Handoff source must be valid UTF-8 text') }
      if (!text.trim()) throw Error('Handoff source cannot be empty or whitespace-only')
      if (text.includes('\u0000')) throw Error('Handoff source must be text, not binary data')
    }
    return { path, sha256: createHash('sha256').update(data).digest('hex') }
  } finally { closeSync(fd) }
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
export function prepareProductionHandoff(run: Run, turn: AgentTurn, value: unknown): ProductionHandoff & { next: ProductionAssignment } {
  const request = handoffSchema.parse(value), current = turn.production
  if (turn.message?.intent === 'discuss' || turn.message?.intent === 'message' && request.action === 'advance')
    throw Error('Discussion cannot advance production')
  let next: ProductionAssignment
  if (request.action === 'implement') {
    if (current || !turn.message || !['message', 'work', 'change', 'continue'].includes(turn.message.intent))
      throw Error('Implementation entry is for a current authorized work assignment; production stages use advance')
    next = { stage: 'implementation', originRequestKey: turn.requestKey }
  } else {
    if (!current || current.stage === 'implementation') throw Error('No preparatory production stage to advance')
    if (!request.sections.length) throw Error('Cite the actual GDD sections containing the current outputs and unresolved dependencies')
    if (current.stage === 'design') throw Error('Design handoff uses the saved docs/GDD.md source and ready/blocked metadata; do not use the generic production handoff tool')
    readDesignSections(run.workspacePath, [{ document: 'GDD.md', sections: request.sections }])
    if (current.stage === 'visual' && !request.files.some(p => /\.(png|jpe?g|webp|gif|svg|pdf)$/i.test(p)))
      throw Error('Visual handoff needs an actual saved design image')
    next = { stage: 'implementation', originRequestKey: current.originRequestKey }
  }
  const paths = [...new Set([...(request.action === 'advance' ? ['docs/GDD.md'] : []), ...request.files])]
  return { request, next, sources: paths.map(path => sourceVersion(run.workspacePath, path, path === 'docs/GDD.md')) }
}
export function verifyProductionHandoff(workspace: string, handoff: ProductionHandoff) {
  for (const source of handoff.sources) if (sourceVersion(workspace, source.path, source.path === 'docs/GDD.md').sha256 !== source.sha256)
    throw Error('Production handoff source changed after submission: ' + source.path + '; no automatic continuation')
}
