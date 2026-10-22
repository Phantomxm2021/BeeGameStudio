import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeeGameAssetManifest } from '../beegame/asset-contracts'
import { BEEGAME_SCENE_MODEL, parseBeeGameContentDocument, validateContentDocument } from '../beegame/game-content-package'

import { createRun } from '../beegame/workflow-v3/state'
import { readContentView } from '../beegame/workflow-v3/content-view'
import { prepareSourceEdit, writeSourceEdit } from '../beegame/workflow-v3/source-edit'
import { reserveSourceEdit } from '../beegame/workflow-v3/changes'

test('editor image edits preserve roles through the current source save and shared content validation', async () => {
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
    const view = await readContentView(workspacePath)
    if (view.state !== 'draft') throw Error('Expected editable fixture')
    const current = view.documents.find(entry => entry.path === 'ui/menu.json')!
    const run = createRun({ projectId: 'fixture', ownerId: 'test', workspacePath, chatSessionId: 'test',
      requestKey: 'fixture', text: 'Offline editor fixture', constraints: {}, ids: ['req.edit'] })
    const edit = await prepareSourceEdit(run, { path: current.path, expectedRevision: current.revision, document,
      workflow: { version: run.version, planRevision: run.planRevision, requirementsRevision: run.requirements.revision } })
    const reserved = reserveSourceEdit(run, { path: edit.path, before: edit.beforeHash, after: edit.afterHash,
      workerId: 'fixture', requestKey: 'save', requestHash: edit.afterHash })
    await writeSourceEdit(reserved, reserved.writer!.attemptId, edit, new AbortController().signal)
    expect(JSON.parse(await readFile(join(workspacePath, 'content/ui/menu.json'), 'utf8'))).toEqual(document)
    const issues: string[] = []
    validateContentDocument({ workspacePath, path: 'content/ui/menu.json', document: edit.document, authority, issues })
    expect(issues).toEqual([])
    const invalid = structuredClone(document)
    Object.assign(invalid.data.nodes[1], { assetRef: 'RES-UI' })
    validateContentDocument({ workspacePath, path: 'content/ui/menu.json', document: parseBeeGameContentDocument(invalid), authority, issues })
    expect(issues.join('; ')).toContain('UI role container is not an asset type')
    expect(JSON.parse(await readFile(join(workspacePath, 'content/ui/menu.json'), 'utf8'))).toEqual(document)
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
})
