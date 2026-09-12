import { expect, test } from 'bun:test'
import { mkdtemp, rm, realpath, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSingleReviewerLifecycle } from '../single-agent-lifecycle'
import { REVIEW_DOCUMENT_PATHS, reviewHash, reviewDocumentSetDigest } from '../single-agent-contract'
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


test('candidate re-review receives bound diffs and full versions; restart preserves its request and billing', async () => {
  const f = await fixture('comparison')
  try {
    const baseDocuments = structuredClone(f.start.input.documents)
    baseDocuments[0]!.content = '# Earlier copied document'
    f.start.input = { ...f.start.input, subject: { kind: 'candidate', candidateId: 'candidate',
      candidateResultId: reviewHash('candidate-result'), sourceReviewResultId: reviewHash('source-review'),
      sourceReviewResultDigest: reviewHash('review-envelope'), baseDocumentSetDigest: reviewDocumentSetDigest(baseDocuments), round: 1 },
      comparison: { baseDocuments } }
    f.start.inputDigest = singleReviewInputDigest(f.start)
    const handle = await f.stage.start(f.start), result = await f.wait(handle)
    expect(result.status).toBe('completed')
    const root = singleReviewRoot(f.workspacePath, 'owner', handle.id)
    const attempts = await readdir(join(root, 'native'))
    expect(attempts).toHaveLength(1)
    const workspace = join(root, 'native', attempts[0]!, 'workspace')
    const manifest = JSON.parse(await readFile(join(workspace, 'review-context/manifest.json'), 'utf8'))
    expect(manifest.changedDocumentCount).toBe(1)
    expect(manifest.baseDocumentSetDigest).toBe(reviewDocumentSetDigest(baseDocuments))
    for (const document of f.start.input.documents)
      expect(await readFile(join(workspace, document.path), 'utf8')).toBe(document.content)
    expect(await f.stage.start(f.start)).toEqual(handle)
    expect(await createSingleReviewerLifecycle(f.workspacePath, f.infrastructure).getResult(handle)).toEqual(result)
    expect(f.calls).toHaveLength(1)
    const invalid = structuredClone(f.start)
    invalid.input.comparison!.baseDocuments[0]!.content += 'tampered'
    await expect(f.stage.start(invalid)).rejects.toThrow()
  } finally { await f.cleanup() }
})

test('one file audit publishes, settles once, reopens and never redispatches on replay',async()=>{
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
test('exact duplicate findings collapse without rejecting the audit or another model call',async()=>{
 const f=await fixture('duplicates');try{
  const handle=await f.stage.start(f.start),result=await f.wait(handle)
  if(result.status!=='completed')throw new Error(JSON.stringify(result))
  expect(result.result.kind).toBe('issues_found')
  expect(result.result.issues).toHaveLength(1)
  expect(f.resolutions()).toBe(1);expect(f.calls).toHaveLength(1)
  const nativeRoot=join(singleReviewRoot(f.workspacePath,'owner',handle.id),'native')
  const attempt=(await readdir(nativeRoot))[0]!
  const raw=JSON.parse(await readFile(join(nativeRoot,attempt,'native-result.json'),'utf8'))
  expect(raw.structured_output.findings).toHaveLength(2)
  expect(await createSingleReviewerLifecycle(f.workspacePath,f.infrastructure).getResult(handle)).toEqual(result)
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
test('legacy accepted and settled report resumes publication even with an exhausted model budget',async()=>{
 const f=await fixture();try{
  // Recovery reproduces the real journal sequence without another model or debit:
  // accepted -> generic failure -> finally settled, leaving publication blocked.
  const handle=await f.stage.start(f.start)
  await f.wait(handle)
  const journal=await openSingleReviewJournal(f.workspacePath,handle.id,f.start)
  const state=await journal.read()
  // Use a separate retained-report journal so no existing publication masks recovery.
  const recoveryStart={...f.start,requestId:'legacy-retained-report',tokenBudget:30}
  recoveryStart.inputDigest=singleReviewInputDigest(recoveryStart)
  const {reviewDigest}=await import('../single-agent-contract')
  const hash=reviewDigest({ownerId:recoveryStart.ownerId,projectId:recoveryStart.projectId,requestId:recoveryStart.requestId})
  const recoveryHandle:SingleReviewHandle={protocolVersion:1,producer:'foundation-reviewer',id:`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`}
  const {journalImmutableFiles:files}=await import('../journal-storage')
  const root=singleReviewRoot(f.workspacePath,'owner',recoveryHandle.id)
  await files.ensureDirectories(root)
  await files.publishJson(join(root,'request.json'),recoveryStart)
  const recoveredJournal=await openSingleReviewJournal(f.workspacePath,recoveryHandle.id,recoveryStart)
  const attempt=state.attempts[0]!
  const closed=attempt.closed!
  expect(closed.outcome.kind).toBe('accepted')
  await recoveredJournal.append('claim',{kind:'claim',attemptId:attempt.id})
  await recoveredJournal.append('closed',closed)
  await recoveredJournal.append('failure',{kind:'failure',code:'execution_or_publication_failed'})
  await recoveredJournal.append('settled',{kind:'settled',attemptId:attempt.id,receipt:{retained:true}})
  const beforeCalls=f.calls.length,beforeModels=f.resolutions()
  expect(await f.stage.getResult(recoveryHandle)).toMatchObject({status:'needs_action',billingStatus:'settled',resumable:true})
  await f.stage.resume({handle:recoveryHandle,requestId:'recover-publication'})
  expect(await f.wait(recoveryHandle)).toMatchObject({status:'completed',billingStatus:'settled'})
  expect(f.calls).toHaveLength(beforeCalls);expect(f.resolutions()).toBe(beforeModels)
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
test('explicit token budget cannot be reset by resume',async()=>{
 const f=await fixture();try{
  f.start.tokenBudget=10;f.start.inputDigest=singleReviewInputDigest(f.start)
  const handle=await f.stage.start(f.start)
  expect(await f.wait(handle)).toMatchObject({status:'needs_action',resumable:false,billingStatus:'settled'})
  await f.stage.resume({handle,requestId:'again'});expect(f.resolutions()).toBe(1)
 }finally{await f.cleanup()}
})
