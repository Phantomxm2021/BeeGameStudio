import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile, readdir, mkdir, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRevisionOwnedAttempt } from '../owned-attempt'
import { openRevisionAttemptStore } from '../attempt-store'
import { publishRevisionCompletedCandidate } from '../completed-candidate'
import { readRevisionPublishedCandidate } from '../candidate-publication'
import { revisionDigest } from '../json-digest'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'

const roots: string[] = []
async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-owned-attempt-')))
  roots.push(root)
  return root
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const documentPath = 'document-set'
function fixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const sourceResult = buildSingleReviewFixture({ documents,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  return { ownerId: 'owner', projectId: 'project', requestId: 'repair', sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
}
function configuration(mode = 'valid', body = reviewFixtureDocuments()[0]!.content) {
  return { command: [process.execPath, join(import.meta.dir, 'native-file-revision.ts'), mode, Buffer.from(body).toString('base64')],
    env: { OPENAI_API_KEY: 'offline-unused-secret-sentinel' } }
}

function metadataFixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = `---\ndocument_id: GDD\nversion: 1.0.0\nupdated_at: 2026-08-13T01:00:00.000Z\n---\n# incomplete`
  const sourceResult = buildSingleReviewFixture({ documents,
    identity: { ownerId: 'metadata-owner', projectId: 'metadata-project', requestId: 'metadata-review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  const body = `---\ndocument_id: GDD\nversion: 1.0.0\nupdated_at: 2026-08-13T01:00:00.000Z\n---\n${reviewFixtureDocuments()[0]!.content}`
  return {
    request: { ownerId: sourceResult.ownerId, projectId: sourceResult.projectId,
      requestId: 'metadata-repair', sourceResult,
      sourceBinding: { ownerId: sourceResult.ownerId, projectId: sourceResult.projectId, resultId: sourceResult.resultId,
        resultDigest: revisionDigest(sourceResult) } },
    sourceResult, body,
  }
}


test('durable completion precedes callback; callback failure replays without a child',async()=>{
 const root=await workspace(),request=fixture()
 await expect(runRevisionOwnedAttempt(root,{request,configuration:configuration()},{onCompleted:()=>{throw new Error('downstream')}})).rejects.toThrow('downstream')
 const store=await openRevisionAttemptStore(root,request)
 const first=(await store.read()).completed!
 expect(first.settlement.status).toBe('completed')
 const replay=await runRevisionOwnedAttempt(root,{request,configuration:{command:['/no-redispatch'],env:{}}})
 expect(replay.settlement).toEqual(first.settlement)
 expect((await store.read()).attempt).toBe(1)
})
test('empty edited files remain uncommitted and usage is retained',async()=>{
 const root=await workspace(),request=fixture()
 const receipt=await runRevisionOwnedAttempt(root,{request,configuration:configuration('valid',' ')})
 expect(receipt.settlement).toMatchObject({status:'retryable',failureCode:'output_invalid'})
 expect(receipt.usage).toMatchObject({total_tokens:16});expect(receipt.settlement.status).not.toBe('completed')
 await expect(publishRevisionCompletedCandidate(root,request)).rejects.toThrow('completed execution')
})
test('pre-cancellation does not publish a candidate or fabricate usage',async()=>{
 const root=await workspace(),request=fixture(),abort=new AbortController();abort.abort()
 const receipt=await runRevisionOwnedAttempt(root,{request,configuration:configuration()},{signal:abort.signal})
 expect(receipt.settlement.status).toBe('stopped');expect(receipt.usage).toMatchObject({total_tokens:0})
})
test('another store can stop the direct child; known usage is sealed before return',async()=>{
 const root=await workspace(),request=fixture(),abort=new AbortController()
 const pending=runRevisionOwnedAttempt(root,{request,configuration:configuration('wait')},{signal:abort.signal})
 try{
  const store=await openRevisionAttemptStore(root,request)
  let ready=false
  for(let i=0;i<100;i++){if((await store.readRequest()).progress){ready=true;break}await new Promise(r=>setTimeout(r,20))}
  expect(ready).toBe(true)
  await store.requestStop({requestId:'remote-stop',reason:'user_requested'})
  const result=await pending
  expect(result.settlement.status).toBe('stopped');expect(result.usage).toMatchObject({total_tokens:12})
  expect(result.settlement.completion).toMatchObject({scope:'direct-child',stdoutDrained:true})
 }finally{abort.abort();await pending}
})
test('a candidate is made from the receipt-bound files and preserves source bytes',async()=>{
 const root=await workspace(),request=fixture(),original=JSON.stringify(request.sourceResult)
 const receipt=await runRevisionOwnedAttempt(root,{request,configuration:configuration()})
 expect(receipt.settlement.status).toBe('completed')
 const published=await publishRevisionCompletedCandidate(root,request)
 const candidate=(await readRevisionPublishedCandidate(root,published.result))!
 expect(candidate.documents[0]!.content).toBe(reviewFixtureDocuments()[0]!.content);expect(JSON.stringify(request.sourceResult)).toBe(original)
})
test('native snapshot preserves model metadata without host rewriting',async()=>{
 const root=await workspace(),f=metadataFixture()
 const receipt=await runRevisionOwnedAttempt(root,{request:f.request,configuration:configuration('valid',f.body)})
 expect(receipt.settlement.status).toBe('completed')
 const published=await publishRevisionCompletedCandidate(root,f.request)
 const candidate=(await readRevisionPublishedCandidate(root,published.result))!
 expect(candidate.documents[0]!.content).toBe(f.body)
})
