import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { getMacroDefines } from '../../../scripts/defines'

test('native npm metadata uses the user registry outside the project, and installation uses its own staging project', () => {
  const root = resolve(import.meta.dir, '../../..')
  const definitions = { ...getMacroDefines(), 'MACRO.NATIVE_PACKAGE_URL': JSON.stringify('@phantomlab/bgs-native') }
  const defines = Object.entries(definitions).flatMap(([key, value]) => ['--define', key + '=' + value])
  const child = Bun.spawnSync([process.execPath, ...defines, '-e', `
    import { mock } from 'bun:test'; import { strict as assert } from 'node:assert';
    import { homedir } from 'node:os';
    const root = ${JSON.stringify(root)}; const calls = [];
    mock.module(root+'/src/utils/execFileNoThrow.ts', () => ({
      execFileNoThrow() {}, execSyncWithDefaults_DEPRECATED() {},
      execFileNoThrowWithCwd: async (command, args, options) => {
        calls.push({ command, args, options });
        return { code: 0, stderr: '', stdout: args.includes('dist.integrity') ? 'sha512-fixture' : '2.8.4' };
      },
    }));
    const fileOps = await import(root+'/src/utils/fsOperations.ts');
    mock.module(root+'/src/utils/fsOperations.ts', () => ({ ...fileOps, getFsImplementation: () => ({ async rm() {}, async mkdir() {} }) }));
    const slow = await import(root+'/src/utils/slowOperations.ts');
    mock.module(root+'/src/utils/slowOperations.ts', () => ({ ...slow, writeFileSync_DEPRECATED() {} }));
    const { getLatestVersionFromArtifactory, downloadVersionFromArtifactory } = await import(root+'/src/utils/nativeInstaller/download.ts');
    assert.equal(await getLatestVersionFromArtifactory(), '2.8.4');
    await downloadVersionFromArtifactory('2.8.4', '/isolated/staging');
    for (const call of calls.filter(c => c.args[0] === 'view')) {
      assert.equal(call.options.cwd, homedir());
      assert.equal(call.args.includes('--registry'), false);
    }
    const install = calls.find(c => c.args[0] === 'ci');
    assert.equal(install.options.cwd, '/isolated/staging');
  `], { cwd: root, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' }, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-2500))
  expect(child.exitCode).toBe(0)
})
