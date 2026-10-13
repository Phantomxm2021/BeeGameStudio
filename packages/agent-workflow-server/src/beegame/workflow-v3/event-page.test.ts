import {test,expect} from 'bun:test'
import {auditEventPage} from './event-page'

test('large audit history returns only one selected native turn page without serializing SDK bodies',()=>{
  const large='x'.repeat(100000)
  const payload={type:'assistant',agentId:'native-child',body:large,toJSON(){throw Error('Whole SDK payload serialized')}}
  const events=Array.from({length:90000},(_,id)=>({id,type:'assistant.message' as const,turnId:id<85000?'old':'current',
    text:id===89999?large:'event '+id,payload,createdAt:new Date(0)}))
  const page=auditEventPage(events,{turnId:'current',limit:100})
  expect(page.events).toHaveLength(100);expect(page.events[0]!.id).toBe(89900)
  expect(page.events.at(-1)!.textTruncated).toBe(true)
  expect(page.events.at(-1)!.payload).toEqual({type:'assistant',agentId:'native-child'})
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(40000)
  expect(page.nextBeforeId).toBe(89900);expect(page.hasMore).toBe(true)
  const previous=auditEventPage(events,{turnId:'current',limit:100,beforeId:page.nextBeforeId!})
  expect(previous.events.map(e=>e.id)).toEqual(Array.from({length:100},(_,i)=>89800+i))
  expect(events[89999]!.text.length).toBe(100000);expect(events[89999]!.payload.body).toBe(large)
  const first=auditEventPage(events,{turnId:'current',limit:100,beforeId:85050})
  expect(first.events).toHaveLength(50);expect(first.nextBeforeId).toBeNull();expect(first.hasMore).toBe(false)
})

test('audit display page handles empty turns and rejects invalid cursors without claiming complete permission history',()=>{
  expect(auditEventPage([],{turnId:'none',limit:100})).toMatchObject({events:[],hasMore:false,nextBeforeId:null})
  for(const selection of [{turnId:'',limit:100},{turnId:'turn',limit:0},{turnId:'turn',limit:201},
    {turnId:'turn',limit:100,beforeId:-1},{turnId:'turn',limit:100,beforeId:1.5}])
    expect(()=>auditEventPage([],selection)).toThrow('limit')
  const page=auditEventPage([{id:1,turnId:'turn',type:'permission.requested',text:'Approval required',
    payload:{type:'permission',toolUseID:'child-tool',input:{command:'not an authorization'}},createdAt:'2026-10-12'}],{turnId:'turn',limit:1})
  expect(page.events[0]).toMatchObject({type:'permission.requested',payloadSummarized:true,payload:{toolUseID:'child-tool'}})
  expect(page.note).toContain('dedicated Question/permission')
  expect(page.events[0]!.payload).not.toHaveProperty('input')
})
