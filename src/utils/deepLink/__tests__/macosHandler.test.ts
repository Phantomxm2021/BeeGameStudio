import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { getMacroDefines } from '../../../../scripts/defines'

// AppleScript standard additions are unavailable in filesystem-only sandboxes.
// Run explicitly on a desktop host: BGS_TEST_MACOS_SCRIPTING=1 bun test <this file>.
test.skipIf(process.platform !== 'darwin' || process.env.BGS_TEST_MACOS_SCRIPTING !== '1')('macOS handler compiles and forwards a URL literally, without OS registration', () => {
  const root = resolve(import.meta.dir, '../../../..')
  const defines = Object.entries(getMacroDefines()).flatMap(([key, value]) => ['--define', key + '=' + value])
  const child = Bun.spawnSync([process.execPath, ...defines, '-e', `
    import { strict as assert } from 'node:assert';
    import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
    import { join } from 'node:path';
    const { macosUrlHandlerScript, MACOS_PLIST_EDITS } = await import(${JSON.stringify(resolve(root, 'src/utils/deepLink/registerProtocol.ts'))});
    const fixture = await mkdtemp('/private/tmp/bgs-url-event-');
    const run = args => { const p = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' }); assert.equal(p.exitCode, 0, JSON.stringify(args)+'\\n'+p.stderr.toString()); return p.stdout.toString(); };
    try {
      const executable = join(fixture, "bgs ' quoted CLI");
      await writeFile(executable, '#!/usr/bin/env node\\nprocess.stdout.write(process.argv.slice(2).join("\\\\n"));\\n');
      await chmod(executable, 0o755);
      const script = macosUrlHandlerScript(executable);
      const app = join(fixture, 'Handler.app');
      run(['/usr/bin/osacompile', '-o', app, '-e', script]);
      const plist = join(app, 'Contents/Info.plist');
      for (const edit of MACOS_PLIST_EDITS) run(['/usr/libexec/PlistBuddy', '-c', edit, plist]);
      assert.equal(run(['/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0', plist]).trim(), 'claude-cli');
      const url = "claude-cli://open?q=hello%20world&raw=';echo%20NO;#";
      const appleQuotedUrl = url.replaceAll('\\\\', '\\\\\\\\').replaceAll('"', '\\\\"');
      const forwarded = run(['/usr/bin/osascript', '-e', script, '-e', 'open location "'+appleQuotedUrl+'"']);
      assert.deepEqual(forwarded.trim().split(/\\r\\n|\\r|\\n/), ['--handle-uri', url]);
      assert.throws(() => macosUrlHandlerScript('/invalid\\npath'), /Invalid/);
    } finally { await rm(fixture, { recursive: true, force: true }); }
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-2500))
  expect(child.exitCode).toBe(0)
}, 20_000)
