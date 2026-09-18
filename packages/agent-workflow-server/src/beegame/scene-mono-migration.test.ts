import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BeeGameAssetManifest } from './asset-contracts'
import { auditBeeGameContentPackage, BEEGAME_SCENE_MODEL, parseBeeGameContentDocument } from './game-content-package'
import {
  LEGACY_BEHAVIOR_MIGRATIONS,
  migrateLegacyScene,
  type LegacySceneDocument,
} from './scene-mono-migration'
import { readVerifiedAssetRefs } from './scene-mono-migration-cli'

const workspaces: string[] = []
afterEach(() => { for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true }) })

function scene(overrides: Partial<LegacySceneDocument> = {}): LegacySceneDocument {
  return {
    schema: 'beegame-content.v1',
    id: 'scene.test',
    kind: 'scene-2d',
    assetRefs: ['RES-SPRITE'],
    data: {
      cameraNodeId: 'camera',
      settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels', width: 1280, height: 720 } },
      nodes: [
        {
          id: 'camera',
          transform: { position: [0, 0, 0] },
          components: [{ type: 'camera', data: { orthographic: true, viewport: { width: 1280, height: 720 } } }],
        },
        {
          id: 'audio_rig',
          components: [
            { type: 'audio-source', assetRef: 'RES-SPRITE', data: { role: 'ambience' } },
            { type: 'audio-source', assetRef: 'RES-SPRITE', data: { role: 'music' } },
            { type: 'mono-behaviour', data: { scriptId: 'audio-director', cueBank: 'RES-SFX-BANK', cues: ['caught'] } },
          ],
        },
        {
          id: 'post_caught_collapse',
          components: [
            { type: 'canvas', data: { renderMode: 'screen-space-overlay' } },
            { type: 'canvas-renderer', data: {} },
          ],
        },
        {
          id: 'caught_fade',
          parentId: 'post_caught_collapse',
          transform: { position: [0, 0, 0], scale: [1280, 720, 1] },
          components: [{ type: 'image', data: { width: 1280, height: 720 } }],
        },
        {
          id: 'letter',
          components: [
            { type: 'sprite-renderer', assetRef: 'RES-SPRITE' },
            { type: 'mono-behaviour', data: { scriptId: 'letter-pickup', index: 1, pickupRadius: 40 } },
            { type: 'mono-behaviour', data: { scriptId: 'vertical-bob', amplitudePx: 3, periodSecs: 2.4 } },
          ],
        },
      ],
    },
    ...overrides,
  }
}

