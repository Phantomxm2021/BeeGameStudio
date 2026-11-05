// Project-local command adapter; managed sessions resolve current BGS capabilities per invocation.
// The host prepends TOOL_CONFIG when copying this file into the current session work directory.
import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const catalogFilterKeys = ['packIds','dimensions','primaryCategories','categories','styles','gameTypes','packTags','usageTags','assetKinds','capabilities','formats']
const catalogUsage = 'Catalog accepts structured filter arrays: '+catalogFilterKeys.join(', ')+
  '. No free-text query/search. Use {"filters":{"formats":["png"]},"limit":10,"cursor":"<returned nextCursor>"}; flat filter arrays with limit/cursor also work.'
  + ' Catalog returns compact items, total, facets and optional nextCursor. Use pack/element for selected metadata or append --details for full list items. readyElementCount counts technically browsable files, not proven matches. Empty usageTags means unclassified, not unavailable; inspect or audition before choosing a game role.'

const atlasInputFormat = 'Atlas input: {"frames":{"name":{"x":0,"y":0,"w":32,"h":32}}}. Frame values are flat rectangles; nested {frame:{x,y,w,h}} is the output sidecar format, not input.'
const workspaceUsage = 'Run from the project root: bun <current-tools-directory>/assets.mjs <command> [arguments]. Use the current BGS tools directory supplied in the project context as the script prefix; keep the project root as cwd. Relative JSON input paths and assets/ output paths are relative to the project root.'

const usage = `Usage: bun <this-file> <command> [arguments]
${workspaceUsage}
  catalog [request-json] [--details]      Browse library packs and available facets
  elements <pack-id> [request-json] [--details]  Browse a selected pack's elements
  pack <pack-id>                         Read license, version and pack metadata
  element <pack-id> <element-id>         Read element and dependency metadata
  fetch <pack-id> <element-id> <assets/path>  Download one selected library file and its complete dependency closure
  inspect <assets/path> [assets/path ...] Hash local assets in one call; no provenance/quality inference
  cost [quality] [size]                 Show availability and image pricing terms
  ui-board-plan <request.json>          Read-only: complete game-screen design board grid and prompt, no network or billing
  ui-assets-plan <request.json>         Optional reference-guided UI atlas planning, no network or billing
  generate <request.json> <assets/path>  Generate or revise a PNG; generate --help has JSON examples and quoting
  generate --help / ui-board-plan --help  Reference images and revisions
  ui-assets-plan --help                Optional reference-guided image work
  atlas <assets/sheet.png> <assets/frames.json> <assets/runtime/name.png>
                                         Publish named rectangles as a PNG + same-basename atlas JSON
${atlasInputFormat} Coordinates are integer source-image pixels from the top-left; x/y >= 0, w/h > 0. Rectangles must fit the PNG and not overlap. Both inputs are project-relative files under assets/; output is a new PNG under assets/runtime/.
Use atlas to publish inspected rectangles, then resources.mjs to register the pair. atlas copies the PNG bytes unchanged; separate part files and repacking are not required for a usable intact sheet. For static atlas generation, describe the elements, relative proportions and transparent separation; determine their source-pixel rectangles from the returned image for this import command. Inspect complete elements and sampling gutters; animated sheets additionally need pose alignment and playback checks. Nonoverlap alone does not prove suitability. atlas does not pack separate images or approve appearance. A full-screen reference board is not automatically a production sheet.
For read-only decoded alpha/bounds measurements (operation:inspect), or a demonstrated need for crop/resize/composition and packing separate sprites, use ${TOOL_CONFIG.mediaCommand ?? 'bun <current-tools-directory>/media.mjs'} --help. Replace <current-tools-directory> with the current BGS tools directory supplied in the project context; keep the project root as cwd. Alpha bounds do not identify objects or automatically define safe crops. Its JSON request supports named crop regions, explicit filtering/padding and compatible atlas output; no package installation or custom PNG encoder is needed.
Honor explicit source and resource-library preferences, usage rights and authorized cost. Preserve required appearance and behavior. No command updates the Manifest.
${catalogUsage}
Commands are optional; unavailable access is not an empty catalog.`

