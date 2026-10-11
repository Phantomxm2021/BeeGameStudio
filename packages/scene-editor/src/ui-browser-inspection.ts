import { initializeUiLayout } from './ui-container-layout'
import { inspectUiLayout, type UiLayoutInspectionOptions } from './ui-layout-inspection'
import { createUiTextMeasurer } from './ui-text-measurement'
import type { UiResponsiveNode, UiViewport } from './ui-responsive'

import { uiFontKey } from './ui-font-reference'

export type UiBrowserInspectionOptions = Omit<UiLayoutInspectionOptions, 'measureText'> & {
  /** Explicit candidate/system font for nodes without a delivered font reference. */
  fontFamily: (node: UiResponsiveNode) => string
  /** Loaded faces keyed by uiFontKey; bare assetRef aliases only the default member. */
  fontFaces?: Readonly<Record<string, FontFace>>
  /** Additional legal labels/counter values; never overwrites authored text. */
  textSamples?: Readonly<Record<string, readonly string[]>>
}

/** Browser font measurements + existing layout math, not a renderer or aesthetic verdict.
 * The preview owns font registration, asset loading and rendering of these same inputs. */
export async function inspectUiLayoutInBrowser(nodes: readonly UiResponsiveNode[], rootId: string,
  viewport: UiViewport, options: UiBrowserInspectionOptions) {
  if (typeof document === 'undefined' || !document.fonts) throw new Error('UI text inspection requires a browser with FontFaceSet support')
  const context = document.createElement('canvas').getContext('2d')
  if (!context) throw new Error('UI text inspection requires a 2D measurement context')
  const { fontFamily, fontFaces, textSamples = {}, ...layoutOptions } = options
  const byId = new Map(nodes.map(node => [node.id, node]))
  for (const [id, samples] of Object.entries(textSamples)) {
    if (!byId.has(id) || byId.get(id)?.text === undefined) throw new Error(`Text samples require an authored text node: ${id}`)
    if (!Array.isArray(samples) || !samples.length || samples.some(value => typeof value !== 'string'))
      throw new Error(`Text samples must be a nonempty string array: ${id}`)
  }
  const fontFor = (node: UiResponsiveNode) => {
    const selection = node.data?.font as { assetRef?: string; member?: string } | undefined
    const ref = selection?.assetRef
    if (ref) {
      const face = fontFaces?.[uiFontKey(selection)!]
      if (!face || !document.fonts.has(face) || face.status !== 'loaded')
        throw new Error(`Load and register the actual FontFace before inspecting ${node.id}: ${ref}${selection?.member ? '/' + selection.member : ''}`)
      return { family: face.family, basis: 'registered-font' as const, assetRef: ref,
        ...(selection?.member ? { member: selection.member } : {}) }
    }
    const family = fontFamily(node)
    if (typeof family !== 'string' || !family.trim()) throw new Error(`Choose an explicit candidate font: ${node.id}`)
    return { family, basis: 'candidate-font' as const }
  }
  const valuesFor = (node: UiResponsiveNode) => [...new Set([node.text ?? '', ...(textSamples[node.id] ?? [])])]
  const measure = createUiTextMeasurer(context, node => fontFor(node).family)
  await initializeUiLayout()
  // Load every authored style before measuring, including variants. This requests
  // fonts only; it does not introduce support for additional viewport directions.
  for (const node of nodes) if (node.text !== undefined) {
    for (const style of [node.style, { ...node.style, ...node.responsive?.compact?.style },
      { ...node.style, ...node.responsive?.compact?.style, ...node.responsive?.portrait?.style }]) {
      measure({ ...node, style }) // Set the exact font shorthand; discard pre-load metrics.
      await document.fonts.load(context.font, valuesFor(node).join(''))
    }
  }
  await document.fonts.ready
  const textMeasurements = new Map<string, { nodeId: string; family: string; basis: 'candidate-font' | 'registered-font';
    assetRef?: string; values: { text: string; width: number; height: number }[] }>()
  const measuredLayout = inspectUiLayout(nodes, rootId, viewport, { ...layoutOptions, measureText: node => {
    const font = fontFor(node)
    const values = valuesFor(node).map(text => ({ text, ...measure({ ...node, text }) }))
    textMeasurements.set(node.id, { nodeId: node.id, ...font, values })
    return { width: Math.max(...values.map(value => value.width)), height: Math.max(...values.map(value => value.height)) }
  } })
  return { viewport, nodes: measuredLayout, textMeasurements: [...textMeasurements.values()],
    note: 'Intrinsic text and declared sample bounds only, not wrapping, clipping or aesthetic acceptance. Candidate fonts are preliminary; registered fonts may still use glyph fallback. Inspect the rendered composition and remeasure after font/text/style changes.' }
}
