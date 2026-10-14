import { describe, expect, it } from 'vitest';
import { canonicalJson, rendererOrder, type SceneAsset } from '@beegame/scene-editor';
import type { BeeGameSceneContentDocument } from '../../services/beeGameAdapter';
import { editorDocumentToSceneContent, sceneContentToEditorDocument } from './sceneContentAdapter';
import { editorRect, rectTransform } from '../../../../../packages/scene-editor/src/rect-transform';
import { sceneWorldTransforms2d } from '../../../../../packages/scene-editor/src/scene-layout-inspection';
import { nodeWorldMatrix } from '../../../../../packages/scene-editor/src/selection-transform';

const HASH = 'a'.repeat(64);
const assets: Record<string, SceneAsset> = {
  'RES-FOX': { id: 'RES-FOX', name: 'fox.webp', mimeType: 'image/webp', path: 'fox.webp', uri: 'blob:fox' },
  'RES-FOX:idle': { id: 'RES-FOX:idle', name: 'idle.webp', mimeType: 'image/webp', path: 'idle.webp', uri: 'blob:idle' },
  'RES-FX:glow': { id: 'RES-FX:glow', name: 'glow.webp', mimeType: 'image/webp', path: 'glow.webp', uri: 'blob:glow' },
  'RES-AUDIO': { id: 'RES-AUDIO', name: 'forest.ogg', mimeType: 'audio/ogg', path: 'forest.ogg' },
};
const assetMembers = { 'RES-FOX': { idle: 'RES-FOX:idle' }, 'RES-FX': { glow: 'RES-FX:glow' } };

function scene(): BeeGameSceneContentDocument {
  return { schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: ['RES-FOX', 'RES-FX', 'RES-AUDIO'], data: { settings: { layers: [{ id: 'actors', order: 5 }] }, cameraNodeId: 'camera', nodes: [
    { id: 'root', name: 'Root', semantic: ['anchor'], components: [] },
    { id: 'camera', parentId: 'root', transform: { position: [0, 0, 10] }, components: [{ id: 'camera-camera', type: 'camera', data: { orthographic: true } }, { id: 'camera-listener', type: 'audio-listener', data: {} }] },
    { id: 'player', parentId: 'root', semantic: ['player'], layer: 'actors', transform: { position: [96, 624, 0] }, components: [{ id: 'player-sprite', type: 'sprite-renderer', assetRef: 'RES-FOX', data: { member: 'idle', size: { width: 64, height: 64 }, anchor: { x: .5, y: .5 }, alpha: .75 } }, { id: 'player-collider', type: 'box-collider-2d', data: { size: [0.5, 0.8], offset: [0, 0], isTrigger: false } }] },
    { id: 'fireflies', parentId: 'root', components: [{ id: 'fireflies-system', type: 'particle-system', data: { count: 25, particleSize: { min: 3, max: 7 }, tint: '#FFD89A', blend: 'additive', zone: { x: 40, y: 60, width: 1200, height: 600 } } }, { id: 'fireflies-renderer', type: 'particle-system-renderer', assetRef: 'RES-FX', data: { member: 'glow', blend: 'additive' } }] },
    { id: 'guard-vision', parentId: 'root', semantic: ['guard-vision'], transform: { position: [240, 320, 0], rotation: [0, 0, 0] }, components: [{ id: 'guard-vision-light', type: 'light-2d', data: { lightType: 'spot', range: 260, halfAngleDeg: 30, colors: { calm: '#CFE0FF', calmAlpha: .4, suspicious: '#F2D04A', suspiciousAlpha: .4, chase: '#FF5A4D', chaseAlpha: .4 }, pulseWhenChase: true } }] },
    { id: 'awareness', parentId: 'root', transform: { position: [0, 0, 0], scale: [0.4, 0.04, 1] }, components: [{ id: 'awareness-canvas', type: 'canvas', data: { renderMode: 'world-space' } }, { id: 'awareness-rect', type: 'rect-transform', data: { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [.5, .5], anchoredPosition: [0, 0], sizeDelta: [80, 8] } }, { id: 'awareness-canvas-renderer', type: 'canvas-renderer', data: {} }, { id: 'awareness-image', type: 'image', data: { color: '#f2d04a', opacity: 1 } }] },
    { id: 'audio', parentId: 'root', components: [{ id: 'audio-source', type: 'audio-source', assetRef: 'RES-AUDIO', data: { loop: true } }] },
  ] } };
}

