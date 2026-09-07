import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { reviewFixtureDocuments } from '../test-fixtures/review-fixture'

test('bundled public Reviewer executes from a detached directory without repository modules', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-detached-')))
  try {
    // Isolate compiler caches from the long-running native lifecycle suite.
    const buildScript = `const built = await Bun.build(${JSON.stringify({ entrypoints: [join(import.meta.dir, '../../public.ts')],
      target: 'bun', outdir: workspacePath, naming: 'reviewer.js' })});
      if (!built.success) { console.error(built.logs.join('\\n')); process.exit(1); }`
    const compiler = Bun.spawn([process.execPath, '--eval', buildScript], { cwd: workspacePath, env: {}, stdout: 'pipe', stderr: 'pipe' })
    const [buildCode, buildErrors] = await Promise.all([compiler.exited, new Response(compiler.stderr).text()])
    expect(buildErrors).toBe('')
    expect(buildCode).toBe(0)
    const moduleUrl = pathToFileURL(join(workspacePath, 'reviewer.js')).href
    const documents = reviewFixtureDocuments(true)
    documents[0]!.content = '# incomplete\n'
    const script = `
      const { createFoundationReviewer, foundationReviewerInputDigest } = await import(${JSON.stringify(moduleUrl)});
      const documents = await new Response(Bun.stdin).json();
      const identity = { ownerId: 'detached-owner', projectId: 'detached-project' };
      const input = { documents, subject: { kind: 'initial', sourceResultId: 'source', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } };
      const clients = { runtimeConfiguration: { protocolVersion: 1, ownerId: identity.ownerId, resolve() { throw new Error('format must not run native workers'); } },
        billing: { protocolVersion: 1, ownerId: identity.ownerId, submitUsage() { throw new Error('format must not bill'); } } };
      const api = createFoundationReviewer({ workspacePath: process.cwd() }, clients);
      const handle = await api.start({ protocolVersion: 1, requestId: 'detached', ...identity, input, inputDigest: foundationReviewerInputDigest({ ...identity, input }) });
      let result;
      for (let attempt = 0; attempt < 100; attempt++) {
        result = await api.getResult(handle);
        if (result.status === 'completed') break;
        await Bun.sleep(50);
      }
      const reopened = await createFoundationReviewer({ workspacePath: process.cwd() }, clients).getResult(handle);
      if (JSON.stringify(reopened) !== JSON.stringify(result)) throw new Error('detached replay changed');
      console.log(JSON.stringify({ status: result.status, kind: result.result?.kind, issue: result.result?.issues[0]?.issue.reasonCode, keys: Object.keys(api).sort() }));
    `
    const child = Bun.spawn([process.execPath, '--eval', script], { cwd: workspacePath, env: {},
      stdin: new TextEncoder().encode(JSON.stringify(documents)), stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ status: 'completed', kind: 'issues_found', issue: 'DOCUMENT_FORMAT_INVALID',
      keys: ['getResult', 'resume', 'start', 'stop'] })
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
}, 20_000)
