import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { getMacroDefines } from '../../../scripts/defines'

test('native cleanup preserves unrelated vendor files, regular files and foreign symlinks', () => {
  const root = resolve(import.meta.dir, '../../..')
  const defines = Object.entries(getMacroDefines()).flatMap(([key, value]) => ['--define', key + '=' + value])
  const child = Bun.spawnSync([process.execPath, ...defines, '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    import { mkdtemp, mkdir, writeFile, symlink, readFile, lstat, rm } from 'node:fs/promises';
    import { join } from 'node:path';
    const fixture = await mkdtemp('/private/tmp/bgs-native-owner-');
    mock.module(${JSON.stringify(resolve(root, 'src/utils/xdg.ts'))}, () => ({
      getXDGDataHome: () => join(fixture, 'data'), getXDGCacheHome: () => join(fixture, 'cache'),
      getXDGStateHome: () => join(fixture, 'state'), getUserBinDir: () => join(fixture, 'bin'),
    }));
    const native = await import(${JSON.stringify(resolve(root, 'src/utils/nativeInstaller/installer.ts'))});
    try {
      assert.equal(native.getNativePackageBinaryPath('/staging', '@phantomlab/bgs-native', 'linux-x64'), '/staging/node_modules/@phantomlab/bgs-native-linux-x64/cli');
      assert.equal(native.getNativePackageBinaryPath('/staging', 'bgs-native', 'darwin-arm64'), '/staging/node_modules/bgs-native-darwin-arm64/cli');
      assert.throws(() => native.getNativePackageBinaryPath('/staging', '', 'linux-x64'), /not configured/);
      await mkdir(join(fixture, 'bin'), { recursive: true });
      const vendor = join(fixture, 'bin/claude');
      const binary = join(fixture, 'bin/bee-game-studio');
      await writeFile(vendor, 'vendor-owned');
      await symlink(vendor, binary);
      await native.removeInstalledSymlink();
      assert.equal((await lstat(binary)).isSymbolicLink(), true);
      await rm(binary);
      await writeFile(binary, 'user-owned regular file');
      await native.removeInstalledSymlink();
      assert.equal(await readFile(binary, 'utf8'), 'user-owned regular file');
      await rm(binary);
      const versions = join(fixture, 'data/bee-game-studio/versions');
      await mkdir(versions, { recursive: true });
      const owned = join(versions, '1.2.3');
      await writeFile(owned, 'owned');
      await symlink(owned, binary);
      await native.removeInstalledSymlink();
      await assert.rejects(() => lstat(binary), { code: 'ENOENT' });
      assert.equal(await readFile(vendor, 'utf8'), 'vendor-owned');
    } finally { await rm(fixture, { recursive: true, force: true }); }
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-2500))
  expect(child.exitCode).toBe(0)
})
