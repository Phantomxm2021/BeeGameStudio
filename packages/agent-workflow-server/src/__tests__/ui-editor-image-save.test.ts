import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeeGameAssetManifest } from '../beegame/asset-contracts'
import { BEEGAME_SCENE_MODEL, loadBeeGameContentDocument, saveBeeGameContentDocument } from '../beegame/game-content-package'

test('editor image edits preserve container/control roles and pass the real save validation', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-ui-image-save-'))
  try {
    const documentRevision = 'a'.repeat(64)
    const assetManifestRevision = 'b'.repeat(64)
    const authority = { documentRevision, assetManifestRevision, manifest: { resources: [{
      id: 'RES-UI', status: 'verified', root_path: 'assets/button.png', file_paths: ['assets/button.png'],
    }] } as unknown as BeeGameAssetManifest }
    await mkdir(join(workspacePath, 'content/ui'), { recursive: true })
    await mkdir(join(workspacePath, 'content/scenes'), { recursive: true })
    await writeFile(join(workspacePath, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2', id: 'test', dimension: '2d', documentRevision,
      assetManifestRevision, sceneModel: BEEGAME_SCENE_MODEL, entryScene: 'scene', files: ['scenes/main.json', 'ui/menu.json'],
    }))
    await writeFile(join(workspacePath, 'content/scenes/main.json'), JSON.stringify({
      schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: [], data: {
        settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels', width: 1280, height: 720, pixelsPerUnit: 1 } },
        nodes: [{ id: 'root', components: [] }],
      },
    }))
    const document = {
      schema: 'beegame-content.v1', id: 'menu', kind: 'ui-screen', assetRefs: ['RES-UI'],
      data: { rootId: 'root', nodes: [
        { id: 'root', role: 'screen-root' },
        ...['container', 'button', 'shape'].map(role => ({ id: role, role, parentId: 'root',
          style: { background: { color: '#123456', opacity: 0.5 } },
          data: { image: { assetRef: 'RES-UI', member: 'button', type: 'simple', preserveAspect: true } },
        })),
        { id: 'label', role: 'text', parentId: 'container', text: 'Child' },
      ] },
    }
    await writeFile(join(workspacePath, 'content/ui/menu.json'), JSON.stringify(document))
    const current = loadBeeGameContentDocument(workspacePath, 'ui/menu.json')
    const result = saveBeeGameContentDocument({ workspacePath, path: 'ui/menu.json', expectedRevision: current.revision, document, authority })
    expect(result.document).toEqual(document)
    // The editor must not solve visual capability by relaxing the structural contract.
    const invalid = structuredClone(document)
    Object.assign(invalid.data.nodes[1], { assetRef: 'RES-UI' })
    expect(() => saveBeeGameContentDocument({ workspacePath, path: 'ui/menu.json', expectedRevision: result.revision, document: invalid, authority }))
      .toThrow('UI role container is not an asset type')
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
})
