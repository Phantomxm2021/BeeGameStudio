import { describe, expect, it } from 'vitest';
import type { SceneAsset } from '@beegame/scene-editor';
import type { BeeGameSceneContentDocument } from '../../services/beeGameAdapter';
import {
  editorDocumentToSceneContent,
  sceneContentToEditorDocument,
} from './sceneContentAdapter';

const HASH = 'a'.repeat(64);

function scene(): BeeGameSceneContentDocument {
  return {
    schema: 'beegame-content.v1',
    id: 'scene_test',
    kind: 'scene-2d',
    assetRefs: ['RES-BG', 'RES-FOX'],
    data: {
      nodes: [
        {
          id: 'config',
          kind: 'world-config',
          data: {
            layers: [
              { id: 'background', order: 1 },
              { id: 'actors', order: 5 },
            ],
          },
        },
        {
          id: 'bg_night',
          kind: 'image',
          layer: 'background',
          assetRef: 'RES-BG',
          transform: { position: [0, 0] },
          data: {
            size: { width: 1280, height: 720 },
            anchor: { x: 0, y: 0 },
            alpha: 0.8,
          },
        },
        {
          id: 'bg_fog_far',
          kind: 'image',
          layer: 'background',
          assetRef: 'RES-BG',
          transform: { position: [0, 210] },
          data: {
            size: { width: 1280, height: 180 },
            anchor: { x: 0, y: 0 },
          },
        },
        {
          id: 'player',
          kind: 'player',
          layer: 'actors',
          assetRef: 'RES-FOX',
          transform: { position: [96, 624] },
          data: {
            sprite: {
              assetRef: 'RES-FOX',
              logicalSize: { width: 64, height: 64 },
              actions: { idle: { member: 'sp_fox_idle_sheet' } },
            },
            patrol: {
              mode: 'pingpong',
              waypoints: [{ x: 96, y: 624 }, { x: 320, y: 624 }],
            },
          },
        },
        {
          id: 'glyph',
          parentId: 'player',
          kind: 'glyph',
          assetRef: 'RES-FOX',
          data: {
            offset: { x: 0, y: -58 },
            size: { width: 36, height: 36 },
            anchor: { x: 0.5, y: 0.5 },
            visibleWhen: 'state == suspicious',
          },
        },
      ],
    },
  };
}

const assets: Record<string, SceneAsset> = {
  'RES-BG': { id: 'RES-BG', name: 'background.webp', mimeType: 'image/webp', path: 'background.webp', uri: 'blob:bg' },
  'RES-BG:bg_fog_01': { id: 'RES-BG:bg_fog_01', name: 'fog.webp', mimeType: 'image/webp', path: 'fog.webp', uri: 'blob:fog' },
  'RES-FOX': { id: 'RES-FOX', name: 'fox.webp', mimeType: 'image/webp', path: 'fox.webp', uri: 'blob:fox' },
  'RES-FOX:sp_fox_idle_sheet': { id: 'RES-FOX:sp_fox_idle_sheet', name: 'fox-idle.webp', mimeType: 'image/webp', path: 'fox-idle.webp', uri: 'blob:fox-idle' },
};

const assetMembers = {
  'RES-BG': {
    bg_night: 'RES-BG',
    bg_fog_01: 'RES-BG:bg_fog_01',
  },
  'RES-FOX': {
    sp_fox_idle_sheet: 'RES-FOX:sp_fox_idle_sheet',
  },
};

const frameTables = {
  'RES-FOX': {
    sp_fox_idle_sheet: {
      frameWidth: 128,
      frameHeight: 128,
      framesPerFacing: 2,
      facings: ['down', 'up', 'left', 'right'],
      frameDurationMs: [600, 600, 600, 600, 600, 600, 600, 600],
    },
  },
};

describe('sceneContentAdapter 2D rendering', () => {
  it('maps asset-backed 2D nodes to sized, anchored texture planes', () => {
    const output = sceneContentToEditorDocument({
      document: scene(),
      documentRevision: HASH,
      foundationDocumentRevision: HASH,
      assetManifestRevision: HASH,
      assets,
      assetMembers,
      frameTables,
    });

    expect(output.nodes.bg_night.kind).toBe('plane');
    expect(output.nodes.bg_night.material).toMatchObject({
      textureAssetId: 'RES-BG',
      opacity: 0.8,
    });
    expect(output.nodes.bg_night.transform.position).toEqual([6.4, 0.01, 3.6]);
    expect(output.nodes.bg_night.transform.rotation.map(Math.abs)).toEqual([0, 0, 0]);
    expect(output.nodes.bg_night.transform.scale).toEqual([12.8, 1, 7.2]);
    expect(output.nodes.bg_fog_far.material?.textureAssetId).toBe('RES-BG:bg_fog_01');

    expect(output.nodes.player.kind).toBe('plane');
    expect(output.nodes.player.material?.textureAssetId).toBe('RES-FOX:sp_fox_idle_sheet');
    expect(output.nodes.player.material?.textureRegion).toEqual({ x: 0, y: 0, width: 128, height: 128 });
    expect(output.nodes.player.transform.scale).toEqual([0.64, 1, 0.64]);
    expect(output.nodes.player.unknown?.preview2d).toMatchObject({
      patrol: { mode: 'pingpong', waypoints: [{ x: 96, y: 624 }, { x: 320, y: 624 }] },
    });
    expect(output.nodes.glyph.kind).toBe('plane');
    expect(output.nodes.glyph.visible).toBe(false);
    expect(output.nodes.glyph.transform.position).toEqual([0, 0, -0.58]);
    expect(output.settings?.showGrid).toBe(false);
    expect(output.source.source.kind).toBe('content-package');
  });

  it('does not rewrite unchanged canonical transforms during a round trip', () => {
    const input = scene();
    const editor = sceneContentToEditorDocument({
      document: input,
      documentRevision: HASH,
      foundationDocumentRevision: HASH,
      assetManifestRevision: HASH,
      assets,
      assetMembers,
      frameTables,
    });

    expect(editorDocumentToSceneContent(editor, input)).toEqual(input);
  });
});
