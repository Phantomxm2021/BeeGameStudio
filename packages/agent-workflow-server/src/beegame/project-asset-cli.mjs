// Project-local command adapter; managed sessions resolve current BGS capabilities per invocation.
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
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

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
  fetch <pack-id> <element-id> <assets/path>  Download one selected library file
  inspect <assets/path> [assets/path ...] Hash local assets in one call; no provenance/quality inference
  cost [quality] [size]                 Show availability and the image Credit quote
  ui-board-plan <request.json>          Read-only: complete game-screen design board grid and prompt, no network or billing
  ui-assets-plan <request.json>         Read-only: design-linked runtime UI sheet, no network or billing
  generate <request.json> <assets/path>  Generate or revise a PNG; generate --help has JSON examples and quoting
  generate --help / ui-board-plan --help  Reference images and revisions
  ui-assets-plan --help                Runtime UI skins from a selected design
  atlas <assets/sheet.png> <assets/frames.json> <assets/runtime/name.png>
                                         Publish named rectangles as a PNG + same-basename atlas JSON
${atlasInputFormat} Coordinates are integer source-image pixels from the top-left; x/y >= 0, w/h > 0. Rectangles must fit the PNG and not overlap. Both inputs are project-relative files under assets/; output is a new PNG under assets/runtime/.
For compatible small AI-generated elements, prefer one shared sheet request; use atlas to publish inspected rectangles, then resources.mjs to register the pair. atlas copies the PNG bytes unchanged; separate part files and repacking are not required for a usable intact sheet. generate returns an image, not measured frame metadata. Inspect complete artwork, state alignment and sampling gutters; nonoverlap alone does not prove suitability. atlas does not pack separate images or approve appearance. A full-screen reference board is not automatically a production sheet. Split generation for a concrete visual/use need, preserving planned atlas delivery.
For read-only decoded alpha/bounds measurements (operation:inspect), or a demonstrated need for crop/resize/composition and packing separate sprites, use ${TOOL_CONFIG.mediaCommand ?? 'bun <current-tools-directory>/media.mjs'} --help. Replace <current-tools-directory> with the current BGS tools directory supplied in the project context; keep the project root as cwd. Alpha bounds do not identify objects or automatically define safe crops. Its JSON request supports named crop regions, explicit filtering/padding and compatible atlas output; no package installation or custom PNG encoder is needed.
Honor explicit user source choices. For common sounds, icons and environment assets, first consider suitable supplied or built-in licensed resources. Prefer existing complete animations when suitable; a generated sheet does not guarantee temporal continuity. Consider AI generation for distinctive artwork when existing candidates do not fit, not as the default for all core art. Use focused web sourcing for a concrete gap, verifying rights and download/format feasibility; stop when a suitable candidate is found. These are source choices, not a mandatory source-by-source tour. Procedurally replacing required core artwork remains a fallback requiring a concrete blocker and user authorization; simple controls, geometric effects and an explicitly chosen procedural aesthetic are different. The same atlas format supports retrieved and generated assets. Dynamic text and live geometry need not become images.
${catalogUsage}
Commands are optional. You choose the source and asset design. No command updates the Manifest.`

const imageUsage = `Image commands (prefix with bun <this-file>):
${workspaceUsage}
  cost low <size>                        Read availability and price; no generation
  ui-board-plan <request.json>           Optional offline board layout and chosen size
  generate <request.json> <assets/path>  Submit the JSON file; output must be a new path under assets/