const imageUsage = `Image commands (prefix with bun <this-file>):
${workspaceUsage}
For production assets, honor explicit source preferences, rights and charge authorization. The existing cost command reports the current configured image model, availability and request options; it does not verify generated appearance or motion.
For production artwork, determine image deliverables before per-object output paths: compatible static UI parts share a transparent UI atlas, and compatible static game parts share a separate game-element atlas. Submit each atlas as one image request listing all its required parts/states together. Use purpose: production and prompt from the confirmed appearance definitions; include requirementIds when requirements already exist. Neither a selected design image nor referenceImagePath is required. Describe silhouettes, relative proportions, materials, lighting and transparent separation; determine extraction bounds after generation. Backgrounds/layers with incompatible opacity or scale can remain separate; a family with only one required element can remain a single image. Character action sequences follow the sprite-animation method. Keep live text/values out of skins and production assets out of uiReference.screens.
  cost low <size>                        Optional availability/price query; no generation
  ui-board-plan <request.json>           Optional offline board layout and chosen size
  generate <request.json> <assets/path>  Submit the JSON file; output must be a new path under assets/
Request fields are JSON keys, not CLI flags. Use purpose: reference|experiment|production. For new work, omit requestId: generate assigns a unique ID and saves it in this JSON file before submission. For recovery, reuse the original file unchanged (including its saved requestId); an explicit requestId preserves an existing identity and is never automatically replaced. A new authorized design or revision uses a new file without requestId; do not remove or change an ID merely to retry an unknown paid attempt. Production can precede registration when no existing requirement or required-library policy blocks it. When requirements already exist, include their requirementIds. References/experiments do not fulfill runtime requirements. Missing metadata is only for recovery of an existing paid attempt.
Optional keys: referenceImagePath, requirementIds, background (auto|opaque|transparent), quality (auto|low|medium|high|xhigh|max), size (1024x1024|1024x1536|1536x1024). Quality follows the request or configured default; a uiReference board defaults to low. Generation checks availability and applicable pricing before submission within charge authorization. Use cost when a price query or an explicit user budget needs it. fixedPrice:true supplies quotedCredits; fixedPrice:false is usage-priced with quotedCredits:null.
Request shape only; replace screens with the distinct compositions needed to cover the GDD states; shared conditional variants map to those compositions in the handoff (this placeholder is not a screen inventory):
{"purpose":"reference","quality":"low","uiReference":{"viewport":{"width":1280,"height":720},"style":"Shared GDD art direction and user visual choices","screens":[{"id":"state-from-gdd","description":"Player situation; necessary information/actions; GDD composition and constraints applicable to this state"}]}}
When choosing a game-screen overview board, use uiReference instead of prompt. Derive screens from the GDD's detailed player-visible design: describe the situation, necessary information/actions, chosen composition and state-specific constraints. Use style for the shared GDD art direction and user visual choices. Image design develops concrete appearance and open visual details within that design, preserving functionality without extra controls, readouts or player-facing steps. Keep required overlays and recovery states, allowing defined copy/value and control-visibility variants to share a composition under the visual-production method. Apply gameplay camera constraints only to descriptions of states retaining that view. Each depicted panel shows one actual state; conditional reuse keeps mutually exclusive interfaces out of the same picture. Character/action sheets are resource work. Viewport is the main game viewport and follows the confirmed orientation; the tool derives grid/canvas from the list. Offline planning and submission apply the same orientation check. Quote the ui-board-plan size and submit the SAME STRUCTURED file. Its blank guide constrains input, not measured output.
A targeted local concept edit or a separate adaptation overlay uses prompt instead of uiReference, with the supported image size and selected appearance. Its canvas may differ from the main game orientation; this does not change that orientation. Example repair of a missing required action in an otherwise usable composition:
{"purpose":"reference","quality":"low","size":"1536x1024","referenceImagePath":"assets/reference/selected.png","prompt":"Preserve composition and subjects; uncover the required primary control hidden by the overlay, retaining only the actions available in this state."}
referenceImagePath also works with uiReference. Use a project-relative PNG under assets/ and a provider reporting referenceImageSupported; viewing the image in chat does not pass it to generation. A reference guides the new image, not deterministic pixel editing. For a requested new composition or correction of a conflicting reference, omit that referenceImagePath; uiReference then uses the blank layout guide. If the prior request already used this guide, repeating it with stronger wording is the same method. Preserve confirmed identity, style and palette without inventing layout or camera requirements. For a new free-form image, omit referenceImagePath.
For concept inspection and handoff, follow the shared visual-production Skill and the current stage result contract. Screen concepts are reference images, not runtime assets; the requested layout is planning data, not a measurement of the generated image.`

const uiAssetUsage = `Optional reference-guided UI atlas (common request fields and quoting: generate --help).
Use this path for an explicitly reference-guided image task. Ordinary resource production uses purpose: production and prompt from confirmed appearance definitions, without requiring a selected design image; explicit user source choices take precedence.
Production artwork may be generated before any Manifest requirements exist, then registered with actual paths and provenance. This does not satisfy a resource requirement automatically. If requirements are already registered, include their requirementIds for PNG-compatible parts; omitting them cannot bypass source constraints.
For this reference-guided operation replace prompt with uiAssets:{elements:[{id,description,width,height},...]}, purpose:production, requirementIds when requirements already exist, and referenceImagePath pointing to the selected UI design. Descriptions identify appearance/state in that design, not an invented visual direction. ui-assets-plan reads/hashes the actual reference and compiles a shared transparent atlas request on the specified canvas (1024x1024 if omitted); generate accepts the same request. Element width/height describe design proportions. The image arranges the differently sized parts with separation; the plan supplies no grid or frame coordinates and does not generate automatically. Keep live text/values/progress/hit areas in runtime UI; use existing media/resources for inspected named frames. Runtime layout, live text and simple geometric controls remain code-owned; distinctive decorative skins remain artwork. This path does not turn a reference board into a runtime atlas or certify visual fidelity.`

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

