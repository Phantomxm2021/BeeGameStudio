import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { composeDraft, createComposedDrafts } from './draft-composition'
import { sceneLayoutFixture, uiLayoutFixture } from './fixtures/layout-fixture'
import { initializeUiLayout } from '../../../scene-editor/src/ui-container-layout'
import { inspectUiLayout, summarizeUiLayoutInspection } from '../../../scene-editor/src/ui-layout-inspection'
import { runGameContentCommand } from './game-content-validation-cli'
import { sharedContentChecker, COMPOSE_DRAFT_ENTRY } from './content-checker-runtime'

function menu(): any {
  const draft = uiLayoutFixture()
  draft.data.nodes = [{ ...draft.data.nodes[0], layout: { container: { direction: 'column', align: 'center', justify: 'center' } },
    children: [{ id: 'panel', role: 'container', layout: { container: { direction: 'column', align: 'center', padding: [12, 12, 12, 12], gap: 8 } },
      children: [{ id: 'play', role: 'button', text: 'Play', layout: { size: [200, 48] } },
        { id: 'quit', role: 'button', text: 'Quit', layout: { size: [200, 48] } }] }] } as any]
  return draft
}
function scene(): any {
  const draft: any = sceneLayoutFixture()
  draft.data.nodes[1].tileLayer = { cellSize: [16, 16], regions: [{ from: [-2, 0], to: [8, 2], tileId: 'floor' }] }
  return draft
}
async function fixture(run: (root: string) => unknown) {
  const root = mkdtempSync(join(tmpdir(), 'bgs-composition-'))
  try { await run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
test('UI tree becomes canonical nodes and auto-sized panel passes real layout at two viewports', async () => {
  await initializeUiLayout()
  const input = menu(), original = structuredClone(input), output: any = composeDraft(input)
  expect(input).toEqual(original)
  expect(output.data.nodes.map((n: any) => [n.id, n.parentId])).toEqual([['root', undefined], ['panel', 'root'], ['play', 'panel'], ['quit', 'panel']])
  expect(JSON.stringify(output)).not.toContain('children')
  for (const [width, height] of [[960, 540], [600, 360]]) {
    const nodes = inspectUiLayout(output.data.nodes, 'root', { width: width!, height: height! })
    const panel = nodes.find(n => n.id === 'panel')!
    expect(panel.layout!.size).toEqual([224, 128])
    expect(summarizeUiLayoutInspection(nodes)).toMatchObject({ outsideViewport: [], outsideParent: [], outsideContentArea: [], belowMinimumControlSize: [] })
  }
})
test('tile rectangles use one canonical Grid/Tilemap node and pass existing draft checks', () => fixture(root => {
  const output: any = composeDraft(scene()), node = output.data.nodes[1]
  expect(node.components.map((c: any) => c.type)).toEqual(['grid', 'tilemap', 'tilemap-renderer'])
  expect(node.components[1].data.gridNodeId).toBe(node.id)
  expect(node.components[1].data.cells).toHaveLength(33)
  expect(createComposedDrafts(root, [{ file: 'content/scenes/map.json', document: scene() }]).valid).toBe(true)
  expect((runGameContentCommand(root, ['--check-drafts', 'content/scenes/map.json']) as any).valid).toBe(true)
}))
test.each(['parent', 'duplicate', 'zero', 'overlap', 'reverse', 'unsafe', 'explicit'] as const)('invalid %s is rejected, not silently repaired', kind => {
  let draft = menu()
  if (kind === 'parent') draft.data.nodes[0].children[0].parentId = 'elsewhere'
  if (kind === 'duplicate') draft.data.nodes[0].children[0].id = 'root'
  if (kind === 'zero') draft.data.nodes[0].children[0].layout.size = [320, 0]
  if (['overlap', 'reverse', 'unsafe', 'explicit'].includes(kind)) {
    draft = scene(); const node = draft.data.nodes[1]
    if (kind === 'overlap') node.tileLayer.regions.push(node.tileLayer.regions[0])
    if (kind === 'reverse') node.tileLayer.regions[0].to = [-4, 1]
    if (kind === 'unsafe') node.tileLayer.regions[0].to = [Number.MAX_SAFE_INTEGER, 10]
    if (kind === 'explicit') node.components = [{ id: 'grid', type: 'grid', data: {} }]
  }
  expect(() => composeDraft(draft)).toThrow()
})
test('batch preflight and path checks do not overwrite any existing draft', () => fixture(root => {
  const a = { file: 'content/ui/a.json', document: menu() }
  expect(() => createComposedDrafts(root, [a, { file: 'content/ui/../bad.json', document: menu() }])).toThrow()
  expect(existsSync(join(root, a.file))).toBe(false)
  createComposedDrafts(root, [a]); const before = readFileSync(join(root, a.file))
  expect(() => createComposedDrafts(root, [a])).toThrow('already exists')
  expect(readFileSync(join(root, a.file))).toEqual(before)
  mkdirSync(join(root, 'outside')); symlinkSync(join(root, 'outside'), join(root, 'content/scenes'))
  expect(() => createComposedDrafts(root, [{ file: 'content/scenes/a.json', document: scene() }])).toThrow('symlink')
}))
test('actual materialized CLI accepts one inline batch, no request file or paid service', () => fixture(async root => {
  mkdirSync(join(root, '.beegame/delivery'), { recursive: true })
  writeFileSync(join(root, '.beegame/delivery/compose-drafts.mjs'), COMPOSE_DRAFT_ENTRY)
  const runtime = await sharedContentChecker()
  const child = Bun.spawn([process.execPath, '.beegame/delivery/compose-drafts.mjs', '--json', JSON.stringify([
    { file: 'content/ui/menu.json', document: menu() }, { file: 'content/scenes/map.json', document: scene() },
  ])], { cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0); expect(JSON.parse(out).written).toHaveLength(2)
}))
