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
  '. No free-text query/search. The request argument accepts a .json file path or inline JSON; omit it to browse without filters. Use {"filters":{"formats":["png"]},"limit":10,"cursor":"<returned nextCursor>"}; flat filter arrays with limit/cursor also work.'
  + ' Catalog returns compact items, total, facets and optional nextCursor. Use pack/element for selected metadata or append --details for full list items. readyElementCount counts technically browsable files, not proven matches. Empty usageTags means unclassified, not unavailable; inspect or audition before choosing a game role.'

const workspaceUsage = 'Run from the project root: bun <current-tools-directory>/assets.mjs <command> [arguments]. Use the current BGS tools directory supplied in the project context as the script prefix; keep the project root as cwd. Relative JSON input paths and assets/ output paths are relative to the project root.'

const usage = TOOL_CONFIG.referenceOnly ? `Design-reference image entry. ${workspaceUsage}
  cost [quality] [size]
  generate <request.json> <assets/reference/new-file.png>
Request: {"purpose":"reference","prompt":"the visual question to resolve"}.
Use the system imagegen Skill within current task authorization. This entry does not produce or register runtime resources.
` : `Usage: bun <this-file> <command> [arguments]
${workspaceUsage}
  catalog [request.json | inline-json] [--details]      Browse library packs and available facets
  elements <pack-id> [request.json | inline-json] [--details]  Browse a selected pack's elements
  pack <pack-id>                         Read license, version and pack metadata
  element <pack-id> <element-id>         Read element and dependency metadata
  fetch <pack-id> <element-id> <assets/path>  Download one selected library file and its complete dependency closure
  inspect <assets/path> [assets/path ...] Hash local assets in one call; no provenance/quality inference
  cost [quality] [size]                 Show availability and image pricing terms
  generate <request.json> <assets/path>  Generate or revise a PNG; generate --help documents JSON fields and quoting
Image inspection, intact-sheet frame metadata, crops and packing: ${TOOL_CONFIG.mediaCommand ?? 'bun <current-tools-directory>/media.mjs'} --help.
Honor explicit source and resource-library preferences, usage rights and authorized cost. For unassigned artwork sources, search the library, then suitable Web sources, then authorized AI generation; programmatic drawing is the fallback. Preserve required appearance and behavior. No command updates the Manifest.
${catalogUsage}
Commands are optional; unavailable access is not an empty catalog.`

const imageUsage = `Image commands (prefix with bun <this-file>):
${workspaceUsage}
For production assets, honor explicit source preferences, rights and charge authorization. The existing cost command reports the current configured image model, availability and request options; it does not verify generated appearance or motion.
  cost low <size>                        Optional availability/price query; no generation
  generate <request.json> <assets/path>  Submit the JSON file; output must be a new path under assets/; receipt includes decoded hasAlpha/isOpaque or imageFactsError
Request fields are JSON keys, not CLI flags. Use purpose: reference|experiment|production. For new work, omit requestId: generate assigns a unique ID and saves it in this JSON file before submission. For recovery, reuse the original file unchanged (including its saved requestId); an explicit requestId preserves an existing identity and is never automatically replaced. A new authorized design or revision uses a new file without requestId; do not remove or change an ID merely to retry an unknown paid attempt. Production can precede registration when no existing requirement or required-library policy blocks it. When requirements already exist, include their requirementIds. References/experiments do not fulfill runtime requirements. Missing metadata is only for recovery of an existing paid attempt.
Optional keys: referenceImagePath, requirementIds, background (auto|opaque|transparent), quality (auto|low|medium|high|xhigh|max), size (1024x1024|1024x1536|1536x1024). Quality follows the request or configured default. Generation checks availability and applicable pricing before submission within charge authorization. Use cost when a price query or an explicit user budget needs it. fixedPrice:true supplies quotedCredits; fixedPrice:false is usage-priced with quotedCredits:null.
referenceImagePath: a project-relative PNG under assets/ with a provider reporting referenceImageSupported. Viewing an image does not pass it to generation. A reference guides the new image, not deterministic pixel editing; omit it for new free-form images.
Use prompt for new image requests, including concept boards and production atlases. referenceImagePath remains available for edits. Saved structured requests retain their original requestId for recovery.`

