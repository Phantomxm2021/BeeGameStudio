import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { foundationReviewerInputDigest, type ReviewerHandle, type ReviewerResult } from '../../public'
import { REVIEW_DOCUMENT_PATHS, reviewHash } from '../single-agent-contract'
import { openSingleReviewJournal, singleReviewRoot } from '../single-agent-journal'
import { NATIVE_FILE_REVIEW_POLICY } from '../native-files'

test('detached Reviewer bundle completes and reopens using only copied input and public infrastructure', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-detached-')))
  const input = { subject: { kind: 'initial' as const, sourceResultId: 'author', sourceDocumentRevision: reviewHash('author'), confirmedBriefDigest: reviewHash('Brief') },
    requirements: { status: 'available' as const, content: 'Brief', digest: reviewHash('Brief') },
    documents: REVIEW_DOCUMENT_PATHS.map(path => ({ path, content: '# Original copied document' })) }
  const start = { protocolVersion: 1 as const, ownerId: 'owner', projectId: 'project', requestId: 'detached', input,
    inputDigest: foundationReviewerInputDigest({ ownerId: 'owner', projectId: 'project', input }) }
  let handle: ReviewerHandle | undefined
  let executed = false
  try {
    // Isolate Bun's compiler state from other tests' onLoad plugins.
    const config = { target: 'bun', entrypoints: [resolve(import.meta.dir, '../../public.ts'),
      resolve(import.meta.dir, '../test-fixtures/native-file-review.ts')], outdir: workspacePath, naming: '[name].js' }
    const compiler = Bun.spawn([process.execPath, '--eval',
      'const result = await Bun.build(' + JSON.stringify(config) + ');' +
      'if (!result.success) throw new Error(result.logs.join("\\n"));'], {
      cwd: workspacePath, env: {}, stdout: 'pipe', stderr: 'pipe',
    })
    const [buildExit, buildOutput, buildError] = await Promise.all([
      compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text(),
    ])
    expect(buildError).toBe('')
    expect(buildOutput).toBe('')
    expect(buildExit).toBe(0)
    const script = [
      'const {createFoundationReviewer} = await import(' + JSON.stringify(pathToFileURL(join(workspacePath, 'public.js')).href) + ');',
      'const start = await new Response(Bun.stdin).json(); let calls = 0; const charged = new Set();',
      'const runtimeConfiguration = {protocolVersion:1, ownerId:"owner", async resolve(){calls++; return {command:[process.execPath,' +
        JSON.stringify(join(workspacePath, 'native-file-review.js')) + ',"direct-final"],env:{}}}};',
      'const billing = {protocolVersion:1,ownerId:"owner",async submitUsage(value){charged.add(value.eventId); const receipt={eventId:value.eventId,duplicate:false,weightedTokensDelta:30,creditsMicro:1}; return {protocolVersion:1,ownerId:"owner",eventId:value.eventId,idempotencyKey:value.eventId,pricingVersion:"weighted-v1",usageSource:"runtime_snapshot",usage:value.usage,duplicate:false,recorded:receipt,debited:receipt}}};',
      'const api=createFoundationReviewer({workspacePath:process.cwd()},{runtimeConfiguration,billing});',
      'const handle=await api.start(start); let completed; const deadline=Date.now()+10000;',
      'while(Date.now()<deadline){const result=await api.getResult(handle);if(result.status==="completed"){completed=result;break;}if(result.status==="needs_action")throw new Error(result.reason);await Bun.sleep(25);}',
      'if(!completed)throw new Error("Detached review timed out");',
      'const reopened=createFoundationReviewer({workspacePath:process.cwd()},{runtimeConfiguration:{...runtimeConfiguration,async resolve(){throw new Error("Replay must not execute")}},billing});',
      'if(JSON.stringify(await reopened.getResult(handle))!==JSON.stringify(completed))throw new Error("Replay differs");',
      'if(JSON.stringify(await reopened.start(start))!==JSON.stringify(handle))throw new Error("Duplicate differs");',
      'console.log(JSON.stringify({handle,completed,calls,charged:charged.size,keys:Object.keys(api).sort()}));',
    ].join('\n')
    const child = Bun.spawn([process.execPath, '--eval', script], { cwd: workspacePath,
      env: { PATH: '/usr/bin:/bin', TMPDIR: tmpdir() }, stdin: new TextEncoder().encode(JSON.stringify(start)), stdout: 'pipe', stderr: 'pipe' })
    executed = true
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    const output = stdout ? JSON.parse(stdout) as { handle: ReviewerHandle; completed: ReviewerResult; calls: number; charged: number; keys: string[] } : undefined
    handle = output?.handle
    expect(stderr).toBe('')
    expect(exit).toBe(0)
    if (!output || output.completed.status !== 'completed') throw new Error('Detached review missing')
    expect(output.keys).toEqual(['getResult', 'resume', 'start', 'stop'])
    expect(output.calls).toBe(1)
    expect(output.charged).toBe(1)
    expect(output.completed.billingStatus).toBe('settled')
    expect(output.completed.result.protocolVersion).toBe(6)
    expect(output.completed.result.audit.policy).toBe(NATIVE_FILE_REVIEW_POLICY)
    expect(output.completed.result.audit).not.toHaveProperty('validation')
    expect(output.completed.result.documents.map(({ path, content }) => ({ path, content }))).toEqual(input.documents)
    expect(output.completed.result.requirements).toEqual(input.requirements)
  } finally {
    if (executed && handle) {
      const stored = JSON.parse(await readFile(join(singleReviewRoot(workspacePath, 'owner', handle.id), 'request.json'), 'utf8'))
      const journal = await openSingleReviewJournal(workspacePath, handle.id, stored, true)
      expect(await journal.leaseStatus()).toBe('free')
      expect((await journal.read()).attempts.every(attempt => attempt.closed && attempt.receipt)).toBe(true)
    }
    if (!executed || handle) await rm(workspacePath, { recursive: true, force: true })
  }
}, 20_000)