function imageRequest(value, screenOrientation) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Image request must be a JSON object')
  const allowed = ['requestId', 'purpose', 'requirementIds', 'prompt', 'uiReference', 'uiAssets', 'background', 'quality', 'size', 'referenceImagePath']
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length) throw new Error('Unknown image request fields: ' + unknown.join(', '))
  for (const [key, max] of [['requestId', 200], ['prompt', 32000]]) {
    if (key === 'requestId' && value.requestId === undefined) continue
    if (key === 'prompt' && (value.uiReference !== undefined || value.uiAssets !== undefined)) continue
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].trim().length > max)
      throw new Error('Image request ' + key + ' must be a nonempty string of at most ' + max + ' characters')
  }
  for (const [key, options] of [
    ['purpose', ['reference', 'experiment', 'production']],
    ['background', ['auto', 'opaque', 'transparent']],
    ['quality', ['auto', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['size', ['1024x1024', '1024x1536', '1536x1024']],
  ]) {
    if (value[key] !== undefined && !options.includes(value[key]))
      throw new Error('Image request ' + key + ' must be one of: ' + options.join(', '))
  }
  if (value.referenceImagePath !== undefined &&
    (typeof value.referenceImagePath !== 'string' || !value.referenceImagePath.trim() ||
      value.referenceImagePath.length > 512 || !value.referenceImagePath.startsWith('assets/') ||
      value.referenceImagePath.split(/[\\/]/).includes('..')))
    throw new Error('Image request referenceImagePath must be a project-relative path under assets/')
  if (value.uiReference !== undefined) compileUiReferenceBoard(value, screenOrientation)
  if (value.uiAssets !== undefined) compileUiAssetSheet(value)
  return value
}

async function currentCapabilities() {
  const path = process.env.BEEGAME_ASSET_CAPABILITY_FILE
  if (!path) {
    if (TOOL_CONFIG.sessionId) throw Error('ASSET_CAPABILITY_MISSING: No active BGS resource connection in this execution environment. Use the current BGS turn; do not probe ports or request broader network access.')
    return TOOL_CONFIG
  }
  let capability
  try { capability = JSON.parse(await readFile(path, 'utf8')) }
  catch { throw Error('ASSET_CAPABILITY_EXPIRED: The BGS resource connection is missing or unreadable. Use the current BGS turn; this does not establish provider availability.') }
  if (capability?.version !== 1 || typeof capability.workspace !== 'string' ||
      !isAbsolute(capability.workspace) || resolve(capability.workspace) !== capability.workspace ||
      typeof capability.sessionId !== 'string' || !capability.sessionId ||
      TOOL_CONFIG.sessionId && capability.sessionId !== TOOL_CONFIG.sessionId ||
      typeof capability.executionId !== 'string' || !capability.executionId ||
      !capability.assets || typeof capability.assets !== 'object' || Array.isArray(capability.assets))
    throw Error('ASSET_CAPABILITY_MISMATCH: Resource connection belongs to another workspace/session or is invalid.')
  for (const endpoint of [capability.assets.libraryBaseUrl, capability.assets.imageEndpoint, capability.assets.registrationEndpoint]) {
    if (endpoint === undefined) continue
    let url
    try { url = new URL(endpoint) } catch { throw Error('ASSET_CAPABILITY_MISMATCH: Invalid resource endpoint.') }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash)
      throw Error('ASSET_CAPABILITY_MISMATCH: Invalid resource endpoint.')
  }
  if (capability.assets.screenOrientation !== undefined && !['Landscape', 'Portrait'].includes(capability.assets.screenOrientation))
    throw Error('ASSET_CAPABILITY_MISMATCH: Invalid screen orientation.')
  const cwd = await realpath(process.cwd())
  if (cwd !== capability.workspace) {
    const fromWorkspace = relative(capability.workspace, cwd)
    if (fromWorkspace && fromWorkspace !== '..' && !fromWorkspace.startsWith('..' + sep) && !isAbsolute(fromWorkspace))
      throw Error('ASSET_WORKSPACE_CWD: Current directory is a project subdirectory. Return to the current project root and invoke bun <current-tools-directory>/assets.mjs with the current BGS tools directory as the script prefix. No resource request was sent; this does not establish provider availability.')
    throw Error('ASSET_CAPABILITY_MISMATCH: Resource connection belongs to another workspace/session or is invalid.')
  }
  return capability.assets
}

async function capabilityFetch(url, init, requestId) {
  try { return await fetch(url, { ...init, redirect: 'error' }) }
  catch {
    throw Error(requestId
      ? 'ASSET_REQUEST_OUTCOME_UNKNOWN: BGS image request transport failed; requestId=' + requestId + '. No automatic retry. Inspect the existing attempt before recovery; keep this requestId.'
      : 'ASSET_BRIDGE_UNREACHABLE: The current BGS resource connection could not be reached. This does not establish provider availability; do not probe ports or request broader network access.')
  }
}

