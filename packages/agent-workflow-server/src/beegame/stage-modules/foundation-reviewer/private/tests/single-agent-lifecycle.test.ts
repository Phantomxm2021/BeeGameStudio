import { expect, test } from 'bun:test'
import { mkdtemp, rm, realpath, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSingleReviewerLifecycle } from '../single-agent-lifecycle'
import { REVIEW_DOCUMENT_PATHS, reviewHash } from '../single-agent-contract'
import { singleReviewInputDigest, type SingleReviewStart, type SingleReviewHandle, type SingleReviewResult } from '../single-agent-publication'
import type { UsageBillingInput } from '../../../../../billing/public'
import { openSingleReviewJournal, singleReviewRoot } from '../single-agent-journal'
import { NATIVE_FILE_REVIEW_POLICY } from '../native-files'

async function fixture(mode = 'normal', failBilling: boolean | number = false) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'single-review-test-')))
  const calls: UsageBillingInput[] = []
  let resolutions = 0
  const infrastructure = { runtimeConfiguration: { protocolVersion: 1 as const, ownerId: 'owner', async resolve() {
    resolutions++; return { command: [process.execPath, join(import.meta.dir, '../test-fixtures/native-file-review.ts'), mode], env: {} }
  } }, billing: { protocolVersion: 1 as const, ownerId: 'owner', async submitUsage(value: UsageBillingInput) {
    calls.push(structuredClone(value))
    if (failBilling === true || (typeof failBilling === 'number' && calls.length <= failBilling)) throw new Error('offline')
    return { protocolVersion: 1 as const, ownerId: value.ownerId, eventId: value.eventId, idempotencyKey: value.eventId,
      pricingVersion: 'weighted-v1' as const, usageSource: 'runtime_snapshot' as const, usage: value.usage, duplicate: calls.filter(call => call.eventId === value.eventId).length > 1,
      recorded: { eventId: value.eventId, duplicate: false, weightedTokensDelta: 30, creditsMicro: 1 },
      debited: { eventId: value.eventId, duplicate: false, weightedTokensDelta: 30, creditsMicro: 1 } }
  } } }
  const input: SingleReviewStart['input'] = { subject: { kind: 'initial', sourceResultId: 'source', sourceDocumentRevision: reviewHash('source'), confirmedBriefDigest: reviewHash('Brief') },
    requirements: { status: 'available', content: 'Brief', digest: reviewHash('Brief') },
    documents: REVIEW_DOCUMENT_PATHS.map(path => ({ path, content: '# Original copied document' })) }
  const start: SingleReviewStart = { protocolVersion: 1, ownerId: 'owner', projectId: 'project', requestId: 'request', input,
    inputDigest: singleReviewInputDigest({ ownerId: 'owner', projectId: 'project', input }) }
  const stage = createSingleReviewerLifecycle(workspacePath, infrastructure)
  async function wait(handle: SingleReviewHandle): Promise<SingleReviewResult> {
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await stage.getResult(handle)
      if (result.status !== 'running') return result
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('Review fixture timed out')
  }
  return { stage, start, calls, wait, workspacePath, infrastructure, resolutions: () => resolutions,
    restoreBilling: () => { failBilling = false }, cleanup: () => rm(workspacePath, { recursive: true, force: true }) }
}


test('independent readers observe settlement-to-publication without a false continuation pause or redispatch', async () => {
  await Promise.all(Array.from({ length: 4 }, async () => {
    const f = await fixture('normal', 1)
    const handle = await f.stage.start(f.start)
    try {
      const deadline = Date.now() + 8000
      while (f.calls.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1))
      expect(f.calls.length).toBeGreaterThan(0)
      const reader = createSingleReviewerLifecycle(f.workspacePath, f.infrastructure)
      let completed = false
      while (Date.now() < deadline) {
        const observations = await Promise.all([f.stage.getResult(handle), reader.getResult(handle)])
        for (const observation of observations) expect(['running', 'completed']).toContain(observation.status)
        if (observations.every(observation => observation.status === 'completed')) { completed = true; break }
      }
      expect(completed).toBe(true)
      expect(f.resolutions()).toBe(1)
      expect(f.calls).toHaveLength(2)
      expect(new Set(f.calls.map(call => call.eventId)).size).toBe(1)
    } finally {
      await f.stage.stop({ handle, requestId: 'reader-test-cleanup', reason: 'shutdown' })
      await f.wait(handle)
      await f.cleanup()
    }
  }))
}, 15000)

