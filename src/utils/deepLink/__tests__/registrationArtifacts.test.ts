import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { getMacroDefines } from '../../../../scripts/defines'

test('deep-link artifact checks reject damaged applets and escape Linux Exec paths', () => {
  const root = resolve(import.meta.dir, '../../../..')
  const defines = Object.entries(getMacroDefines()).flatMap(([key, value]) => ['--define', key + '=' + value])
  const child = Bun.spawnSync([process.execPath, ...defines, '-e', `
    import { mock } from 'bun:test'; import { strict as assert } from 'node:assert';
    import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
    import { join } from 'node:path';
    const fixture = await mkdtemp('/private/tmp/bgs-registration-artifact-');
    const os = await import('node:os'); mock.module('os', () => ({ ...os, homedir: () => fixture }));
    const { isProtocolHandlerCurrent, linuxExecLine, MACOS_BUNDLE_ID } = await import(${JSON.stringify(resolve(root, 'src/utils/deepLink/registerProtocol.ts'))});
    try {
      assert.equal(linuxExecLine('/tmp/plain/bgs'), 'Exec="/tmp/plain/bgs" --handle-uri %u');
      assert.equal(linuxExecLine('/tmp/a"b%/bgs'), 'Exec="/tmp/a' + '\\\\'.repeat(2) + '"b%%/bgs" --handle-uri %u');
      assert.throws(() => linuxExecLine('/tmp/bgs\\nExec=evil'), /Invalid/);
      if (process.platform === 'darwin') {
        const contents = join(fixture, 'Applications/BGS URL Handler.app/Contents');
        await mkdir(join(contents, 'Resources/Scripts'), { recursive: true });
        await mkdir(join(contents, 'MacOS'), { recursive: true });
        await writeFile(join(contents, 'Resources/bgs-cli-path'), '/bin/bgs');
        assert.equal(await isProtocolHandlerCurrent('/bin/bgs'), false);
        await writeFile(join(contents, 'Info.plist'), '<plist>'+MACOS_BUNDLE_ID+' claude-cli</plist>');
        await writeFile(join(contents, 'MacOS/applet'), 'fixture executable');
        await chmod(join(contents, 'MacOS/applet'), 0o755);
        await writeFile(join(contents, 'Resources/Scripts/main.scpt'), 'fixture script');
        assert.equal(await isProtocolHandlerCurrent('/bin/bgs'), true);
        await rm(join(contents, 'MacOS/applet'));
        assert.equal(await isProtocolHandlerCurrent('/bin/bgs'), false);
      }
    } finally { await rm(fixture, { recursive: true, force: true }); }
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-2500))
  expect(child.exitCode).toBe(0)
})
