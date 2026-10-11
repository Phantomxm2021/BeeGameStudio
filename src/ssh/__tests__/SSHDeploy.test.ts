import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile, cp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { findLocalBuildDirectory } from '../SSHDeploy'

test('deployable selection includes all files in the active build, not the stable wrapper or old versions', async () => {
  const root = await mkdtemp('/private/tmp/bgs-ssh-deploy-')
  try {
    const dist = join(root, 'dist')
    const generation = join(dist, 'build-current')
    await mkdir(generation, { recursive: true })
    await writeFile(join(dist, 'cli-bun.js'), '#!/usr/bin/env bun\nimport "./cli.js"\n')
    await writeFile(join(dist, 'cli.js'), 'import "./build-current/cli.js"\n')
    await writeFile(join(generation, 'cli-bun.js'), '#!/usr/bin/env bun\nimport "./cli.js"\n')
    await writeFile(join(generation, 'cli.js'), 'import "./chunk.js"\n')
    await writeFile(join(generation, 'chunk.js'), 'console.log("relocated-build-ok")\n')
    expect(findLocalBuildDirectory(root)).toBe(generation)
    expect(findLocalBuildDirectory(generation)).toBe(generation)
    const remote = join(root, 'remote')
    await cp(findLocalBuildDirectory(root), remote, { recursive: true })
    const child = Bun.spawn([process.execPath, join(remote, 'cli-bun.js'), '--version'], { stdout: 'pipe', stderr: 'pipe' })
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toContain('relocated-build-ok')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('remote search validation happens before wrapper publication, and failure preserves the wrapper', () => {
  const repository = resolve(import.meta.dir, '../../..')
  const child = Bun.spawnSync([process.execPath, '-e', `
    import { mock } from 'bun:test'; import { strict as assert } from 'node:assert';
    import { mkdtemp, writeFile, rm } from 'node:fs/promises'; import { join } from 'node:path';
    const fixture = await mkdtemp('/private/tmp/bgs-remote-tools-');
    await writeFile(join(fixture, 'cli.js'), ''); await writeFile(join(fixture, 'cli-bun.js'), '');
    mock.module(${JSON.stringify(resolve(repository, 'src/utils/distRoot.ts'))}, () => ({ distRoot: fixture }));
    mock.module(${JSON.stringify(resolve(repository, 'src/utils/debug.ts'))}, () => ({ logForDebugging() {} }));
    const calls = []; const actual = Bun.spawn;
    Bun.spawn = args => { calls.push(args); const fail = String(args.at(-1)).includes('postinstall.cjs --required');
      return { stdout: new ReadableStream({ start(c) { c.close() } }), stderr: new ReadableStream({ start(c) { c.close() } }), exited: Promise.resolve(fail ? 1 : 0), kill() {} }; };
    try {
      const { deployBinary } = await import(${JSON.stringify(resolve(repository, 'src/ssh/SSHDeploy.ts'))});
      await assert.rejects(() => deployBinary({ host: 'fixture', remotePlatform: 'linux', remoteArch: 'x64', localVersion: 'fixture' }), /ripgrep.*wrapper preserved/);
      assert.equal(calls.some(args => String(args.at(-1)).includes('rg --version')), true);
      assert.equal(calls.some(args => String(args.at(-1)).includes('cat >')), false);
    } finally { Bun.spawn = actual; await rm(fixture, { recursive: true, force: true }); }
  `], { cwd: repository, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-2500))
  expect(child.exitCode).toBe(0)
})

test('wrapper startup failure preserves the old executable, and success publishes the complete wrapper', () => {
  const repository = resolve(import.meta.dir, '../../..')
  const child = Bun.spawnSync([process.execPath, '-e', `
    import { mock } from 'bun:test'; import { strict as assert } from 'node:assert';
    import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'; import { join } from 'node:path';
    const fixture = await mkdtemp('/private/tmp/bgs-wrapper-publish-');
    const bin = join(fixture, 'bin'); await mkdir(bin);
    await writeFile(join(fixture, 'cli.js'), ''); await writeFile(join(fixture, 'cli-bun.js'), '');
    await writeFile(join(bin, 'bee-game-studio'), 'original executable');
    await writeFile(join(bin, 'bun'), '#!/bin/sh\\n[ ! -e "'+join(fixture, 'fail')+'" ] || exit 1\\nprintf "fixture-version\\\\n"\\n', { mode: 0o755 });
    mock.module(${JSON.stringify(resolve(repository, 'src/utils/distRoot.ts'))}, () => ({ distRoot: fixture }));
    mock.module(${JSON.stringify(resolve(repository, 'src/utils/debug.ts'))}, () => ({ logForDebugging() {} }));
    const actual = Bun.spawn; let wrapper;
    Bun.spawn = args => {
      const command = String(args.at(-1)); if (command.includes('cat >')) wrapper = command;
      return { stdout: new ReadableStream({ start(c) { c.close() } }), stderr: new ReadableStream({ start(c) { c.close() } }), exited: Promise.resolve(0), kill() {} };
    };
    try {
      const { deployBinary } = await import(${JSON.stringify(resolve(repository, 'src/ssh/SSHDeploy.ts'))});
      await deployBinary({ host: 'fixture', remotePlatform: 'linux', remoteArch: 'x64', localVersion: 'fixture' });
      assert.ok(wrapper);
    } finally { Bun.spawn = actual; }
    try {
      const localScript = wrapper.replaceAll('~/.local/bin', bin).replaceAll('$HOME/.local/share/bee-game-studio', join(fixture, 'builds'));
      await writeFile(join(fixture, 'fail'), '');
      const run = () => Bun.spawnSync(['sh', '-c', localScript], { env: { ...process.env, PATH: bin+':'+process.env.PATH }, stdout: 'pipe', stderr: 'pipe' });
      assert.notEqual(run().exitCode, 0);
      assert.equal(await readFile(join(bin, 'bee-game-studio'), 'utf8'), 'original executable');
      assert.equal((await readdir(bin)).some(name => name.startsWith('.bee-game-studio-')), false);
      await rm(join(fixture, 'fail'));
      assert.equal(run().exitCode, 0);
      assert.match(await readFile(join(bin, 'bee-game-studio'), 'utf8'), /^#!\\/bin\\/sh\\nexec bun /);
      assert.equal((await readdir(bin)).some(name => name.startsWith('.bee-game-studio-')), false);
    } finally { await rm(fixture, { recursive: true, force: true }); }
  `], { cwd: repository, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-2500))
  expect(child.exitCode).toBe(0)
})
