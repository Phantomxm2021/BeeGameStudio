import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test.each(['api-key', 'oauth'])('proxy handler replaces placeholders with matching local credentials using a simulated Unix listener (%s)', mode => {
  if (process.platform === 'win32') return
  const root = resolve(import.meta.dir, '../../..')
  const child = Bun.spawnSync([process.execPath, '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    import { statSync, existsSync, writeFileSync } from 'node:fs';
    process.env.ANTHROPIC_BASE_URL = 'https://fixture.invalid';
    if (${JSON.stringify(mode)} === 'api-key') process.env.ANTHROPIC_API_KEY = 'local-key';
    else delete process.env.ANTHROPIC_API_KEY;
    mock.module(${JSON.stringify(resolve(root, 'src/utils/auth.ts'))}, () => ({
      getClaudeAIOAuthTokens: () => ({ accessToken: 'local-oauth' }),
    }));
    mock.module(${JSON.stringify(resolve(root, 'src/constants/oauth.ts'))}, () => ({
      getOauthConfig: () => ({ BASE_API_URL: 'https://fixture.invalid' }),
    }));
    mock.module(${JSON.stringify(resolve(root, 'src/utils/debug.ts'))}, () => ({ logForDebugging: () => {} }));
    // No real server/network is needed to verify auth forwarding. The
    // listener boundary is simulated; chmod/unlink still use actual files.
    let handler;
    const actualServe = Bun.serve;
    Bun.serve = options => {
      handler = options.fetch;
      writeFileSync(options.unix, '');
      return { stop() {} };
    };
    const actualFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://fixture.invalid/v1/messages');
      captured = options.headers;
      return new Response('proxy-ok');
    };
    const { createAuthProxy } = await import(${JSON.stringify(resolve(root, 'src/ssh/SSHAuthProxy.ts'))});
    const info = await createAuthProxy();
    try {
      assert.equal(info.authEnv.BGS_API_UNIX_SOCKET, info.localAddress);
      const keyMode = ${JSON.stringify(mode)} === 'api-key';
      assert.equal(info.authEnv[keyMode ? 'ANTHROPIC_API_KEY' : 'CLAUDE_CODE_OAUTH_TOKEN'], 'ssh-proxy');
      assert.equal(info.authEnv[keyMode ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'], undefined);
      assert.equal(statSync(info.localAddress).mode & 0o777, 0o600);
      const response = await handler(new Request('http://localhost/v1/messages', {
        headers: { 'authorization': 'Bearer remote-placeholder', 'x-api-key': 'remote-placeholder' },
      }));
      assert.equal(await response.text(), 'proxy-ok');
      assert.equal(captured.get('authorization'), keyMode ? null : 'Bearer local-oauth');
      assert.equal(captured.get('x-api-key'), keyMode ? 'local-key' : null);
    } finally {
      info.proxy.stop();
      globalThis.fetch = actualFetch;
      Bun.serve = actualServe;
    }
    assert.equal(existsSync(info.localAddress), false);
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-2500))
  expect(child.exitCode).toBe(0)
})
