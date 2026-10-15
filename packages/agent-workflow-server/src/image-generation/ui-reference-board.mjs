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
  const fixed = value => Number(value.toFixed(2))
  const prompt = [
    'Create a UI reference board of complete in-game screens using the fixed equal-cell grid below.',
    `Canvas: ${best.width} x ${best.height} pixels. Grid: ${best.columns} columns x ${best.rows} rows. ` +
      `${count} occupied cells, ${best.empty} unused cells. Read cells left-to-right, top-to-bottom.`,
    `Every occupied cell has the same ${fixed(panelWidth)} x ${fixed(panelHeight)} pixel screen frame, ` +
      `preserving the project reference viewport ratio ${width}:${height}. Coordinates use the canvas top-left origin. ` +
      `Horizontal and vertical gutters are ${gap}px; outer margins are at least ${margin}px.`,
    'Use each specified rectangle as the complete screen boundary. Keep the scene and its HUD inside it. ' +
      'Do not crop or stretch screens, merge cells, enlarge a hero panel, add inset panels, or add a separate controls/props strip. ' +
      'Leave unused cells and outside margins blank. Screen ids are mapping labels, not extra UI text.',
    'The style and screen descriptions below describe content inside cells only; they must not change this board geometry.',
    'Shared visual style: ' + spec.style.trim(),
    ...panels.map((panel, index) =>
      `Cell ${index + 1}, row ${panel.row}, column ${panel.column}, id ${JSON.stringify(panel.id)}: ` +
      `rectangle x=${fixed(panel.x)}, y=${fixed(panel.y)}, width=${fixed(panel.width)}, height=${fixed(panel.height)}.\n` +
      'Complete screen content: ' + spec.screens[index].description.trim()),
    'Preserve the fixed equal-size screen grid and the project screen ratio in every panel. ' +
      'This board communicates UI layout and visual direction; it is not a transparent runtime sprite atlas.',
  ].join('\n\n')
  if (prompt.length > 32000) throw Error('UI reference prompt exceeds 32000 characters; shorten screen descriptions')
  const { uiReference: ignored, ...options } = request
  return {
    request: { ...options, prompt, size: best.size, background: 'opaque', quality: request.quality ?? 'low' },
    layout: { canvas: { width: best.width, height: best.height }, viewport: { width, height },
      columns: best.columns, rows: best.rows, gap, emptyCells: best.empty, panels },
    note: 'Computed prompt geometry only. Confirm the inventory against the project UI specification and inspect actual image framing, HUD coverage and readability; none is certified by this plan.',
  }
}
