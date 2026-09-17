import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeeGameAssetManifest } from '../beegame/asset-contracts'
import {
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
    expect(task.contract.validationCommand.args[0]).toEndWith(
      'game-content-validation-cli.ts',
    )
    expect(task.contract.previewCommand.args[0]).toEndWith(
      'scene-content-preview-cli.ts',
    )
    expect(task.contract.previewCommand.outputRoot).toBe('content/previews/')

    const index = (format.index ?? {}) as Record<string, unknown>
    expect(() => parseBeeGameContentIndex(index)).not.toThrow()

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
          data: { nodes: [{ id: 'root', kind: 'group' }] },
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
