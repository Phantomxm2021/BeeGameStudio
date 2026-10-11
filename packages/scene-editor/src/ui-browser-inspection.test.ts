import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectUiLayoutInBrowser } from './ui-browser-inspection'
import { uiFontKey } from './ui-font-reference'

// Synthetic metrics exercise integration boundaries; the backend browser test
// separately checks real Canvas/FontFaceSet behavior.
function browserFixture() {
  const context = { font: '', letterSpacing: '0px', measureText(text: string) {
    return { width: text.length * Number(this.font.match(/([\d.]+)px/)?.[1]) }
  } }
  const registered = new Set<FontFace>()
  const fonts = { has: (face: FontFace) => registered.has(face), load: vi.fn(async () => []), ready: Promise.resolve() }
  vi.stubGlobal('document', { fonts, createElement: () => ({ getContext: () => context }) })
  return { registered, fonts }
}
const nodes = () => [
  { id: 'root', layout: { container: { direction: 'column' as const } } },
  { id: 'score', parentId: 'root', text: '0', layout: { size: [40,30] as [number,number] },
    style: { fontSize: 10, lineHeight: 15 }, responsive: { compact: { style: { fontSize: 20 } } } },
]
afterEach(() => vi.unstubAllGlobals())

describe('browser text/layout inspection', () => {
  it('measures actual selected styles and legal samples without changing input', async () => {
    const { fonts } = browserFixture()
    const source = nodes(), before = JSON.stringify(source)
    const result = await inspectUiLayoutInBrowser(source, 'root', { width: 500, height: 400 }, {
      fontFamily: () => 'Candidate', textSamples: { score: ['99999', '99999'] },
    })
    expect(result.nodes.find(node => node.id === 'score')?.textFit).toBe('exceeds-intrinsic-bounds')
    expect(result.textMeasurements).toEqual([{ nodeId: 'score', family: 'Candidate', basis: 'candidate-font',
      values: [{ text: '0', width: 20, height: 15 }, { text: '99999', width: 100, height: 15 }] }])
    expect(fonts.load).toHaveBeenCalledWith('400 20px Candidate', '099999')
    expect(JSON.stringify(source)).toBe(before)
  })
  it('requires registered loaded faces for actual font references, never an implicit fallback', async () => {
    const { registered } = browserFixture()
    const source = nodes().map(node => node.id === 'score' ? { ...node, data: { font: { assetRef: 'FONT' } } } : node)
    await expect(inspectUiLayoutInBrowser(source, 'root', { width: 900, height: 500 }, {
      fontFamily: () => 'Fallback',
    })).rejects.toThrow('actual FontFace')
    const face = { family: 'Actual', status: 'loaded' } as FontFace
    registered.add(face)
    const result = await inspectUiLayoutInBrowser(source, 'root', { width: 900, height: 500 }, {
      fontFamily: () => 'Fallback', fontFaces: { FONT: face },
    })
    expect(result.textMeasurements[0]).toMatchObject({ family: 'Actual', basis: 'registered-font', assetRef: 'FONT' })
  })
  it('rejects unavailable browser capabilities, invalid samples and font choices explicitly', async () => {
    vi.stubGlobal('document', undefined)
    await expect(inspectUiLayoutInBrowser(nodes(), 'root', { width: 900, height: 500 }, {
      fontFamily: () => 'Candidate',
    })).rejects.toThrow('browser')
    browserFixture()
    const invalidSamples: Record<string, string[]>[] = [{ missing: ['x'] }, { root: ['x'] }, { score: [] }]
    for (const textSamples of invalidSamples)
      await expect(inspectUiLayoutInBrowser(nodes(), 'root', { width: 900, height: 500 }, {
        fontFamily: () => 'Candidate', textSamples,
      })).rejects.toThrow('Text samples')
    await expect(inspectUiLayoutInBrowser(nodes(), 'root', { width: 900, height: 500 }, {
      fontFamily: () => '',
    })).rejects.toThrow('explicit candidate')
  })
  it('measures the explicit member and refuses an available default as its substitute', async () => {
    const { registered } = browserFixture()
    const selection = { assetRef: 'FONT', member: 'fonts/bold.ttf' }
    const source = nodes().map(node => node.id === 'score' ? { ...node, data: { font: selection } } : node)
    const regular = { family: 'Regular', status: 'loaded' } as FontFace
    const bold = { family: 'Bold', status: 'loaded' } as FontFace
    registered.add(regular); registered.add(bold)
    await expect(inspectUiLayoutInBrowser(source, 'root', { width: 900, height: 500 }, {
      fontFamily: () => 'Fallback', fontFaces: { FONT: regular },
    })).rejects.toThrow('fonts/bold.ttf')
    const result = await inspectUiLayoutInBrowser(source, 'root', { width: 900, height: 500 }, {
      fontFamily: () => 'Fallback', fontFaces: { FONT: regular, [uiFontKey(selection)!]: bold },
    })
    expect(result.textMeasurements[0]).toMatchObject({ family: 'Bold', member: 'fonts/bold.ttf', basis: 'registered-font' })
  })
})
