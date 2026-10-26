import { createHash } from 'node:crypto'
import { constants, openSync, closeSync, fstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod/v4'
import { readDesignSections } from '../design-source-reading'
import type { Run, AgentTurn } from './state'

// Professional coverage remains required; one assignment can resolve several directions.
export const DESIGN_ASSIGNMENTS = {
  gameplay: { skills: ['game-creative-director-expert', 'game-systems-designer-expert'], question: 'Derive the player experience, core loop, concrete rules, state transitions and interacting systems from the confirmed brief. Work through ordinary and boundary outcomes, dependencies and unresolved decisions.' },
  levels: { skills: ['game-level-designer-expert'], question: 'Resolve spatial structure, routes, encounters/challenges and progression where the gameplay needs them. Explain consequential space, pacing and teaching choices; reference existing rules and UI allocation instead of restating them. Existing spatial and pacing decisions may share their owning sections.' },
  balance: { skills: ['game-balance-designer-expert'], question: 'Resolve consequential quantitative questions from the rules and player situations. State units, assumptions and relevant boundaries; calculate only relationships needed for a decision. Keep initial choices and playtest hypotheses distinct from demonstrated outcomes; reference authoritative parameters rather than duplicate their tables.' },
  art: { skills: ['game-art-director-expert'], question: 'Derive visual direction, recognizable subjects, shape/color/readability and representation requirements from the player situations and platform. Specify what subsequent visual design must resolve; this assignment writes design, it does not produce all assets.' },
  ui: { skills: ['game-ui-ux-designer'], question: 'Derive screens, key states, information hierarchy, input flows and feedback from the gameplay and platform. Coordinate Scene/HUD relationships, failures and recovery. For XR, select the applicable spatial interaction Skill instead of imposing a flat-screen layout.' },
  audio: { skills: ['game-audio-designer'], question: 'Resolve audible roles, event/state feedback, timing, priorities and mix behavior from player situations, including any explicitly silent scope. Own audio intent and lifecycle behavior; resource representation and technical consumption belong to their respective owners.' },
  resources: { skills: ['game-content-pipeline-engineer'], question: 'Resolve representations, sharing/variants, source/rights needs and production dependencies from the selected design. Identify resources for the first coherent player situation and leave later resources planned without reducing the final scope. Reference behavior, layout and consuming interfaces; delivered paths and metrics belong in the Manifest when assets actually exist.' },
  technical: { skills: ['game-implementation-planning'], question: 'Derive engine/platform architecture, data ownership, state and resource interfaces, runtime consumption and verification methods from the professional design. Resolve cross-chapter contradictions and mark real unresolved dependencies. Do not implement Scene/UI or gameplay in this assignment.' },
} as const
export type DesignDiscipline = keyof typeof DESIGN_ASSIGNMENTS
const disciplines = Object.keys(DESIGN_ASSIGNMENTS) as DesignDiscipline[]
export type ProductionAssignment = {
  stage: 'design' | 'visual' | 'resources' | 'implementation'
  discipline?: DesignDiscipline
  completedDesigns?: DesignDiscipline[]
  originRequestKey: string
}
export type ProductionHandoff = {
  request: { action: 'advance' | 'implement'; summary: string; sections: string[]; files: string[]; nextDesign?: DesignDiscipline; coveredDesigns?: Partial<Record<DesignDiscipline, string[]>> }
  next: ProductionAssignment
  sources: Array<{ path: string; sha256: string }>
}
export function initialProductionAssignment(run: Run): ProductionAssignment | undefined {
  return run.productionWorkflow === 1 ? { stage: 'design', discipline: 'gameplay', completedDesigns: [], originRequestKey: run.requestKey } : undefined
}
export function productionAssignmentPrompt(run: Run, task: ProductionAssignment): string {
  const original = run.agentTurns?.find(t => t.requestKey === task.originRequestKey)?.message
  const scope = original ? 'Original authorized assignment:\n' + original.text : 'Use the full confirmed new-game brief in bgsConfirmedBrief.'
  const previous = run.agentTurns?.slice(0,-1).findLast(t => t.productionHandoff?.next.originRequestKey === task.originRequestKey)?.productionHandoff
  const sources = previous ? 'Preceding author handoff: '+JSON.stringify({summary:previous.request.summary,sections:previous.request.sections,coveredDesigns:previous.request.coveredDesigns,files:previous.sources.map(s=>s.path)})+' . These are source pointers, not certification; read the current relevant sections and inspect actual images/assets.' : ''
  const design = task.discipline && DESIGN_ASSIGNMENTS[task.discipline]
  const work = task.stage === 'design' && design
    ? `Current professional design question (${task.discipline}): ${design.question}\nRead and apply ${design.skills.map(s => '$' + s).join(' and ')} to the unresolved decisions; reuse applicable guidance and research already in context. Read relevant existing GDD sections before writing; create docs/GDD.md if absent. Keep each decision, necessary reasoning and boundary in one owning section; other disciplines reference it and specify only their own consequences or exceptions. Revise affected definitions and consumers when a decision changes. Completed directions: ${(task.completedDesigns ?? []).join(', ') || 'none'}. Remaining directions: ${disciplines.filter(name => !(task.completedDesigns ?? []).includes(name)).join(', ')}.\nA direction already resolved by existing design needs no new prose. For additional directions resolved in this work or already covered, apply their relevant professional Skills and include coveredDesigns:{direction:[exact existing GDD headings]} in this same handoff. Cite substantive decisions or an explicit scope-based inapplicability reason, not just a heading or an assertion of completion. Keep unresolved decisions and dependencies explicit; missing necessary design stays unfinished. Do not expand into unrelated directions to fill the map. Choose nextDesign from the remaining unfinished directions; all eight directions still require coverage before visual design. No separate chapter, approval or review call is required. Summarize changes and unresolved dependencies without copying unchanged design.`
    : task.stage === 'visual'
      ? 'Read the relevant GDD art, level and UI/UX chapters and apply $game-art-director-expert and $game-ui-ux-designer (or the applicable XR Skill). Form or adopt actual visual designs covering screens and key states, with Scene and HUD together. Inspect the pictures and reconcile selected designs, resource representations and affected GDD chapters. Image errors do not authorize changing confirmed requirements. Reuse suitable supplied pictures; do not regenerate for minor lettering/count errors. Save image paths and consequential unresolved issues.'
      : task.stage === 'resources'
        ? 'Apply $game-content-pipeline-engineer and read its relevant production guidance with the selected visual/audio designs and resource/technical GDD chapters. Acquire or produce, inspect and register the resources needed for the first complete implementation unit. Follow source, rights and charge authorization. Record actual paths and metrics in the Manifest; leave unrelated resources planned. Do not require all game assets in advance and do not assemble runtime Scene/UI yet. An explicitly chosen procedural representation may use its design and interfaces without fabricated asset files.'
        : 'Implement the full authorized scope from the current GDD, selected pictures and available resources. Scene/UI assembly, runtime consumption and gameplay belong here. Begin with the first complete implementation unit; verify affected behavior and presentation continuously, then expand through the remaining scope. Obtain later resources or repair affected designs within this Goal without restarting earlier stages. Submit current validated delivery through BgsFinishDelivery (or measure.mjs --finish when the native tool is unavailable); native Goal completion alone is not delivery.'
  return [scope, sources, 'BGS current production stage: ' + task.stage + '.', work,
    ...(task.stage === 'implementation' ? [] : ['This is an ordinary bounded task with no native Goal. Do not start implementation or mark the whole game complete. When the current outputs are usable, prefer BgsWorkflow({action:"advance", ...handoff fields}) when it is exposed; otherwise submit workflow.mjs --advance with a summary, exact existing GDD headings and actual file paths, then end this turn. BGS continues in this conversation after native work and tools stop. If blocked, report the blocker and end without advancing. The handoff records author-declared readiness and source identity, not certified design quality.'])].join('\n\n')
}
const handoffSchema = z.object({ action: z.enum(['advance', 'implement']), summary: z.string().trim().min(1),
  sections: z.array(z.string().trim().min(1)), files: z.array(z.string().trim().min(1)),
  nextDesign: z.enum(disciplines as [DesignDiscipline, ...DesignDiscipline[]]).optional(),
  coveredDesigns: z.partialRecord(z.enum(disciplines as [DesignDiscipline, ...DesignDiscipline[]]),
    z.array(z.string().trim().min(1)).min(1)).optional(),
}).strict()
function sourceVersion(workspace: string, path: string) {
  if (isAbsolute(path) || path.includes('\\') || path.split('/').some(p => !p || p.startsWith('.') || ['node_modules', 'transcripts'].includes(p)))
    throw Error('Handoff sources must be public project-relative files')
  const file = resolve(realpathSync(workspace), path)
  if (realpathSync(file) !== file) throw Error('Handoff source cannot redirect through a symlink')
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!fstatSync(fd).isFile()) throw Error('Handoff source must be a regular file')
    const data = readFileSync(fd)
    if (!data.length) throw Error('Handoff source cannot be empty')
    return { path, sha256: createHash('sha256').update(data).digest('hex') }
  } finally { closeSync(fd) }
}
export function prepareProductionHandoff(run: Run, turn: AgentTurn, value: unknown): ProductionHandoff {
  const request = handoffSchema.parse(value), current = turn.production
  if (turn.message?.intent === 'discuss' || turn.message?.intent === 'message' && request.action === 'advance')
    throw Error('Discussion cannot advance production')
  let next: ProductionAssignment
  if (request.action === 'implement') {
    if (current || !turn.message || !['message', 'work', 'change', 'continue'].includes(turn.message.intent))
      throw Error('Implementation entry is for a current authorized work assignment; production stages use advance')
    if (request.nextDesign || request.coveredDesigns) throw Error('Implementation entry has no design coverage or next direction')
    next = { stage: 'implementation', originRequestKey: turn.requestKey }
  } else {
    if (!current || current.stage === 'implementation') throw Error('No preparatory production stage to advance')
    if (!request.sections.length) throw Error('Cite the actual GDD sections containing the current outputs and unresolved dependencies')
    readDesignSections(run.workspacePath, [{ document: 'GDD.md', sections: [
      ...new Set([...request.sections, ...Object.values(request.coveredDesigns ?? {}).flat()]),
    ] }])
    if (current.stage === 'design') {
      const completedDesigns = [...new Set([...(current.completedDesigns ?? []), current.discipline!,
        ...Object.keys(request.coveredDesigns ?? {}) as DesignDiscipline[]])]
      const remaining = disciplines.filter(name => !completedDesigns.includes(name))
      if (request.nextDesign && !remaining.includes(request.nextDesign)) throw Error('Choose an unfinished design direction')
      next = remaining.length ? { ...current, completedDesigns, discipline: request.nextDesign ?? remaining[0] }
        : { stage: 'visual', originRequestKey: current.originRequestKey }
    } else {
      if (request.nextDesign || request.coveredDesigns) throw Error('Only professional design declares coverage or selects a next direction')
      if (current.stage === 'visual' && !request.files.some(p => /\.(png|jpe?g|webp|gif|svg|pdf)$/i.test(p)))
        throw Error('Visual handoff needs an actual saved design image')
      next = { stage: current.stage === 'visual' ? 'resources' : 'implementation', originRequestKey: current.originRequestKey }
    }
  }
  const paths = [...new Set([...(request.action === 'advance' ? ['docs/GDD.md'] : []), ...request.files])]
  return { request, next, sources: paths.map(path => sourceVersion(run.workspacePath, path)) }
}
export function verifyProductionHandoff(workspace: string, handoff: ProductionHandoff) {
  for (const source of handoff.sources) if (sourceVersion(workspace, source.path).sha256 !== source.sha256)
    throw Error('Production handoff source changed after submission: ' + source.path + '; no automatic continuation')
}