function id(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value ?? ''))
    throw new Error('Expected a pack or element ID')
  return value
}

async function catalogRequest(value) {
  const parsed = value === undefined ? {} : JSON.parse(/\.json$/i.test(value) ? await readFile(value, 'utf8') : value)
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
  if ((value.uiReference !== undefined || value.uiAssets !== undefined) && !value.requestId)
    throw new Error('New image requests use prompt; structured UI requests are retained only for saved-request recovery')
  const allowed = ['requestId', 'purpose', 'prompt', 'background', 'quality', 'size', 'referenceImagePath',
    ...(TOOL_CONFIG.referenceOnly ? [] : ['requirementIds', 'uiReference', 'uiAssets'])]
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
    throw Object.assign(new Error(
      'Capability HTTP ' + response.status + ': ' + JSON.stringify(body),
    ), { capabilityStatus: response.status, capabilityCode: body?.code })
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

async function saveBytes(response, output, reservedFile, inspectImage = false) {
  if (!response.ok) {
    const details = await response.text()
    let code
    try { code = JSON.parse(details).code } catch { /* Non-JSON failures retain their original HTTP error. */ }
    throw Object.assign(new Error(
      'Capability HTTP ' + response.status + ': ' + details.slice(0, 2000),
    ), { capabilityStatus: response.status, capabilityCode: code })
  }
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > 256 * 1024 * 1024)
    throw new Error('Asset exceeds the 256 MiB download limit')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > 256 * 1024 * 1024)
    throw new Error('Empty or oversized asset')
  if (reservedFile) await reservedFile.writeFile(bytes)
  else await writeFile(output.target, bytes, { flag: 'wx' })
  const file = {
    path: output.path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    mimeType: response.headers.get('content-type') ?? undefined,
    ...pngDimensions(bytes),
  }
  if (!inspectImage) return file
  // The saved result may already be paid. Inspection failure must disclose
  // missing facts without discarding that result or inviting a new request.
  try {
    if (!process.env.BEEGAME_SHARP_MODULE) throw Error('Host image decoder is unavailable')
    const image = (await import(process.env.BEEGAME_SHARP_MODULE)).default
    const source = image(bytes, {limitInputPixels:64*1024*1024})
    const [metadata, stats] = await Promise.all([source.metadata(), source.stats()])
    return { ...file, hasAlpha: metadata.hasAlpha === true, isOpaque: stats.isOpaque }
  } catch (error) {
    return { ...file, imageFactsError: error instanceof Error ? error.message : String(error) }
  }
}

// Managed creative work identifies an output across process restart, including MCP
// and CLI calls. The provider receipt still verifies the complete request digest.
function creativeImageId(outputPath) {
  return TOOL_CONFIG.imageRequestScope && 'creative-' + createHash('sha256')
    .update(JSON.stringify([TOOL_CONFIG.sessionId, TOOL_CONFIG.imageRequestScope, relative(process.cwd(),resolve(outputPath))])).digest('hex')
}

async function generateImage(args, capabilities, signal) {
  if (!capabilities.imageEndpoint)
    throw new Error('AI image generation is unavailable for this turn')
  const submittedRequest = imageRequest(JSON.parse(await readFile(args[0], 'utf8')), capabilities.screenOrientation)
  if (TOOL_CONFIG.referenceOnly) {
    if (submittedRequest.purpose !== 'reference') throw Error('This document assignment permits only reference-purpose images')
    if (!resolve(args[1]).startsWith(resolve('assets/reference') + sep))
      throw Error('Save design references to new files under assets/reference/')
  }
  const newRequest = submittedRequest.requestId === undefined
  if (newRequest) submittedRequest.requestId = creativeImageId(args[1]) || randomUUID()
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
    const file = await saveBytes(response, output, reservedFile, true)
    saved = true
    return {
        ...file,
        source: 'agent-authored',
        requestId: request.requestId,
        chargedCredits: response.headers.has('x-image-credits-micro') ? Number(response.headers.get('x-image-credits-micro')) / 1_000_000 : null,
        currency: 'Credits',
        billingState: response.headers.get('x-image-billing-state'),
        note: submittedRequest.purpose === 'production'
          ? 'Inspect the actual image; registration can reuse this saved result with acquisition:"assets/result.json". Declare its actual use; generation is not registration.'
          : 'Inspect the actual image for its declared purpose. Reference and experiment images do not fulfill runtime resource requirements.',
    }
  } finally {
    await reservedFile.close()
    if (!saved) await unlink(output.target).catch(() => undefined)
  }
}


