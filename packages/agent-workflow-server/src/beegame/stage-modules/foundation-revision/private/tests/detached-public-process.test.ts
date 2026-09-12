import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { foundationRevisionInputDigest, type RevisionHandle, type RevisionResult, type RevisionStartInput } from '../../public'
import { openRevisionAttemptStore } from '../attempt-store'
import { openRevisionExecutionLease } from '../execution-lease'
import { readRevisionRequestByHandle } from '../request-store'
import fixtures from './fixtures/public-initial-inputs.json'

test('Revision public lifecycle executes in a detached process using only frozen input data and its own runtime', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'revision-public-process-')))
  const moduleRoot = resolve(import.meta.dir, '../..')
  const input = structuredClone(fixtures.lifecycle) as { start: RevisionStartInput; validMarkdown: string }
  input.start.requestId = 'detached-public-process'
  input.start.inputDigest = foundationRevisionInputDigest({ownerId:input.start.ownerId,projectId:input.start.projectId,input:input.start.input})
  let executionStarted = false
  let executionExited = false
  let handle: RevisionHandle | undefined
  try {
    const config = { entrypoints: [join(moduleRoot, 'public.ts'), join(import.meta.dir, 'native-file-revision.ts')],
      target: 'bun', outdir: workspacePath, naming: '[name].js' }
    const buildScript = [
      "const { readFile, realpath } = await import('node:fs/promises');",
      'const loaded = new Set();',
      'const config = ' + JSON.stringify(config) + ';',
      "config.plugins = [{ name: 'revision-closed-runtime', setup(build) {",
      '  build.onLoad({ filter: /.*/ }, async args => {',
      '    const path = await realpath(args.path);',
      '    if (!path.startsWith(' + JSON.stringify(moduleRoot + '/') + ") && !path.includes('/node_modules/zod/') && !" + JSON.stringify(['native-file-agent.ts', 'native-task-access.ts'].map(file => resolve(moduleRoot, '../../../../../../packages/agent-workflow/src', file))) + '.includes(path))',
      "      throw new Error('Unexpected Revision runtime dependency: ' + path);",
      '    loaded.add(path);',
      "    return { contents: await readFile(path, 'utf8'), loader: path.endsWith('.ts') ? 'ts' : 'js' };",
      '  });',
      '} }];',
      'const result = await Bun.build(config);',
      "if (!result.success || result.logs.length) throw new Error(result.logs.join('\\n'));",
      'console.log(JSON.stringify([...loaded]));',
    ].join('\n')
    const compiler = Bun.spawn([process.execPath, '--eval', buildScript], {
      cwd: workspacePath, env: {}, stdout: 'pipe', stderr: 'pipe',
    })
    const [buildExit, buildOutput, buildError] = await Promise.all([
      compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text(),
    ])
    expect(buildError).toBe('')
    expect(buildExit).toBe(0)
    const loaded: string[] = JSON.parse(buildOutput)
    for (const path of ['public.ts', 'private/lifecycle.ts', 'private/owned-attempt.ts',
      'private/usage-outbox.ts', 'private/completed-candidate.ts'])
      expect(loaded).toContain(join(moduleRoot, path))

    const script = [
      'const { createFoundationRevision } = await import(' + JSON.stringify(pathToFileURL(join(workspacePath, 'public.js')).href) + ');',
      'const input = await new Response(Bun.stdin).json();',
      'const ownerId = input.start.ownerId;',
      'let calls = 0;',
      'const ledger = new Map();',
      'const runtimeConfiguration = { protocolVersion: 1, ownerId, async resolve() {',
      '  calls++;',
      '  return { command: [process.execPath, ' + JSON.stringify(join(workspacePath, 'native-file-revision.js')) +
        ", 'valid', Buffer.from(input.validMarkdown).toString('base64')], env: { OPENAI_API_KEY: 'offline-unused-sentinel' } };",
      '} };',
      'const billing = { protocolVersion: 1, ownerId, async submitUsage(value) {',
      '  const prior = ledger.get(value.eventId);',
      "  if (prior && JSON.stringify(prior) !== JSON.stringify(value)) throw new Error('Conflicting usage bytes');",
      '  ledger.set(value.eventId, structuredClone(value));',
      '  const charged = { eventId: value.eventId, duplicate: Boolean(prior), weightedTokensDelta: 1, creditsMicro: 1 };',
      '  return { protocolVersion: 1, ownerId, eventId: value.eventId, idempotencyKey: value.eventId,',
      "    pricingVersion: 'weighted-v1', usageSource: 'runtime_snapshot', usage: value.usage, duplicate: Boolean(prior),",
      '    recorded: charged, debited: { ...charged } };',
      '} };',
      'const api = createFoundationRevision({ workspacePath: process.cwd() }, { runtimeConfiguration, billing });',
      'let handle;',
      'try {',
      '  handle = await api.start(input.start);',
      '  const deadline = Date.now() + 15000;',
      '  let completed;',
      '  while (Date.now() < deadline) {',
      '    const result = await api.getResult(handle);',
      "    if (result.status === 'completed' && result.billingStatus === 'settled') { completed = result; break; }",
      "    if (result.status === 'needs_action') throw new Error('Detached Revision requires action');",
      '    await Bun.sleep(25);',
      '  }',
      "  if (!completed) throw new Error('Detached Revision timed out');",
      "  const noExecution = { ...runtimeConfiguration, async resolve() { throw new Error('Lookup must not execute'); } };",
      '  const reopened = createFoundationRevision({ workspacePath: process.cwd() }, { runtimeConfiguration: noExecution, billing });',
      "  if (JSON.stringify(await reopened.getResult(handle)) !== JSON.stringify(completed)) throw new Error('Result replay changed');",
      "  if (JSON.stringify(await reopened.start(input.start)) !== JSON.stringify(handle)) throw new Error('Duplicate start changed handle');",
      '  console.log(JSON.stringify({ handle, completed, calls, charged: ledger.size, keys: Object.keys(api).sort() }));',
      '} finally {',
      "  if (handle) await api.stop({ handle, requestId: 'detached-cleanup', reason: 'shutdown' });",
      '}',
    ].join('\n')
    const child = Bun.spawn([process.execPath, '--eval', script], {
      cwd: workspacePath, env: { PATH: '/usr/bin:/bin', TMPDIR: tmpdir() },
      stdin: new TextEncoder().encode(JSON.stringify(input)), stdout: 'pipe', stderr: 'pipe',
    })
    executionStarted = true
    const [exit, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    executionExited = true
    const output = stdout ? JSON.parse(stdout) as {
      handle: RevisionHandle; completed: RevisionResult; calls: number; charged: number; keys: string[]
    } : undefined
    handle = output?.handle
    expect(stderr).toBe('')
    expect(exit).toBe(0)
    if (!output || output.completed.status !== 'completed') throw new Error('Detached candidate missing')
    expect(output.keys).toEqual(['getResult', 'resume', 'start', 'stop'])
    expect(output.calls).toBe(1)
    expect(output.charged).toBe(1)
    expect(output.completed.billingStatus).toBe('settled')
    expect(output.completed.result.kind).toBe('candidate_ready')
    expect('verdict' in output.completed.result).toBe(false)
    const source = fixtures.lifecycle.start.input.sourceResult
    for (const document of output.completed.result.documents) {
      // The frozen native Markdown admission trims the repaired response;
      // untouched documents must still retain their exact original bytes.
      const expected = document.path === 'docs/GDD.md' ? input.validMarkdown
        : source.documents.find(item => item.path === document.path)!.content
      expect(document.content).toBe(expected)
    }
  } finally {
    if (executionStarted) {
      // Keep evidence on failure. Parent exit or a completed result alone is
      // not accepted as proof that every owned attempt has been closed.
      expect(executionExited).toBe(true)
      if (!handle) throw new Error('Detached handle unavailable; temporary evidence retained')
      const registration = await readRevisionRequestByHandle(workspacePath, handle.id, input.start.ownerId)
      const store = await openRevisionAttemptStore(workspacePath, registration.prepared.request, { readOnlyHandle: handle.id })
      expect((await store.readRequest()).activeAttemptId).toBeNull()
      const lease = await openRevisionExecutionLease(workspacePath, registration.prepared.request, { readOnlyHandle: handle.id })
      expect(await lease.status()).toBe('free')
    }
    await rm(workspacePath, { recursive: true, force: true })
  }
}, 25_000)
