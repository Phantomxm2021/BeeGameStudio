// Shared by the host and the project-local asset CLI. Geometry is computed here;
// the author supplies screen content, never board placement or a separate count.
const uiBoardCanvases = [
  { size: '1024x1024', width: 1024, height: 1024 },
  { size: '1536x1024', width: 1536, height: 1024 },
  { size: '1024x1536', width: 1024, height: 1536 },
]

function uiBoardObject(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error(name + ' must be an object')
  const unknown = Object.keys(value).filter(key => !keys.includes(key))
  if (unknown.length) throw Error(name + ' has unknown fields: ' + unknown.join(', '))
}

function uiBoardText(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw Error(name + ' must be nonempty text of at most ' + max + ' characters')
}

/** Compile a UI-reference request without I/O, image generation or billing.
 * screenOrientation is optional host-owned evidence from the confirmed brief.
 * Returned geometry is a requested layout, not a measurement of generated pixels.
 */
export function compileUiReferenceBoard(request, screenOrientation) {
  const spec = request.uiReference
  uiBoardObject(spec, ['viewport', 'screens', 'style'], 'uiReference')
  uiBoardObject(spec.viewport, ['width', 'height'], 'uiReference.viewport')
  const { width, height } = spec.viewport
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0))
    throw Error('uiReference.viewport needs positive integer project reference width and height')
  if ((screenOrientation === 'Landscape' && width <= height) ||
      (screenOrientation === 'Portrait' && height <= width))
    throw Error('UI reference viewport conflicts with the confirmed ' + screenOrientation + ' orientation')
  if (request.prompt !== undefined)
    throw Error('Use uiReference instead of a free-form prompt for a UI reference board')
  if (request.background !== undefined && request.background !== 'opaque')
    throw Error('A complete-screen UI reference board requires background: opaque')
  uiBoardText(spec.style, 'uiReference.style', 4000)
  if (!Array.isArray(spec.screens) || !spec.screens.length || spec.screens.length > 64)
    throw Error('uiReference.screens must list 1–64 actual screens or distinct UI states')
  const ids = new Set()
  for (const screen of spec.screens) {
    uiBoardObject(screen, ['id', 'description'], 'uiReference screen')
    uiBoardText(screen.id, 'screen.id', 80)
    uiBoardText(screen.description, 'screen.description', 4000)
    if (ids.has(screen.id.trim())) throw Error('Duplicate UI screen id: ' + screen.id)
    ids.add(screen.id.trim())
  }

  // Uniform margins/gutters separate complete screens. Enumerating supported
  // canvases and column counts maximizes each screen's proportional scale.
  // Tie-breaks use fewer empty cells, then the smaller canvas, then fewer columns.
  const margin = 32, gap = 24, count = spec.screens.length
  const canvases = request.size === undefined ? uiBoardCanvases :
    uiBoardCanvases.filter(canvas => canvas.size === request.size)
  if (!canvases.length) throw Error('Unsupported UI reference board size')
  let best
  for (const canvas of canvases) {
    for (let columns = 1; columns <= count; columns++) {
      const rows = Math.ceil(count / columns)
      const scale = Math.min(
        (canvas.width - 2 * margin - (columns - 1) * gap) / (columns * width),
        (canvas.height - 2 * margin - (rows - 1) * gap) / (rows * height),
      )
      if (scale <= 0) continue
      const candidate = { ...canvas, columns, rows, scale, empty: columns * rows - count }
      if (!best || scale > best.scale + 1e-10 ||
          (Math.abs(scale - best.scale) <= 1e-10 &&
           (candidate.empty < best.empty || (candidate.empty === best.empty &&
            (canvas.width * canvas.height < best.width * best.height ||
             (canvas.width * canvas.height === best.width * best.height && columns < best.columns))))))
        best = candidate
    }
  }
  if (!best) throw Error('UI reference screens do not fit the supported canvases')
  const panelWidth = width * best.scale, panelHeight = height * best.scale
  const x0 = (best.width - best.columns * panelWidth - (best.columns - 1) * gap) / 2
  const y0 = (best.height - best.rows * panelHeight - (best.rows - 1) * gap) / 2
  const panels = spec.screens.map((screen, index) => ({
    id: screen.id.trim(), row: Math.floor(index / best.columns) + 1, column: index % best.columns + 1,
    x: x0 + (index % best.columns) * (panelWidth + gap),
    y: y0 + Math.floor(index / best.columns) * (panelHeight + gap),
    width: panelWidth, height: panelHeight,
  }))
  const prompt = [
    'Create a visual reference board of complete game screens from the supplied game design. Carry its artistic direction, focal subjects, composition, information grouping and scene/interface relationships into a distinctive, coherent visual treatment. Develop typography, materials, color, lighting and spacing within that design; resolve unspecified visual details coherently. Make necessary information readable and available actions recognizable. Preserve the listed functional scope without inventing mechanics, controls, readouts or extra steps. Apply gameplay camera constraints only to screens retaining that view; title and standalone results follow their own described compositions.',
    `Canvas: ${best.width} x ${best.height} pixels. Grid: ${best.columns} columns x ${best.rows} rows. ` +
      `${count} occupied cells, ${best.empty} unused cells. Read cells left-to-right, top-to-bottom.`,
    `Each complete screen panel must retain the project reference viewport ratio ${width}:${height} inside its grid cell. ` +
      'Keep each complete screen and the interface belonging to its state readable without stretching or cropping; leave surrounding canvas space blank instead of expanding panels to fill it. Leave unused cells blank. Screen ids identify states, not extra UI text.',
    request.referenceImagePath
      ? 'The attached image is the selected design for a local edit. Preserve only the choices compatible with the requested correction.'
      : 'The attached image is an empty layout guide, not artwork or a style reference. Generate one complete screen in its specified state inside each outlined frame in reading order. Keep the frame positions and proportions and leave the surrounding space blank; replace the guide outlines with the finished screen edges. Do not expand screens to fill the canvas.',
    'Viewport and content dimensions describe logical design proportions, not literal output pixels; scale them together to fit each panel. ' +
      'Preserve the screen aspect ratio and grid arrangement above while designing the scene and interface within each panel. Working copy conveys meaning and approximate content length; preserve only explicitly user-fixed wording verbatim. Retain the described grouping and hierarchy while making labels and typography readable. Depicted values must fit their gameplay state; sample values do not create new features.',
    'Shared GDD art direction and user visual choices: ' + spec.style.trim(),
    ...panels.map((panel, index) =>
      `Cell ${index + 1}, row ${panel.row}, column ${panel.column}, id ${JSON.stringify(panel.id)}: ` +
      spec.screens[index].description.trim()),
    'Each panel depicts one actual game state with only the scene and interface visible together in that state. Mutually exclusive states belong in separate complete-screen panels, not alternate-state insets or simultaneous result interfaces. Exclude character sheets, labeled pose strips and production instructions. This is a screen concept reference, not a measured construction drawing or runtime sprite atlas.',
  ].join('\n\n')
  if (prompt.length > 32000) throw Error('UI reference prompt exceeds 32000 characters; shorten screen descriptions')
  const { uiReference: ignored, ...options } = request
  return {
    request: { ...options, prompt, size: best.size, background: 'opaque', quality: request.quality ?? 'low' },
    layout: { canvas: { width: best.width, height: best.height }, viewport: { width, height },
      columns: best.columns, rows: best.rows, gap, emptyCells: best.empty, panels },
    note: 'Requested arrangement; new compositions use an empty layout guide as reference input. Neither is measured image geometry or proof that generated screens match the target ratio. Compare actual pictures against the original GDD state coverage and necessary information/actions; none is certified by this plan or the submitted screen list. Concept acceptance does not demand an exact ratio or pixel cleanup. Record implementation corrections separately; requested dimensions are not measured output.',
  }
}

