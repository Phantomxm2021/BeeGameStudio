// Project-local, short-lived command adapter for existing BGS capabilities.
// The host prepends TOOL_CONFIG when copying this file into .beegame/tmp.
import { createHash } from 'node:crypto'
import {
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

const catalogFilterKeys = ['packIds','dimensions','primaryCategories','categories','styles','gameTypes','packTags','usageTags','assetKinds','capabilities','formats']
const catalogUsage = 'Catalog accepts structured filter arrays: '+catalogFilterKeys.join(', ')+
  '. No free-text query/search. Use {"filters":{"formats":["png"]},"limit":10,"cursor":"<returned nextCursor>"}; flat filter arrays with limit/cursor also work.'

const usage = `Usage: bun <this-file> <command> [arguments]
  catalog [request-json]                Browse library packs and available facets
  elements <pack-id> [request-json]      Browse a selected pack's elements
  pack <pack-id>                         Read license, version and pack metadata
  element <pack-id> <element-id>         Read element and dependency metadata
  fetch <pack-id> <element-id> <assets/path>  Download one selected library file
  inspect <assets/path> [assets/path ...] Hash local assets in one call; no provenance/quality inference
  cost [quality] [size]                 Show availability and the Cloudflare Credit quote
  generate <request.json> <assets/path>  Generate from {requestId,prompt,background?,quality?,size?,referenceImagePath?}
  atlas <assets/sheet.png> <assets/frames.json> <assets/runtime/name.png>
                                         Publish named rectangles as a PNG + same-basename atlas JSON
For compatible small AI-generated elements, prefer one shared sheet request; use atlas to register inspected rectangles. generate returns an image, not frame metadata. atlas does not pack separate images. Split generation for a concrete visual/use need, preserving planned atlas delivery.
For decoded image crop/resize/composition and packing separate sprites, use ${TOOL_CONFIG.mediaCommand ?? 'bun .beegame/delivery/media.mjs'} --help. Its JSON request supports named crop regions, explicit filtering/padding and compatible atlas output; no package installation or custom PNG encoder is needed.
The same atlas delivery applies to retrieved and procedural static sprites. Procedural drawing can write a shared PNG and exact rectangles directly. Dynamic text and live geometry need not become images.
${catalogUsage}
Commands are optional. You choose the source and asset design. No command updates the Manifest.`

function id(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value ?? ''))
    throw new Error('Expected a pack or element ID')
  return value
}

function catalogRequest(value) {
  const parsed = value === undefined ? {} : JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Catalog request must be a JSON object. '+catalogUsage)
  const nested = Object.hasOwn(parsed, 'filters')
  const allowed = nested ? ['filters','limit','cursor'] : [...catalogFilterKeys,'limit','cursor']
  const unknown = Object.keys(parsed).filter(key => !allowed.includes(key))
  if (unknown.length) throw new Error('Unknown catalog request fields: '+unknown.join(', ')+'. '+catalogUsage)
  const filters = nested ? parsed.filters : Object.fromEntries(Object.entries(parsed).filter(([key]) => catalogFilterKeys.includes(key)))
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('Catalog filters must be an object. '+catalogUsage)
  for (const [key, values] of Object.entries(filters)) {
    if (!catalogFilterKeys.includes(key)) throw new Error('Unknown catalog filter: '+key+'. '+catalogUsage)
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value.trim()))
      throw new Error('Catalog filters.'+key+' must be an array of nonempty strings. '+catalogUsage)
  }
  if (parsed.limit !== undefined && (!Number.isInteger(parsed.limit) || parsed.limit < 1 || parsed.limit > 64))
    throw new Error('Catalog limit must be an integer from 1 to 64, outside filters. '+catalogUsage)
  if (parsed.cursor !== undefined && typeof parsed.cursor !== 'string')
    throw new Error('Catalog cursor must be a string, outside filters. '+catalogUsage)
  return { filters, ...(parsed.limit !== undefined ? {limit:parsed.limit}:{}), ...(parsed.cursor !== undefined ? {cursor:parsed.cursor}:{}) }
}

async function jsonRequest(url, init) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('Capability returned non-JSON HTTP ' + response.status)
  }
  if (!response.ok)
    throw new Error(
      'Capability HTTP ' + response.status + ': ' + JSON.stringify(body),
    )
  return body
}

async function assetDestination(path, createParent = true) {
  if (
    typeof path !== 'string' ||
    !path.startsWith('assets/') ||
    path.split(/[\\/]/).includes('..')
  )
    throw new Error('Output must be a relative path inside assets/')
  const root = await realpath(process.cwd())
  const assets = resolve(root, 'assets')
  const target = resolve(root, path)
  if (target === assets || !target.startsWith(assets + '/'))
    throw new Error('Output must be a file inside assets/')
  if (createParent) await mkdir(dirname(target), { recursive: true })
  const actualParent = await realpath(dirname(target))
  if (
    actualParent !== dirname(target) ||
    (actualParent !== assets && !actualParent.startsWith(assets + '/'))
  )
    throw new Error('Output directory must not resolve through a link')
  return { target, path: relative(root, target) }
}