Request fields are JSON keys, not CLI flags. Use purpose: reference|experiment|production and a stable requestId; do not change the ID just to retry an unknown paid attempt. Production requires existing Manifest requirementIds; references/experiments do not fulfill runtime requirements. Missing metadata is only for recovery of an existing paid attempt.
Optional keys: referenceImagePath, requirementIds, background (auto|opaque|transparent), quality (auto|low|medium|high|xhigh|max), size (1024x1024|1024x1536|1536x1024). Availability and the BGS delivery contract restrict these options: delivery quality remains low. Read cost for the actual quality/size within the authorized budget; generation also checks the quote before submission.
Reference example (replace the screen/state inventory, content and viewport with the project's design):
{"requestId":"screen-design-1","purpose":"reference","quality":"low","uiReference":{"viewport":{"width":1280,"height":720},"style":"Project visual direction","screens":[{"id":"title","description":"Complete title screen and primary action"},{"id":"play","description":"Complete game scene, subjects and HUD"},{"id":"pause","description":"Paused game with its overlay and actions"},{"id":"result","description":"Complete result screen and next actions"}]}}
For complete game-screen design boards replace prompt with uiReference. List all game screens and key states in the current assignment in one uiReference.screens request for one overview board; keep each Scene and HUD together. Viewport/content dimensions express design proportions, not literal output pixels. The system chooses the canvas when size is omitted. ui-board-plan reports that size; quote it and submit the SAME STRUCTURED file to generate, not the compiled prompt. The plan is a layout aid, not image validation.
Revision example:
{"requestId":"screen-design-2","purpose":"reference","quality":"low","size":"1536x1024","referenceImagePath":"assets/reference/selected.png","prompt":"Preserve composition and subjects; clarify the primary control's contrast."}
referenceImagePath also works with uiReference. Use a project-relative PNG under assets/ and a provider reporting referenceImageSupported; viewing the image in chat does not pass it to generation. A reference guides the new image, not deterministic pixel editing. For a new free-form image, omit referenceImagePath.
Inspect layout, hierarchy, subject identity and key-state coverage. Minor lettering/grid/pixel deviations alone do not require regeneration; exact requirements stay in documents and implementation. During reference generation, keep existing design documents unchanged unless the user explicitly requests a design change. Report image paths and consequential unresolved deviations at the requested delivery boundary. For a consequential correction, revise the affected complete screen with referenceImagePath. Full-game delivery continues from selected designs into needed UI atlases/skins and game assets without a separate request, within the existing budget and authorization. Stop after references only when the current assignment explicitly ends there; component explanation boards do not replace usable resources.
For runtime UI skins use uiAssets (ui-assets-plan --help). For character/prop bitmap assets use purpose: production, requirementIds and prompt with the selected referenceImagePath; choose format and production methods with applicable Skills. Keep production assets out of uiReference.screens.`

const uiAssetUsage = `Runtime UI skins (common request fields and quoting: generate --help).
Production includes existing Manifest requirementIds for PNG-compatible parts; register needs with resources: [] before files exist. PNG may supply a 3D/XR texture, not a model, rig or runtime behavior.
For production UI skins replace prompt with uiAssets:{elements:[{id,description,width,height},...]}, purpose:production, existing requirementIds and referenceImagePath pointing to the selected UI design. Descriptions identify appearance/state in that design, not an invented visual direction. ui-assets-plan reads/hashes the actual reference and computes a shared transparent grid; generate accepts the same request. It does not generate automatically or assign frame coordinates. Keep live text/values/progress/hit areas in runtime UI; use existing media/resources for inspected named frames. Procedural UI remains supported, but this production path does not turn a reference board into a runtime atlas or certify visual fidelity.`

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

function imageRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Image request must be a JSON object')
  const allowed = ['requestId', 'purpose', 'requirementIds', 'prompt', 'uiReference', 'uiAssets', 'background', 'quality', 'size', 'referenceImagePath']
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length) throw new Error('Unknown image request fields: ' + unknown.join(', '))
  for (const [key, max] of [['requestId', 200], ['prompt', 32000]]) {
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
  if (value.uiReference !== undefined) compileUiReferenceBoard(value)
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
  for (const endpoint of [capability.assets.libraryBaseUrl, capability.assets.imageEndpoint]) {
    if (endpoint === undefined) continue
    let url
    try { url = new URL(endpoint) } catch { throw Error('ASSET_CAPABILITY_MISMATCH: Invalid resource endpoint.') }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash)
      throw Error('ASSET_CAPABILITY_MISMATCH: Invalid resource endpoint.')
  }
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

async function jsonRequest(url, init) {
  const response = await capabilityFetch(url, {
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

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!command || command === 'help' || command === '--help') {
    console.log(usage)
    return
  }
  if (args.length === 1 && args[0] === '--help' && ['generate', 'cost', 'ui-board-plan', 'ui-assets-plan'].includes(command)) {
    console.log(command === 'ui-assets-plan' ? uiAssetUsage : imageUsage)
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
    const expectedHash = (element.element ?? element).specs?.contentHash
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash))
      throw new Error('Library element requires a valid stored content hash before download')
    const selectedPack = pack.pack ?? pack, selectedElement = element.element ?? element
    if (typeof selectedPack.version !== 'string' || !selectedPack.version.trim() ||
        typeof selectedElement.path !== 'string' || !selectedElement.path.trim())
      throw new Error('Library selection requires its pack version and element path before download')
    const registrationSource = { type:'resource-library', pack_id:packId, pack_version:selectedPack.version,
      element_id:elementId, element_path:selectedElement.path }
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
      if (file.sha256 !== expectedHash)
        throw new Error(
          'Downloaded file hash does not match the selected library element',
        )
      saved = true
      console.log(
        JSON.stringify({
          ...file,
          source: 'resource-library',
          registrationSource,
          pack: pack.pack ?? pack,
          element: element.element ?? element,
          note: 'Use registrationSource unchanged with resources.mjs register. Fetch required dependency files as well; include their local paths in file_paths and existing dependencies records. Download is not registration or runtime use.',
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
  } else if (command === 'ui-board-plan' || command === 'ui-assets-plan') {
    const request = imageRequest(JSON.parse(await readFile(args[0], 'utf8')))
    if (command === 'ui-assets-plan') {
      if (request.uiAssets === undefined) throw Error('ui-assets-plan requires uiAssets')
      const source = await assetDestination(request.referenceImagePath, false)
      if (await realpath(source.target) !== source.target) throw Error('UI design reference must not resolve through a link')
      const bytes = await readFile(source.target)
      console.log(JSON.stringify({ ...compileUiAssetSheet(request), design: { path: source.path,
        sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length } }, null, 2))
    } else {
      if (request.uiReference === undefined) throw Error('ui-board-plan requires uiReference')
      console.log(JSON.stringify(compileUiReferenceBoard(request), null, 2))
    }
  } else if (command === 'cost') {
    if (!capabilities.imageEndpoint)
      throw new Error('AI image generation is unavailable for this turn')
    const endpoint = new URL(capabilities.imageEndpoint)
    if (args[0]) endpoint.searchParams.set('quality', args[0])
    if (args[1]) endpoint.searchParams.set('size', args[1])
    console.log(JSON.stringify(await jsonRequest(endpoint)))
  } else if (command === 'generate') {
    if (!capabilities.imageEndpoint)
      throw new Error('AI image generation is unavailable for this turn')
    const submittedRequest = imageRequest(JSON.parse(await readFile(args[0], 'utf8')))
    const board = submittedRequest.uiAssets !== undefined ? compileUiAssetSheet(submittedRequest) :
      submittedRequest.uiReference === undefined ? undefined : compileUiReferenceBoard(submittedRequest)
    const request = board?.request ?? submittedRequest
    const quoteUrl = new URL(capabilities.imageEndpoint)
    if (request.quality) quoteUrl.searchParams.set('quality', request.quality)
    if (request.size) quoteUrl.searchParams.set('size', request.size)
    const quote = await jsonRequest(quoteUrl)
    if (!quote.available) throw new Error('AI image generation unavailable: ' + (quote.unavailableReason ?? 'check model, credentials and billing'))
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
      const response = await capabilityFetch(capabilities.imageEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submittedRequest),
        signal: AbortSignal.timeout(180_000),
      }, request.requestId)
      const file = await saveBytes(response, output, reservedFile)
      saved = true
      console.log(
        JSON.stringify({
          ...file,
          source: 'agent-authored',
          requestId: request.requestId,
          chargedCreditsMicro: response.headers.get('x-image-credits-micro'),
          billingState: response.headers.get('x-image-billing-state'),
          ...(board ? { requestedLayout: board.layout } : {}),
          note: board ? board.note : 'Inspect the actual image and register the selected file in the Manifest.',
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