async function jsonRequest(url, init, signal) {
  const response = await capabilityFetch(url, {
    ...init,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
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
  if (createParent) {
    let ancestor = dirname(target)
    while (ancestor !== root) {
      try {
        if ((await lstat(ancestor)).isSymbolicLink() || await realpath(ancestor) !== ancestor)
          throw new Error('Output directory must not resolve through a link')
        break
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        ancestor = dirname(ancestor)
      }
    }
    await mkdir(dirname(target), { recursive: true })
  }
  const actualParent = await realpath(dirname(target))
  if (
    actualParent !== dirname(target) ||
    (actualParent !== assets && !actualParent.startsWith(assets + '/'))
  )
    throw new Error('Output directory must not resolve through a link')
  return { target, path: relative(root, target) }
}

async function verifiedAssetBytes(output, expectedHash) {
  let listed
  try { listed = await lstat(output.target) }
  catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
  if (listed.isSymbolicLink()) throw new Error('Asset destination must not be a link')
  if (!listed.isFile()) throw new Error('Asset destination already exists and is not a regular file')

  // lstat alone is not enough: the path can be replaced between the check and
  // the read. Open the same path without following a final symlink, then use
  // the descriptor for both the identity check and the hash read. In
  // particular, never open a FIFO just to discover that it is not a file.
  let handle
  try {
    handle = await open(output.target, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    if (error?.code === 'ELOOP') throw new Error('Asset destination must not be a link')
    throw error
  }
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Asset destination already exists and is not a regular file')
    if (info.dev !== listed.dev || info.ino !== listed.ino)
      throw new Error('Asset destination changed while it was being inspected')
    if (!Number.isSafeInteger(info.size) || info.size > 256 * 1024 * 1024)
      throw new Error('Asset exceeds the 256 MiB download limit')
    const bytes = await handle.readFile()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== expectedHash)
      throw new Error('Asset destination already exists with a different content hash; refusing to overwrite it')
    return bytes
  } finally {
    await handle.close()
  }
}

async function existingAsset(output, expectedHash) {
  const bytes = await verifiedAssetBytes(output, expectedHash)
  return bytes ? { path: output.path, sha256: expectedHash, bytes: bytes.length, reused: true } : undefined
}

// Keep dependency URI normalization identical to the resource binding rules:
// dots and separators are portable, while absolute paths and URI schemes are
// rejected. A leading ../ is legal when the resolved local file remains under
// this project's assets directory.
function normalizeResourceReference(value) {
  if (typeof value !== 'string') return undefined
  const source = value.trim().replaceAll('\\', '/')
  if (!source || source.startsWith('/') || source.includes(':')) return undefined
  const parts = []
  for (const part of source.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length && parts.at(-1) !== '..') parts.pop()
      else parts.push('..')
    } else parts.push(part)
  }
  return parts.join('/') || undefined
}

function dependencyOutputPath(parentPath, referencePath) {
  let decoded
  try { decoded = decodeURIComponent(referencePath) }
  catch { throw new Error('Resolved resource dependency has an invalid percent-encoded reference path') }
  const normalized = normalizeResourceReference(decoded)
  if (!normalized)
    throw new Error('Resolved resource dependency has no reference path')
  const output = resolve(dirname(parentPath), normalized)
  const assetsRoot = resolve('assets')
  if (output !== assetsRoot && !output.startsWith(assetsRoot + sep))
    throw new Error('Resolved resource dependency must stay inside assets/')
  return relative(resolve('.'), output).split(sep).join('/')
}

function pngDimensions(bytes) {
  return bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    : {}
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
    ...pngDimensions(bytes),
  }
}

function atlasFrames(value, width, height) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !value.frames || typeof value.frames !== 'object' || Array.isArray(value.frames))
    throw new Error(atlasInputFormat)
  const entries = Object.entries(value.frames)
  if (!entries.length || entries.length > 128) throw new Error('Atlas needs 1–128 named frames')
  const frames = {}
  const rectangles = []
  for (const [name, rectangle] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name))
      throw new Error('Invalid atlas frame name: ' + name + '. Use letters, digits, underscores or hyphens, starting with a letter or digit.')
    if (!rectangle || typeof rectangle !== 'object' || Array.isArray(rectangle) ||
        !['x', 'y', 'w', 'h'].every(key => Number.isSafeInteger(rectangle[key])))
      throw new Error('Invalid atlas frame fields: ' + name + '. x, y, w and h must be integers. ' + atlasInputFormat)
    if (rectangle.x < 0 || rectangle.y < 0 || rectangle.w < 1 || rectangle.h < 1 ||
        rectangle.x + rectangle.w > width || rectangle.y + rectangle.h > height)
      throw new Error(`Out-of-bounds atlas frame: ${name}; x=${rectangle.x}, y=${rectangle.y}, w=${rectangle.w}, h=${rectangle.h}; PNG=${width}x${height}. Require x/y >= 0, w/h > 0, x+w <= ${width}, y+h <= ${height}.`)
    for (const previous of rectangles)
      if (rectangle.x < previous.x + previous.w && previous.x < rectangle.x + rectangle.w &&
          rectangle.y < previous.y + previous.h && previous.y < rectangle.y + rectangle.h)
        throw new Error('Overlapping atlas frames: ' + name)
    rectangles.push(rectangle)
    frames[name] = { frame: { x: rectangle.x, y: rectangle.y, w: rectangle.w, h: rectangle.h } }
  }
  return { frames }
}

