import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('native Git removes a clean registered worktree but preserves a dirty worktree and its team record', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bgs-worktree-cleanup-'))
  try {
    const result = Bun.spawnSync([process.execPath, '-e', `
      import { strict as assert } from 'node:assert';
      import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
      import { join } from 'node:path';
      const root = ${JSON.stringify(directory)};
      const repo = join(root, 'repo'), worktree = join(root, 'worker');
      const run = args => {
        const r = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
        if (r.exitCode !== 0) throw new Error(r.stderr.toString());
      };
      mkdirSync(repo);
      run(['init', repo]);
      writeFileSync(join(repo, 'fixture.txt'), 'original');
      run(['-C', repo, 'add', 'fixture.txt']);
      run(['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
      run(['-C', repo, 'worktree', 'add', '-b', 'fixture', worktree]);
      const config = join(process.env.BEEGAME_CONFIG_DIR, 'teams', 'fixture', 'config.json');
      mkdirSync(join(process.env.BEEGAME_CONFIG_DIR, 'teams', 'fixture'), { recursive: true });
      writeFileSync(config, JSON.stringify({ members: [{ worktreePath: worktree }] }));
      const { cleanupTeamDirectories } = await import(${JSON.stringify(resolve(import.meta.dir, '../teamHelpers.ts'))});
      writeFileSync(join(worktree, 'fixture.txt'), 'uncommitted');
      await assert.rejects(cleanupTeamDirectories('fixture'), /Git could not remove/);
      assert(existsSync(worktree));
      assert(existsSync(config));
      writeFileSync(join(worktree, 'fixture.txt'), 'original');
      await cleanupTeamDirectories('fixture');
      assert(!existsSync(worktree));
      assert(!existsSync(config));
      assert(existsSync(join(repo, 'fixture.txt')));
    `], { env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', BEEGAME_CONFIG_DIR: join(directory, 'config') },
      stdout: 'pipe', stderr: 'pipe' })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString().slice(-2500))
    expect(result.exitCode).toBe(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('team cleanup refuses unverified worktrees and retains retry ownership after any failure', () => {
  const modulePath = (path: string) => JSON.stringify(resolve(import.meta.dir, path))
  const result = Bun.spawnSync([process.execPath, '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    const fs = await import('fs');
    const fsp = await import('fs/promises');
    const marker = 'gitdir: /synthetic/repo/.git/worktrees/fixture';
    let markerReadable = false, gitCode = 1, rmFails = false, missingWorktree = false, configReadable = true;
    const removals = [], gitCalls = [];
    const config = '/synthetic-audit/teams/fixture/config.json';
    mock.module('fs', () => ({ ...fs,
      readFileSync: (path, ...args) => path === config
        ? JSON.stringify({ members: [{ worktreePath: '/synthetic/worktree' }] })
        : fs.readFileSync(path, ...args),
    }));
    mock.module('fs/promises', () => ({ ...fsp,
      lstat: async () => { if (missingWorktree) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return {}; },
      readFile: async path => {
        if (path === config) {
          if (!configReadable) throw Object.assign(new Error('unreadable config'), { code: 'EACCES' });
          return JSON.stringify({ members: [{ worktreePath: '/synthetic/worktree' }] });
        }
        if (!markerReadable) throw Object.assign(new Error('missing marker'), { code: 'ENOENT' });
        return marker;
      },
      rm: async path => { removals.push(path); if (rmFails) throw new Error('synthetic rm failure'); },
    }));
    const execution = await import(${modulePath('../../execFileNoThrow.ts')});
    mock.module(${modulePath('../../execFileNoThrow.ts')}, () => ({ ...execution,
      execFileNoThrowWithCwd: async (command, args) => {
        gitCalls.push(args);
        return { code: gitCode, stdout: '', stderr: 'not a working tree' };
      },
    }));
    const debug = await import(${modulePath('../../debug.ts')});
    mock.module(${modulePath('../../debug.ts')}, () => ({ ...debug, logForDebugging: () => {} }));
    const { cleanupTeamDirectories, cleanupSessionTeams, registerTeamForSessionCleanup } = await import(${modulePath('../teamHelpers.ts')});
    const { getSessionCreatedTeams } = await import(${modulePath('../../../bootstrap/state.ts')});
    await assert.rejects(cleanupTeamDirectories('fixture'), /Cannot verify/);
    assert.equal(removals.length, 0);
    markerReadable = true;
    await assert.rejects(cleanupTeamDirectories('fixture'), /Git could not remove/);
    assert.equal(removals.length, 0);
    assert(!gitCalls[0].includes('--force'));
    configReadable = false;
    await assert.rejects(cleanupTeamDirectories('fixture'), /Cannot read team cleanup metadata/);
    assert.equal(removals.length, 0);
    configReadable = true;
    gitCode = 0;
    rmFails = true;
    registerTeamForSessionCleanup('fixture');
    await assert.rejects(cleanupSessionTeams(), /synthetic rm failure/);
    assert(getSessionCreatedTeams().has('fixture'));
    assert(!removals.includes(config.replace('/config.json', '')));
    rmFails = false;
    missingWorktree = true; // Previously removed worktree must not block a retry.
    await cleanupSessionTeams();
    assert(!getSessionCreatedTeams().has('fixture'));
    assert(removals.at(-1).endsWith('/teams/fixture'));
    assert(!removals.includes('/synthetic/worktree'));
  `], { env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', BEEGAME_CONFIG_DIR: '/synthetic-audit' },
    stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().slice(-2500))
  expect(result.exitCode).toBe(0)
})
