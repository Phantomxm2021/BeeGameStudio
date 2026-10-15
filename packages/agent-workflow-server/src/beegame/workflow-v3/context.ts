import type { Run, SkillUse } from './state'

type ToolEvent = { id: number; type: string; payload?: Record<string, unknown> }

/** Only actual tool lifecycles count. Discovery, assistant prose and failed calls do not. */
export function skillEvidence(events: ToolEvent[]): SkillUse[] {
  const uses = new Map<string, SkillUse>()
  for (const event of events) {
    const p = event.payload, toolUseID = p?.toolUseID
    if (typeof toolUseID !== 'string') continue
    if (event.type === 'tool.started' && p?.toolName === 'Skill') {
      const name = (p.input as { skill?: unknown } | undefined)?.skill
      if (typeof name === 'string') uses.set(toolUseID, { name, toolUseID, eventId: event.id, status: 'unverified',
        ...(typeof p.parentToolUseID === 'string' ? { parentToolUseID: p.parentToolUseID } : {}) })
    } else if (uses.has(toolUseID) && ['tool.completed', 'tool.failed'].includes(event.type)) {
      Object.assign(uses.get(toolUseID)!, { eventId: event.id, status: event.type === 'tool.completed' ? 'loaded' : 'failed' })
    }
  }
  return [...uses.values()]
}

/** Recorded successful main-session loads in the same native lineage. This
 * is not a claim that compaction retained the method or it was applied. Child
 * loads are not transferable evidence for their parent or another child. */
export function priorMainSkillLoads(run:Run,attemptId:string) {
  const at=run.agentTurns?.findIndex(t=>t.attemptId===attemptId)??-1
  if(at>=0 && run.agentTurns![at]!.message?.contextMode==='focused')
    return {recordedMainLoads:[],contextPresence:'not-transferred',application:'unverified'}
  const prior=at>=0?run.agentTurns!.slice(0,at):[]
  const nativeId=prior.at(-1)?.nativeSessionId
  const loaded=new Map<string,{name:string;attemptId:string;toolUseID:string}>()
  if(nativeId)for(const turn of prior)if(turn.nativeSessionId===nativeId)
    for(const skill of turn.skillUses??[])if(skill.status==='loaded'&&!skill.parentToolUseID)
      loaded.set(skill.name,{name:skill.name,attemptId:turn.attemptId,toolUseID:skill.toolUseID})
  return {recordedMainLoads:[...loaded.values()],contextPresence:'unverified',application:'unverified'}
}
