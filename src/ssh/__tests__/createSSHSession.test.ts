import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('remote and local sessions use SDK initialize, quote arguments and redact credentials', () => {
  const root = resolve(import.meta.dir, '../../..')
  const child = Bun.spawnSync([process.execPath, '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    const root = ${JSON.stringify(root)};
    let calls = [], logs = [], initializeCount = 0;
    mock.module(root+'/src/ssh/SSHAuthProxy.ts', () => ({ createAuthProxy: async () => ({
      proxy: { stop() {} }, localAddress: '/tmp/fixture.sock', authEnv: {
        BGS_API_UNIX_SOCKET: '/tmp/fixture.sock', ANTHROPIC_AUTH_NONCE: 'secret-fixture-nonce',
      },
    }) }));
    mock.module(root+'/src/ssh/SSHProbe.ts', () => ({ probeRemote: async () => ({
      hasBinary: true, remoteVersion: 'fixture', binaryPath: '/usr/bin/true', defaultCwd: '/fixture', remotePlatform: 'linux', remoteArch: 'x64',
    }) }));
    mock.module(root+'/src/utils/cliLaunch.ts', () => ({ buildCliLaunch: args => ({ execPath: '/usr/bin/true', args, env: {} }) }));
    mock.module(root+'/src/utils/debug.ts', () => ({ logForDebugging: text => logs.push(text) }));
    mock.module(root+'/src/utils/slowOperations.ts', () => ({ jsonParse: JSON.parse, jsonStringify: JSON.stringify }));
    const actualSpawn = Bun.spawn;
    Bun.spawn = args => {
      calls.push(args); let stdout;
      return { stdout: new ReadableStream({ start(c) { stdout = c } }),
        stderr: new ReadableStream({ start(c) { c.close() } }),
        stdin: { write(bytes) {
          const request = JSON.parse(new TextDecoder().decode(bytes));
          assert.equal(request.request.subtype, 'initialize'); initializeCount++;
          stdout.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id } })+'\\n')); stdout.close(); return bytes.length;
        }, flush() {} }, exited: new Promise(() => {}), kill() {},
      };
    };
    const { createSSHSession, createLocalSSHSession } = await import(root+'/src/ssh/createSSHSession.ts');
    const { getReconnectCliArgs } = await import(root+'/src/ssh/createSSHSession.ts');
    await createSSHSession({ host: 'fixture', localVersion: 'fixture', cwd: 'x; printf BGS_INJECTION; #', extraCliArgs: [] });
    await createLocalSSHSession({});
    assert.equal(initializeCount, 2);
    assert.equal(calls[1].includes('--verbose'), true);
    assert.equal(calls[1].includes('--cwd'), false);
    assert.equal(calls[0].includes('ExitOnForwardFailure=yes'), true);
    assert.deepEqual(getReconnectCliArgs(['-p', '--continue', '--resume', 'other', '--session-id=old', '--fork-session'], 'original'), ['-p', '--resume', 'original']);
    assert.deepEqual(getReconnectCliArgs(['-p']), ['-p']);
    assert.equal(logs.some(text => text.includes('secret-fixture-nonce')), false);
    Bun.spawn = actualSpawn;
    const proof = Bun.spawnSync(['/bin/sh', '-c', calls[0].at(-1)], { stdout: 'pipe', stderr: 'pipe' });
    assert.equal(proof.stdout.toString(), '');
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-2500))
  expect(child.exitCode).toBe(0)
})