test('one autonomous audit-and-correct task publishes, settles once, reopens and never redispatches on replay',async()=>{
 const f=await fixture();try{
  const handle=await f.stage.start(f.start),result=await f.wait(handle)
  expect(result.status).toBe('completed')
  if(result.status!=='completed')throw new Error(JSON.stringify(result))
  expect(result.result.audit.policy).toBe(NATIVE_FILE_REVIEW_POLICY)
  expect(f.resolutions()).toBe(1);expect(f.calls.map(x=>x.usage.total_tokens)).toEqual([30])
  const root=singleReviewRoot(f.workspacePath,'owner',handle.id)
  expect(await readdir(join(root,'native'))).toHaveLength(1)
  const stored=JSON.parse(await readFile(join(root,'request.json'),'utf8'))
  const state=await(await openSingleReviewJournal(f.workspacePath,handle.id,stored)).read()
  expect(state.attempts).toHaveLength(1);expect(state.attempts[0]?.closed?.sealScope).toBe('direct-child')
  expect(state.progress?.modelResponses).toBe(1);expect('verification' in state).toBe(false)
  expect(await f.stage.start(f.start)).toEqual(handle)
  expect(await createSingleReviewerLifecycle(f.workspacePath,f.infrastructure).getResult(handle)).toEqual(result)
  expect(f.calls).toHaveLength(1)
 }finally{await f.cleanup()}
})
for (const mode of ['invalid', 'extra-field']) test(mode+' report stops without host correction or another model call',async()=>{
 const f=await fixture(mode);try{
  const handle=await f.stage.start(f.start),result=await f.wait(handle)
  expect(result).toMatchObject({status:'needs_action',billingStatus:'settled'})
  expect(f.resolutions()).toBe(1);expect(f.calls).toHaveLength(1)
  expect(await readdir(singleReviewRoot(f.workspacePath,'owner',handle.id))).not.toContain('result')
  const nativeRoot=join(singleReviewRoot(f.workspacePath,'owner',handle.id),'native')
  const attempt=(await readdir(nativeRoot))[0]!
  const raw=JSON.parse(await readFile(join(nativeRoot,attempt,'native-result.json'),'utf8'))
  expect(raw.structured_output).toBeDefined()
  expect(JSON.parse(await readFile(join(nativeRoot,attempt,'output-diagnostic.json'),'utf8'))).toBeDefined()
 }finally{await f.cleanup()}
})
test('billing retry publishes retained report without rerunning model',async()=>{
 const f=await fixture('normal',true);try{
  const handle=await f.stage.start(f.start)
  expect(await f.wait(handle)).toMatchObject({status:'needs_action',billingStatus:'pending'})
  expect(f.calls).toHaveLength(2)
  expect((await f.stage.getResult(handle)).status).toBe('needs_action')
  f.restoreBilling();await f.stage.resume({handle,requestId:'billing-retry'})
  expect(await f.wait(handle)).toMatchObject({status:'completed',billingStatus:'settled'})
  expect(f.resolutions()).toBe(1);expect(new Set(f.calls.map(x=>x.eventId)).size).toBe(1)
 }finally{await f.cleanup()}
})
test('lost billing acknowledgement retries the same sealed event and publishes without a stranded failure',async()=>{
 const f=await fixture('normal',1);try{
  const handle=await f.stage.start(f.start)
  expect(await f.wait(handle)).toMatchObject({status:'completed',billingStatus:'settled'})
  expect(f.calls).toHaveLength(2)
  expect(f.calls[0]).toEqual(f.calls[1])
  expect(f.resolutions()).toBe(1)
  const state=await(await openSingleReviewJournal(f.workspacePath,handle.id,f.start)).read()
  expect(state.failure).toBeUndefined()
  expect(state.attempts).toHaveLength(1)
  expect(state.published).toBeDefined()
  expect(await createSingleReviewerLifecycle(f.workspacePath,f.infrastructure).getResult(handle)).toMatchObject({status:'completed'})
 }finally{await f.cleanup()}
})
test('stop drains child and settles observed usage before reporting stopped',async()=>{
 const f=await fixture('wait');try{
  const handle=await f.stage.start(f.start)
  for(let i=0;i<100;i++){if((await f.stage.getResult(handle)).progress)break;await new Promise(r=>setTimeout(r,20))}
  await f.stage.stop({handle,requestId:'stop',reason:'user'})
  expect(await f.wait(handle)).toMatchObject({status:'stopped',billingStatus:'settled'})
  expect(f.calls.map(x=>x.usage.total_tokens)).toEqual([20])
 }finally{await f.cleanup()}
})
