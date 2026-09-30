import type { UiResponsiveNode } from './ui-responsive'
import type { UiLayoutOptions } from './ui-container-layout'

/** Intrinsic text measurement, not a wrapping/shaping engine. Load fonts before using this. */
export function createUiTextMeasurer(
  context: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
  fontFamily: (node: UiResponsiveNode) => string = () => 'sans-serif',
): NonNullable<UiLayoutOptions['measureText']> {
  return node => {
    const style = node.style ?? {}
    const data = node.data ?? {}
    const label = data.label as { content?: string; fontSize?: number } | undefined
    const size = Number(style.fontSize ?? data.fontSize ?? label?.fontSize ?? 18)
    const lineHeight = Number(style.lineHeight ?? size * 1.35)
    const spacing = Number(style.letterSpacing ?? 0)
    if (![size, lineHeight, spacing].every(Number.isFinite) || size <= 0 || lineHeight <= 0)
      throw new Error(`Invalid text metrics: ${node.id}`)
    context.font = `${style.fontWeight ?? 400} ${size}px ${fontFamily(node)}`
    const spacingContext = context as typeof context & { letterSpacing?: string }
    if ('letterSpacing' in context) spacingContext.letterSpacing = `${spacing}px`
    else if (spacing !== 0) throw new Error(`Text measurement context does not support letterSpacing: ${node.id}`)
    const lines = String(node.text ?? label?.content ?? '').split('\n')
    return { width: Math.max(0, ...lines.map(line => context.measureText(line).width)), height: lines.length * lineHeight }
  }
}