async function generateImage(args, capabilities, signal) {
  if (!capabilities.imageEndpoint)
    throw new Error('AI image generation is unavailable for this turn')
  const submittedRequest = imageRequest(JSON.parse(await readFile(args[0], 'utf8')), capabilities.screenOrientation)
  const newRequest = submittedRequest.requestId === undefined
  if (newRequest) submittedRequest.requestId = randomUUID()
  const board = submittedRequest.uiAssets !== undefined ? compileUiAssetSheet(submittedRequest) :
    submittedRequest.uiReference === undefined ? undefined : compileUiReferenceBoard(submittedRequest, capabilities.screenOrientation)
  const request = board?.request ?? submittedRequest
  const quoteUrl = new URL(capabilities.imageEndpoint)
  if (request.quality) quoteUrl.searchParams.set('quality', request.quality)
  if (request.size) quoteUrl.searchParams.set('size', request.size)
  const quote = await jsonRequest(quoteUrl, undefined, signal)
  // Billing incompatibility blocks new work in the host, but paid receipts must still reach recovery.
  if (!quote.available && quote.unavailableCode !== 'billing-unsupported')
    throw new Error('AI image generation unavailable: ' + (quote.unavailableReason ?? 'check model, credentials and billing'))
  if (submittedRequest.uiAssets !== undefined && quote.referenceImageSupported !== true)
    throw Error('UI skins require a provider that accepts the selected design image; no generation was submitted')
  if (quote.fixedPrice === true) {
    if (!Number.isSafeInteger(quote.quotedCreditsMicro) || quote.quotedCreditsMicro <= 0)
      throw new Error('Image has no fixed Credit price for this quality and size')
    console.error('Image price: ' + quote.quotedCreditsMicro / 1_000_000 + ' Credits; reserving before generation')
  }
  const output = await assetDestination(args[1])
  // Reserve the destination before any potentially billable provider call.
  const reservedFile = await open(output.target, 'wx', 0o600)
  let saved = false
  try {
    // Persist before submission so a lost response cannot turn recovery into new paid work.
    if (newRequest) await writeFile(args[0], JSON.stringify(submittedRequest, null, 2) + '\n')
    const response = await capabilityFetch(capabilities.imageEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(submittedRequest),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
    }, request.requestId)
    const file = await saveBytes(response, output, reservedFile)
    saved = true
    return {
        ...file,
        source: 'agent-authored',
        requestId: request.requestId,
        chargedCredits: response.headers.has('x-image-credits-micro') ? Number(response.headers.get('x-image-credits-micro')) / 1_000_000 : null,
        currency: 'Credits',
        billingState: response.headers.get('x-image-billing-state'),
        note: submittedRequest.purpose === 'production'
          ? 'Inspect the actual image and register the selected file in the Manifest.'
          : 'Inspect the actual image for its declared purpose. Reference and experiment images do not fulfill runtime resource requirements.',
    }
  } finally {
    await reservedFile.close()
    if (!saved) await unlink(output.target).catch(() => undefined)
  }
}


/** A viewing surface only: keep the generated PNG and its facts unchanged. */
async function transparencyPreview(result) {
  if (!process.env.BEEGAME_SHARP_MODULE) throw Error('Host image decoder is unavailable')
  const image = (await import(process.env.BEEGAME_SHARP_MODULE)).default
  const output = await assetDestination(result.path, false)
  const bytes = await verifiedAssetBytes(output, result.sha256)
  if (!bytes) throw Error('Saved image is missing before preview rendering')
  const source = image(bytes, {limitInputPixels:64*1024*1024})
  const {width,height,hasAlpha} = await source.metadata()
  if (!hasAlpha) return undefined
  const tw = Math.min(32,width), th = Math.min(32,height), tile = Buffer.alloc(tw*th*3)
  for (let y=0;y<th;y++) for (let x=0;x<tw;x++) {
    const color = (Math.floor(x/16)+Math.floor(y/16))%2 ? 220 : 250
    tile.fill(color,(y*tw+x)*3,(y*tw+x+1)*3)
  }
  return image({create:{width,height,channels:3,background:'#ffffff'}})
    .composite([{input:tile,raw:{width:tw,height:th,channels:3},tile:true},{input:bytes}])
    .png().toBuffer()
}