describe('Unity-style scene adapter', () => {
  it.each([1, 100])('resolves screen Canvas reference bounds at %s pixels per unit without changing authored rects', pixelsPerUnit => {
    for (const renderMode of ['screen-space-overlay', 'screen-space-camera', 'world-space']) {
      const rect = { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [.5, .5], anchoredPosition: [0, 0], sizeDelta: [0, 0] };
      const input: BeeGameSceneContentDocument = { schema: 'beegame-content.v1', id: 'canvas-scene', kind: 'scene-2d', assetRefs: [], data: {
        settings: { coordinateSystem: { width: 960, height: 540, pixelsPerUnit } }, nodes: [
          { id: 'canvas', components: [
            { id: 'canvas-component', type: 'canvas', data: { renderMode, referenceResolution: { width: 960, height: 540 } } },
            { id: 'canvas-rect', type: 'rect-transform', data: rect },
          ] },
          { id: 'background', parentId: 'canvas', components: [
            { id: 'background-rect', type: 'rect-transform', data: rect },
            { id: 'image', type: 'image', data: { color: '#ffffff' } },
          ] },
        ],
      } };
      const before = structuredClone(input);
      const editor = sceneContentToEditorDocument({ document: input, documentRevision: HASH, foundationDocumentRevision: HASH, assetManifestRevision: HASH });
      const screen = renderMode !== 'world-space';
      const size = screen ? [960 / pixelsPerUnit, 540 / pixelsPerUnit] : [0, 0];
      expect(editorRect(editor.nodes.canvas, editor.nodes)?.size).toEqual(size);
      expect(editorRect(editor.nodes.background, editor.nodes)).toEqual({ size, position: [0, 0] });
      const position = nodeWorldMatrix(editor, 'background').elements.slice(12, 14);
      expect(position).toEqual(screen ? [0, 0] : [-480 / pixelsPerUnit, 270 / pixelsPerUnit]);
      const canonical = sceneWorldTransforms2d(input.data.nodes);
      expect(canonical.rects.get('background')?.size).toEqual(screen ? [960, 540] : [0, 0]);
      expect(canonical.poses.get('background')?.slice(4)).toEqual(screen ? [480, 270] : [0, 0]);
      const canvas = editor.nodes.canvas;
      expect(rectTransform(canvas, editor.nodes, rectTransform(canvas, editor.nodes), true)).toEqual(canvas.transform);
      const saved = editorDocumentToSceneContent(editor, input);
      expect(saved.data.nodes.map(node => node.components)).toEqual(input.data.nodes.map(node => node.components));
      expect(input).toEqual(before);
    }
  });

  it('preserves authored camera identity, reference aspect and framing independently of the map size', () => {
    const input=scene();input.data.cameraNodeId='camera'
    input.data.settings={coordinateSystem:{origin:'top-left',units:'logical-pixels',width:2400,height:1600,pixelsPerUnit:100}}
    input.data.nodes.push({id:'camera',transform:{position:[1200,800,1000]},components:[{id:'cam',type:'camera',data:{orthographic:true,
      orthographicSize:2.7,coordinateSpace:'logical-pixels',viewport:{width:960,height:540},framing:'keep-width'}}]})
    const editor=sceneContentToEditorDocument({document:input,documentRevision:HASH,foundationDocumentRevision:HASH,assetManifestRevision:HASH})
    expect(editor.cameraNodeId).toBe('camera')
    expect(editor.nodes.camera.components[0]).toMatchObject({orthographicSize:2.7,properties:{framing:'keep-width',viewport:{width:960,height:540}}})
    const saved=editorDocumentToSceneContent(editor,input)
    expect(saved.data.cameraNodeId).toBe('camera')
    expect(saved.data.nodes.at(-1)!.components).toEqual(input.data.nodes.at(-1)!.components)
  })
  it('keeps independent scene layers ordered in the editor without rewriting source order', () => {
    const input = scene();
    input.data.settings = { layers: [{ id: 'far', order: -2 }, { id: 'near', order: 3 }] };
    input.data.nodes.push(
      { id: 'far', layer: 'far', zIndex: 0, components: [{ id: 'far-sprite', type: 'sprite-renderer', assetRef: 'RES-FOX' }] },
      { id: 'near', layer: 'near', zIndex: 0, components: [{ id: 'near-sprite', type: 'sprite-renderer', assetRef: 'RES-FOX' }] },
    );
    const editor = sceneContentToEditorDocument({ document: input, documentRevision: HASH, foundationDocumentRevision: HASH, assetManifestRevision: HASH });
    expect(rendererOrder(editor.nodes.far)).toBeLessThan(rendererOrder(editor.nodes.near));
    const saved = editorDocumentToSceneContent(editor, input);
    expect(saved.data.nodes.slice(-2).map(node => [node.layer, node.zIndex])).toEqual([['far', 0], ['near', 0]]);
  });

  it('round-trips versioned Tilemap cells and parent transforms without scaling cell data', () => {
    const input:BeeGameSceneContentDocument={schema:'beegame-content.v1',id:'tile-scene',kind:'scene-2d',assetRefs:['RES-TILES'],data:{
      settings:{coordinateSystem:{origin:'top-left',units:'logical-pixels',width:320,height:180,pixelsPerUnit:32}},
      nodes:[
        {id:'grid',transform:{position:[64,96,0],rotation:[0,0,.5],scale:[2,1,1]},components:[{id:'g',type:'grid',data:{schema:'grid.v1',cellSize:[32,32]}}]},
        {id:'map',parentId:'grid',transform:{position:[16,32,0]},components:[
          {id:'m',type:'tilemap',assetRef:'RES-TILES',data:{schema:'tilemap.v1',gridNodeId:'grid',cells:[{x:-1,y:2,tileId:'tree'}]}},
          {id:'r',type:'tilemap-renderer',data:{schema:'tilemap-renderer.v1',sortingOrder:2}},
        ]},
      ],
    }};
    const editor=sceneContentToEditorDocument({document:input,documentRevision:HASH,foundationDocumentRevision:HASH,assetManifestRevision:HASH});
    expect(editor.nodes.map.transform.position).toEqual([.5,-1,0]);
    expect(editor.nodes.map.components[0]).toMatchObject({properties:{cells:[{x:-1,y:2,tileId:'tree'}]}});
    const saved=editorDocumentToSceneContent(editor,input);
    expect(saved.data.nodes[1].components).toEqual(input.data.nodes[1].components);
    expect(saved.data.nodes[0].transform).toEqual(input.data.nodes[0].transform);
  });
  it('round-trips 2D rotation, Z, scale and rect anchors at the editor boundary', () => {
    const input = scene();
    input.data.settings = { coordinateSystem:{width:960,height:540,pixelsPerUnit:32}, layers:[{id:'actors',order:5}] };
    const actor = input.data.nodes.find(n => n.id === 'player')!;
    actor.transform = { position:[96,224,7], rotation:[0,0,Math.PI/3], scale:[-2,3,1] };
    const rect = input.data.nodes.find(n => n.id === 'awareness')!.components!.find(c => c.type === 'rect-transform')!;
    rect.data = {anchorMin:[.25,.1],anchorMax:[.75,.8],pivot:[0,1],anchoredPosition:[12,16],sizeDelta:[80,8]};
    const editor = sceneContentToEditorDocument({document:input,documentRevision:HASH,foundationDocumentRevision:HASH,assetManifestRevision:HASH});
    expect(editor.nodes.player.transform.rotation[2]).toBeCloseTo(-Math.PI/3);
    expect(editor.nodes.player.transform.scale).toEqual([-2,3,1]);
    const imported = editor.nodes.awareness.components.find(c=>c.type==='rect-transform')!;
    expect(imported).toMatchObject({anchoredPosition:[.375,-.5],pivot:[0,0],sizeDelta:[2.5,.25]});
    const saved = editorDocumentToSceneContent(editor,input);
    const savedActor = saved.data.nodes.find(n=>n.id==='player')!;
    savedActor.transform!.position.forEach((v,i)=>expect(v).toBeCloseTo(actor.transform!.position[i]));
    savedActor.transform!.rotation!.forEach((v,i)=>expect(v).toBeCloseTo(actor.transform!.rotation![i]));
    const savedRect = saved.data.nodes.find(n=>n.id==='awareness')!.components!.find(c=>c.type==='rect-transform')!;
    (savedRect.data!.anchorMin as number[]).forEach((v,i)=>expect(v).toBeCloseTo((rect.data!.anchorMin as number[])[i]));
    expect(savedRect.data!.anchoredPosition).toEqual([12,16]);
    editor.nodes.player.transform.position[0] += 1;
    editor.nodes.player.transform.rotation[2] -= .25;
    const moved = editorDocumentToSceneContent(editor,input);
    expect(moved.data.nodes.find(n=>n.id==='player')!.transform!.position[0]).toBe(128);
    const reopened = sceneContentToEditorDocument({document:moved,documentRevision:HASH,foundationDocumentRevision:HASH,assetManifestRevision:HASH});
    expect(reopened.nodes.player.transform.position).toEqual(editor.nodes.player.transform.position);
    expect(reopened.nodes.player.transform.rotation[2]).toBeCloseTo(editor.nodes.player.transform.rotation[2]);
  });

  it('does not apply 2D flips, canvas offsets or pixel scaling to a 3D scene and its effects', () => {
    const input = scene(); input.kind = 'scene-3d';
    input.data.settings = {coordinateSystem:{origin:'world',units:'meters',pixelsPerUnit:32}};
    input.data.nodes[0].transform = {position:[1,2,3],rotation:[.1,.2,.3],scale:[1,2,3]};
    const editor = sceneContentToEditorDocument({document:input,documentRevision:HASH,foundationDocumentRevision:HASH,assetManifestRevision:HASH});
    expect(editor.nodes.root.transform).toEqual(input.data.nodes[0].transform);
    expect(editor.pixelsPerUnit).toBe(1);
    expect(editor.nodes.fireflies.components[0]).toMatchObject({properties:{zone:{x:40,y:60,width:1200,height:600}}});
    const saved = editorDocumentToSceneContent(editor,input);
    expect(saved.data.nodes[0].transform).toEqual(input.data.nodes[0].transform);
    expect(saved.data.nodes.find(n=>n.id==='fireflies')!.components![0].data).toEqual(input.data.nodes.find(n=>n.id==='fireflies')!.components![0].data);
  });

  it('converts collider pixels and y-down offsets, and restores them on save without shrinking lights', () => {
    const input = scene();
    input.data.settings = { coordinateSystem: { pixelsPerUnit: 50, width: 1280, height: 720 } };
    input.data.nodes[0].components = [
      { id: 'box', type: 'box-collider-2d', data: { size: [140, 80], offset: [10, 20], isTrigger: false } },
      { id: 'circle', type: 'circle-collider-2d', data: { radius: 26, offset: [5, -10], isTrigger: false } },
      { id: 'capsule', type: 'capsule-collider-2d', data: { size: [140, 80], offset: [0, 0], direction: 'horizontal', isTrigger: true } },
      { id: 'polygon', type: 'polygon-collider-2d', data: { points: [[0, 0], [50, 0], [0, 100]], offset: [10, 20], isTrigger: false } },
    ];
    const imported = sceneContentToEditorDocument({ document: input, documentRevision: HASH, foundationDocumentRevision: HASH, assetManifestRevision: HASH });
    expect(imported.nodes.root.components).toMatchObject([
      { size: [2.8, 1.6], offset: [.2, -.4] },
      { radius: .52, offset: [.1, .2] },
      { size: [2.8, 1.6], direction: 'horizontal' },
      { points: [[0, -0], [1, -0], [0, -2]], offset: [.2, -.4] },
    ]);
    const saved = editorDocumentToSceneContent(imported, input);
    expect(saved.data.nodes[0].components).toEqual(input.data.nodes[0].components);
    const reopened = sceneContentToEditorDocument({ document: saved, documentRevision: HASH, foundationDocumentRevision: HASH, assetManifestRevision: HASH });
    expect(reopened.nodes['guard-vision'].components[0]).toMatchObject({ light: { distance: 5.2 } });
    input.kind = 'scene-3d';
    const threeD = sceneContentToEditorDocument({ document: input, documentRevision: HASH, foundationDocumentRevision: HASH, assetManifestRevision: HASH });
    expect(threeD.nodes.root.components[0]).toMatchObject({ size: [140, 80], offset: [10, 20] });
  });
  it('uses state sheets on Image and root resource references without a member', () => {
    const input = scene();
    input.data.nodes[0].components = [{ id: 'image', type: 'image', assetRef: 'RES-FOX', data: { frame: 'hover' } }];
    const imported = sceneContentToEditorDocument({ document: input, documentRevision: HASH, foundationDocumentRevision: HASH, assetManifestRevision: HASH,
      assets: { ...assets, 'RES-FOX': { ...assets['RES-FOX'], spriteSheet: { frameWidth: 44, frameHeight: 44, states: ['normal', 'hover'] } } } });
    expect(imported.nodes.root.components[0]).toMatchObject({ material: { textureRegion: { x: 44, y: 0, width: 44, height: 44 } } });
  });

  it('reads harbor packed frames, array size/anchor and PPU32 without altering scene JSON', () => {
    const input = scene();
    input.data.settings = { coordinateSystem: { pixelsPerUnit: 32, width: 2400, height: 1600 } };
    input.data.nodes[0] = { id: 'root', transform: { position: [320, 320, 0] }, components: [
      { id: 'sprite', type: 'sprite-renderer', assetRef: 'RES-FOX', data: { size: [32, 48], anchor: [.5, 1], frame: 'boat_hull_f0' } },
      { id: 'collider', type: 'box-collider-2d', data: { size: [32, 48], offset: [0, 0] } },
    ] };
    const sheetAssets = { ...assets, 'RES-FOX': { ...assets['RES-FOX'], spriteSheet: { frames: { boat_hull_f0: { x: 1, y: 1, width: 40, height: 48 } } } } };
    const editor = sceneContentToEditorDocument({ document: input, documentRevision: HASH, foundationDocumentRevision: HASH, assetManifestRevision: HASH, assets: sheetAssets });
    expect(editor.pixelsPerUnit).toBe(32);
    expect(editor.nodes.root.components[0]).toMatchObject({ frame: { x: 1, y: 1, width: 40, height: 48 } });
    expect(editor.nodes.root.components[1]).toMatchObject({ size: [1, 1.5] });
    // A bottom pivot moves geometry, not the GameObject/collider.
    expect(editor.nodes.root.transform.position).toEqual([-27.5, 15, 0]);
    expect(editorDocumentToSceneContent(editor, input).data.nodes[0].transform?.position).toEqual([320, 320, 0]);
    expect(editorDocumentToSceneContent(editor, input).data.nodes[0].components?.[0].data).toEqual(input.data.nodes[0].components?.[0].data);
  });

  it('maps canonical 2D GameObjects without synthetic component types', () => {
    const output = sceneContentToEditorDocument({ document: scene(), documentRevision: HASH, foundationDocumentRevision: HASH, assetManifestRevision: HASH, assets, assetMembers });
    expect(output).toMatchObject({ schemaVersion: 'scene-game-object.v2', dimension: '2d' });
    expect(output.nodes.root.components).toEqual([]);
    expect(output.nodes.camera.components.map(component => component.type)).toEqual(['camera', 'audio-listener']);
    expect(output.nodes.player.components[0]).toMatchObject({ type: 'sprite-renderer', assetId: 'RES-FOX:idle', material: { opacity: .75 } });
    expect(output.nodes.player.components.map(component => component.type)).toEqual(['sprite-renderer', 'box-collider-2d']);
    expect(output.nodes.player.transform.scale).toEqual([1, 1, 1]);
    expect(output.nodes.fireflies.components.map(component => component.type)).toEqual(['particle-system', 'particle-system-renderer']);
    expect(output.nodes.fireflies.components[0]).toMatchObject({ properties: { zone: { x: 40, y: -660, width: 1200, height: 600 } } });
    expect(output.nodes.fireflies.components[1]).toMatchObject({ type: 'particle-system-renderer', assetId: 'RES-FX:glow', textureAssetId: 'RES-FX:glow' });
    expect(output.nodes['guard-vision'].components).toEqual([expect.objectContaining({ type: 'light-2d', light: expect.objectContaining({ kind: 'spot', color: '#CFE0FF', alpha: .4, intensity: 1, distance: 2.6, angle: Math.PI / 6 }) })]);
    expect(output.nodes['guard-vision'].components).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'sprite-renderer' }), expect.objectContaining({ type: 'image' })]));
    expect(output.nodes.awareness.components[3]).toMatchObject({ type: 'image', material: { color: '#f2d04a' } });
    expect(output.nodes.awareness.components[3]).not.toHaveProperty('assetId');
    expect(output.nodes.awareness.components[1]).toMatchObject({ id: 'awareness-rect', type: 'rect-transform', sizeDelta: [.8, .08] });
    expect(output.nodes.audio.components[0]).toMatchObject({ type: 'audio-source', assetId: 'RES-AUDIO' });
    for (const node of Object.values(output.nodes)) expect(node).not.toHaveProperty('kind');
  });

  it('round-trips the canonical component vocabulary', () => {
    const input = scene(); const editor = sceneContentToEditorDocument({ document: input, documentRevision: HASH, foundationDocumentRevision: HASH, assetManifestRevision: HASH, assets, assetMembers });
    const output = editorDocumentToSceneContent(editor, input);
    expect(output.kind).toBe('scene-2d');
    expect(output.data.nodes.every(node => !('kind' in node))).toBe(true);
    expect(output.data.nodes.find(node => node.id === 'fireflies')?.components?.map(component => component.type)).toEqual(['particle-system', 'particle-system-renderer']);
    expect(output.data.nodes.find(node => node.id === 'fireflies')?.components?.find(component => component.type === 'particle-system')?.data).toMatchObject({ zone: { x: 40, y: 60, width: 1200, height: 600 } });
    expect(output.data.nodes.find(node => node.id === 'fireflies')?.components?.find(component => component.type === 'particle-system-renderer')).toMatchObject({ assetRef: 'RES-FX', data: { member: 'glow', blend: 'additive' } });
    expect(output.data.nodes.find(node => node.id === 'guard-vision')?.components).toEqual([expect.objectContaining({ type: 'light-2d', data: expect.objectContaining({ lightType: 'spot', range: 260, halfAngleDeg: 30, colors: expect.objectContaining({ calm: '#CFE0FF', calmAlpha: .4 }), kind: 'spot', distance: 260, angle: Math.PI / 6, alpha: .4, intensity: 1 }) })]);
    expect(output.data.nodes.find(node => node.id === 'awareness')?.components?.find(component => component.type === 'rect-transform')).toMatchObject({ id: 'awareness-rect' });
    expect(output.data.nodes.find(node => node.id === 'player')?.transform?.scale).toEqual([1, 1, 1]);
  });

  it('does not materialize undefined animation fields when a frame table has no facings', () => {
    const sheetAssets = { ...assets, 'RES-FOX:idle': { ...assets['RES-FOX:idle'], spriteSheet: { frameWidth: 64, frameHeight: 64, framesPerFacing: 4 } } };
    const output = sceneContentToEditorDocument({ document: scene(), documentRevision: HASH, foundationDocumentRevision: HASH, assetManifestRevision: HASH, assets: sheetAssets, assetMembers });
    const sprite = output.nodes.player.components[0];
    expect(sprite.type).toBe('sprite-renderer');
    if (sprite.type !== 'sprite-renderer') throw new Error('Expected sprite renderer');
    expect(sprite).not.toHaveProperty('animation');
    expect(() => canonicalJson(output)).not.toThrow();
  });

  it('maps scene light aliases and preserves a static state-sheet frame', () => {
    const input = scene();
    const light = input.data.nodes.find(node => node.id === 'guard-vision')!;
    light.components![0]!.data = { lightType: 'spot', range: 260, halfAngleDeg: 30, colors: { calm: '#CFE0FF', calmAlpha: .4 } };
    const mailbox = input.data.nodes.find(node => node.id === 'player')!;
    mailbox.components![0]!.data = { member: 'idle', frame: 'flag_up', size: { width: 64, height: 64 } };
    const output = sceneContentToEditorDocument({ document: input, documentRevision: HASH, foundationDocumentRevision: HASH, assetManifestRevision: HASH, assets: { ...assets, 'RES-FOX:idle': { ...assets['RES-FOX:idle'], spriteSheet: { frameWidth: 64, frameHeight: 64, framesPerFacing: 2, states: ['flag_down', 'flag_up'] } } }, assetMembers });
    expect(output.nodes['guard-vision'].components[0]).toMatchObject({ light: { kind: 'spot', color: '#CFE0FF', alpha: .4, intensity: 1, distance: 2.6, angle: Math.PI / 6 } });
    expect(output.nodes.player.components[0]).toMatchObject({ frame: { x: 64, y: 0, width: 64, height: 64 }, material: { textureRegion: { x: 64, y: 0 } } });
  });

  it('does not guess a resource member from the GameObject id', () => {
    const input = scene();
    const player = input.data.nodes.find(node => node.id === 'player')!;
    player.id = 'idle';
    const sprite = player.components![0];
    sprite.data = { ...sprite.data };
    delete sprite.data.member;
    const output = sceneContentToEditorDocument({ document: input, documentRevision: HASH, foundationDocumentRevision: HASH, assetManifestRevision: HASH, assets, assetMembers });
    expect(output.nodes.idle.components[0]).toMatchObject({ type: 'sprite-renderer', assetId: 'RES-FOX' });
  });

  it('resolves scene text fonts using the canonical reference and legacy member form', () => {
    const input = scene();
    input.assetRefs.push('FONT-CN-01');
    input.data.nodes.push({
      id: 'text', parentId: 'root', transform: { position: [20, 20, 0] },
      components: [
        { id: 'text-rect', type: 'rect-transform', data: { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [.5, .5], anchoredPosition: [0, 0], sizeDelta: [240, 40] } },
        { id: 'text-renderer', type: 'text', data: { text: '你好', fontSize: 22, member: 'fonts/lxgw.woff2' } },
      ],
    });
    const fontAsset: SceneAsset = { id: 'FONT-CN-01:fonts/lxgw.woff2', name: 'lxgw.woff2', mimeType: 'font/woff2', path: 'fonts/lxgw.woff2', uri: 'blob:font' };
    const editor = sceneContentToEditorDocument({
      document: input,
      documentRevision: HASH,
      foundationDocumentRevision: HASH,
      assetManifestRevision: HASH,
      assets: { ...assets, 'FONT-CN-01': fontAsset, [fontAsset.id]: fontAsset },
      assetMembers: { ...assetMembers, 'FONT-CN-01': { 'fonts/lxgw.woff2': fontAsset.id } },
    });
    expect(editor.nodes.text.components.find(component => component.type === 'text')).toMatchObject({ fontAssetId: fontAsset.id });
    const saved = editorDocumentToSceneContent(editor, input);
    expect(saved.data.nodes.find(node => node.id === 'text')?.components?.find(component => component.type === 'text')?.data).toMatchObject({ font: { assetRef: 'FONT-CN-01', member: 'fonts/lxgw.woff2' }, text: '你好' });
    expect(saved.data.nodes.find(node => node.id === 'text')?.components?.find(component => component.type === 'text')?.data).not.toHaveProperty('member');
  });
});
