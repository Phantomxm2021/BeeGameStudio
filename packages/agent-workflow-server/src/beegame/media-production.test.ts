import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { produceMedia } from './media-production'
import { sharedSharp } from './shared-sharp'
import { parseSpriteSheet, spriteSheetSelection } from '../../../scene-editor/src/sprite-sheet'
import { sharedContentChecker, MEDIA_PRODUCTION_ENTRY } from './content-checker-runtime'

// Independent synthetic fixtures only; no generated project is edited.
const roots: string[] = []
afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bgs-media-test-'))
  roots.push(root)
  await mkdir(join(root, 'assets'))
  for (const [name, colour] of [['red', '#ff0000'], ['blue', '#0000ff']]) {
    await sharp({ create: { width: 6, height: 4, channels: 4, background: colour! } }).png().toFile(join(root, 'assets', name + '.png'))
  }
  return root
}
const atlas = { operation: 'atlas', group: 'test', frames: [
  { id: 'red.png', input: 'assets/red.png' }, { id: 'blue', input: 'assets/blue.png' },
], maxWidth: 10, maxHeight: 20, padding: 1, filtering: 'linear', output: 'assets/sheet.png', metadata: 'assets/sheet.atlas.json' }

test('atlas is decoded and selected by the actual runtime frame consumer, including edge padding', async () => {
  const root = await fixture()
  expect(await produceMedia(root, atlas, sharp)).toMatchObject({ valid: true, width: 8, height: 12, frameCount: 2 })
  const table = parseSpriteSheet(JSON.parse(await readFile(join(root, atlas.metadata), 'utf8')))
  for (const [name, colour] of [['red', [255, 0, 0, 255]], ['blue', [0, 0, 255, 255]]] as const) {
    const frame = spriteSheetSelection(table, { frame: name }).frame!
    expect(frame).toMatchObject({ width: 6, height: 4 })
    const buffer = await sharp(join(root, atlas.output)).extract({ left: frame.x, top: frame.y,
      width: frame.width, height: frame.height }).raw().toBuffer()
    expect([...buffer.subarray(0, 4)]).toEqual([...colour])
    const edge = await sharp(join(root, atlas.output)).extract({ left: frame.x - 1, top: frame.y - 1, width: 1, height: 1 }).raw().toBuffer()
    expect([...edge]).toEqual([...colour])
  }
  await produceMedia(root, { ...atlas, output: 'assets/repeated sheet.png', metadata: 'assets/repeated sheet.json' }, sharp)
  expect(await readFile(join(root, 'assets/repeated sheet.png'))).toEqual(await readFile(join(root, atlas.output)))
  expect(await readFile(join(root, 'assets/repeated sheet.json'))).toEqual(await readFile(join(root, atlas.metadata)))
})

test('image crop, explicit resize, padding and overlay have verified output dimensions/pixels', async () => {
  const root = await fixture()
  const result = await produceMedia(root, { operation: 'images', jobs: [{
    input: 'assets/red.png', crop: { left: 1, top: 1, width: 2, height: 2 },
    resize: { width: 4, height: 4, fit: 'fill', kernel: 'nearest' },
    padding: { top: 1, bottom: 1, left: 1, right: 1 },
    overlays: [{ input: 'assets/blue.png', crop: { left: 0, top: 0, width: 1, height: 1 }, left: 2, top: 2 }],
    output: 'assets/processed.png',
  }] }, sharp)
  expect(result).toMatchObject({ valid: true, outputs: [{ width: 6, height: 6, alpha: true }] })
  const { data } = await sharp(join(root, 'assets/processed.png')).raw().toBuffer({ resolveWithObject: true })
  expect([...data.subarray(0, 4)]).toEqual([0, 0, 0, 0])
  expect([...data.subarray((2 * 6 + 2) * 4, (2 * 6 + 2) * 4 + 4)]).toEqual([0, 0, 255, 255])
})

test('invalid regions, duplicate normalized names, size and filtering fail before output', async () => {
  const root = await fixture()
  for (const [request, message] of [
    [{ ...atlas, frames: [{ id: 'x', input: 'assets/red.png', crop: { left: 5, top: 0, width: 2, height: 2 } }] }, 'crop rectangle'],
    [{ ...atlas, frames: [...atlas.frames, { id: 'red', input: 'assets/blue.png' }] }, 'normalized frame'],
    [{ ...atlas, maxHeight: 6 }, 'maxHeight'],
    [{ ...atlas, padding: 0 }, 'Linear filtering'],
    [{ ...atlas, frames: [{ id: '__proto__', input: 'assets/red.png' }] }, 'normalized frame'],
  ] as const) await expect(produceMedia(root, request, sharp)).rejects.toThrow(message)
  expect((await readdir(join(root, 'assets'))).sort()).toEqual(['blue.png', 'red.png'])
})

test('output collision rolls back only newly created pair and preserves existing bytes', async () => {
  const root = await fixture()
  await writeFile(join(root, atlas.metadata), 'keep')
  await expect(produceMedia(root, atlas, sharp)).rejects.toThrow('EEXIST')
  expect(await readFile(join(root, atlas.metadata), 'utf8')).toBe('keep')
  expect(await readdir(join(root, 'assets'))).not.toContain('sheet.png')
})

test('failed batch reports retained successful jobs, never destroys source', async () => {
  const root = await fixture()
  await expect(produceMedia(root, { operation: 'images', jobs: [
    { input: 'assets/red.png', output: 'assets/saved.png' },
    { input: 'assets/blue.png', output: 'assets/red.png' },
  ] }, sharp)).rejects.toThrow('completed outputs retained: assets/saved.png')
  expect(await sharp(join(root, 'assets/red.png')).raw().toBuffer()).toEqual(await sharp(join(root, 'assets/saved.png')).raw().toBuffer())
})

test('input/output traversal and symlinks cannot escape the project', async () => {
  const root = await fixture(), outside = await fixture()
  await symlink(join(outside, 'assets'), join(root, 'assets', 'external'))
  for (const job of [
    { input: join(outside, 'assets/red.png'), output: 'assets/no.png' },
    { input: 'assets/external/red.png', output: 'assets/no.png' },
    { input: 'assets/red.png', output: 'assets/../../no.png' },
    { input: 'assets/red.png', output: 'assets/external/no.png' },
  ]) await expect(produceMedia(root, { operation: 'images', jobs: [job] }, sharp)).rejects.toThrow()
  expect((await readdir(join(outside, 'assets'))).sort()).toEqual(['blue.png', 'red.png'])
})

test('deployed thin entry uses the installed dependency closure without package installs', async () => {
  const root = await fixture()
  const runtime = await sharedContentChecker(), media = await sharedSharp()
  expect(media.roots).toHaveLength(1)
  expect(media.roots[0]).not.toContain('claude-code-main')
  await writeFile(join(root, 'media.mjs'), MEDIA_PRODUCTION_ENTRY)
  await writeFile(join(root, 'request.json'), JSON.stringify(atlas))
  const child = Bun.spawn([process.execPath, 'media.mjs', 'request.json'], { cwd: root,
    env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl, BEEGAME_SHARP_MODULE: media.moduleUrl },
    stdout: 'pipe', stderr: 'pipe' })
  const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect({ code, error }).toEqual({ code: 0, error: '' })
  expect(JSON.parse(output)).toMatchObject({ valid: true, frameCount: 2 })
}, 30_000)
