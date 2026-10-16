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

test('inspect measures whole images and regions in source pixels without writing or selecting objects', async () => {
  const root = await fixture(), width = 12, height = 8
  const raw = Buffer.alloc(width * height * 4)
  const mark = (x: number, y: number, alpha = 255) => raw.set([30, 180, 100, alpha], (y * width + x) * 4)
  for (let y = 3; y <= 4; y++) for (let x = 2; x <= 4; x++) mark(x, y)
  mark(9, 6); mark(10, 6); mark(1, 1, 8)
  const bytes = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer()
  await writeFile(join(root, 'assets/parts.png'), bytes)
  const before = (await readdir(join(root, 'assets'))).sort()
  const result = await produceMedia(root, { operation: 'inspect', inputs: [
    { input: 'assets/parts.png' },
    { input: 'assets/parts.png', crop: { left: 1, top: 2, width: 5, height: 4 } },
    { input: 'assets/parts.png', crop: { left: 3, top: 3, width: 3, height: 3 } },
  ] }, sharp)
  expect(result).toMatchObject({ valid: true, scope: 'decoded-alpha-measurement', coordinates: 'decoded-source-pixels',
    measurements: [
      { hasAlpha: true, alphaThreshold: 0, visiblePixels: 9,
        alphaBounds: { left: 1, top: 1, width: 10, height: 6 },
        edgeVisiblePixels: { top: 0, right: 0, bottom: 0, left: 0 } },
      { region: { left: 1, top: 2, width: 5, height: 4 }, visiblePixels: 6,
        alphaBounds: { left: 2, top: 3, width: 3, height: 2 } },
      { visiblePixels: 4, alphaBounds: { left: 3, top: 3, width: 2, height: 2 },
        edgeVisiblePixels: { top: 2, right: 0, bottom: 0, left: 2 } },
    ] })
  // Two independent marks yield one combined bound, not an inferred object or safe frame.
  expect(result.unverified.join(' ')).toContain('Object identity/count')
  expect(result.unverified.join(' ')).toContain('pixels outside a selected region are not checked')
  const thresholded = await produceMedia(root, { operation: 'inspect', inputs: [{ input: 'assets/parts.png' }], alphaThreshold: 120 }, sharp)
  expect(thresholded).toMatchObject({ measurements: [{ visiblePixels: 8,
    alphaBounds: { left: 2, top: 3, width: 9, height: 4 } }] })
  expect((await readdir(join(root, 'assets'))).sort()).toEqual(before)
  expect((await readFile(join(root, 'assets/parts.png'))).toString('hex')).toBe(bytes.toString('hex'))
})

test('inspect distinguishes transparent images from images without alpha', async () => {
  const root = await fixture()
  await writeFile(join(root, 'assets/empty.png'), await sharp({ create: {
    width: 6, height: 4, channels: 4, background: '#00000000',
  } }).png().toBuffer())
  await writeFile(join(root, 'assets/rgb.png'), await sharp(join(root, 'assets/red.png')).removeAlpha().png().toBuffer())
  expect(await produceMedia(root, { operation: 'inspect', inputs: [
    { input: 'assets/empty.png' }, { input: 'assets/rgb.png' },
  ] }, sharp)).toMatchObject({ measurements: [
    { hasAlpha: true, visiblePixels: 0, alphaBounds: null, edgeVisiblePixels: { top: 0, right: 0, bottom: 0, left: 0 } },
    { hasAlpha: false, visiblePixels: 24, alphaBounds: { left: 0, top: 0, width: 6, height: 4 },
      edgeVisiblePixels: { top: 6, right: 4, bottom: 6, left: 4 } },
  ] })
})