async function saveBytes(response, output, reservedFile) {
  if (!response.ok) {
    const details = await response.text()
    throw new Error(
      'Capability HTTP ' + response.status + ': ' + details.slice(0, 2000),
    )
  }
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > 256 * 1024 * 1024)
    throw new Error('Asset exceeds the 256 MiB download limit')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > 256 * 1024 * 1024)
    throw new Error('Empty or oversized asset')
  if (reservedFile) await reservedFile.writeFile(bytes)
  else await writeFile(output.target, bytes, { flag: 'wx' })
  return {
    path: output.path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    mimeType: response.headers.get('content-type') ?? undefined,
  }
}

function atlasFrames(value, width, height) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !value.frames || typeof value.frames !== 'object' || Array.isArray(value.frames))
    throw new Error('Frame spec must contain frames: { name: {x,y,w,h} }')
  const entries = Object.entries(value.frames)
  if (!entries.length || entries.length > 128) throw new Error('Atlas needs 1–128 named frames')
  const frames = {}
  const rectangles = []
  for (const [name, rectangle] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) ||
        !rectangle || typeof rectangle !== 'object' || Array.isArray(rectangle) ||
        !['x', 'y', 'w', 'h'].every(key => Number.isSafeInteger(rectangle[key])) ||
        rectangle.x < 0 || rectangle.y < 0 || rectangle.w < 1 || rectangle.h < 1 ||
        rectangle.x + rectangle.w > width || rectangle.y + rectangle.h > height)
      throw new Error('Invalid or out-of-bounds atlas frame: ' + name)
    for (const previous of rectangles)
      if (rectangle.x < previous.x + previous.w && previous.x < rectangle.x + rectangle.w &&
          rectangle.y < previous.y + previous.h && previous.y < rectangle.y + rectangle.h)
        throw new Error('Overlapping atlas frames: ' + name)
    rectangles.push(rectangle)
    frames[name] = { frame: { x: rectangle.x, y: rectangle.y, w: rectangle.w, h: rectangle.h } }
  }
  return { frames }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!command || command === 'help' || command === '--help') {
    console.log(usage)
    return
  }
  const base = TOOL_CONFIG.libraryBaseUrl
  if (
    ['catalog', 'elements', 'pack', 'element', 'fetch'].includes(command) &&
    !base
  )
    throw new Error('Built-in resource library is unavailable for this turn')
  if (command === 'catalog') {
    if (args.length > 1) throw new Error(usage)
    console.log(
      JSON.stringify(
        await jsonRequest(base + '/api/resource-catalog/packs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(catalogRequest(args[0])),
        }),
      ),
    )
  } else if (command === 'elements') {
    if (args.length > 2) throw new Error(usage)
    console.log(
      JSON.stringify(
        await jsonRequest(
          base + '/api/resource-catalog/packs/' + id(args[0]) + '/elements',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(catalogRequest(args[1])),
          },
        ),
      ),
    )
  } else if (command === 'pack' || command === 'element') {
    const path =
      '/api/resource-packs/' +
      id(args[0]) +
      (command === 'element' ? '/elements/' + id(args[1]) : '')
    console.log(JSON.stringify(await jsonRequest(base + path)))
  } else if (command === 'fetch') {
    const packId = id(args[0])
    const elementId = id(args[1])
    const output = await assetDestination(args[2])
    const [pack, element, location] = await Promise.all([
      jsonRequest(base + '/api/resource-packs/' + packId),
      jsonRequest(
        base + '/api/resource-packs/' + packId + '/elements/' + elementId,
      ),
      jsonRequest(
        base +
          '/api/resource-packs/' +
          packId +
          '/elements/' +
          elementId +
          '/resource-url',
      ),
    ])
    const url = new URL(location.url)
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Library returned an invalid download URL')
    const reservedFile = await open(output.target, 'wx', 0o600)
    let saved = false
    try {
      const file = await saveBytes(
        await fetch(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(90_000),
        }),
        output,
        reservedFile,
      )
      const expectedHash = (element.element ?? element).specs?.contentHash
      if (
        typeof expectedHash === 'string' &&
        /^[a-f0-9]{64}$/.test(expectedHash) &&
        file.sha256 !== expectedHash
      )
        throw new Error(
          'Downloaded file hash does not match the selected library element',
        )
      saved = true
      console.log(
        JSON.stringify({
          ...file,
          source: 'resource-library',
          pack: pack.pack ?? pack,
          element: element.element ?? element,
          note: 'Inspect dependencies before registering this file in the Manifest.',
        }),
      )
    } finally {
      await reservedFile.close()
      if (!saved) await unlink(output.target).catch(() => undefined)
    }
  } else if (command === 'inspect') {
    if (!args.length) throw new Error('inspect requires one or more asset paths')
    const results = await Promise.all(args.map(async path => {
    const asset = await assetDestination(path, false)
    if ((await realpath(asset.target)) !== asset.target)
      throw new Error('Asset must not resolve through a link')
    const bytes = await readFile(asset.target)
    return {
        path: asset.path,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ...(bytes.length >= 24 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
          : {}),
      }
    }))
    console.log(JSON.stringify(results.length === 1 ? results[0] : { files: results,
      local_file_hashes: Object.fromEntries(results.map(file => [file.path, file.sha256])) }))
  } else if (command === 'atlas') {
    const source = await assetDestination(args[0], false)
    const specification = await assetDestination(args[1], false)
    if ((await realpath(source.target)) !== source.target ||
        (await realpath(specification.target)) !== specification.target)
      throw new Error('Atlas inputs must not resolve through links')
    const output = await assetDestination(args[2])
    if (!output.path.startsWith('assets/runtime/') || !output.path.endsWith('.png'))
      throw new Error('Atlas output must be a PNG under assets/runtime/')
    const sidecar = await assetDestination(output.path.slice(0, -4) + '.json')
    const bytes = await readFile(source.target)
    if (bytes.length < 26 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error('Atlas source must be a PNG')
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
    if (!width || !height || width * height > 16_000_000)
      throw new Error('Atlas source dimensions are invalid or too large')
    const frameSpec = JSON.parse(await readFile(specification.target, 'utf8'))
    const atlas = atlasFrames(frameSpec, width, height)
    const imageFile = await open(output.target, 'wx', 0o600)
    let published = false
    try {
      await imageFile.writeFile(bytes)
      await writeFile(sidecar.target, JSON.stringify(atlas, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      published = true
      console.log(JSON.stringify({ image: output.path, sidecar: sidecar.path,
        width, height, frames: Object.keys(atlas.frames),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        note: 'Inspect the frame artwork and register the PNG and sidecar in the Asset Manifest.' }))
    } finally {
      await imageFile.close()
      if (!published) await unlink(output.target).catch(() => undefined)
    }
  } else if (command === 'cost') {
    if (!TOOL_CONFIG.imageEndpoint)
      throw new Error('AI image generation is unavailable for this turn')
    const endpoint = new URL(TOOL_CONFIG.imageEndpoint)
    if (args[0]) endpoint.searchParams.set('quality', args[0])
    if (args[1]) endpoint.searchParams.set('size', args[1])
    console.log(JSON.stringify(await jsonRequest(endpoint)))
  } else if (command === 'generate') {
    if (!TOOL_CONFIG.imageEndpoint)
      throw new Error('AI image generation is unavailable for this turn')
    const request = JSON.parse(await readFile(args[0], 'utf8'))
    if (
      typeof request.requestId !== 'string' ||
      !request.requestId.trim() ||
      typeof request.prompt !== 'string' ||
      !request.prompt.trim() ||
      (request.referenceImagePath !== undefined &&
        (typeof request.referenceImagePath !== 'string' ||
          !request.referenceImagePath.startsWith('assets/') ||
          request.referenceImagePath.split(/[\\/]/).includes('..')))
    )
      throw new Error('Request file needs requestId and prompt')
    const quoteUrl = new URL(TOOL_CONFIG.imageEndpoint)
    if (request.quality) quoteUrl.searchParams.set('quality', request.quality)
    if (request.size) quoteUrl.searchParams.set('size', request.size)
    const quote = await jsonRequest(quoteUrl)
    if (!quote.available) throw new Error('AI image generation unavailable: ' + (quote.unavailableReason ?? 'check model, credentials and billing'))
    if (quote.provider === 'cloudflare') {
      if (!Number.isSafeInteger(quote.quotedCreditsMicro) || quote.quotedCreditsMicro <= 0)
        throw new Error('Cloudflare image has no fixed Credit price for this quality and size')
      console.error('Image price: ' + quote.quotedCreditsMicro / 1_000_000 + ' Credits; reserving before generation')
    }
    const output = await assetDestination(args[1])
    // Reserve the destination before any potentially billable provider call.
    const reservedFile = await open(output.target, 'wx', 0o600)
    let saved = false
    try {
      const response = await fetch(TOOL_CONFIG.imageEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(180_000),
      })
      const file = await saveBytes(response, output, reservedFile)
      saved = true
      console.log(
        JSON.stringify({
          ...file,
          source: 'agent-authored',
          requestId: request.requestId,
          chargedCreditsMicro: response.headers.get('x-image-credits-micro'),
          billingState: response.headers.get('x-image-billing-state'),
          note: 'Inspect the actual image and register the selected file in the Manifest.',
        }),
      )
    } finally {
      await reservedFile.close()
      if (!saved) await unlink(output.target).catch(() => undefined)
    }
  } else throw new Error('Unknown command. Run help for usage.')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
