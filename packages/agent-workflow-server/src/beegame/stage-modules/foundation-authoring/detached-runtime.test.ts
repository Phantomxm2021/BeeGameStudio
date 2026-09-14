import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FROZEN_DOCUMENTS } from './private/test-fixtures/frozen-documents'

test('bundled public author completes outside the source tree without legacy runtime dependencies', async () => {
  const moduleRoot = resolve(import.meta.dir)
  const loaded = new Set<string>()
  const build = await Bun.build({
    entrypoints: [join(moduleRoot, 'public.ts'), join(moduleRoot, 'private/test-fixtures/native-author.ts')],
    target: 'bun',
    plugins: [{ name: 'author-runtime-boundary', setup(builder) {
      builder.onLoad({ filter: /.*/ }, args => {
        loaded.add(args.path)
        if (!args.path.startsWith(moduleRoot + sep) && !args.path.includes('/node_modules/zod/') &&
            !['native-task-access.ts', 'native-file-agent.ts', 'native-tool-diagnostics.ts', 'native-response-trace.ts', 'native-diagnostics.ts'].some(name => args.path === resolve(moduleRoot, '../../../../../../packages/agent-workflow/src', name)))
          throw new Error('Unexpected transitive Author runtime dependency: ' + args.path)
      })
    } }],
  })
  expect(build.success).toBe(true)
  expect(build.logs).toEqual([])
  expect(loaded.has(join(moduleRoot, 'private/autonomous-lifecycle.ts'))).toBe(true)
  expect(loaded.has(join(moduleRoot, 'private/lifecycle.ts'))).toBe(false)
  expect(loaded.has(join(moduleRoot, 'private/runtime/runtime.ts'))).toBe(false)
  const isolated = await realpath(await mkdtemp(join(tmpdir(), 'author-detached-')))
  let child: ReturnType<typeof Bun.spawn> | undefined
  try {
    for (const output of build.outputs) await writeFile(join(isolated, output.path.endsWith('/public.js') ? 'public.js' : 'native-author.js'), await output.text())
    const publicUrl = pathToFileURL(join(isolated, 'public.js')).href
    const nativePath = join(isolated, 'native-author.js')
    const script = `
      import { createFoundationAuthoring } from ${JSON.stringify(publicUrl)};
      import { createHash } from 'node:crypto';
      import { join } from 'node:path';
      const digest = value => createHash('sha256').update(value).digest('hex');
      const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
        value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
      const ownerId = 'isolated-owner', projectId = 'isolated-project';
      let resolutions = 0;
      const events = new Set();
      const infrastructure = {
        runtimeConfiguration: { protocolVersion: 1, ownerId, async resolve() {
          resolutions++; return { command: [process.execPath, ${JSON.stringify(nativePath)}], env: {} };
        }},
        billing: { protocolVersion: 1, ownerId, async submitUsage(input) {
          events.add(input.eventId);
          return { protocolVersion: 1, ownerId, eventId: input.eventId, idempotencyKey: input.eventId,
            pricingVersion: 'weighted-v1', usageSource: 'runtime_snapshot', usage: input.usage, skipped: true, duplicate: false };
        }},
      };
      const config = { workspacePath: process.cwd(), privateRootPath: join(process.cwd(), '.beegame/workflow/foundation-authoring/state') };
      const stage = createFoundationAuthoring(config, infrastructure);
      const input = { confirmedBrief: 'Detached offline author', confirmedBriefDigest: digest('Detached offline author') };
      const request = { protocolVersion: 1, requestId: 'detached', ownerId, projectId, input, inputDigest: digest(canonical({ ownerId, projectId, input })) };
      const handle = await stage.start(request);
      let result;
      try {
        for (let index = 0; index < 500; index++) {
          result = await stage.getResult(handle);
          if (result.status !== 'running') break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (result?.status !== 'completed') throw new Error('Detached author did not complete: ' + JSON.stringify(result));
        const rebuilt = createFoundationAuthoring(config, infrastructure);
        const repeated = await rebuilt.start(request);
        await rebuilt.resume({ handle, requestId: 'completed-replay' });
        const replay = await rebuilt.getResult(repeated);
        if (repeated.id !== handle.id || replay.status !== 'completed' || replay.result.resultId !== result.result.resultId)
          throw new Error('Detached completed replay changed identity');
        console.log(JSON.stringify({ result, resolutions, events: events.size, exports: Object.keys(stage).sort() }));
      } finally {
        await stage.stop({ handle, requestId: 'detached-cleanup', reason: 'Offline test cleanup' });
      }
    `
    const spawned = Bun.spawn([process.execPath, '--eval', script], { cwd: isolated, env: { PATH: '/usr/bin:/bin', TMPDIR: tmpdir() }, stdout: 'pipe', stderr: 'pipe' })
    child = spawned
    const [stdout, stderr, exit] = await Promise.all([new Response(spawned.stdout).text(), new Response(spawned.stderr).text(), spawned.exited])
    expect(stderr).toBe('')
    expect(exit).toBe(0)
    const actual = JSON.parse(stdout)
    expect(actual.exports).toEqual(['getResult', 'resume', 'start', 'stop'])
    expect(actual.resolutions).toBe(1)
    expect(actual.events).toBe(1)
    expect(actual.result.status).toBe('completed')
    expect(actual.result.result.documents).toHaveLength(8)
    for (const [path, bytes] of Object.entries(FROZEN_DOCUMENTS)) {
      const published = await readFile(join(isolated, path), 'utf8')
      expect(published.replace(/^---\ndocument_id: [^\n]+\nversion: 1\.0\.0\nupdated_at: [^\n]+\n---\n/, '')).toBe(bytes)
      const artifact = actual.result.result.documents.find((entry: { path: string }) => entry.path === path)
      expect(createHash('sha256').update(published).digest('hex')).toBe(artifact.digest)
      expect(await readFile(join(isolated, artifact.artifactPath), 'utf8')).toBe(published)
    }
  } finally {
    child?.kill()
    if (child) await child.exited
    await rm(isolated, { recursive: true, force: true })
  }
}, 15_000)