test('inspect rejects invalid requests, undecodable inputs and escaped paths without outputs', async () => {
  const root = await fixture(), outside = await fixture()
  await symlink(join(outside, 'assets'), join(root, 'assets/external'))
  await writeFile(join(root, 'assets/broken.png'), 'not a decoded image')
  const before = (await readdir(join(root, 'assets'))).sort()
  const request = { operation: 'inspect', inputs: [{ input: 'assets/red.png' }] }
  for (const invalid of [
    { ...request, inputs: [] }, { ...request, alphaThreshold: -1 }, { ...request, alphaThreshold: 255 },
    { ...request, alphaThreshold: 1.5 }, { ...request, output: 'assets/no.png' },
    { ...request, inputs: [{ input: 'assets/broken.png' }] },
    { ...request, inputs: [{ input: 'assets/red.png', crop: { left: 5, top: 0, width: 2, height: 2 } }] },
    { ...request, inputs: [{ input: '../outside.png' }] },
    { ...request, inputs: [{ input: 'assets/external/red.png' }] },
  ]) await expect(produceMedia(root, invalid, sharp)).rejects.toThrow()
  expect((await readdir(join(root, 'assets'))).sort()).toEqual(before)
  expect((await readdir(join(outside, 'assets'))).sort()).toEqual(['blue.png', 'red.png'])
})

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

test('sprite crops and packing preserve transparent frame space and intentional airborne offsets', async () => {
  // Mechanical fixture, not generated artwork or a visual-quality acceptance sample.
  const root = await fixture()
  const names = ['contact', 'air', 'recovery']
  const offsets = [4, 0, 4]
  const mark = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#00aabb' } }).png().toBuffer()
  const source = await sharp({ create: { width: 24, height: 10, channels: 4, background: '#00000000' } })
    .composite(offsets.map((top, i) => ({ input: mark, left: i * 8 + 2, top }))).png().toBuffer()
  await writeFile(join(root, 'assets/motion-source.png'), source)
  await produceMedia(root, { operation: 'images', jobs: names.map((name, i) => ({
    input: 'assets/motion-source.png', crop: { left: i * 8, top: 0, width: 8, height: 10 },
    padding: { top: 2, bottom: 2, left: 2, right: 2 }, output: 'assets/' + name + '.png',
  })) }, sharp)
  await produceMedia(root, { operation: 'atlas', group: 'motion',
    frames: names.map(id => ({ id, input: 'assets/' + id + '.png' })),
    output: 'assets/motion.png', metadata: 'assets/motion.json',
    maxWidth: 32, maxHeight: 32, padding: 1, filtering: 'linear',
  }, sharp)
  const table = parseSpriteSheet(JSON.parse(await readFile(join(root, 'assets/motion.json'), 'utf8')))
  for (const [i, name] of names.entries()) {
    const frame = spriteSheetSelection(table, { frame: name }).frame!
    expect(frame).toMatchObject({ width: 12, height: 14 })
    const packed = await sharp(join(root, 'assets/motion.png'))
      .extract({ left: frame.x, top: frame.y, width: frame.width, height: frame.height }).raw().toBuffer()
    const prepared = await sharp(join(root, 'assets/' + name + '.png')).raw().toBuffer()
    expect(packed).toEqual(prepared)
    const visibleRows = []
    for (let y = 0; y < frame.height; y++)
      if (packed[(y * frame.width + 4) * 4 + 3]) visibleRows.push(y)
    expect(visibleRows).toEqual([offsets[i]! + 2, offsets[i]! + 3, offsets[i]! + 4])
  }
  expect((await readFile(join(root, 'assets/motion-source.png'))).toString('hex')).toBe(source.toString('hex'))
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
  const before = (await readdir(join(root, 'assets'))).sort()
  await writeFile(join(root, 'request.json'), JSON.stringify({ operation: 'inspect', inputs: [{ input: atlas.output }] }))
  const inspection = Bun.spawn([process.execPath, 'media.mjs', 'request.json'], { cwd: root,
    env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl, BEEGAME_SHARP_MODULE: media.moduleUrl },
    stdout: 'pipe', stderr: 'pipe' })
  const [inspectCode, inspectOutput, inspectError] = await Promise.all([
    inspection.exited, new Response(inspection.stdout).text(), new Response(inspection.stderr).text(),
  ])
  expect({ code: inspectCode, error: inspectError }).toEqual({ code: 0, error: '' })
  expect(JSON.parse(inspectOutput)).toMatchObject({ operation: 'inspect', scope: 'decoded-alpha-measurement',
    measurements: [{ region: { left: 0, top: 0, width: 8, height: 12 }, hasAlpha: true }] })
  expect((await readdir(join(root, 'assets'))).sort()).toEqual(before)
}, 30_000)
