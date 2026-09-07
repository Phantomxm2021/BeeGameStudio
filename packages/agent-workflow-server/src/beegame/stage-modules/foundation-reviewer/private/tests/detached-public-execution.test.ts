import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openReviewerFactJournal } from '../fact-journal'
import { reviewerInputDigest } from '../review-publication'
import { reviewFixtureDocuments } from '../test-fixtures/review-fixture'

test('detached public Reviewer owns native facts, semantic review, publication and billing without other stage modules', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-detached-public-execution-')))
  const moduleRoot = resolve(import.meta.dir, '../..')
  const identity = { ownerId: 'detached-full-owner', projectId: 'detached-full-project', requestId: 'detached-full' }
  // No pre-normalized facts: this must execute the fact workers as well as
  // semantic workers, not just the local format fast path.
  const documents = reviewFixtureDocuments()
  const subject = { kind: 'initial' as const, sourceResultId: 'copied-upstream-result',
    sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }
  const inputDigest = reviewerInputDigest({ ...identity, documents, subject })
  let executionStarted = false
  let executionExited = false
  try {
    const entrypoints = [join(moduleRoot, 'public.ts'),
      join(moduleRoot, 'private/test-fixtures/native-reviewer.ts'),
      join(moduleRoot, 'private/test-fixtures/offline-billing.ts')]
    // The compiler is separate from the long-running test process. Its load
    // audit verifies the actual transitive runtime bundle, not just imports.
    const buildScript = `
      const { readFile } = await import('node:fs/promises');
      const loaded = new Set();
      const built = await Bun.build({
        entrypoints: ${JSON.stringify(entrypoints)}, target: 'bun',
        outdir: ${JSON.stringify(workspacePath)}, naming: '[name].js',
        plugins: [{ name: 'public-reviewer-closed-runtime', setup(builder) {
          builder.onLoad({ filter: /.*/ }, async args => {
            if (!args.path.startsWith(${JSON.stringify(moduleRoot + '/')}) && !args.path.includes('/node_modules/zod/'))
              throw new Error('Unexpected Reviewer runtime dependency: ' + args.path);
            loaded.add(args.path);
            return { contents: await readFile(args.path, 'utf8'), loader: args.path.endsWith('.ts') ? 'ts' : 'js' };
          });
        } }]
      });
      if (!built.success || built.logs.length) throw new Error(built.logs.join('\\n'));
      console.log(JSON.stringify([...loaded]));
    `
    const compiler = Bun.spawn([process.execPath, '--eval', buildScript], {
      cwd: workspacePath, env: {}, stdout: 'pipe', stderr: 'pipe',
    })
    const [buildExit, buildOutput, buildErrors] = await Promise.all([
      compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text(),
    ])
    expect(buildErrors).toBe('')
    expect(buildExit).toBe(0)
    const loaded: string[] = JSON.parse(buildOutput)
    for (const file of ['public.ts', 'private/initial-lifecycle.ts', 'private/fact-controller.ts',
      'private/semantic-controller.ts', 'private/native-worker.ts', 'private/review-publication.ts', 'private/usage-outbox.ts'])
      expect(loaded).toContain(join(moduleRoot, file))

    const script = `
      const { createFoundationReviewer, foundationReviewerInputDigest } = await import(${JSON.stringify(pathToFileURL(join(workspacePath, 'public.js')).href)});
      const { offlineReviewerBilling } = await import(${JSON.stringify(pathToFileURL(join(workspacePath, 'offline-billing.js')).href)});
      const { identity, documents, subject } = await new Response(Bun.stdin).json();
      const input = { documents, subject };
      const billing = offlineReviewerBilling(identity.ownerId);
      let calls = 0;
      const runtimeConfiguration = { protocolVersion: 1, ownerId: identity.ownerId, async resolve() {
        calls++;
        return { command: [process.execPath, ${JSON.stringify(join(workspacePath, 'native-reviewer.js'))}],
          env: { BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast',
            OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced', OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong' } };
      } };
      const api = createFoundationReviewer({ workspacePath: process.cwd() }, { runtimeConfiguration, billing: billing.client });
      let handle;
      try {
        handle = await api.start({ protocolVersion: 1, ...identity, input,
          inputDigest: foundationReviewerInputDigest({ ...identity, input }) });
        const deadline = Date.now() + 90000;
        let completed;
        while (Date.now() < deadline) {
          const value = await api.getResult(handle);
          if (value.status === 'completed' && value.billingStatus === 'settled') { completed = value; break; }
          if (value.status === 'needs_action' || value.status === 'failed') throw new Error('Detached execution needs action');
          await Bun.sleep(50);
        }
        if (!completed) throw new Error('Detached public execution timed out');
        const noExecution = { ...runtimeConfiguration, async resolve() { throw new Error('Completed lookup cannot execute'); } };
        const reopened = await createFoundationReviewer({ workspacePath: process.cwd() }, { runtimeConfiguration: noExecution, billing: billing.client }).getResult(handle);
        if (JSON.stringify(reopened) !== JSON.stringify(completed)) throw new Error('Completed replay changed');
        if (JSON.stringify(completed.result.documents.map(doc => ({ path: doc.path, content: doc.content }))) !== JSON.stringify(documents))
          throw new Error('Reviewer changed document bytes');
        console.log(JSON.stringify({ status: completed.status, kind: completed.result.kind,
          billingStatus: completed.billingStatus, calls, charged: billing.recorded.size,
          keys: Object.keys(api).sort() }));
      } finally {
        if (handle) await api.stop({ handle, requestId: 'detached-cleanup', reason: 'test shutdown' });
      }
    `
    const child = Bun.spawn([process.execPath, '--eval', script], {
      cwd: workspacePath, env: { PATH: '/usr/bin:/bin', TMPDIR: tmpdir() },
      stdin: new TextEncoder().encode(JSON.stringify({ identity, documents, subject })), stdout: 'pipe', stderr: 'pipe',
    })
    executionStarted = true
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    executionExited = true
    expect(stderr).toBe('')
    expect(exit).toBe(0)
    const result = JSON.parse(stdout)
    expect(result).toMatchObject({ status: 'completed', billingStatus: 'settled',
      keys: ['getResult', 'resume', 'start', 'stop'] })
    const journal = await openReviewerFactJournal({ workspacePath, identity, documents, binding: { inputDigest, subject }, readOnly: true })
    const state = await journal.read()
    expect(state.collection.tasks.length).toBeGreaterThan(0)
    expect(state.semantic!.collection.tasks.length).toBeGreaterThan(0)
    const tasks = [...state.collection.tasks, ...state.semantic!.collection.tasks]
    expect(tasks.every(task => task.status === 'completed')).toBe(true)
    expect(result.calls).toBe(tasks.length)
    expect(result.charged).toBe(tasks.length)
  } finally {
    if (executionStarted) {
      // A public result or an exited parent is not sufficient cleanup proof.
      // Keep the temporary evidence if native closure cannot be confirmed.
      expect(executionExited).toBe(true)
      const journal = await openReviewerFactJournal({ workspacePath, identity, documents, binding: { inputDigest, subject }, readOnly: true })
      const state = await journal.read()
      expect([...state.collection.tasks, ...(state.semantic?.collection.tasks ?? [])].some(task => task.status === 'running')).toBe(false)
      expect(await journal.leaseStatus()).toBe('free')
    }
    await rm(workspacePath, { recursive: true, force: true })
  }
}, 120_000)
