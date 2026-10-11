import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { getMacroDefines } from '../../../scripts/defines'

test('unconfigured distribution makes no npm, lock or shell-alias changes', () => {
  const root = resolve(import.meta.dir, '../../..')
  const args = Object.entries(getMacroDefines()).flatMap(([key, value]) => ['--define', key + '=' + value])
  const child = Bun.spawnSync([process.execPath, ...args, '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    const fail = () => { throw new Error('Unexpected installation side effect'); };
    for (const [path, exports] of [
      ['src/utils/execFileNoThrow.ts', ['execFileNoThrowWithCwd']],
      ['src/utils/fsOperations.ts', ['getFsImplementation']],
      ['src/utils/shellConfig.ts', ['getShellConfigPaths', 'readFileLines', 'writeFileLines']],
    ]) {
      const name = ${JSON.stringify(root)} + '/' + path;
      const original = await import(name);
      mock.module(name, () => ({ ...original, ...Object.fromEntries(exports.map(key => [key, fail])) }));
    }
    const updater = await import(${JSON.stringify(resolve(root, 'src/utils/autoUpdater.ts'))});
    const axios = (await import('axios')).default;
    axios.get = fail;
    process.env.USER_TYPE = 'ant';
    assert.equal(await updater.getLatestVersion(), null);
    assert.deepEqual(await updater.getNpmDistTags(), { latest: null, stable: null });
    assert.deepEqual(await updater.getVersionHistory(5), []);
    assert.equal(await updater.installGlobalPackage('1.2.3'), 'install_failed');
    assert.equal(await updater.getLatestVersionFromGcs('latest'), null);
    assert.deepEqual(await updater.getGcsDistTags(), { latest: null, stable: null });
    const native = await import(${JSON.stringify(resolve(root, 'src/utils/nativeInstaller/installer.ts'))});
    const downloads = await import(${JSON.stringify(resolve(root, 'src/utils/nativeInstaller/download.ts'))});
    assert.equal(native.getBinaryName('darwin-arm64'), 'bee-game-studio');
    assert.equal(native.getBinaryName('win32-x64'), 'bee-game-studio.exe');
    await assert.rejects(() => native.installLatest('latest'), /not configured/);
    await assert.rejects(() => downloads.getLatestVersion('latest'), /not configured/);
    await assert.rejects(() => downloads.downloadVersion('1.2.3', '/must-not-write'), /not configured/);
    await assert.rejects(() => downloads.downloadVersionFromArtifactory('1.2.3', '/must-not-write'), /not configured/);
    assert.deepEqual(await native.cleanupNpmInstallations(), { removed: 0, errors: [], warnings: [] });
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-2500))
  expect(child.exitCode).toBe(0)
})
