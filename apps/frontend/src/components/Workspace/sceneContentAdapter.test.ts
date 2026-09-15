import {
  editorDocumentToSceneContent,
  sceneContentToEditorDocument,
} from './sceneContentAdapter';
import type { BeeGameSceneContentDocument } from '../../services/beeGameAdapter';

const REVISION = 'a'.repeat(64);
const ASSET_REVISION = 'b'.repeat(64);

function scene(): BeeGameSceneContentDocument {
  return {
    schema: 'beegame-content.v1',
    id: 'scene.main',
    kind: 'scene-2d',
    irRefs: ['world.main'],
    assetRefs: ['asset.background'],
    data: {
      cameraNodeId: 'camera.main',
      nodes: [
        { id: 'world', kind: 'group', data: { theme: 'night' } },
        {
          id: 'background',
          parentId: 'world',
          kind: 'sprite',
          assetRef: 'asset.background',
          zIndex: -2,
          transform: { position: [2, 4], rotation: 0.25, scale: [8, 6] },
          components: [{ type: 'sprite-renderer', data: { blend: 'normal' } }],
        },
        { id: 'camera.main', parentId: 'world', kind: 'camera' },
      ],
    },
  };
}

describe('Scene content editor boundary', () => {
  it('round-trips an unchanged canonical scene without inventing fields', () => {
    const canonical = scene();
    const editor = sceneContentToEditorDocument({
      document: canonical,
      documentRevision: REVISION,
      irRevision: REVISION,
      assetManifestRevision: ASSET_REVISION,
    });

    expect(editor.rootIds).toEqual(['world']);
    expect(editor.nodes.world.children).toEqual(['background', 'camera.main']);
    expect(editor.nodes.background.transform).toEqual({
      position: [2, -2, 4],
      rotation: [0, -0.25, 0],
      scale: [8, 1, 6],
    });
    expect(editorDocumentToSceneContent(editor, canonical)).toEqual(canonical);
  });

  it('writes hierarchy, visibility and 2D transform edits back to the same document', () => {
    const canonical = scene();
    const editor = sceneContentToEditorDocument({
      document: canonical,
      documentRevision: REVISION,
      irRevision: REVISION,
      assetManifestRevision: ASSET_REVISION,
    });
    editor.nodes.background.name = 'Night Sky';
    editor.nodes.background.visible = false;
    editor.nodes.background.transform.position = [7, 3, 9];
    editor.nodes.background.transform.rotation = [0, -0.5, 0];
    editor.nodes.background.transform.scale = [4, 1, 5];

    const saved = editorDocumentToSceneContent(editor, canonical);
    expect(saved.data.nodes[1]).toEqual({
      ...canonical.data.nodes[1],
      name: 'Night Sky',
      enabled: false,
      zIndex: 3,
      transform: { position: [7, 9], rotation: 0.5, scale: [4, 5] },
    });
    expect(saved.data.nodes[1].components).toEqual(canonical.data.nodes[1].components);
  });

  it('does not retain a dangling camera reference when that node is deleted', () => {
    const canonical = scene();
    const editor = sceneContentToEditorDocument({
      document: canonical,
      documentRevision: REVISION,
      irRevision: REVISION,
      assetManifestRevision: ASSET_REVISION,
    });
    delete editor.nodes['camera.main'];
    editor.nodes.world.children = editor.nodes.world.children.filter(id => id !== 'camera.main');

    expect(editorDocumentToSceneContent(editor, canonical).data.cameraNodeId).toBeUndefined();
  });
});
