import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test.each(['', 'bee-game-studio'])('rollback only uses the configured product distribution %j', packageName => {
  const root = resolve(import.meta.dir, '../..')
  const child = Bun.spawnSync([process.execPath, '--define', 'MACRO.PACKAGE_URL=' + JSON.stringify(packageName), '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    let called;
    mock.module(${JSON.stringify(resolve(root, 'src/utils/autoUpdater.ts'))}, () => ({
      installGlobalPackage: async version => { called = version; return 'success'; },
    }));
    const { rollback } = await import(${JSON.stringify(resolve(root, 'src/cli/rollback.ts'))});
    await rollback('1.2.3');
    assert.equal(called, ${packageName ? "'1.2.3'" : "undefined"});
    assert.equal(process.exitCode ?? 0, ${packageName ? "0" : "1"});
    process.exitCode = 0;
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-2000))
  expect(child.exitCode).toBe(0)
})

test.each(['safe', 'list'])('unsupported rollback %s does not report success', async option => {
  const { rollback } = await import('./rollback')
  const previous = process.exitCode
  try {
    process.exitCode = 0
    await rollback(undefined, { [option]: true })
    expect(process.exitCode).toBe(1)
  } finally { process.exitCode = previous }
})
