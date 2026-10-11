import { constants } from 'node:fs'
import { mkdir, open, readFile, realpath, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { array, discriminatedUnion, enum as enumeration, literal, number, object, string } from 'zod/v4'
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
export const atlasRequestSchema = object({ operation: literal('atlas'), group: string().min(1),
    frames: array(source.extend({ id: string().min(1) })).min(1),
    output: string().min(1), metadata: string().min(1),
    maxWidth: positive, maxHeight: positive, padding: zero,
    filtering: enumeration(['nearest', 'linear']),
  }).strict()
const requestSchema = discriminatedUnion('operation', [
  object({ operation: literal('images'), jobs: array(imageJob).min(1) }).strict(),
  atlasRequestSchema,
])
const inside = (root: string, path: string) => {
  const part = relative(root, path)
  return part !== '..' && !part.startsWith('../') && !isAbsolute(part)
}
const pixels = (width: number, height: number) => {
  if (width * height > MAX_PIXELS) throw Error('Decoded/output image exceeds ' + MAX_PIXELS + ' pixels')
}

/** Mechanical production only. It never edits Manifest, design or content. */
export async function produceMedia(workspace: string, value: unknown, suppliedSharp?: typeof sharp, reuseIdentical = false) {
  const request = requestSchema.parse(value)
  const root = await realpath(workspace)
  const image = suppliedSharp ?? (await import(process.env.BEEGAME_SHARP_MODULE ??
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
      if (reuseIdentical) {
        try {
          const existing = await open(entry.path, constants.O_RDONLY | constants.O_NOFOLLOW)
          try {
            if (!(await existing.readFile()).equals(Buffer.from(entry.bytes))) throw Error('Existing media differs; choose a new version path: ' + relative(root, entry.path))
          } finally { await existing.close() }
          continue
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
      pending.push(entry)
    }
    const opened: Array<{ path: string; handle: Awaited<ReturnType<typeof open>> }> = []
    try {
      for (const entry of pending) opened.push({ path: entry.path,
        handle: await open(entry.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) })
      for (let i = 0; i < pending.length; i++) await opened[i]!.handle.writeFile(pending[i]!.bytes)
      for (const entry of opened) await entry.handle.close()
      completed.push(...entries.map(entry => relative(root, entry.path)))
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
        await save([{ path, bytes: current }])
        outputs.push({ path: job.output, ...meta, operations: {
          input: job.input, crop: job.crop, resize: job.resize, padding: job.padding, overlays: job.overlays,
        } })
      }
      return { valid: true, operation: request.operation, outputs, issues: [],
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
    await save([{ path: output, bytes: buffer }, { path: metadata, bytes: JSON.stringify({ frames }, null, 2) + '\n' }])
    return { valid: true, operation: request.operation, group: request.group, outputs: [request.output, request.metadata],
      ...decoded, frameCount: names.size, padding: request.padding, paddingMode: 'edge-copy', filtering: request.filtering,
      issues: [], unverified: ['Grouping suitability, appearance, provenance and target-runtime rendering. Register with the existing Manifest tools.'] }
  } catch (error) {
    throw Error((error instanceof Error ? error.message : String(error)) + (completed.length ? '; completed outputs retained: ' + completed.join(', ') : ''))
  }
}

export const MEDIA_HELP = `Usage: bun .beegame/delivery/media.mjs request.json
Run from the project root. Inputs are project-relative. Outputs are new assets/*.png (and atlas *.json); existing files are never overwritten. Use a new version path for replacements, then update registration explicitly. Batch failures list retained successful files; rerun only unfinished jobs.
Images example:
{"operation":"images","jobs":[{"input":"assets/source.png","crop":{"left":0,"top":0,"width":32,"height":32},"resize":{"width":64,"height":64,"fit":"contain","kernel":"nearest"},"padding":{"top":2,"bottom":2,"left":2,"right":2},"output":"assets/icon.png"}]}
Optional overlays: [{"input":"assets/mark.png","left":4,"top":4}], with optional crop. Coordinates/dimensions are decoded image pixels, not UI logical units. Resize fit is contain/cover/fill (cover crops; fill distorts); kernel is nearest/lanczos3. Transparent padding; single-frame inputs only; output PNG.
Atlas example:
{"operation":"atlas","group":"hud","frames":[{"id":"button","input":"assets/button.png"},{"id":"icon","input":"assets/icon.png","crop":{"left":2,"top":2,"width":64,"height":64}}],"padding":1,"filtering":"linear","maxWidth":1024,"maxHeight":1024,"output":"assets/hud.png","metadata":"assets/hud.atlas.json"}
Fixed-order shelf packing, no rotation/trim, edge-copy padding outside frame rectangles; linear filtering requires padding. Inputs in one group must share planned filtering/loading use. No auto scaling, multi-page splitting or ID renaming.
Reports decoded dimensions/channels, output paths, operations or frame count. Frame rectangles are in the metadata file consumed by existing sprite-sheet readers. No Manifest edits or aesthetic approval. Existing resource acquisition/audio channels remain available; this tool does not compose music.`

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
