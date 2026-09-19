import { describe, expect, it } from 'vitest';
import { canonicalJson, type SceneAsset } from '@beegame/scene-editor';
import type { BeeGameSceneContentDocument } from '../../services/beeGameAdapter';
import { editorDocumentToSceneContent, sceneContentToEditorDocument } from './sceneContentAdapter';

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
    expect(editor.nodes.root.transform.position).toEqual([-27.5, 15.75, 0]);
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
});
