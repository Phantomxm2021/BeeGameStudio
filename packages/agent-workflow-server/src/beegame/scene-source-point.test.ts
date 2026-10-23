import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGameContentCommand } from './game-content-validation-cli'
import { sceneLayoutFixture } from './fixtures/layout-fixture'

test('source point uses current hierarchy, Camera center and zoom without broad pixel-region expectations', () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-source-point-'))
  try {
    const scene: any = sceneLayoutFixture()
    scene.data.settings.coordinateSystem.width = 800; scene.data.settings.coordinateSystem.height = 500
    scene.data.nodes[0].transform = { position: [400,250,0] }
    scene.data.nodes[0].components[0].data.viewport = { width: 800, height: 500 }
    scene.data.nodes[0].components[0].data.orthographicSize = 2
    scene.data.nodes[1].transform.position = [20,-10,0]
    scene.data.nodes.push({ id: 'target', parentId: 'board', transform: { position: [500,350,0] }, components: [] })
    const save = () => writeFileSync(join(root,'scene.json'),JSON.stringify(scene))
    const point = (node='target',width='800') => runGameContentCommand(root,['--scene-point','scene.json',node,width,'500']) as any
    save(); const bytes = readFileSync(join(root,'scene.json'),'utf8'), first = point()
    // Independent arithmetic: (520-400)*1.25+400, (340-250)*1.25+250.
    expect(first.world).toEqual({ x: 520, y: 340 })
    expect(first.screen).toEqual({ x: 550, y: 362.5 })
    expect(first.inputLocation.sources[0].sha256).toHaveLength(64)
    expect(JSON.stringify(first).length).toBeLessThan(2200)
    expect(first.runtimeVerified).toBe(false)
    expect(readFileSync(join(root,'scene.json'),'utf8')).toBe(bytes)
    scene.data.nodes[0].transform.position[0] = 420; save()
    const shifted = point(); expect(shifted.screen.x).toBe(525)
    expect(shifted.inputLocation.sources[0].sha256).not.toBe(first.inputLocation.sources[0].sha256)
    scene.data.nodes[0].components[0].data.orthographicSize = 4; save()
    expect(point().screen).toEqual({ x: 462.5, y: 306.25 })
    expect(() => point('missing')).toThrow('missing or disabled')
    expect(() => point('target','0')).toThrow('positive viewport')
    scene.data.nodes[1].enabled = false; save()
    expect(() => point()).toThrow('missing or disabled')
  } finally { rmSync(root,{recursive:true,force:true}) }
})
