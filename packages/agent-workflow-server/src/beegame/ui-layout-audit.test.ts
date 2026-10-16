import { describe, expect, test } from 'bun:test'
import { parseBeeGameContentDocument } from './game-content-schema'
import { auditUiInteractiveBounds } from './ui-layout-audit'

function screen(nodes: Array<Record<string, unknown>>) {
  const document = parseBeeGameContentDocument({
    schema: 'beegame-content.v1', id: 'menu', kind: 'ui-screen', assetRefs: [],
    data: { rootId: 'root', nodes: [
      { id: 'root', role: 'screen-root', data: { referenceResolution: [960, 540], targetViewports: [[390, 844], [844, 390]] }, layout: { size: [960, 540] } },
      ...nodes,
    ] },
  })
  if (document.kind !== 'ui-screen') throw new Error('Unexpected fixture kind')
  return document
}

describe('screen UI content geometry handoff', () => {
  test('catches a centered button authored with a left-pivot offset', () => {
    const document = screen([{ id: 'play', parentId: 'root', role: 'button',
      layout: { anchor: 'top-center', position: [-120, 278], size: [240, 52] } }])
    expect(auditUiInteractiveBounds(document).join(' ')).toContain('play:')
    expect(auditUiInteractiveBounds(document).join(' ')).toContain('390x844')
  })

  test('honors anchor-as-default-pivot and portrait overrides from the shared editor contract', () => {
    const document = screen([{ id: 'play', parentId: 'root', role: 'button',
      layout: { anchor: 'top-center', position: [0, 278], size: [240, 52] },
      responsive: { portrait: { layout: { position: [0, 180], size: [300, 52] } } },
    }])
    expect(auditUiInteractiveBounds(document)).toEqual([])
  })

  test('checks nested overlay controls with composed parent transforms', () => {
    const document = screen([
      { id: 'panel', parentId: 'root', role: 'container', layout: {
        anchor: 'middle-center', position: [-160, -110], size: [320, 220],
      } },
      { id: 'next', parentId: 'panel', role: 'button', layout: {
        anchor: 'top-center', position: [-70, 150], size: [140, 48],
      } },
    ])
    expect(auditUiInteractiveBounds(document).join(' ')).toContain('next:')
    expect(auditUiInteractiveBounds(document).join(' ')).toContain('390x844')
  })

  test('catches a clipped dialog even when its button remains on screen', () => {
    const document = screen([
      { id: 'panel', parentId: 'root', role: 'container', layout: {
        anchor: 'middle-center', position: [-300, -200], size: [600, 400],
      } },
      { id: 'back', parentId: 'panel', role: 'button', layout: {
        anchor: 'bottom-center', position: [0, -16], size: [160, 40],
      } },
    ])
    const issues = auditUiInteractiveBounds(document)
    expect(issues.join(' ')).toContain('panel:')
    expect(issues.find(issue => issue.startsWith('panel:'))).toContain('960x540')
    expect(issues.find(issue => issue.startsWith('back:')) ?? '').not.toContain('960x540')
  })

  test('checks the authored root size when referenceResolution is omitted', () => {
    const document = screen([{ id: 'play', parentId: 'root', role: 'button',
      layout: { anchor: 'top-center', position: [0, 520], size: [160, 40] },
    }])
    document.data.nodes[0]!.data = {}
    expect(auditUiInteractiveBounds(document).join(' ')).toContain('960x540')
  })

  test('checks clickable images without forcing them to be button roles', () => {
    const document = screen([{ id: 'image-action', parentId: 'root', role: 'image',
      actions: { click: 'start' }, layout: { anchor: 'top-center', position: [-120, 278], size: [240, 52] } }])
    expect(auditUiInteractiveBounds(document).join(' ')).toContain('image-action:')
  })

  test('does not apply screen bounds to world-space UI', () => {
    const document = screen([{ id: 'play', parentId: 'root', role: 'button',
      layout: { anchor: 'top-center', position: [-120, 278], size: [240, 52] } }])
    document.data.nodes[0]!.data = { space: 'world' }
    expect(auditUiInteractiveBounds(document)).toEqual([])
  })

  test('does not require phone layout when only desktop containers are targeted', () => {
    const document = screen([{ id: 'play', parentId: 'root', role: 'button',
      layout: { anchor: 'top-center', position: [0, 278], size: [500, 52] } }])
    document.data.nodes[0]!.data = { referenceResolution: [960, 540] }
    expect(auditUiInteractiveBounds(document)).toEqual([])
  })

  test('checks controls inside stretched parent panels at the actual container size', () => {
    const document = screen([
      { id: 'panel', parentId: 'root', role: 'container', layout: {
        anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [-40, -40], position: [20, 20],
      } },
      { id: 'next', parentId: 'panel', role: 'button', layout: {
        anchor: 'bottom-right', position: [-16, -16], size: [160, 40],
      } },
    ])
    document.data.nodes[0]!.data = { referenceResolution: [960, 540] }
    expect(auditUiInteractiveBounds(document)).toEqual([])
  })

  test('rejects a stretched control that collapses at a supported width', () => {
    const document = screen([{ id: 'play', parentId: 'root', role: 'button', layout: {
      anchorMin: [0, 0], anchorMax: [1, 0], sizeDelta: [-1000, 52], position: [20, 20],
    } }])
    document.data.nodes[0]!.data = { referenceResolution: [960, 540] }
    expect(auditUiInteractiveBounds(document).join(' ')).toContain('Invalid UI geometry: play')
  })

  test('reports invalid authored viewport settings rather than silently ignoring them', () => {
    const document = screen([])
    document.data.nodes[0]!.data = { compactMaxWidth: 'phone' } as any
    expect(auditUiInteractiveBounds(document).join(' ')).toContain('compactMaxWidth')
    document.data.nodes[0]!.data = { targetViewports: [] }
    expect(auditUiInteractiveBounds(document).join(' ')).toContain('targetViewports')
  })
})