/** Production skins have different shapes and sizes; screen-board cells do not
 * describe their arrangement. Named frame bounds come from the generated pixels. */
export function compileUiAssetSheet(request) {
  const spec = request.uiAssets
  uiBoardObject(spec, ['elements'], 'uiAssets')
  if (request.purpose !== 'production') throw Error('UI assets need purpose: production')
  if (request.requirementIds !== undefined && (!Array.isArray(request.requirementIds) || !request.requirementIds.length))
    throw Error('When supplied, UI asset requirementIds must be a nonempty array')
  uiBoardText(request.referenceImagePath, 'UI assets referenceImagePath (selected design)', 512)
  if (request.prompt !== undefined || request.uiReference !== undefined)
    throw Error('Use uiAssets with the selected design, not prompt or uiReference')
  if (request.background !== undefined && request.background !== 'transparent')
    throw Error('UI asset sheets require background: transparent')
  if (!Array.isArray(spec.elements) || !spec.elements.length || spec.elements.length > 64)
    throw Error('uiAssets.elements must list 1–64 static visual elements from the selected design')
  const ids = new Set()
  for (const element of spec.elements) {
    uiBoardObject(element, ['id', 'description', 'width', 'height'], 'UI asset element')
    uiBoardText(element.id, 'element.id', 80)
    uiBoardText(element.description, 'element.description (design appearance/state)', 4000)
    if (ids.has(element.id.trim())) throw Error('Duplicate UI element id: ' + element.id)
    ids.add(element.id.trim())
    if (![element.width, element.height].every(value => Number.isSafeInteger(value) && value > 0))
      throw Error('UI element width/height must be positive integer design dimensions')
  }
  const canvas = uiBoardCanvases.find(item => item.size === (request.size ?? '1024x1024'))
  if (!canvas) throw Error('Unsupported UI asset sheet size')
  const prompt = [
    'Produce a shared runtime UI asset sheet using the attached selected UI design as the visual source, not a new design.',
    'Reproduce the specified element skins, materials, silhouettes, decoration and states. Do not replace distinctive artwork with generic geometric controls.',
    `Canvas ${canvas.width} x ${canvas.height}. Element dimensions below describe design proportions, not required output pixel sizes or measured frame bounds.`,
    'Arrange all listed elements once in a shared atlas, allocating space to their different shapes and relative sizes. Keep each complete element unrotated and separated by transparent padding, preserving its aspect ratio and intended opacity. No screen backgrounds, dynamic labels, scores, progress fills or hit areas; those remain runtime UI. Skins are text-free unless an element explicitly calls for fixed decorative lettering or a wordmark. IDs below are identifiers, never text to paint.',
    ...spec.elements.map(item => `Element ${JSON.stringify(item.id.trim())}, design proportions ${item.width} x ${item.height}: ${item.description.trim()}`),
  ].join('\n\n')
  if (prompt.length > 32000) throw Error('UI asset prompt exceeds 32000 characters; shorten element descriptions')
  const { uiAssets: ignored, ...options } = request
  return { request: { ...options, prompt, size: canvas.size, background: 'transparent' },
    layout: { canvas: { width: canvas.width, height: canvas.height }, elements: spec.elements },
    note: 'Design-linked production request only, not an aesthetic verdict or measured atlas. Inspect actual alpha/bounds, then crop/pack or register measured named frames with the existing media/resources tools. No image or frame coordinates are certified.' }
}
