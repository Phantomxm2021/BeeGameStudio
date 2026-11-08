import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, realpath, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { array, discriminatedUnion, enum as enumeration, literal, number, object, record, string } from 'zod/v4'
import type { z } from 'zod/v4'
import type sharp from 'sharp'
import { atlasFrameName, parseSpriteSheet, validateSpriteSheetBounds } from '../../../scene-editor/src/sprite-sheet'

// Decoded/output memory safety, not an Agent effort or token quota.
const MAX_PIXELS = 64 * 1024 * 1024
const positive = number().int().positive().max(MAX_PIXELS)
const zero = number().int().nonnegative().max(MAX_PIXELS)
const crop = object({ left: zero, top: zero, width: positive, height: positive }).strict()
const source = object({ input: string().min(1), crop: crop.optional() }).strict()
const imageJob = source.extend({
  output: string().min(1),
  resize: object({ width: positive, height: positive,
    fit: enumeration(['contain', 'cover', 'fill']), kernel: enumeration(['nearest', 'lanczos3']) }).strict().optional(),
  padding: object({ top: zero, bottom: zero, left: zero, right: zero }).strict().optional(),
  overlays: array(source.extend({ left: zero, top: zero })).optional(),
}).strict()
const atlasRequestSchema = object({ operation: literal('atlas'), group: string().min(1),
    frames: array(source.extend({ id: string().min(1) })).min(1),
    output: string().min(1), metadata: string().min(1),
    maxWidth: positive, maxHeight: positive, padding: zero,
    filtering: enumeration(['nearest', 'linear']),
  }).strict()
const requestSchema = discriminatedUnion('operation', [
  object({ operation: literal('inspect'), inputs: array(source).min(1),
    alphaThreshold: number().int().min(0).max(254).default(0) }).strict(),
  object({ operation: literal('images'), jobs: array(imageJob).min(1) }).strict(),
  atlasRequestSchema,
  object({ operation: literal('atlas-frames'), input: string().min(1), output: string().min(1),
    frames: record(string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/), object({
      x: zero, y: zero, w: positive, h: positive,
    }).strict()).refine(frames => Object.keys(frames).length >= 1 && Object.keys(frames).length <= 128,
      'Atlas needs 1–128 named frames'),
  }).strict(),
])
const inside = (root: string, path: string) => {
  const part = relative(root, path)
  return part !== '..' && !part.startsWith('../') && !isAbsolute(part)
}
const pixels = (width: number, height: number) => {
  if (width * height > MAX_PIXELS) throw Error('Decoded/output image exceeds ' + MAX_PIXELS + ' pixels')
}