/** A viewing surface only: keep the generated PNG and its facts unchanged. */
async function imageViewingPreview(result, purpose) {
  if (result.isOpaque === true && purpose !== 'reference') return undefined
  if (!process.env.BEEGAME_SHARP_MODULE) throw Error('Host image decoder is unavailable')
  const image = (await import(process.env.BEEGAME_SHARP_MODULE)).default
  const output = await assetDestination(result.path, false)
  const bytes = await verifiedAssetBytes(output, result.sha256)
  if (!bytes) throw Error('Saved image is missing before preview rendering')
  const source = image(bytes, {limitInputPixels:64*1024*1024})
  const {hasAlpha} = await source.metadata()
  const transparent = hasAlpha && result.isOpaque !== true
  if (!transparent && purpose !== 'reference') return undefined
  // Bound only the automatic viewing copy; source bytes and facts stay intact.
  const {data:thumbnail,info:{width,height}} = await source
    .resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true})
  const tw = Math.min(32,width), th = Math.min(32,height), tile = Buffer.alloc(tw*th*3)
  for (let y=0;y<th;y++) for (let x=0;x<tw;x++) {
    const color = (Math.floor(x/16)+Math.floor(y/16))%2 ? 220 : 250
    tile.fill(color,(y*tw+x)*3,(y*tw+x+1)*3)
  }
  const preview = transparent
    ? image({create:{width,height,channels:3,background:'#ffffff'}})
        .composite([{input:tile,raw:{width:tw,height:th,channels:3},tile:true},{input:thumbnail}])
    : image(thumbnail)
  const png = await preview.clone().png().toBuffer()
  const webp = await preview.webp({lossless:true}).toBuffer()
  return webp.length < png.length
    ? {bytes:webp,mimeType:'image/webp',transparent}
    : {bytes:png,mimeType:'image/png',transparent}
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
    description:TOOL_CONFIG.referenceOnly ? 'Generate an optional design reference with the configured image service and system imagegen Skill. Set request.purpose=reference and save a new file under assets/reference/. Existing availability, pricing, prompt checks and recovery apply; this does not create runtime resources. Returns saved-file facts and a bounded viewing preview.' : 'Generate or edit project PNG artwork, including character reference sheets, per-character action pose sheets, game-element atlases, UI atlases and backgrounds, through the configured image service independently of the chat model. Supports a project reference image and transparent-background requests; pose consistency, frame geometry and playback need inspection and runtime preparation. assets.mjs cost reports the current configured image model and request options. Uses the existing availability, pricing, source, reference-image and recovery contract. Save to a new assets/ outputPath. Reuse requestId only to recover the unchanged original request; no automatic paid retry. Returns actual saved-file facts, including decoded hasAlpha/isOpaque when available, and one bounded viewing preview for reference or nonopaque images in the smaller lossless encoding. Transparent previews use a checkerboard. The source PNG stays unchanged; this does not register assets or verify appearance.',
    inputSchema:{type:'object',properties:{
      request:{type:'object',properties:{
        requestId:{type:'string'},purpose:{type:'string',enum:TOOL_CONFIG.referenceOnly?['reference']:['reference','experiment','production']},
        prompt:{type:'string',description:TOOL_CONFIG.referenceOnly?'Describe the visual question and intended appearance for this reference.':'Describe the intended image, including all parts needed in a production atlas.'},
        ...(TOOL_CONFIG.referenceOnly ? {} : {
          requirementIds:{type:'array',items:{type:'string'}},
        }),
        referenceImagePath:{type:'string',description:'Project-relative reference image under assets/.'},
        background:{type:'string',enum:['auto','opaque','transparent']},
        quality:{type:'string',enum:['auto','low','medium','high','xhigh','max']},
        size:{type:'string',enum:['1024x1024','1024x1536','1536x1024']},
      },required:['purpose','prompt'],additionalProperties:false},
      outputPath:{type:'string',description:TOOL_CONFIG.referenceOnly?'New project-relative file under assets/reference/.':'New project-relative file under assets/.'},
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
      // The low-level MCP Server validates its envelope, not the tool inputSchema.
      const unknown = Object.keys(args).filter(key => !['request', 'outputPath'].includes(key))
      if (unknown.length) throw Error('Unknown image tool fields: ' + unknown.join(', ') + '. Put image fields inside request, including request.purpose; outputPath stays outside request. No image request was created or submitted.')
      imageRequest(args.request, capabilities.screenOrientation)
      if (args.request.purpose === undefined && args.request.requestId === undefined)
        throw Error('New image requests need request.purpose: reference, experiment or production. No image request was created or submitted.')
      extra.signal.throwIfAborted()
      requestId = args.request.requestId ?? (creativeImageId(args.outputPath) || 'mcp-' + createHash('sha256').update(JSON.stringify([execution,extra.requestId])).digest('hex'))
      requestFile = resolve(dirname(fileURLToPath(import.meta.url)), 'image-request-' + randomUUID() + '.json')
      await writeFile(requestFile, JSON.stringify({...args.request,requestId},null,2)+'\n', {flag:'wx',mode:0o600})
      const result = await generateImage([requestFile,args.outputPath],capabilities,extra.signal)
      const content=[{type:'text',text:JSON.stringify({...result,requestFile})}]
      // A preview failure follows a saved, potentially paid result. Preserve
      // that result and its recovery identity rather than failing generation.
      try {
        const preview=await imageViewingPreview(result, args.request.purpose)
        if (preview) {
          content[0].text=JSON.stringify({...result,requestFile,
            note:'Use the attached viewing preview for overall composition and transparency. The saved source path and dimensions support any inspection that needs finer detail. '+(args.request.purpose==='production'
              ? 'Registration can reuse this saved result with acquisition:"assets/result.json"; declare its actual use.'
              : 'Reference and experiment images do not fulfill runtime resource requirements.')})
          content.push(
            {type:'text',text:preview.transparent
              ? 'Transparency viewing thumbnail on a checkerboard (longest edge at most 512px). The saved source PNG remains full size and transparent; this thumbnail is not a production asset.'
              : 'Reference viewing thumbnail (longest edge at most 512px). The saved source PNG and its dimensions remain unchanged; this thumbnail is not a production asset.'},
            {type:'image',mimeType:preview.mimeType,data:preview.bytes.toString('base64')})
        }
      } catch (error) {
        content.push({type:'text',text:'Image saved; viewing preview unavailable: '+(error instanceof Error?error.message:String(error))})
      }
      return {content}
    } catch (error) {
      const rejected = error?.capabilityStatus === 422 && ['resource-intent', 'image-prompt-conflict'].includes(error.capabilityCode)
      return {isError:true,content:[{type:'text',text:(error instanceof Error ? error.message : String(error)) +
        (requestFile ? '\nOriginal request: '+requestFile+'; requestId='+requestId+(rejected
          ? '. No image submission or new Credit reservation. Correct the input before another call and preserve this ID; no automatic resubmission was performed.'
          : '. Do not automatically resubmit or change this ID.') : '')}]}
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
  if (TOOL_CONFIG.referenceOnly && !['cost','generate','catalog','elements','pack','element'].includes(command)) throw Error(usage)
  if (['catalog', 'elements'].includes(command) && args.at(-1) === '--help') {
    if (args.length > (command === 'catalog' ? 1 : 2)) throw new Error(usage)
    console.log(`Usage: bun <this-file> ${command}${command === 'elements' ? ' <pack-id>' : ''} [request.json | inline-json] [--details]\n${workspaceUsage}\n${catalogUsage}`)
    return
  }
  if (args.length === 1 && args[0] === '--help' && ['generate', 'cost'].includes(command)) {
    console.log(TOOL_CONFIG.referenceOnly ? usage : imageUsage)
    return
  }
  // Resolve once: quote and paid submission must use the same execution.
  const capabilities = ['catalog', 'elements', 'pack', 'element', 'fetch', 'cost', 'generate'].includes(command)
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
      body: JSON.stringify(await catalogRequest(args[isPack ? 0 : 1])),
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
      note: 'Save this result JSON and use acquisition:"assets/result.json" with resources.mjs register to reuse paths, registrationSource and dependencies. Declare its actual use; download is not registration or runtime use.',
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