async function runImageMcp() {
  if (!TOOL_CONFIG.imageMcpModules) throw Error('Image MCP is not configured for this entry')
  const [{Server}, {StdioServerTransport}, {CallToolRequestSchema,ListToolsRequestSchema}] = await Promise.all([
    import(TOOL_CONFIG.imageMcpModules.server), import(TOOL_CONFIG.imageMcpModules.stdio), import(TOOL_CONFIG.imageMcpModules.types),
  ])
  // Bind this process to its original turn endpoint, not a later published turn.
  const capabilities = await currentCapabilities(), execution = randomUUID()
  const server = new Server({name:'beegame-images',version:'1'}, {capabilities:{tools:{}}})
  server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:capabilities.imageEndpoint ? [{
    name:'generate_image',
    description:'Generate or edit project PNG artwork, including character reference sheets, per-character action pose sheets, game-element atlases, UI atlases and backgrounds, through the configured image service independently of the chat model. Supports a project reference image and transparent-background requests; pose consistency, frame geometry and playback need inspection and runtime preparation. assets.mjs cost reports the current configured image model and request options. Uses the existing availability, pricing, source, reference-image and recovery contract. Save to a new assets/ outputPath. Reuse requestId only to recover the unchanged original request; no automatic paid retry. Returns actual saved-file facts and, for alpha images, one checkerboard viewing preview. The source PNG stays unchanged; this does not register assets or verify appearance.',
    inputSchema:{type:'object',properties:{
      request:{type:'object',properties:{
        requestId:{type:'string'},purpose:{type:'string',enum:['reference','experiment','production']},
        prompt:{type:'string',description:'Use exactly one of prompt, uiReference or uiAssets.'},
        uiReference:{type:'object',description:'Existing ui-board-plan specification; see assets.mjs generate --help.'},
        uiAssets:{type:'object',description:'Existing design-linked UI atlas specification; see assets.mjs ui-assets-plan --help.'},
        requirementIds:{type:'array',items:{type:'string'}},referenceImagePath:{type:'string',description:'Project-relative reference image under assets/.'},
        background:{type:'string',enum:['auto','opaque','transparent']},
        quality:{type:'string',enum:['auto','low','medium','high','xhigh','max']},
        size:{type:'string',enum:['1024x1024','1024x1536','1536x1024']},
      },required:['purpose'],additionalProperties:false},
      outputPath:{type:'string',description:'New project-relative file under assets/.'},
    },required:['request','outputPath'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true},
  }] : []}))
  server.setRequestHandler(CallToolRequestSchema, async ({params}, extra) => {
    let requestId, requestFile
    try {
      if (params.name !== 'generate_image') throw Error('Unknown image tool')
      const args = params.arguments
      if (!args || !args.request || typeof args.request !== 'object' || Array.isArray(args.request) || typeof args.outputPath !== 'string')
        throw Error('Expected request and outputPath')
      extra.signal.throwIfAborted()
      requestId = args.request.requestId ?? 'mcp-' + createHash('sha256').update(JSON.stringify([execution,extra.requestId])).digest('hex')
      requestFile = resolve(dirname(fileURLToPath(import.meta.url)), 'image-request-' + randomUUID() + '.json')
      await writeFile(requestFile, JSON.stringify({...args.request,requestId},null,2)+'\n', {flag:'wx',mode:0o600})
      const result = await generateImage([requestFile,args.outputPath],capabilities,extra.signal)
      const content=[{type:'text',text:JSON.stringify({...result,requestFile})}]
      // A preview failure follows a saved, potentially paid result. Preserve
      // that result and its recovery identity rather than failing generation.
      try {
        const preview=await transparencyPreview(result)
        if (preview) content.push(
          {type:'text',text:'Transparency viewing preview on a checkerboard. The saved source PNG remains transparent; this preview is not a production asset.'},
          {type:'image',mimeType:'image/png',data:preview.toString('base64')})
      } catch (error) {
        content.push({type:'text',text:'Image saved; viewing preview unavailable: '+(error instanceof Error?error.message:String(error))})
      }
      return {content}
    } catch (error) {
      return {isError:true,content:[{type:'text',text:(error instanceof Error ? error.message : String(error)) +
        (requestFile ? '\nOriginal request: '+requestFile+'; requestId='+requestId+'. Do not automatically resubmit or change this ID.' : '')}]}
    }
  })
  await server.connect(new StdioServerTransport())
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === '--mcp') return runImageMcp()
  if (!command || command === 'help' || command === '--help') {
    console.log(usage)
    return
  }
  if (args.length === 1 && args[0] === '--help' && ['generate', 'cost', 'ui-board-plan', 'ui-assets-plan'].includes(command)) {
    console.log(command === 'ui-assets-plan' ? uiAssetUsage : imageUsage)
    return
  }
  // Resolve once: quote and paid submission must use the same execution.
  const capabilities = ['catalog', 'elements', 'pack', 'element', 'fetch', 'cost', 'generate', 'ui-board-plan'].includes(command)
    ? await currentCapabilities() : {}
  const base = capabilities.libraryBaseUrl
  if (
    ['catalog', 'elements', 'pack', 'element', 'fetch'].includes(command) &&
    !base
  )
    throw new Error('Built-in resource library is unavailable for this turn')
  if (command === 'catalog' || command === 'elements') {
    const details = args.at(-1) === '--details'
    if (details) args.pop()
    const isPack = command === 'catalog'
    if (args.length > (isPack ? 1 : 2)) throw new Error(usage)
    const path = '/api/resource-catalog/packs' + (isPack ? '' : '/' + id(args[0]) + '/elements')
    const result = await jsonRequest(base + path, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(catalogRequest(args[isPack ? 0 : 1])),
    })
    if (!details && Array.isArray(result.items)) {
      const fields = isPack
        ? ['packId', 'packVersion', 'packName', 'dimension', 'primaryCategory', 'categories', 'styles', 'gameTypes', 'readyElementCount', 'assetKinds', 'formats', 'license']
        : ['packId', 'packVersion', 'elementId', 'elementName', 'elementPath', 'category', 'dimension', 'assetKind', 'usageTags', 'capabilities', 'dependencyCount']
      result.items = result.items.map(item => Object.fromEntries(fields.filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]])))
    }
    console.log(JSON.stringify(result))
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
    const [pack, element] = await Promise.all([
      jsonRequest(base + '/api/resource-packs/' + packId),
      jsonRequest(
        base + '/api/resource-packs/' + packId + '/elements/' + elementId,
      ),
    ])
    const expectedHash = (element.element ?? element).specs?.contentHash
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash))
      throw new Error('Library element requires a valid stored content hash before download')
    const selectedPack = pack.pack ?? pack, selectedElement = element.element ?? element
    if (typeof selectedPack.version !== 'string' || !selectedPack.version.trim() ||
        typeof selectedElement.path !== 'string' || !selectedElement.path.trim())
      throw new Error('Library selection requires its pack version and element path before download')
    const registrationSource = { type:'resource-library', pack_id:packId, pack_version:selectedPack.version,
      element_id:elementId, element_path:selectedElement.path }
    const resolved = await jsonRequest(base + '/api/resource-library/resolve', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        selections: [{
          resourceId: elementId,
          packId,
          expectedPackVersion: selectedPack.version,
          elementId,
          destinationPath: output.path,
          selectionReason: ['Explicitly selected through project asset fetch'],
        }],
      }),
    })
    const selected = Array.isArray(resolved.selections) && resolved.selections.length === 1
      ? resolved.selections[0] : undefined
    if (!selected || typeof selected.sourceUrl !== 'string' || selected.sourceHash !== expectedHash ||
        !Array.isArray(selected.dependencies) ||
        !/^[a-f0-9]{64}$/.test(selected.sourceHash))
      throw new Error('Resource library returned an incomplete or inconsistent dependency closure')

    const dependencyDownloads = selected.dependencies.map((dependency, index) => {
      if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency))
        throw new Error('Resource library returned an incomplete dependency record at index ' + index)
      const key = dependency.key
      const parentKey = dependency.parentKey
      const dependencyElementId = dependency.elementId
      const elementPath = dependency.elementPath
      const referencePath = dependency.referencePath
      if (typeof key !== 'string' || !key.trim() || key === 'root' ||
          typeof parentKey !== 'string' || !parentKey.trim() ||
          typeof dependencyElementId !== 'string' || !dependencyElementId.trim() ||
          typeof elementPath !== 'string' || !elementPath.trim() ||
          !referencePath || !normalizeResourceReference(referencePath))
        throw new Error('Resource library returned incomplete dependency metadata at index ' + index)
      if (dependency.kind !== undefined &&
          (typeof dependency.kind !== 'string' || !dependency.kind.trim()))
        throw new Error('Resource library returned invalid dependency kind at index ' + index)
      if (typeof dependency.sourceUrl !== 'string' ||
          typeof dependency.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(dependency.sourceHash))
        throw new Error('Resource library returned an incomplete dependency download record')
      return {
        key: key.trim(),
        parentKey: parentKey.trim(),
        elementId: dependencyElementId.trim(),
        elementPath: elementPath.trim(),
        referencePath,
        ...(dependency.kind ? { kind: dependency.kind.trim() } : {}),
        sourceUrl: dependency.sourceUrl,
        sourceHash: dependency.sourceHash,
      }
    })
    const localPathByKey = new Map([['root', output.path]])
    const dependencyByKey = new Map()
    for (const dependency of dependencyDownloads) {
      if (dependencyByKey.has(dependency.key))
        throw new Error('Resource library returned duplicate dependency key: ' + dependency.key)
      const parentPath = localPathByKey.get(dependency.parentKey)
      if (!parentPath)
        throw new Error('Resource library returned dependency with unknown parent key: ' + dependency.parentKey)
      dependencyByKey.set(dependency.key, dependency)
      const localPath = dependencyOutputPath(parentPath, dependency.referencePath)
      localPathByKey.set(dependency.key, localPath)
    }
    const downloads = [{
      sourceUrl: selected.sourceUrl,
      sourceHash: selected.sourceHash,
      output,
      key: 'root',
      parentKey: undefined,
      elementId,
      elementPath: selectedElement.path,
      referencePath: undefined,
    }, ...dependencyDownloads.map(dependency => ({
        sourceUrl: dependency.sourceUrl,
        sourceHash: dependency.sourceHash,
        output: undefined,
        key: dependency.key,
        parentKey: dependency.parentKey,
        elementId: dependency.elementId,
        elementPath: dependency.elementPath,
        referencePath: dependency.referencePath,
        ...(dependency.kind ? { kind: dependency.kind } : {}),
      }))]

    // Resolve every local target before writing anything. This makes a
    // conflicting closure fail as one validation error instead of leaving a
    // partially downloaded bundle behind. Shared paths are valid only when
    // their immutable hashes agree.
    const planned = []
    const targetHashes = new Map()
    for (const download of downloads) {
      const target = download.output ?? await assetDestination(
        localPathByKey.get(download.key),
      )
      let url
      try { url = new URL(download.sourceUrl) } catch { throw new Error('Library returned an invalid download URL') }
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Library returned an invalid download URL')
      const previousHash = targetHashes.get(target.path)
      if (previousHash !== undefined && previousHash !== download.sourceHash)
        throw new Error(`Resource dependency path conflict at ${target.path}: different content hashes were returned`)
      targetHashes.set(target.path, download.sourceHash)
      planned.push({ ...download, target, url })
    }

    const filesByPath = new Map()
    const files = []
    for (const download of planned) {
      const target = download.target
      const existing = filesByPath.get(target.path)
      if (existing) {
        files.push({ ...existing, elementId: download.elementId, ...(download.referencePath ? { referencePath: download.referencePath } : {}) })
        continue
      }
      const reused = await existingAsset(target, download.sourceHash)
      let file = reused
      if (!file) {
        const reservedFile = await open(target.target, 'wx', 0o600)
        let saved = false
        try {
          file = await saveBytes(
            await fetch(download.url, { redirect: 'error', signal: AbortSignal.timeout(90_000) }),
            target,
            reservedFile,
          )
          if (file.sha256 !== download.sourceHash)
            throw new Error('Downloaded file hash does not match the selected library element')
          saved = true
        } finally {
          await reservedFile.close()
          if (!saved) await unlink(target.target).catch(() => undefined)
        }
      }
      filesByPath.set(target.path, file)
      files.push({ ...file, elementId: download.elementId, ...(download.referencePath ? { referencePath: download.referencePath } : {}) })
    }
    const rootFile = files[0]
    const dependencies = dependencyDownloads.map(dependency => {
      const localPath = localPathByKey.get(dependency.key)
      if (!localPath) throw new Error('Resource library returned an unresolved dependency key: ' + dependency.key)
      return {
        key: dependency.key,
        parent_key: dependency.parentKey,
        element_id: dependency.elementId,
        element_path: dependency.elementPath,
        reference_path: dependency.referencePath,
        local_path: localPath,
        ...(dependency.kind ? { kind: dependency.kind } : {}),
      }
    })
    const filePaths = [...new Set(files.map(file => file.path))]
    console.log(JSON.stringify({
      ...rootFile,
      root_path: output.path,
      file_paths: filePaths,
      local_file_hashes: Object.fromEntries([...filesByPath].map(([path, file]) => [path, file.sha256])),
      source: 'resource-library',
      registrationSource,
      pack: pack.pack ?? pack,
      element: element.element ?? element,
      dependencies,
      note: 'Use registrationSource as source with resources.mjs register. root_path, file_paths and dependencies are ready to copy into one registration input; download is not registration or runtime use.',
    }))
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
        ...pngDimensions(bytes),
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
  } else if (command === 'ui-board-plan' || command === 'ui-assets-plan') {
    const request = imageRequest(JSON.parse(await readFile(args[0], 'utf8')), capabilities.screenOrientation)
    if (command === 'ui-assets-plan') {
      if (request.uiAssets === undefined) throw Error('ui-assets-plan requires uiAssets')
      const source = await assetDestination(request.referenceImagePath, false)
      if (await realpath(source.target) !== source.target) throw Error('UI design reference must not resolve through a link')
      const bytes = await readFile(source.target)
      console.log(JSON.stringify({ ...compileUiAssetSheet(request), design: { path: source.path,
        sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length } }, null, 2))
    } else {
      if (request.uiReference === undefined) throw Error('ui-board-plan requires uiReference')
      console.log(JSON.stringify(compileUiReferenceBoard(request, capabilities.screenOrientation), null, 2))
    }
  } else if (command === 'cost') {
    if (!capabilities.imageEndpoint)
      throw new Error('AI image generation is unavailable for this turn')
    const endpoint = new URL(capabilities.imageEndpoint)
    if (args[0]) endpoint.searchParams.set('quality', args[0])
    if (args[1]) endpoint.searchParams.set('size', args[1])
    const { quotedCreditsMicro, ...quote } = await jsonRequest(endpoint)
    // The host reservation limit is a billing detail, not the image price or user budget.
    delete quote.maxRequestCredits
    console.log(JSON.stringify({ ...quote,
      quotedCredits: quotedCreditsMicro == null ? null : quotedCreditsMicro / 1_000_000,
      currency: 'Credits' }))
    if (quote.fixedPrice === false)
      console.error('Usage-priced image: quotedCredits is unknown; actual billing follows returned usage.')
  } else if (command === 'generate') {
    console.log(JSON.stringify(await generateImage(args, capabilities)))
  } else throw new Error('Unknown command. Run help for usage.')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
