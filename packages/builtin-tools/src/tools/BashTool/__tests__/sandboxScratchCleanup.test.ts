import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pinSandboxScratchCleanup } from '../sandboxScratchCleanup'

let root: string
let scratch: string
beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'bgs-scratch-cleanup-')))
  scratch = join(root, '.beegame/tmp/session')
  await mkdir(scratch, { recursive: true })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

test.each([
  'rm -f "$TMPDIR/check_atlas.py" "$TMPDIR/check_wav.py"; echo cleaned',
  'echo 清理 && rm -rf "$TMPDIR/projcopy/.beegame-delivery-tmp" && echo done',
  'SRC="/project" && rm -rf "$TMPDIR/projcopy" && mkdir -p "$TMPDIR/projcopy"',
])('pins only cleanup arguments, preserving compound command semantics: %s', command => {
  const pinned = pinSandboxScratchCleanup(command, root, scratch)
  expect(pinned).toBeDefined()
  expect(pinned).toContain(`'${scratch}/`)
  if (command.includes('mkdir')) expect(pinned).toContain('mkdir -p "$TMPDIR/projcopy"')
})

test.each([
  'rm -rf "$TMPDIR"', 'rm -rf "$TMPDIR/.."', 'rm -rf "$TMPDIR/a/../../docs"',
  'rm -rf "$TMPDIR/$(pwd)"', 'rm -rf "$TMPDIR/${TARGET}"', 'rm -rf "$TMPDIR/*"',
  'TMPDIR=/; rm -rf "$TMPDIR/docs"', 'unset TMPDIR; rm -rf "$TMPDIR/docs"',
  '. ./environment; rm -rf "$TMPDIR/file"',
  'rm -rf "$T/entry.ts"', 'for x in a; do rm -rf "$TMPDIR/file"; done',
  'echo \'rm -rf "$TMPDIR/file"\'',
])('does not approve unknown or broad targets: %s', command => {
  expect(pinSandboxScratchCleanup(command, root, scratch)).toBeUndefined()
})

test('rejects temporary directories outside the project scratch boundary', () => {
  expect(pinSandboxScratchCleanup('rm -f "$TMPDIR/file"', root, root)).toBeUndefined()
  expect(pinSandboxScratchCleanup('rm -f "$TMPDIR/file"', root, tmpdir())).toBeUndefined()
})

test('rejects existing and dangling symlinks and symlink parents', async () => {
  await symlink(root, join(scratch, 'outside'))
  await symlink(join(root, 'missing'), join(scratch, 'dangling'))
  for (const path of ['outside', 'outside/docs', 'dangling'])
    expect(pinSandboxScratchCleanup(`rm -rf "$TMPDIR/${path}"`, root, scratch)).toBeUndefined()
})

test('executed argument cannot be redirected by shell TMPDIR state', async () => {
  await writeFile(join(scratch, 'check.py'), 'temporary')
  const other = join(root, 'other')
  await mkdir(other)
  await writeFile(join(other, 'check.py'), 'keep')
  const command = pinSandboxScratchCleanup('rm -f "$TMPDIR/check.py"', root, scratch)!
  const child = Bun.spawn(['/bin/sh', '-c', command], { env: { ...process.env, TMPDIR: other } })
  expect(await child.exited).toBe(0)
  expect(await Bun.file(join(scratch, 'check.py')).exists()).toBe(false)
  expect(await Bun.file(join(other, 'check.py')).text()).toBe('keep')
})
