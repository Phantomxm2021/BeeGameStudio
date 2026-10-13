import type { BeeGameEvent } from '../session-manager'

type AuditEvent = Omit<BeeGameEvent,'sessionId'|'createdAt'> & {createdAt:Date|string}
export type EventPageSelection = {turnId:string;beforeId?:number;limit:number}

/** Display-only audit page. Never feeds Agent context or permission decisions.
 * Scan backwards and summarize only the requested page, not the entire Chat.
 * Original payloads/text remain unchanged in the durable transcript. */
export function auditEventPage(events:readonly AuditEvent[], selection:EventPageSelection) {
  if(!selection.turnId || !Number.isSafeInteger(selection.limit) || selection.limit<1 || selection.limit>200 ||
    selection.beforeId!==undefined && (!Number.isSafeInteger(selection.beforeId)||selection.beforeId<0))
    throw Error('Expected a turnId, limit 1–200 and optional nonnegative beforeId')
  const page:AuditEvent[]=[]
  let hasMore=false
  for(let i=events.length-1;i>=0;i--) {
    const event=events[i]!
    if(event.turnId!==selection.turnId || selection.beforeId!==undefined && event.id>=selection.beforeId)continue
    if(page.length===selection.limit){hasMore=true;break}
    page.push(event)
  }
  page.reverse()
  return {scope:'turn-audit-display-page',turnId:selection.turnId,limit:selection.limit,
    events:page.map(event=>{
      const payload:Record<string,string>={}
      // Keep ownership/tool identity for diagnosis, not potentially enormous
      // SDK message bodies or tool inputs. Read current permissions separately.
      for(const key of ['type','subtype','toolName','toolUseID','tool_use_id','agentId','parent_tool_use_id']) {
        const value=event.payload?.[key]
        if(typeof value==='string')payload[key]=value.slice(0,256)
      }
      return {id:event.id,type:event.type,turnId:event.turnId,createdAt:event.createdAt,
        text:event.text.slice(0,4096),textTruncated:event.text.length>4096,
        ...(event.payload?{payload,payloadSummarized:true}:{})}
    }),hasMore,nextBeforeId:hasMore?page[0]!.id:null,
    note:'Bounded diagnostic summaries, not complete raw events or current permissions. Text truncation/payload omission are explicit; original evidence is retained. Use the dedicated Question/permission interface for authorization. No Agent history is changed.'}
}
