import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('registry close uses the owning executor and clears its private environment file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bgs-pane-routing-test-'))
  const registry = resolve(import.meta.dir, '../registry.ts')
  const detection = resolve(import.meta.dir, '../detection.ts')
  try {
    const result = Bun.spawnSync([process.execPath, '-e', `
      import { mock } from 'bun:test';
      import { strict as assert } from 'node:assert';
      import { existsSync } from 'node:fs';
      const detection = await import(${JSON.stringify(detection)});
      mock.module(${JSON.stringify(detection)}, () => ({ ...detection,
        isInsideTmux: async () => true, isInsideTmuxSync: () => true,
        isInITerm2: () => false, isInWindowsTerminal: () => false,
      }));
      const r = await import(${JSON.stringify(registry)});
      await r.ensureBackendsRegistered();
      let sent = '', kills = 0;
      class FakeBackend {
        type = 'tmux'; displayName = 'fixture'; supportsHideShow = true;
        async createTeammatePaneInSwarmView() { return { paneId: '%fixture', isFirstTeammate: false } }
        async sendCommandToPane(id, command) { sent = command }
        async killPane() { kills++; return true }
      }
      r.registerTmuxBackend(FakeBackend);
      const executor = await r.getTeammateExecutor();
      const backend = r.getCachedBackend();
      assert.equal(r.getBackendByType('tmux'), backend);
      executor.setContext({ getAppState: () => ({ toolPermissionContext: { mode: 'default' } }) });
      const spawned = await executor.spawn({ name: 'fixture', teamName: 'alpha', prompt: 'synthetic', cwd: ${JSON.stringify(directory)} });
      assert.equal(spawned.success, true);
      const path = sent.match(/environment\\.sh/) && sent.split(' && . ')[1].split(' && env ')[0];
      assert(path && existsSync(path));
      assert(await r.closeTeammatePane('tmux', spawned.paneId, false));
      assert.equal(kills, 1);
      assert.equal(await executor.isActive(spawned.agentId), false);
      assert.equal(existsSync(path), false);
    `], {
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', BEEGAME_CONFIG_DIR: directory, BGS_USE_OPENAI: '1', OPENAI_API_KEY: 'synthetic-key' },
      stdout: 'pipe', stderr: 'pipe',
    })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString().slice(-2500))
    expect(result.exitCode).toBe(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('shutdown consumers route pane closes through their cleanup owner', async () => {
  for (const path of [
    '../../../../hooks/useInboxPoller.ts', '../../../../components/teams/TeamsDialog.tsx',
    '../../teamHelpers.ts', '../../../../cli/print.ts',
  ]) {
    const source = await Bun.file(resolve(import.meta.dir, path)).text()
    expect(source.includes('closeTeammatePane(')).toBe(true)
    expect(/getBackendByType\([^)]*\)\.killPane/.test(source)).toBe(false)
  }
})

test('tmux and iTerm only acknowledge an already-exited pane when listing succeeds', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bgs-pane-close-test-'))
  const execution = resolve(import.meta.dir, '../../../execFileNoThrow.ts')
  const tmux = resolve(import.meta.dir, '../TmuxBackend.ts')
  const iterm = resolve(import.meta.dir, '../ITermBackend.ts')
  try {
    const result = Bun.spawnSync([process.execPath, '-e', `
      import { mock } from 'bun:test';
      import { strict as assert } from 'node:assert';
      const execution = await import(${JSON.stringify(execution)});
      let killCode = 0, listCode = 0, listed = '', lists = 0;
      mock.module(${JSON.stringify(execution)}, () => ({ ...execution,
        execFileNoThrow: async (command, args) => {
          const listing = args.includes('list-panes') || args.includes('list');
          if (listing) lists++;
          return { code: listing ? listCode : killCode, stdout: listing ? listed : '', stderr: '' };
        },
      }));
      const { TmuxBackend } = await import(${JSON.stringify(tmux)});
      const { ITermBackend } = await import(${JSON.stringify(iterm)});
      for (const backend of [new TmuxBackend(), new ITermBackend()]) {
        killCode = 0; lists = 0;
        assert(await backend.killPane('fixture'));
        assert.equal(lists, 0);
        killCode = 1; listCode = 0; listed = 'fixture\\n';
        assert.equal(await backend.killPane('fixture'), false);
        listed = 'other\\n';
        assert.equal(await backend.killPane('fixture'), true);
        listCode = 1;
        assert.equal(await backend.killPane('fixture'), false);
      }
    `], {
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', BEEGAME_CONFIG_DIR: directory },
      stdout: 'pipe', stderr: 'pipe',
    })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString().slice(-2500))
    expect(result.exitCode).toBe(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