/** Mechanical production only. It never edits Manifest, design or content. */
export async function produceMedia(workspace: string, value: unknown, suppliedSharp?: typeof sharp) {
  const request = requestSchema.parse(value)
  const root = await realpath(workspace)
  const image = suppliedSharp ?? (await import(process.env.BEEGAME_SHARP_MODULE ||
    (() => { throw Error('Media runtime is unavailable in this execution environment') })())).default as typeof sharp
  const inputPath = async (path: string) => {
    const lexical = resolve(root, path)
    if (!inside(root, lexical)) throw Error('Input must be inside the project: ' + path)
    const actual = await realpath(lexical)
    if (!inside(root, actual)) throw Error('Input symlink escapes the project: ' + path)
    return actual
  }
  const load = async (item: z.infer<typeof source>) => {
    const buffer = await readFile(await inputPath(item.input))
    const decoder = image(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
    const meta = await decoder.metadata()
    if (!meta.width || !meta.height || (meta.pages ?? 1) > 1)
      throw Error(item.input + ': requires a single decoded image')
    const region = item.crop
    if (region && (region.left + region.width > meta.width || region.top + region.height > meta.height))
      throw Error(item.input + ': crop rectangle exceeds decoded dimensions')
    return region ? decoder.extract(region) : decoder
  }
  const target = async (path: string, extension: string) => {
    if (isAbsolute(path) || !path.startsWith('assets/') || !path.endsWith(extension))
      throw Error('Output must be a project assets/*' + extension + ' path: ' + path)
    const file = resolve(root, path)
    const assets = resolve(root, 'assets')
    if (!inside(assets, file)) throw Error('Output escapes assets: ' + path)
    // Validate ancestors before creating each directory, including assets itself.
    let parent = root
    for (const part of relative(root, dirname(file)).split('/')) {
      parent = resolve(parent, part)
      try { await mkdir(parent) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      if (await realpath(parent) !== parent) throw Error('Output directory must not be a symlink: ' + path)
    }
    return file
  }
  const completed: string[] = []
  // Exclusive output creation. A failed pair rolls back only files created here.
  const save = async (entries: Array<{ path: string; bytes: Buffer | string }>) => {
    const pending = []
    for (const entry of entries) {
      try {
        const existing = await open(entry.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        try {
          if (!(await existing.stat()).isFile()) throw Error('Existing media must be a regular file: ' + relative(root, entry.path))
          if (!(await existing.readFile()).equals(Buffer.from(entry.bytes))) throw Error('Existing media differs; choose a new version path: ' + relative(root, entry.path))
        } finally { await existing.close() }
        continue
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      pending.push(entry)
    }
    const opened: Array<{ path: string; handle: Awaited<ReturnType<typeof open>> }> = []
    try {
      for (const entry of pending) opened.push({ path: entry.path,
        handle: await open(entry.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) })
      for (let i = 0; i < pending.length; i++) await opened[i]!.handle.writeFile(pending[i]!.bytes)
      for (const entry of opened) await entry.handle.close()
      completed.push(...entries.map(entry => relative(root, entry.path)))
      const file_paths = entries.map(entry => relative(root, entry.path))
      const local_file_hashes = Object.fromEntries(entries.map((entry, index) =>
        [file_paths[index]!, createHash('sha256').update(entry.bytes).digest('hex')]))
      const path = file_paths[0]!
      return { path, root_path: path, file_paths, sha256: local_file_hashes[path]!, local_file_hashes }
    } catch (error) {
      const cleanup: string[] = []
      for (const entry of opened) {
        await entry.handle.close().catch(() => {})
        await unlink(entry.path).catch(() => { cleanup.push(relative(root, entry.path)) })
      }
      throw Error(String(error) + (cleanup.length ? '; incomplete outputs remain: ' + cleanup.join(', ') : ''))
    }
  }
  const decode = async (buffer: Buffer) => {
    // Force decoding, not just header inspection.
    const { info } = await image(buffer, { limitInputPixels: MAX_PIXELS }).raw().toBuffer({ resolveWithObject: true })
    return { width: info.width, height: info.height, channels: info.channels, format: 'png' as const, alpha: info.channels === 4 || info.channels === 2 }
  }
  try {
    if (request.operation === 'inspect') {
      const measurements = []
      for (const item of request.inputs) {
        const pipe = await load(item)
        const { hasAlpha } = await pipe.metadata()
        const { data, info } = await pipe.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        const { width, height, channels } = info
        let left = width, top = height, right = -1, bottom = -1, visiblePixels = 0
        const edgeVisiblePixels = { top: 0, right: 0, bottom: 0, left: 0 }
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * channels + channels - 1]! <= request.alphaThreshold) continue
          visiblePixels++
          left = Math.min(left, x); top = Math.min(top, y)
          right = Math.max(right, x); bottom = Math.max(bottom, y)
          if (y === 0) edgeVisiblePixels.top++
          if (x === width - 1) edgeVisiblePixels.right++
          if (y === height - 1) edgeVisiblePixels.bottom++
          if (x === 0) edgeVisiblePixels.left++
        }
        measurements.push({ input: item.input,
          region: { left: item.crop?.left ?? 0, top: item.crop?.top ?? 0, width, height },
          hasAlpha: hasAlpha === true, alphaThreshold: request.alphaThreshold, visiblePixels,
          alphaBounds: visiblePixels ? { left: (item.crop?.left ?? 0) + left,
            top: (item.crop?.top ?? 0) + top, width: right - left + 1, height: bottom - top + 1 } : null,
          edgeVisiblePixels })
      }
      return { valid: true, operation: request.operation, scope: 'decoded-alpha-measurement',
        coordinates: 'decoded-source-pixels', measurements,
        unverified: ['Object identity/count, complete object coverage, state alignment, filtering safety, appearance and runtime use. Alpha bounds are not automatically safe crop/frame rectangles; omitted objects and pixels outside a selected region are not checked.'] }
    }
    if (request.operation === 'atlas-frames') {
      const bytes = await readFile(await inputPath(request.input))
      const decoded = await decode(bytes)
      if (bytes.length < 26 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
        throw Error('Atlas source must be a PNG')
      if (decoded.width * decoded.height > 16_000_000) throw Error('Atlas source dimensions are invalid or too large')
      const rectangles = Object.entries(request.frames)
      const frames = Object.fromEntries(rectangles.map(([name, frame]) => [name, { frame }]))
      const sheet = parseSpriteSheet({ frames })!
      validateSpriteSheetBounds(sheet, decoded.width, decoded.height)
      for (let i = 0; i < rectangles.length; i++) for (let j = 0; j < i; j++) {
        const [name, a] = rectangles[i]!, [, b] = rectangles[j]!
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
          throw Error('Overlapping atlas frames: ' + name)
      }
      if (!request.output.startsWith('assets/runtime/')) throw Error('Atlas output must be a PNG under assets/runtime/')
      const output = await target(request.output, '.png')
      const metadata = await target(request.output.slice(0, -4) + '.json', '.json')
      const files = await save([{ path: output, bytes }, { path: metadata, bytes: JSON.stringify({ frames }, null, 2) + '\n' }])
      return { valid: true, operation: request.operation, ...files, ...decoded, frameCount: rectangles.length,
        unverified: ['Frame identity, complete artwork, filtering safety, provenance and runtime use.'] }
    }
    if (request.operation === 'images') {
      const outputs = []
      for (const job of request.jobs) {
        let pipe = await load(job)
        // Decode crop first so output dimensions/overlay bounds are unambiguous.
        let current = await pipe.png().toBuffer()
        let meta = await decode(current)
        if (job.resize) {
          pixels(job.resize.width, job.resize.height)
          current = await image(current).resize({ ...job.resize, background: '#00000000' }).png().toBuffer()
          meta = await decode(current)
        }
        if (job.padding) {
          pixels(meta.width + job.padding.left + job.padding.right, meta.height + job.padding.top + job.padding.bottom)
          current = await image(current).extend({ ...job.padding, background: '#00000000' }).png().toBuffer()
          meta = await decode(current)
        }
        const overlays = []
        for (const overlay of job.overlays ?? []) {
          const buffer = await (await load(overlay)).png().toBuffer()
          const dimensions = await decode(buffer)
          if (overlay.left + dimensions.width > meta.width || overlay.top + dimensions.height > meta.height)
            throw Error(overlay.input + ': overlay exceeds destination dimensions')
          overlays.push({ input: buffer, left: overlay.left, top: overlay.top })
        }
        if (overlays.length) current = await image(current).composite(overlays).png().toBuffer()
        meta = await decode(current)
        const path = await target(job.output, '.png')
        const files = await save([{ path, bytes: current }])
        outputs.push({ ...files, operation: request.operation, ...meta, operations: {
          input: job.input, crop: job.crop, resize: job.resize, padding: job.padding, overlays: job.overlays,
        } })
      }
      const first = outputs[0]!
      return { valid: true, operation: request.operation, path: first.path, root_path: first.path,
        sha256: first.sha256, file_paths: outputs.map(item => item.path),
        local_file_hashes: Object.assign({}, ...outputs.map(item => item.local_file_hashes)), outputs, issues: [],
        unverified: ['Appearance, provenance and runtime use require existing resource registration and inspection.'] }
    }
    pixels(request.maxWidth, request.maxHeight)
    if (request.filtering === 'linear' && request.padding < 1)
      throw Error('Linear filtering requires at least one pixel of explicit edge padding')
    const names = new Set<string>()
    const frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; rotated: false; trimmed: false }> = Object.create(null)
    const composites = []
    let x = 0, y = 0, rowHeight = 0, width = 0
    for (const item of request.frames) {
      const name = atlasFrameName(item.id)
      if (!name || ['__proto__', 'constructor', 'prototype'].includes(name) || names.has(name))
        throw Error('Duplicate/unsupported normalized frame ID: ' + name)
      names.add(name)
      let buffer = await (await load(item)).png().toBuffer()
      const actual = await decode(buffer)
      const w = actual.width + request.padding * 2, h = actual.height + request.padding * 2
      if (w > request.maxWidth || h > request.maxHeight) throw Error(item.id + ': padded frame exceeds atlas limits')
      if (x + w > request.maxWidth) { x = 0; y += rowHeight; rowHeight = 0 }
      if (y + h > request.maxHeight) throw Error(item.id + ': atlas exceeds maxHeight; choose an explicit larger size or another planned group')
      if (request.padding) buffer = await image(buffer).extend({ top: request.padding, bottom: request.padding,
        left: request.padding, right: request.padding, extendWith: 'copy' }).png().toBuffer()
      frames[item.id] = { frame: { x: x + request.padding, y: y + request.padding, w: actual.width, h: actual.height }, rotated: false, trimmed: false }
      composites.push({ input: buffer, left: x, top: y })
      width = Math.max(width, x + w); x += w; rowHeight = Math.max(rowHeight, h)
    }
    const height = y + rowHeight
    const sheet = parseSpriteSheet({ frames })!
    validateSpriteSheetBounds(sheet, width, height)
    const buffer = await image({ create: { width, height, channels: 4, background: '#00000000' } }).composite(composites).png().toBuffer()
    const decoded = await decode(buffer)
    validateSpriteSheetBounds(sheet, decoded.width, decoded.height)
    const output = await target(request.output, '.png'), metadata = await target(request.metadata, '.json')
    const files = await save([{ path: output, bytes: buffer }, { path: metadata, bytes: JSON.stringify({ frames }, null, 2) + '\n' }])
    return { valid: true, operation: request.operation, ...files, group: request.group, outputs: [request.output, request.metadata],
      ...decoded, frameCount: names.size, padding: request.padding, paddingMode: 'edge-copy', filtering: request.filtering,
      issues: [], unverified: ['Grouping suitability, appearance, provenance and target-runtime rendering. Register with the existing Manifest tools.'] }
  } catch (error) {
    throw Error((error instanceof Error ? error.message : String(error)) + (completed.length ? '; completed outputs retained: ' + completed.join(', ') : ''))
  }
}

export const MEDIA_HELP = `Usage: bun <current-tools-directory>/media.mjs request.json
Replace <current-tools-directory> with the current BGS tools directory supplied in the project context. Run from the project root. Inputs are project-relative. Outputs are assets/*.png (and atlas *.json); matching existing bytes can be reused, changed files are never overwritten. Use a new version path for replacements, then update registration explicitly. Batch failures list retained successful files; rerun only unfinished jobs.
Read-only measurement example:
{"operation":"inspect","inputs":[{"input":"assets/sheet.png"},{"input":"assets/sheet.png","crop":{"left":10,"top":20,"width":100,"height":80}}],"alphaThreshold":0}
Decodes existing images/regions without creating or changing files. Reports alpha bounds in original decoded source pixels and visible pixels on each region edge. Threshold 0 counts every nonzero alpha, including soft shadows; another threshold changes the measurement, not quality. A bound can include multiple objects; a selected region can omit artwork. This measures existing pixels rather than selecting objects or proving filtering safety. Locate the required elements in the actual sheet before measuring their regions; report unresolved identity or bounds.
Intact PNG sheet with measured named regions (no cropping or repacking):
{"operation":"atlas-frames","input":"assets/generated/sheet.png","frames":{"icon":{"x":0,"y":0,"w":32,"h":32}},"output":"assets/runtime/sheet.png"}
Copies the PNG unchanged and writes same-basename JSON. Coordinates are decoded source pixels, not pre-generation layout; frames must be complete, in bounds, nonoverlapping and use 1–128 distinct letter/digit/underscore/hyphen names starting with a letter or digit. Use atlas below only when separate images actually need packing.
Images example:
{"operation":"images","jobs":[{"input":"assets/source.png","crop":{"left":0,"top":0,"width":32,"height":32},"resize":{"width":64,"height":64,"fit":"contain","kernel":"nearest"},"padding":{"top":2,"bottom":2,"left":2,"right":2},"output":"assets/icon.png"}]}
Optional overlays: [{"input":"assets/mark.png","left":4,"top":4}], with optional crop. Coordinates/dimensions are decoded image pixels, not UI logical units. Resize fit is contain/cover/fill (cover crops; fill distorts); kernel is nearest/lanczos3. Transparent padding; single-frame inputs only; output PNG.
Atlas example:
{"operation":"atlas","group":"hud","frames":[{"id":"button","input":"assets/button.png"},{"id":"icon","input":"assets/icon.png","crop":{"left":2,"top":2,"width":64,"height":64}}],"padding":1,"filtering":"linear","maxWidth":1024,"maxHeight":1024,"output":"assets/hud.png","metadata":"assets/hud.atlas.json"}
Fixed-order shelf packing, no rotation/trim, edge-copy padding outside frame rectangles; linear filtering requires padding. Inputs in one group must share planned filtering/loading use. No auto scaling, multi-page splitting or ID renaming.
Outputs include decoded dimensions and acquisition file facts (path, sha256, file_paths and local_file_hashes). Save the returned JSON and register it with resources.mjs acquisition; individual images jobs also carry their own receipts. Media processing does not determine rights/provenance; retain the original source declaration. Reports operations or frame count. Frame rectangles are in the metadata file consumed by existing sprite-sheet readers. No Manifest edits or aesthetic approval. Existing resource acquisition/audio channels remain available; this tool does not compose music.`

export async function runMediaProductionCli(args = process.argv.slice(2)) {
  try {
    if (args.length === 1 && args[0] === '--help') { console.log(MEDIA_HELP); return }
    if (args.length !== 1) throw Error('Usage: media.mjs request.json (or --help)')
    const root = await realpath(process.cwd())
    const path = await realpath(resolve(root, args[0]!))
    if (!inside(root, path)) throw Error('Request must be inside the project')
    console.log(JSON.stringify(await produceMedia(root, JSON.parse(await readFile(path, 'utf8')))))
  } catch (error) {
    console.log(JSON.stringify({ valid: false, issues: [error instanceof Error ? error.message : String(error)] }))
    process.exitCode = 1
  }
}
