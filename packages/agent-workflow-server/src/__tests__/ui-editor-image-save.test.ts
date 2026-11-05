import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeeGameAssetManifest } from '../beegame/asset-contracts'
import { BEEGAME_SCENE_MODEL, parseBeeGameContentDocument, validateContentDocument } from '../beegame/game-content-package'


test('historical UI image validation preserves roles without re-enabling editor saves', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'bgs-ui-image-save-')))
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
      documents: [{ path: 'scenes/main.json', id: 'scene', kind: 'scene-2d', loadPhase: 'startup' },
        { path: 'ui/menu.json', id: 'menu', kind: 'ui-screen', loadPhase: 'startup' }],
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
    const original = structuredClone(document)
    Object.assign(original.data.nodes[4]!, { text: 'Before edit' })
    await writeFile(join(workspacePath, 'content/ui/menu.json'), JSON.stringify(original))
    const issues: string[] = []
    validateContentDocument({ workspacePath, path: 'content/ui/menu.json', document: parseBeeGameContentDocument(document), authority, issues })
    expect(issues).toEqual([])
    const invalid = structuredClone(document)
    Object.assign(invalid.data.nodes[1], { assetRef: 'RES-UI' })
    validateContentDocument({ workspacePath, path: 'content/ui/menu.json', document: parseBeeGameContentDocument(invalid), authority, issues })
    expect(issues.join('; ')).toContain('UI role container is not an asset type')
    expect(JSON.parse(await readFile(join(workspacePath, 'content/ui/menu.json'), 'utf8'))).toEqual(original)
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
})
