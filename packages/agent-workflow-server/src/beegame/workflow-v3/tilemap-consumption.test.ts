import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { runChecks, checkIsCurrent } from './checks'
import { sceneLayoutFixture } from '../fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import type { TaskSpec } from './state'

for (const mode of ['consume', 'individual-images', 'parent-camera', 'wrong-cells', 'wrong-tile-id', 'omit-cell', 'omit-interior', 'extra-cell', 'ignore-cells', 'ignore-grid', 'ignore-tile-size',
  'ignore-position', 'ignore-resource', 'missing-probe', 'stale-tileset', 'shared-frame', 'shared-frame-alias', 'rotated'] as const) {
  test('actual Tilemap Canvas consumes saved cells/Grid/TileSet: ' + mode, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-v3-tiles-'))
    try {
      const manifest = assetManifestAuthoringExamples().canonical, resource = manifest.resources[0]!
      manifest.project_target!.asset_format_capabilities = ['json', 'png']
      const folder = 'assets/runtime/example', image = folder + '/tiles.png', atlas = folder + '/atlas.json', tiles = folder + '/tileset.json'
      resource.root_path = image; resource.file_paths = [image, atlas, tiles]
      await mkdir(join(root, folder), { recursive: true })
      await writeFile(join(root, image), await sharp({ create: { width: 80, height: 40, channels: 4, background: '#327bb8' } }).png().toBuffer())
      await writeFile(join(root, atlas), JSON.stringify({ frames: { grass: { frame: { x: 0, y: 0, w: 40, h: 40 } }, wall: { frame: { x: mode === 'shared-frame-alias' ? 0 : 40, y: 0, w: 40, h: 40 } } } }))
      if (mode === 'individual-images') for (const name of ['grass', 'wall']) {
        const path=folder+'/'+name+'.png';resource.file_paths.push(path)
        await writeFile(join(root,path),await sharp({create:{width:40,height:40,channels:4,background:'#327bb8'}}).png().toBuffer())
      }
      const tile = (frame: string) => ({ sprite: { assetRef: resource.id, member: mode === 'individual-images' ? folder+'/'+frame+'.png' : image,
        ...(mode === 'individual-images' ? {} : { atlasMember: atlas, frame }) },
        size: [36, 28], pivot: [.3, .6], offset: [3, -2] })
      const tileset = { schema: 'beegame-tileset.v1', tiles: { grass: tile('grass'), wall: tile(mode === 'shared-frame' ? 'grass' : 'wall') } }
      await writeFile(join(root, tiles), JSON.stringify(tileset)); await writeBeeGameAssetManifest(root, manifest)
      const scene = sceneLayoutFixture() as any
      scene.assetRefs = [resource.id]
      scene.data.nodes[1] = { id: 'board', parentId: 'grid', transform: { position: [0, 0, 0] }, components: [
        { id: 'map', type: 'tilemap', assetRef: resource.id, data: { schema: 'tilemap.v1', member: tiles, gridNodeId: 'grid',
          tileAnchor: [.25, .75], cells: [{ x: -1, y: 0, tileId: 'grass' }, { x: 1, y: 0, tileId: 'grass' }, { x: 0, y: 1, tileId: 'wall' }] } },
        { id: 'renderer', type: 'tilemap-renderer', data: { schema: 'tilemap-renderer.v1' } },
      ] }
      scene.data.nodes.push({ id: 'grid', transform: { position: [-120, -80, 0], ...(mode === 'parent-camera' ? { scale: [1.5, 1.25, 1] } : {}),
        ...(mode === 'rotated' ? { rotation: [0, 0, Math.PI / 12] } : {}) }, components: [{ id: 'grid-data', type: 'grid', data: { schema: 'grid.v1', cellSize: [48, 40], cellGap: [6, 4] } }] })
      if (mode === 'parent-camera') scene.data.nodes[0].transform = { position: [25, 15, 0] }
      if (mode === 'omit-interior') scene.data.nodes[1].components[0].data.cells = [
        ...Array.from({ length: 11 }, (_, i) => ({ x: i - 2, y: 0, tileId: 'grass' })), { x: 0, y: 1, tileId: 'wall' },
      ]
      const source = 'content/scenes/level.json', body = JSON.stringify(scene), tilesBody = JSON.stringify(tileset)
      await mkdir(join(root, 'content/scenes'), { recursive: true }); await writeFile(join(root, source), body)
      await writeFile(join(root, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2', id: 'fixture', sceneModel: 'game-object-v2',
        documentRevision: '0'.repeat(64), assetManifestRevision: '0'.repeat(64), dimension: '2d', entryScene: 'level',
        files: ['scenes/level.json'], documents: [{ id: 'level', kind: 'scene-2d', path: 'scenes/level.json', loadPhase: 'startup' }] }))
      await mkdir(join(root, 'dist')); await cp(join(root, 'content'), join(root, 'dist/content'), { recursive: true }); await cp(join(root, 'assets'), join(root, 'dist/assets'), { recursive: true })
      if (mode === 'stale-tileset') await writeFile(join(root, 'dist', tiles), '{}')
      // Independent game renderer: own formulas, no BGS preview/layout imports or PASS.
      const script = `const scene=await fetch("/${source}").then(r=>r.json()), mapNode=scene.data.nodes.find(n=>n.id==="board"), map=mapNode.components.find(c=>c.type==="tilemap").data;
        const gridNode=scene.data.nodes.find(n=>n.id===map.gridNodeId), grid=gridNode.components.find(c=>c.type==="grid").data;
        const tiles=await fetch("/${tiles}").then(r=>r.json()), atlas=await fetch("/${atlas}").then(r=>r.json()), images=new Map();
        for(const tile of Object.values(tiles.tiles)){if(images.has(tile.sprite.member))continue;const im=new Image();im.src="/"+tile.sprite.member;await im.decode();images.set(tile.sprite.member,im)}
        const ctx=document.querySelector("canvas").getContext("2d");
        const camera=scene.data.nodes.find(n=>n.id===scene.data.cameraNodeId).transform?.position||[0,0], p=${mode === 'ignore-position' ? '[0,0]' : 'mapNode.transform.position'}, parent=gridNode.transform.position, s=gridNode.transform.scale||[1,1];
        let cells=${mode === 'ignore-cells' ? '[{x:-1,y:0,tileId:"grass"},{x:1,y:0,tileId:"grass"},{x:0,y:1,tileId:"wall"}]' : 'map.cells'};${mode === 'omit-cell' ? 'cells=cells.slice(1);' : ''}${mode === 'omit-interior' ? 'cells=cells.filter(c=>c.x!==3||c.y!==0);' : ''}${mode === 'extra-cell' ? 'cells=[...cells,{x:2,y:1,tileId:"grass"}];' : ''}
        for(const cell of cells){const tile=tiles.tiles[${mode === 'wrong-tile-id' ? '"grass"' : 'cell.tileId'}], size=${mode === 'ignore-tile-size' ? '[36,28]' : 'tile.size'}, g=${mode === 'ignore-grid' ? '[48,40]' : 'grid.cellSize'}, gap=grid.cellGap||[0,0], anchor=map.tileAnchor||[.5,.5],pivot=tile.pivot||[.5,.5],offset=tile.offset||[0,0];
          const x=${mode === 'wrong-cells' ? '(cell.x+1)' : 'cell.x'}*(g[0]+gap[0])+g[0]*anchor[0]+offset[0]-size[0]*pivot[0],
            y=cell.y*(g[1]+gap[1])+g[1]*anchor[1]+offset[1]-size[1]*pivot[1], left=480+parent[0]+(p[0]+x)*s[0]-camera[0], top=270+parent[1]+(p[1]+y)*s[1]-camera[1];
          const image=images.get(tile.sprite.member), f=tile.sprite.frame ? atlas.frames[tile.sprite.frame].frame : {x:0,y:0,w:image.width,h:image.height};
          ${mode === 'ignore-resource' ? 'ctx.fillStyle="#abc";ctx.fillRect(left,top,size[0]*s[0],size[1]*s[1]);' : 'ctx.drawImage(image,f.x,f.y,f.w,f.h,left,top,size[0]*s[0],size[1]*s[1]);'}
        }`
      await writeFile(join(root, 'dist/index.html'), '<style>body{margin:0}</style><canvas width="960" height="540"></canvas><script type="module">' + script + '</script>')
      const task: TaskSpec = { id: 'tiles', kind: 'game.verify', goal: 'Observe actual tile data consumption', dependsOn: [], requirementIds: ['req.board'],
        inputs: [], writablePaths: [], expectedOutputs: ['dist/index.html'], runtimeArtifact: 'dist', checks: ['pixel-data-consumption'],
        pixelProbes: [{ document: source, nodeId: 'board', componentId: mode === 'missing-probe' ? 'missing' : 'map', selector: 'canvas', viewport: [960, 540] }] }
      const result = (await runChecks(root, task, [])).checks[0]!
      const expected = ['consume', 'individual-images', 'parent-camera'].includes(mode) ? 'passed'
        : ['ignore-resource', 'missing-probe', 'stale-tileset', 'shared-frame', 'shared-frame-alias', 'rotated'].includes(mode) ? 'unverified' : 'failed'
      expect(result.status, result.observation).toBe(expected)
      expect(await Bun.file(join(root, source)).text()).toBe(body)
      expect(await Bun.file(join(root, tiles)).text()).toBe(tilesBody)
      expect(await Bun.file(join(root, image)).arrayBuffer()).toEqual(await Bun.file(join(root, 'dist', image)).arrayBuffer())
      if (result.status === 'passed') {
        const observations = JSON.parse(result.observation).probes
        expect(observations.map((p: any) => p.tileId).sort()).toEqual(['grass', 'wall'])
        expect(observations[0].baseline.sha256).toBe(observations[0].restored.sha256)
        expect(observations[0].changed.map((v: any) => v.property)).toEqual(['position', 'cell-position', 'grid-cell-size', 'tile-size'])
        expect(observations[0].before.colors[0].regionsMatch).toBe(true)
        expect(await checkIsCurrent(root, result)).toBe(true)
        expect(await checkIsCurrent(root, { ...result, version: 'v3-canvas-image-consumption.1' })).toBe(false)
        await writeFile(join(root, tiles), '{}'); expect(await checkIsCurrent(root, result)).toBe(false)
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 60000)
}
