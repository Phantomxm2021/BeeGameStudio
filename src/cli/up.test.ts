import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test.each(['bee-game-studio', 'BGS', 'claude'])('up recognizes %s headings while retaining legacy input', name => {
  const root = resolve(import.meta.dir, '../..')
  const child = Bun.spawnSync([process.execPath, '-e', `
    import { mock } from 'bun:test'; import { strict as assert } from 'node:assert';
    import { mkdtemp, writeFile, rm } from 'node:fs/promises'; import { join } from 'node:path';
    const fixture = await mkdtemp('/private/tmp/bgs-up-command-');
    mock.module(${JSON.stringify(resolve(root, 'src/utils/git.ts'))}, () => ({ findGitRoot: () => null }));
    try {
      await writeFile(join(fixture, 'CLAUDE.md'), ${JSON.stringify('# '+name+' up\n```bash\nprintf BGS_UP_FIXTURE\n```\n')});
      process.chdir(fixture);
      const { up } = await import(${JSON.stringify(resolve(root, 'src/cli/up.ts'))}); await up();
      assert.equal(process.exitCode ?? 0, 0);
    } finally { process.chdir(${JSON.stringify(root)}); await rm(fixture, { recursive: true, force: true }); }
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-2000))
  expect(child.exitCode).toBe(0)
  expect(child.stdout.toString()).toContain('BGS_UP_FIXTURE')
  expect(child.stdout.toString()).toContain('bee-game-studio up completed successfully')
})
