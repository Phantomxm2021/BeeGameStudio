import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeeGameAssetManifest } from '../beegame/asset-contracts'
import {
  BEEGAME_SCENE_MODEL,
  auditBeeGameContentPackage,
  parseBeeGameContentDocument,
  parseBeeGameContentIndex,
} from '../beegame/game-content-package'
import { buildSceneUiContentAuthoringAuthority } from '../beegame/scene-ui-content-authoring'
import { buildWorkerPrompt } from '../beegame/delivery-workflow/worker-prompts'

const documentRevision = 'a'.repeat(64)
const assetManifestRevision = 'b'.repeat(64)

function authority() {
  return buildSceneUiContentAuthoringAuthority({
    documentRevision,
    assetManifestRevision,
    manifest: {} as BeeGameAssetManifest,
  })
}

describe('game content authoring contract', () => {
  test('sends the exact strict format and the host validation command to the Agent', () => {
    const task = authority()
    const format = task.contract.output.format as Record<string, unknown>
    expect(task.contract.output.kinds).toContain('vfx')
    expect(format.strict).toBe(true)
    const uiVocabulary = format.uiVocabulary as Record<string, unknown>
    const sceneVocabulary = format.sceneVocabulary as Record<string, unknown>
    expect(sceneVocabulary.model).toBe(BEEGAME_SCENE_MODEL)
    expect(sceneVocabulary.nodeKinds).toBeUndefined()
    expect(sceneVocabulary.componentTypes).toContain('sprite-renderer')
    expect(sceneVocabulary.componentTypes).not.toContain('mono-behaviour')
    expect(sceneVocabulary.componentTypes).toContain('rect-transform')
    expect(sceneVocabulary.componentTypes).toContain('mesh-renderer')
    expect(uiVocabulary.roles).toContain('slider')
    expect(uiVocabulary.roles).toContain('toggle')
    expect(uiVocabulary.assetBackedRoles).toEqual([
      'image',
      'sprite',
      'nineSlicePanel',
    ])
    expect(task.contract.validationCommand.args[0]).toEndWith(
      'game-content-validation-cli.ts',
    )
    expect(task.contract.previewCommand.args[0]).toEndWith(
      'scene-content-preview-cli.ts',
    )
    expect(task.contract.previewCommand.outputRoot).toBe('content/previews/')

    const index = (format.index ?? {}) as Record<string, unknown>
    expect(() => parseBeeGameContentIndex({ ...index, id: 'package', dimension: '2d', entryScene: 'scene', files: ['scenes/scene.json'] })).not.toThrow()

    const prompt = buildWorkerPrompt({
      runId: 'run-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      workspacePath: '/workspace',
      workerType: 'content-author',
      phase: 'GAME_CONTENT',
      revision: assetManifestRevision,
      allowedPaths: ['content/'],
      contract: task.contract,
    })
    expect(prompt).toContain('contract.output.format')
    expect(prompt).toContain('contract.validationCommand')
    expect(prompt).toContain('contract.previewCommand')
    expect(prompt).toContain('inspect the rendered Scene images')
    expect(prompt).toContain('content/vfx/')
  })

  test('accepts the closed component scene model and rejects invented scene types', () => {
    const scene = {
      schema: 'beegame-content.v1',
      id: 'scene.main',
      kind: 'scene-2d',
      assetRefs: [],
      data: {
        nodes: [{
          id: 'player',
          semantic: ['player'],
          data: { behaviors: [{ id: 'player-behavior', kind: 'player-controller', config: { speed: 260 } }] },
        }],
      },
    }
    expect(parseBeeGameContentDocument(scene).kind).toBe('scene-2d')
    expect(() => parseBeeGameContentDocument({
      ...scene,
      data: { nodes: [{ id: 'bad', kind: 'magic-tree-agent', components: [] }] },
    })).toThrow()
    expect(() => parseBeeGameContentDocument({
      ...scene,
      data: { nodes: [{ id: 'bad', components: [{ type: 'magic-renderer' }] }] },
    })).toThrow()
  })

  test('rejects legacy node kinds instead of migrating them', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-scene-v2-'))
    try {
      await mkdir(join(workspacePath, 'content/scenes'), { recursive: true })
      await writeFile(join(workspacePath, 'content/index.json'), JSON.stringify({
        schema: 'beegame-content-package.v2', id: 'scene-v2', dimension: '2d',
        documentRevision, assetManifestRevision, entryScene: 'scene.main',
        sceneModel: BEEGAME_SCENE_MODEL, files: ['scenes/main.json'],
      }))
      await writeFile(join(workspacePath, 'content/scenes/main.json'), JSON.stringify({
        schema: 'beegame-content.v1', id: 'scene.main', kind: 'scene-2d', assetRefs: [],
        data: { nodes: [
          { id: 'legacy', kind: 'tree', components: [] },
          { id: 'modern', components: [{ id: 'modern-sprite', type: 'sprite-renderer' }] },
        ] },
      }))
      const audit = auditBeeGameContentPackage(workspacePath, {
        documentRevision, assetManifestRevision,
        manifest: { resources: [] } as unknown as BeeGameAssetManifest,
      })
      expect(audit.valid).toBe(false)
      expect(audit.issues.length).toBeGreaterThan(0)
      await writeFile(join(workspacePath, 'content/index.json'), JSON.stringify({
        schema: 'beegame-content-package.v2', id: 'scene-v2', dimension: '2d',
        documentRevision, assetManifestRevision, entryScene: 'scene.main',
        files: ['scenes/main.json'],
      }))
      const missingModel = auditBeeGameContentPackage(workspacePath, {
        documentRevision, assetManifestRevision,
        manifest: { resources: [] } as unknown as BeeGameAssetManifest,
      })
      expect(missingModel.valid).toBe(false)
      expect(missingModel.issues.join('\n')).toContain('sceneModel')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('accepts strict VFX content and rejects invented top-level fields', () => {
    const vfx = {
      schema: 'beegame-content.v1',
      id: 'vfx.gameplay',
      kind: 'vfx',
      assetRefs: ['fx.atlas'],
      data: {
        nodes: [
          {
            id: 'pickup-burst',
            type: 'particle-burst',
            assetRef: 'fx.atlas',
            data: { count: 12, durationMs: 240 },
          },
        ],
      },
    }
    expect(parseBeeGameContentDocument(vfx).kind).toBe('vfx')
    expect(() =>
      parseBeeGameContentDocument({ ...vfx, title: 'invented field' }),
    ).toThrow()
  })

  test('preserves the active state of authored UI nodes', () => {
    const ui = parseBeeGameContentDocument({
      schema: 'beegame-content.v1',
      id: 'ui.pause',
      kind: 'ui-screen',
      assetRefs: [],
      data: {
        rootId: 'root',
        nodes: [
          { id: 'root', role: 'screen-root' },
          { id: 'resume', parentId: 'root', role: 'button', enabled: false },
        ],
      },
    })
    expect(ui.kind).toBe('ui-screen')
    if (ui.kind === 'ui-screen') expect(ui.data.nodes[1]?.enabled).toBe(false)
  })

  test('rejects invented UI roles before they reach an editor or runtime', () => {
    const document = {
      schema: 'beegame-content.v1',
      id: 'ui.title',
      kind: 'ui-screen',
      assetRefs: [],
      data: {
        rootId: 'root',
        nodes: [
          { id: 'root', role: 'screen-root' },
          { id: 'invented', parentId: 'root', role: 'glassMagicWidget' },
        ],
      },
    }
    expect(() => parseBeeGameContentDocument(document)).toThrow()
  })

  test('audits root, flow and asset ownership semantics for canonical UI roles', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-ui-vocabulary-'))
    try {
      await mkdir(join(workspacePath, 'content/ui'), { recursive: true })
      await writeFile(join(workspacePath, 'content/index.json'), JSON.stringify({
        schema: 'beegame-content-package.v2',
        id: 'ui-vocabulary',
        dimension: '2d',
        documentRevision,
        assetManifestRevision,
        entryScene: 'ui.bad',
        sceneModel: BEEGAME_SCENE_MODEL,
        files: ['ui/bad.json'],
      }))
      await writeFile(join(workspacePath, 'content/ui/bad.json'), JSON.stringify({
        schema: 'beegame-content.v1',
        id: 'ui.bad',
        kind: 'ui-screen',
        assetRefs: [],
        data: {
          rootId: 'root',
          nodes: [
            { id: 'root', role: 'hud-root' },
            { id: 'image', parentId: 'root', role: 'image' },
            { id: 'control', parentId: 'root', role: 'toggle', assetRef: 'invented-asset' },
            { id: 'volume', parentId: 'root', role: 'slider', data: { track: { assetRef: 'invented-track' } } },
          ],
        },
      }))
      const audit = auditBeeGameContentPackage(workspacePath, {
        documentRevision,
        assetManifestRevision,
        manifest: { resources: [] } as unknown as BeeGameAssetManifest,
      })
      expect(audit.valid).toBe(false)
      expect(audit.issues).toEqual(expect.arrayContaining([
        expect.stringContaining('ui-screen root must use role screen-root'),
        expect.stringContaining('asset-backed UI role image requires assetRef'),
        expect.stringContaining('UI role toggle is not an asset type'),
        expect.stringContaining('uses undeclared assetRef invented-track'),
      ]))
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('accepts VFX files in the canonical package without a separate IR', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-content-'))
    try {
      await mkdir(join(workspacePath, 'content/scenes'), { recursive: true })
      await mkdir(join(workspacePath, 'content/vfx'), { recursive: true })
      await writeFile(
        join(workspacePath, 'content/index.json'),
        JSON.stringify({
          schema: 'beegame-content-package.v2',
          id: 'game-content',
          dimension: '2d',
          documentRevision,
          assetManifestRevision,
          entryScene: 'scene.main',
          sceneModel: BEEGAME_SCENE_MODEL,
          files: ['scenes/main.json', 'vfx/gameplay.json'],
        }),
      )
      await writeFile(
        join(workspacePath, 'content/scenes/main.json'),
        JSON.stringify({
          schema: 'beegame-content.v1',
          id: 'scene.main',
          kind: 'scene-2d',
          assetRefs: [],
          data: { settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels', width: 1280, height: 720, pixelsPerUnit: 1 } }, nodes: [{ id: 'root', components: [] }] },
        }),
      )
      await writeFile(
        join(workspacePath, 'content/vfx/gameplay.json'),
        JSON.stringify({
          schema: 'beegame-content.v1',
          id: 'vfx.gameplay',
          kind: 'vfx',
          assetRefs: [],
          data: { nodes: [{ id: 'pickup', type: 'particle-burst' }] },
        }),
      )
      const audit = auditBeeGameContentPackage(workspacePath, {
        documentRevision,
        assetManifestRevision,
        manifest: { resources: [] } as unknown as BeeGameAssetManifest,
      })
      expect(audit.valid).toBe(true)
      expect(audit.package?.documents.map(document => document.kind)).toEqual([
        'scene-2d',
        'vfx',
      ])
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
