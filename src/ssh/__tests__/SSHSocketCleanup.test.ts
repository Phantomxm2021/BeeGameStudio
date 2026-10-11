import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')

function isolated(code: string): void {
  const child = Bun.spawnSync([process.execPath, '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    const root = ${JSON.stringify(root)};
    const logs = [];
    mock.module(root+'/src/utils/debug.ts', () => ({ logForDebugging: text => logs.push(text) }));
    ${code}
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-3000))
  expect(child.exitCode).toBe(0)
}

test('the actual cleanup deadline terminates a process that ignores SIGTERM', () => {
  isolated(`
    const { cleanupRemoteSocket } = await import(root+'/src/ssh/SSHSocketCleanup.ts');
    const actualSpawn = Bun.spawn;
    const proc = actualSpawn([process.execPath, '-e', 'process.on("SIGTERM",()=>{}); console.log("READY"); setInterval(()=>{},1000)'], { stdin:'ignore', stdout:'pipe', stderr:'pipe' });
    const reader = proc.stdout.getReader();
    let deadline;
    try {
      await reader.read(); reader.releaseLock();
      Bun.spawn = () => proc;
      const started = Date.now();
      await Promise.race([
        cleanupRemoteSocket('fixture','/tmp/bgs-ssh-auth-11111111-1111-4111-8111-111111111111.sock'),
        new Promise((_,reject) => { deadline=setTimeout(()=>reject(new Error('Cleanup exceeded its deadline')),6500) }),
      ]);
      assert.ok(Date.now()-started < 6500);
      assert.equal(proc.signalCode,'SIGKILL');
    } finally {
      clearTimeout(deadline);
      Bun.spawn=actualSpawn;
      if (proc.exitCode===null) proc.kill('SIGKILL');
      await proc.exited;
    }
  `)
}, 10000)

test('remote cleanup cannot target directories, globs, regular files or symlinks', () => {
  isolated(`
    import { randomUUID } from 'node:crypto';
    import { writeFile, symlink, readFile, lstat, unlink } from 'node:fs/promises';
    const { remoteSocketCleanupCommand } = await import(root+'/src/ssh/SSHSocketCleanup.ts');
    for (const path of ['/tmp', '/', '/tmp/bgs-ssh-auth-*.sock', '/tmp/bgs-ssh-auth-x.sock; echo BAD']) {
      assert.throws(() => remoteSocketCleanupCommand(path));
    }
    const regular = '/tmp/bgs-ssh-auth-'+randomUUID()+'.sock';
    const link = '/tmp/bgs-ssh-auth-'+randomUUID()+'.sock';
    await writeFile(regular, 'preserve-me', { flag: 'wx' });
    try {
      await symlink(regular, link);
      for (const path of [regular, link]) {
        const result = Bun.spawnSync(['/bin/sh', '-c', remoteSocketCleanupCommand(path)]);
        assert.equal(result.exitCode, 0);
      }
      assert.equal(await readFile(regular, 'utf8'), 'preserve-me');
      assert.ok((await lstat(link)).isSymbolicLink());
    } finally {
      await unlink(link).catch(() => {});
      await unlink(regular);
    }
  `)
})

test('unreachable remote cleanup is noninteractive, bounded and reports failure', () => {
  isolated(`
    const { cleanupRemoteSocket } = await import(root+'/src/ssh/SSHSocketCleanup.ts');
    const socket = '/tmp/bgs-ssh-auth-11111111-1111-4111-8111-111111111111.sock';
    let args, options, expire, resolveExit, duration, signal, cleared = 0, kills = 0;
    const exited = new Promise(resolve => { resolveExit = resolve });
    Bun.spawn = (a, o) => { args = a; options = o; return { exited, unref() {}, kill(s) { kills++; signal = s; if (s === 'SIGKILL') resolveExit(255) } } };
    globalThis.setTimeout = (fn, ms) => { expire = fn; duration = ms; return { unref() {} } };
    globalThis.clearTimeout = () => { cleared++ };
    const pending = cleanupRemoteSocket('fixture', socket);
    assert.equal(duration, 5000);
    assert.equal(options.stdin, 'ignore');
    assert.ok(args.includes('BatchMode=yes'));
    assert.ok(args.includes('ConnectTimeout=3'));
    assert.ok(args.includes('ClearAllForwardings=yes'));
    assert.ok(args.includes('ControlPath=none'));
    assert.ok(args.at(-1).includes(socket));
    assert.equal(args.includes('-R'), false);
    expire(); await pending;
    assert.equal(kills, 1);
    assert.equal(signal, 'SIGKILL');
    assert.equal(cleared, 1);
    assert.ok(logs.some(text => text.includes('socket may remain')));
  `)
})

test('each retired SSH process cleans only its own generated socket', () => {
  isolated(`
    const cleanups = [], exits = [], calls = [];
    mock.module(root+'/src/ssh/SSHSocketCleanup.ts', () => ({ cleanupRemoteSocket: async (host, socket) => cleanups.push({ host, socket }) }));
    mock.module(root+'/src/ssh/SSHAuthProxy.ts', () => ({ createAuthProxy: async () => ({ proxy: { stop() {} }, localAddress: '/tmp/fixture.sock', authEnv: {} }) }));
    mock.module(root+'/src/ssh/SSHProbe.ts', () => ({ probeRemote: async () => ({ hasBinary: true, remoteVersion: 'fixture', binaryPath: '/usr/bin/true', defaultCwd: '/fixture' }) }));
    mock.module(root+'/src/utils/cliLaunch.ts', () => ({ buildCliLaunch: args => ({ execPath: '/usr/bin/true', args, env: {} }) }));
    mock.module(root+'/src/ssh/SSHSessionManager.ts', () => ({ SSHSessionManagerImpl: class { constructor(proc, options) { this.reconnect = options.reconnect } } }));
    mock.module(root+'/src/utils/slowOperations.ts', () => ({ jsonParse: JSON.parse, jsonStringify: JSON.stringify }));
    Bun.spawn = args => {
      calls.push(args);
      let out;
      const exited = new Promise(resolve => { exits.push(resolve) });
      return { exited, kill() {}, stdout: new ReadableStream({ start(c) { out = c } }), stderr: new ReadableStream({ start(c) { c.close() } }),
        stdin: { write(bytes) {
          const request = JSON.parse(new TextDecoder().decode(bytes));
          out.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id } })+'\\n'));
          return bytes.length;
        }, flush() {} },
      };
    };
    const { createSSHSession } = await import(root+'/src/ssh/createSSHSession.ts');
    const session = await createSSHSession({ host: 'fixture', localVersion: 'fixture', extraCliArgs: [] });
    const manager = session.createManager({});
    assert.equal(cleanups.length, 0);
    const first = calls[0][calls[0].indexOf('-R')+1].split(':')[0];
    exits[0](255); await Bun.sleep(5);
    assert.deepEqual(cleanups, [{ host: 'fixture', socket: first }]);
    await manager.reconnect();
    const second = calls[1][calls[1].indexOf('-R')+1].split(':')[0];
    assert.notEqual(first, second);
    assert.equal(cleanups.length, 1);
    exits[1](0); await Bun.sleep(5);
    assert.deepEqual(cleanups, [{ host: 'fixture', socket: first }, { host: 'fixture', socket: second }]);
  `)
})
