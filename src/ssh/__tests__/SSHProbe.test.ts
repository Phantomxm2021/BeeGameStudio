import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('probe drains stdout before exit, and kills a hung probe on timeout', () => {
  const root = resolve(import.meta.dir, '../../..')
  const child = Bun.spawnSync([process.execPath, '-e', `
    import { mock } from 'bun:test'; import { strict as assert } from 'node:assert';
    mock.module(${JSON.stringify(resolve(root, 'src/utils/debug.ts'))}, () => ({ logForDebugging() {} }));
    let killed = false, resolveExit; const actual = Bun.spawn, timer = setTimeout;
    let hanging = false, architecture = 'x86_64';
    Bun.spawn = () => ({
      stdout: new ReadableStream({ pull(controller) {
        if (hanging) return;
        controller.enqueue(new TextEncoder().encode('/bin/bee-game-studio\\n1.2.3 (BeeGameStudio)\\nLinux '+architecture+'\\n/fixture\\n'));controller.close();resolveExit(0);
      } }, { highWaterMark: 0 }),
      stderr: new ReadableStream({ start(c) { c.close() } }),
      exited: new Promise(resolve => { resolveExit = resolve }), kill() { killed = true; },
    });
    globalThis.setTimeout = (fn, ms) => timer(fn, Math.min(ms, 50));
    try {
      const { probeRemote } = await import(${JSON.stringify(resolve(root, 'src/ssh/SSHProbe.ts'))});
      const result = await probeRemote('fixture'); assert.equal(result.defaultCwd, '/fixture');assert.equal(killed, false);
      assert.equal(result.remoteVersion, '1.2.3');
      architecture = 'armv7l'; await assert.rejects(() => probeRemote('fixture'), /Unsupported remote architecture/);
      hanging = true; await assert.rejects(() => probeRemote('fixture'), /timed out/);assert.equal(killed, true);
    } finally { Bun.spawn = actual; globalThis.setTimeout = timer; }
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-2500))
  expect(child.exitCode).toBe(0)
})