test('reconnect gets a fresh forward and exposes only current-attempt diagnostics', () => {
  const root = resolve(import.meta.dir, '../../..')
  const child = Bun.spawnSync([process.execPath, '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    const root = ${JSON.stringify(root)};
    const calls = [], streams = [];
    let fail = false;
    mock.module(root+'/src/ssh/SSHAuthProxy.ts', () => ({ createAuthProxy: async () => ({
      proxy: { stop() {} }, localAddress: '/tmp/fixture.sock', authEnv: {
        BGS_API_UNIX_SOCKET: '/tmp/fixture.sock', ANTHROPIC_AUTH_NONCE: 'secret-fixture-nonce',
      },
    }) }));
    mock.module(root+'/src/ssh/SSHProbe.ts', () => ({ probeRemote: async () => ({
      hasBinary: true, remoteVersion: 'fixture', binaryPath: '/usr/bin/true', defaultCwd: '/fixture', remotePlatform: 'linux', remoteArch: 'x64',
    }) }));
    mock.module(root+'/src/ssh/SSHSessionManager.ts', () => ({ SSHSessionManagerImpl: class {
      constructor(proc, options) { this.reconnect = options.reconnect }
    } }));
    mock.module(root+'/src/utils/cliLaunch.ts', () => ({ buildCliLaunch: args => ({ execPath: '/usr/bin/true', args, env: {} }) }));
    mock.module(root+'/src/utils/debug.ts', () => ({ logForDebugging() {} }));
    mock.module(root+'/src/utils/slowOperations.ts', () => ({ jsonParse: JSON.parse, jsonStringify: JSON.stringify }));
    Bun.spawn = args => {
      calls.push(args);
      let stdout, stderr;
      const failed = fail;
      const proc = {
        stdout: new ReadableStream({ start(c) { stdout = c } }),
        stderr: new ReadableStream({ start(c) { stderr = c } }),
        stdin: { write(bytes) {
          const request = JSON.parse(new TextDecoder().decode(bytes));
          if (failed) {
            stdout.close();
            setTimeout(() => {
              stderr.enqueue(new TextEncoder().encode('remote port forwarding failed: secret-fixture-'));
              stderr.enqueue(new TextEncoder().encode('nonce'));
              stderr.close();
            }, 5);
          } else {
            stdout.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id } })+'\\n'));
          }
          return bytes.length;
        }, flush() {} }, exited: new Promise(() => {}), kill() {},
      };
      streams.push({ stdout: () => stdout, stderr: () => stderr });
      return proc;
    };
    const { createSSHSession, createLocalSSHSession } = await import(root+'/src/ssh/createSSHSession.ts');
    for (const remote of [true, false]) {
      fail = false;
      const session = remote ? await createSSHSession({ host: 'fixture', localVersion: 'fixture', extraCliArgs: [] }) : await createLocalSSHSession({});
      const initialCall = calls.at(-1);
      const initialStream = streams.at(-1);
      const manager = session.createManager({});
      initialStream.stderr().enqueue(new TextEncoder().encode(Array.from({length:50}, (_,i) => 'line-'+i).join('\\n')+'\\n'));
      await Bun.sleep(10);
      assert.equal(session.getStderrTail(), Array.from({length:20},(_,i)=>'line-'+(i+30)).join('\\n')+'\\n');
      initialStream.stderr().enqueue(new TextEncoder().encode('界'.repeat(10000)));
      await Bun.sleep(10);
      assert.ok(Buffer.byteLength(session.getStderrTail(),'utf8') <= 16384);
      assert.ok(!session.getStderrTail().includes('�'));
      await manager.reconnect('original');
      const replacementCall = calls.at(-1);
      const replacementStream = streams.at(-1);
      if (remote) {
        const forward = args => args[args.indexOf('-R') + 1].split(':')[0];
        assert.notEqual(forward(initialCall), forward(replacementCall));
        assert.ok(replacementCall.at(-1).includes('BGS_API_UNIX_SOCKET='+JSON.stringify(forward(replacementCall)).replaceAll('"', "'")));
        assert.ok(replacementCall.at(-1).includes("'--resume' 'original'"));
      }
      initialStream.stderr().enqueue(new TextEncoder().encode('retired-process-error'));
      replacementStream.stderr().enqueue(new TextEncoder().encode('current-process-error'));
      await Bun.sleep(10);
      assert.equal(session.getStderrTail(), 'current-process-error');
      fail = true;
      await assert.rejects(manager.reconnect('original'), error => {
        assert.ok(error.message.includes('remote port forwarding failed'));
        assert.ok(error.message.includes('[redacted]'));
        assert.ok(!error.message.includes('secret-fixture-nonce'));
        return true;
      });
      assert.equal(session.getStderrTail(), 'remote port forwarding failed: [redacted]');
      initialStream.stderr().close(); replacementStream.stderr().close();
    }
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-3500))
  expect(child.exitCode).toBe(0)
})