describe('strict legacy scene migration', () => {
  it('moves every known behaviour into node metadata without losing config', () => {
    const input = scene()
    const result = migrateLegacyScene(input)
    const letter = result.scene.data.nodes.find((node) => node.id === 'letter')!

    expect(result.report.migratedBehaviorCount).toBe(3)
    expect(letter.components?.some((component) => component.type === 'mono-behaviour')).toBe(false)
    expect(letter.data?.behaviors).toEqual([
      { id: 'behavior:letter:letter-pickup:1', kind: 'pickup.letter', config: { index: 1, pickupRadius: 40 } },
      { id: 'behavior:letter:vertical-bob:1', kind: 'motion.vertical-bob', config: { amplitudePx: 3, periodSecs: 2.4 } },
    ])
    expect(result.scene.assetRefs).toContain('RES-SFX-BANK')
  })

  it('generates stable per-instance component ids and Unity camera/UI metadata', () => {
    const result = migrateLegacyScene(scene(), { verifiedAssetRefs: new Set(['RES-SPRITE', 'RES-SFX-BANK']) })
    const audio = result.scene.data.nodes.find((node) => node.id === 'audio_rig')!
    const camera = result.scene.data.nodes.find((node) => node.id === 'camera')!
    const fade = result.scene.data.nodes.find((node) => node.id === 'caught_fade')!

    expect(audio.components?.map((component) => component.id)).toEqual([
      'component:audio_rig:audio-source:1',
      'component:audio_rig:audio-source:2',
    ])
    expect(camera.components?.[0].data).toMatchObject({
      orthographic: true,
      coordinateSpace: 'logical-pixels',
      viewport: { width: 1280, height: 720 },
      orthographicSize: 3.6,
    })
    expect(camera.components?.[0].data).not.toHaveProperty('projection')
    expect(camera.components?.[0].data).not.toHaveProperty('viewportRect')
    expect(camera.components?.[0].data).not.toHaveProperty('pixelWidth')
    expect(camera.components?.[0].data).not.toHaveProperty('pixelHeight')
    expect(fade.transform?.scale).toEqual([1, 1, 1])
    expect(fade.components?.find((component) => component.type === 'rect-transform')?.data).toEqual({
      anchorMin: [0, 0],
      anchorMax: [1, 1],
      pivot: [0.5, 0.5],
      anchoredPosition: [0, 0],
      sizeDelta: [0, 0],
    })
    expect(fade.components?.some((component) => component.type === 'canvas-renderer')).toBe(true)
    const canvas = result.scene.data.nodes.find((node) => node.id === 'post_caught_collapse')!
    expect(canvas.components?.some((component) => component.type === 'rect-transform')).toBe(true)
  })

  it('refuses unknown behaviours instead of silently dropping them', () => {
    const input = scene()
    input.data.nodes.push({ id: 'unknown', components: [{ type: 'mono-behaviour', data: { scriptId: 'invented-script', value: 1 } }] })
    expect(() => migrateLegacyScene(input)).toThrow('invented-script')
  })

  it('refuses a behaviour asset that is not present in the verified manifest', () => {
    expect(() => migrateLegacyScene(scene(), { verifiedAssetRefs: new Set(['RES-SPRITE']) })).toThrow('RES-SFX-BANK')
  })

  it('CLI manifest binding only admits resources whose module status is verified', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'beegame-manifest-status-'))
    workspaces.push(workspace)
    mkdirSync(join(workspace, 'assets/manifest/resources'), { recursive: true })
    const manifestPath = join(workspace, 'assets/asset-manifest.json')
    writeFileSync(manifestPath, JSON.stringify({
      version: 9,
      modules: { resources: ['assets/manifest/resources/available.json', 'assets/manifest/resources/verified.json'] },
    }))
    writeFileSync(join(workspace, 'assets/manifest/resources/available.json'), JSON.stringify({ id: 'RES-AVAILABLE', status: 'available' }))
    writeFileSync(join(workspace, 'assets/manifest/resources/verified.json'), JSON.stringify({ id: 'RES-VERIFIED', status: 'verified' }))
    const refs = readVerifiedAssetRefs(manifestPath)
    expect(refs.has('RES-VERIFIED')).toBe(true)
    expect(refs.has('RES-AVAILABLE')).toBe(false)
  })

  it('produces a document accepted by the current parser and package auditor', () => {
    const migrated = migrateLegacyScene(scene(), { verifiedAssetRefs: new Set(['RES-SPRITE', 'RES-SFX-BANK']) }).scene
    expect(() => parseBeeGameContentDocument(migrated)).not.toThrow()

    const workspace = mkdtempSync(join(tmpdir(), 'beegame-scene-migration-'))
    workspaces.push(workspace)
    mkdirSync(join(workspace, 'content/scenes'), { recursive: true })
    const hash = 'a'.repeat(64)
    writeFileSync(join(workspace, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2',
      id: 'package',
      dimension: '2d',
      documentRevision: hash,
      assetManifestRevision: hash,
      entryScene: 'scene.test',
      files: ['scenes/scene.json'],
      sceneModel: BEEGAME_SCENE_MODEL,
    }))
    writeFileSync(join(workspace, 'content/scenes/scene.json'), JSON.stringify(migrated))
    const resource = (id: string) => ({
      id,
      fulfills: [],
      source: { type: 'agent-authored' as const, created_at: '2026-09-18T00:00:00.000Z', reason: 'migration-test' },
      root_path: `assets/${id}.bin`,
      file_paths: [`assets/${id}.bin`],
      provisional: false,
      status: 'verified' as const,
      selected_at: '2026-09-18T00:00:00.000Z',
      selection_reason: ['migration-test'],
    })
    const manifest: BeeGameAssetManifest = { version: 9, requirements: [], resources: [resource('RES-SPRITE'), resource('RES-SFX-BANK')] }
    expect(auditBeeGameContentPackage(workspace, { documentRevision: hash, assetManifestRevision: hash, manifest }).valid).toBe(true)
  })

  it('keeps the mapping closed and documents all current legacy scripts', () => {
    expect(Object.keys(LEGACY_BEHAVIOR_MIGRATIONS).sort()).toEqual([
      'audio-director',
      'bush-hide-zone',
      'decorative-only',
      'guard-ai',
      'guard-vision',
      'horizontal-drift',
      'letter-pickup',
      'mailbox-delivery',
      'player-controller',
      'tree-canopy',
      'vertical-bob',
      'world-prompt-anchor',
    ])
  })
})
