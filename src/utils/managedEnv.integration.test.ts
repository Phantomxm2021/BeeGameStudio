import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('pre-trust filtering preserves trusted routing and host-owned SDK credentials', () => {
  const path = (file: string) => JSON.stringify(resolve(import.meta.dir, file))
  const result = Bun.spawnSync([process.execPath, '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    const trusted = { OPENAI_BASE_URL: 'https://trusted.fixture.invalid' };
    const project = { OPENAI_BASE_URL: 'https://untrusted.fixture.invalid',
      OPENAI_API_KEY: 'project-key', XAI_API_KEY: 'project-xai',
      AWS_REGION: 'project-region', AWS_SECRET_ACCESS_KEY: 'project-aws',
      GOOGLE_APPLICATION_CREDENTIALS: '/project/credential',
      BGS_API_UNIX_SOCKET: '/project/socket',
      CLAUDE_CODE_CLIENT_CERT: '/project/cert',
      CLAUDE_CODE_CLIENT_KEY: '/project/key',
      CLAUDE_CODE_CLIENT_KEY_PASSPHRASE: 'project-passphrase',
      NODE_TLS_REJECT_UNAUTHORIZED: '0', NODE_EXTRA_CA_CERTS: '/project/ca' };
    for (const [file, overrides] of [
      [${path('config.ts')}, { getGlobalConfig: () => ({}) }],
      [${path('settings/settings.ts')}, {
        getSettingsForSource: source => source === 'userSettings' ? { env: trusted } : {},
        getSettings_DEPRECATED: () => ({ env: project }),
      }],
      [${path('settings/constants.ts')}, { isSettingSourceEnabled: () => true }],
      [${path('../services/remoteManagedSettings/syncCache.ts')}, { isRemoteManagedSettingsEligible: () => false }],
    ]) {
      const original = await import(file);
      mock.module(file, () => ({ ...original, ...overrides }));
    }
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST;
    delete process.env.BGS_PROVIDER_MANAGED_BY_HOST;
    delete process.env.BGS_API_UNIX_SOCKET;
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
    for (const key of Object.keys(project)) delete process.env[key];
    const { applySafeConfigEnvironmentVariables, applyConfigEnvironmentVariables } = await import(${path('managedEnv.ts')});
    applySafeConfigEnvironmentVariables();
    assert.equal(process.env.OPENAI_BASE_URL, trusted.OPENAI_BASE_URL);
    for (const key of Object.keys(project).filter(k => k !== 'OPENAI_BASE_URL')) assert.equal(process.env[key], undefined);
    process.env.BGS_PROVIDER_MANAGED_BY_HOST = '1';
    process.env.AWS_REGION = 'host-region';
    process.env.AWS_SECRET_ACCESS_KEY = 'host-aws';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/host/credential';
    for (const key of ['CLAUDE_CODE_CLIENT_CERT','CLAUDE_CODE_CLIENT_KEY',
      'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS']) {
      process.env[key] = 'host-' + key;
    }
    applyConfigEnvironmentVariables();
    assert.equal(process.env.OPENAI_BASE_URL, trusted.OPENAI_BASE_URL);
    assert.equal(process.env.AWS_REGION, 'host-region');
    assert.equal(process.env.AWS_SECRET_ACCESS_KEY, 'host-aws');
    assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, '/host/credential');
    assert.equal(process.env.BGS_API_UNIX_SOCKET, undefined);
    for (const key of ['CLAUDE_CODE_CLIENT_CERT','CLAUDE_CODE_CLIENT_KEY',
      'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS']) {
      assert.equal(process.env[key], 'host-' + key);
    }
    delete process.env.BGS_PROVIDER_MANAGED_BY_HOST;
    applyConfigEnvironmentVariables();
    assert.equal(process.env.OPENAI_BASE_URL, project.OPENAI_BASE_URL);
    delete process.env.BGS_API_UNIX_SOCKET;
    process.env.ANTHROPIC_AUTH_NONCE = 'host-nonce';
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1234';
    process.env.ANTHROPIC_API_KEY = 'ssh-proxy';
    project.ANTHROPIC_BASE_URL = 'https://remote-settings.invalid';
    project.ANTHROPIC_API_KEY = 'remote-key';
    project.ANTHROPIC_AUTH_NONCE = 'remote-nonce';
    applyConfigEnvironmentVariables();
    assert.equal(process.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:1234');
    assert.equal(process.env.ANTHROPIC_API_KEY, 'ssh-proxy');
    assert.equal(process.env.ANTHROPIC_AUTH_NONCE, 'host-nonce');
  `], { env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' }, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().slice(-2000))
  expect(result.exitCode).toBe(0)
})
