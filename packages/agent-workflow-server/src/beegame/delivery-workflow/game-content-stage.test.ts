import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import type { DownstreamIr } from './downstream-ir'
import { completeGameContentStage, startGameContentStage } from './game-content-stage'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))

function writeJson(root: string, path: string, value: unknown): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`)
}

const ir = {
  resultId: 'c'.repeat(64),
  foundationRevision: 'a'.repeat(64),
  publicationId: 'publication',
  parameters: {}, assets: [],
  scenes: [{ id: 'world.main', name: 'Main', assetIds: [], config: {} }],
  ui: [{ id: 'presentation.hud', name: 'HUD', assetIds: [], config: {} }],
  vfx: [], logic: {},
} satisfies DownstreamIr

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'beegame-content-stage-'))
  roots.push(root)
  const resource = 'b'.repeat(64)
  await writeBeeGameAssetManifest(root, {
    version: 9,
    requirements: [],
    resources: [],
  })
  const run = {
    ...createTestDeliveryRun({
      runId: 'content-stage', projectId: 'project', ownerId: 'owner',
      documentRevision: 'a'.repeat(64), checklistApproved: true,
    }),
    phase: 'GAME_CONTENT' as const,
    revision: { document: 'a'.repeat(64), resource, workspace: 'workspace' },
    evidence: {
      resourcePreparation: {
        path: '.beegame/workflow/evidence/resources.json',
        kind: 'resource_preparation' as const,
        revision: resource,
        status: 'passed' as const,
        observedAt: new Date().toISOString(),
      },
    },
    resourceProductionState: {
      currentTask: 'RESOURCE_DELIVERED' as const,
      irResultId: ir.resultId,
      deliveryReceipt: {
        bindings: [], catalogObserved: false, resourceDigest: resource,
        acceptedAt: new Date().toISOString(),
      },
    },
  }
  return { root, resource, run }
}

test('Scene/UI stage dispatches one ordinary content-author turn', async () => {
  const { root, run } = await fixture()
  const requests: unknown[] = []
  await startGameContentStage({
    run,
    workspacePath: root,
    gameIr: ir,
    dispatcher: { async dispatch(request) { requests.push(request); return request } },
  })
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({
    workerType: 'content-author', phase: 'GAME_CONTENT', allowedPaths: ['content/'],
  })
})

test('valid Scene2D and UI package is accepted before implementation', async () => {
  const { root, resource, run } = await fixture()
  writeJson(root, 'content/index.json', {
    schema: 'beegame-content-package.v1', id: 'content', dimension: '2d',
    irRevision: ir.resultId, assetManifestRevision: resource,
    entryScene: 'scene.main', files: ['scenes/main.scene.json', 'ui/hud.ui.json'],
  })
  writeJson(root, 'content/scenes/main.scene.json', {
    schema: 'beegame-content.v1', id: 'scene.main', kind: 'scene-2d',
    irRefs: ['world.main'], assetRefs: [], data: { nodes: [{ id: 'world', kind: 'group' }] },
  })
  writeJson(root, 'content/ui/hud.ui.json', {
    schema: 'beegame-content.v1', id: 'ui.hud', kind: 'ui-hud',
    irRefs: ['presentation.hud'], assetRefs: [],
    data: { rootId: 'hud', nodes: [{ id: 'hud', role: 'hud' }] },
  })
  const next = completeGameContentStage({
    run,
    workspacePath: root,
    gameIr: ir,
    terminal: {
      workerType: 'content-author', revision: resource, status: 'completed',
      writtenPaths: ['content/index.json', 'content/scenes/main.scene.json', 'content/ui/hud.ui.json'],
    },
  })
  expect(next.phase).toBe('IMPLEMENTATION')
  expect(next.gameContentReceipt?.contentIds).toEqual(['scene.main', 'ui.hud'])
  expect(next.evidence.gameContent?.status).toBe('passed')
})
