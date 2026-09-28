import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeeGameAssetManifest } from './asset-contracts'
import { auditBeeGameContentPackage, BEEGAME_SCENE_MODEL, loadBeeGameContentFileListForEditing } from './game-content-package'

const HASH = 'a'.repeat(64)
const workspaces: string[] = []
const manifest: BeeGameAssetManifest = {
  version: 9,
  requirements: [],
  resources: ['RES-SPRITE', 'RES-PARTICLE', 'RES-AUDIO'].map((id, index) => ({
    id,
    fulfills: [],
    source: { type: 'agent-authored', created_at: '2026-09-18T00:00:00.000Z', reason: 'test' },
    root_path: `assets/runtime/${index}.bin`,
    file_paths: [`assets/runtime/${index}.bin`],
    provisional: false,
    status: 'verified',
    selected_at: '2026-09-18T00:00:00.000Z',
    selection_reason: ['test'],
  })),
}

afterEach(() => { for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true }) })

function audit(document: Record<string, unknown>, dimension: '2d' | '3d' = '2d', activeManifest: BeeGameAssetManifest = manifest, indexFields: Record<string, unknown> = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'beegame-content-v2-')); workspaces.push(workspace)
  mkdirSync(join(workspace, 'content/scenes'), { recursive: true })
  writeFileSync(join(workspace, 'content/index.json'), `${JSON.stringify({ schema: 'beegame-content-package.v2', id: 'test', dimension, documentRevision: HASH, assetManifestRevision: HASH, entryScene: 'scene', files: ['scenes/scene.json'], sceneModel: BEEGAME_SCENE_MODEL, ...indexFields })}\n`)
  const data = (document.data && typeof document.data === 'object' ? document.data : {}) as Record<string, unknown>
  if (dimension === '2d' && !data.settings)
    data.settings = { coordinateSystem: { origin: 'top-left', units: 'logical-pixels', width: 1280, height: 720, pixelsPerUnit: 1 } }
  writeFileSync(join(workspace, 'content/scenes/scene.json'), `${JSON.stringify({ ...document, data })}\n`)
  return auditBeeGameContentPackage(workspace, { documentRevision: HASH, assetManifestRevision: HASH, manifest: activeManifest })
}

function component(id: string, type: string, extra: Record<string, unknown> = {}) {
  return { id, type, ...extra }
}

const logicalCameraData = {
  orthographic: true,
  orthographicSize: 360,
  coordinateSpace: 'logical-pixels',
  viewport: { width: 1280, height: 720 },
}

describe('Unity-style Game Content scene contract', () => {
  it('rejects offscreen interactive UI before implementation while accepting corrected authored layout', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'beegame-ui-bounds-')); workspaces.push(workspace)
    mkdirSync(join(workspace, 'content/scenes'), { recursive: true })
    mkdirSync(join(workspace, 'content/ui'), { recursive: true })
    writeFileSync(join(workspace, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2', id: 'test', dimension: '2d',
      documentRevision: HASH, assetManifestRevision: HASH, entryScene: 'scene',
      files: ['scenes/scene.json', 'ui/menu.json'], sceneModel: BEEGAME_SCENE_MODEL,
    }))
    writeFileSync(join(workspace, 'content/scenes/scene.json'), JSON.stringify({
      schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: [],
      data: { settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels', width: 960, height: 540, pixelsPerUnit: 1 } }, nodes: [{ id: 'root' }] },
    }))
    const menu = (position: number) => ({
      schema: 'beegame-content.v1', id: 'menu', kind: 'ui-screen', assetRefs: [],
      data: { rootId: 'root', nodes: [
        { id: 'root', role: 'screen-root', layout: { size: [960, 540] }, data: { referenceResolution: [960, 540] } },
        { id: 'play', parentId: 'root', role: 'button', layout: { anchor: 'top-center', position: [position, 278], size: [240, 52] } },
      ] },
    })
    const menuPath = join(workspace, 'content/ui/menu.json')
    writeFileSync(menuPath, JSON.stringify(menu(-120)))
    const authority = { documentRevision: HASH, assetManifestRevision: HASH, manifest }
    const broken = auditBeeGameContentPackage(workspace, authority)
    expect(broken.valid).toBe(false)
    expect(broken.issues.join('\n')).toContain('content/ui/menu.json: play: enabled control or its containing panel is outside the viewport')
    writeFileSync(menuPath, JSON.stringify(menu(0)))
    expect(auditBeeGameContentPackage(workspace, authority).valid).toBe(true)
  })

  it('validates an optional per-document load registry against the canonical files and kinds', () => {
    const document = { schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: [], data: { nodes: [{ id: 'root' }] } }
    const valid = audit(document, '2d', manifest, { documents: [
      { id: 'scene', path: 'scenes/scene.json', kind: 'scene-2d', loadPhase: 'startup' },
    ] })
    expect(valid.valid).toBe(true)

    const wrongPath = audit(document, '2d', manifest, { documents: [
      { id: 'scene', path: 'scenes/other.json', kind: 'scene-2d', loadPhase: 'startup' },
    ] })
    expect(wrongPath.valid).toBe(false)
    expect(wrongPath.issues.join(' ')).toContain('document registry path mismatch for scene')

    const deferredEntry = audit(document, '2d', manifest, { documents: [
      { id: 'scene', path: 'scenes/scene.json', kind: 'scene-2d', loadPhase: 'on-demand' },
    ] })
    expect(deferredEntry.valid).toBe(false)
    expect(deferredEntry.issues.join(' ')).toContain('entryScene must use startup loadPhase')
  })

  it('loads file metadata without returning document bodies', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'beegame-content-file-list-')); workspaces.push(workspace)
    mkdirSync(join(workspace, 'content/scenes'), { recursive: true })
    writeFileSync(join(workspace, 'content/index.json'), JSON.stringify({
      schema: 'beegame-content-package.v2', id: 'test', dimension: '2d', documentRevision: HASH,
      assetManifestRevision: HASH, entryScene: 'scene', files: ['scenes/scene.json'], sceneModel: BEEGAME_SCENE_MODEL,
    }))
    writeFileSync(join(workspace, 'content/scenes/scene.json'), JSON.stringify({
      schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: [],
      data: { nodes: [{ id: 'root', data: { large: 'document body' } }] },
    }))

    const result = loadBeeGameContentFileListForEditing(workspace, {
      documentRevision: HASH, assetManifestRevision: HASH, manifest,
    })

    expect(result.documents).toEqual([
      { path: 'scenes/scene.json', revision: expect.any(String), id: 'scene', kind: 'scene-2d' },
    ])
    expect(result.documents[0]).not.toHaveProperty('document')
  })

  it('accepts real 2D components and asset metadata for non-preview audio', () => {
    const result = audit({ schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: ['RES-SPRITE', 'RES-PARTICLE', 'RES-AUDIO'], data: { cameraNodeId: 'camera', nodes: [
      { id: 'camera', transform: { position: [0, 0, 10] }, components: [component('camera-transform', 'camera', { data: logicalCameraData }), component('camera-listener', 'audio-listener', { data: {} })] },
      { id: 'actor', components: [component('actor-sprite', 'sprite-renderer', { assetRef: 'RES-SPRITE', data: {} }), component('actor-collider', 'box-collider-2d', { data: { size: [1, 1], offset: [0, 0], isTrigger: false } }), component('actor-body', 'rigidbody-2d', { data: { bodyType: 'dynamic' } })] },
      { id: 'fireflies', components: [component('fireflies-system', 'particle-system', { data: { maxParticles: 30 } }), component('fireflies-renderer', 'particle-system-renderer', { assetRef: 'RES-PARTICLE', data: {} })] },
      { id: 'awareness', components: [component('awareness-rect', 'rect-transform', { data: { anchorMin: [0, 0], anchorMax: [1, 1], anchoredPosition: [0, 0], sizeDelta: [0, 0], pivot: [.5, .5] } }), component('awareness-canvas', 'canvas', { data: { renderMode: 'world-space' } }), component('awareness-canvas-renderer', 'canvas-renderer', { data: {} })] },
      { id: 'awareness-image', parentId: 'awareness', components: [component('awareness-image-rect', 'rect-transform', { data: { anchorMin: [0, 0], anchorMax: [1, 1], anchoredPosition: [0, 0], sizeDelta: [0, 0], pivot: [.5, .5] } }), component('awareness-image-canvas-renderer', 'canvas-renderer', { data: {} }), component('awareness-image-graphic', 'image', { data: { color: '#f2d04a', opacity: 1 } })] },
      { id: 'ambience', components: [component('ambience-source', 'audio-source', { assetRef: 'RES-AUDIO', data: { loop: true } })] },
    ] } })
    expect(result.valid).toBe(true)
  })

  it('accepts the same GameObject model with concrete 3D components', () => {
    const result = audit({ schema: 'beegame-content.v1', id: 'scene', kind: 'scene-3d', assetRefs: ['RES-SPRITE'], data: { cameraNodeId: 'camera', nodes: [
      { id: 'camera', transform: { position: [0, 2, -8], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [component('camera-main', 'camera', { data: { orthographic: false, fieldOfView: 60, coordinateSpace: 'world-units' } }), component('camera-listener', 'audio-listener', { data: {} })] },
      { id: 'sun', transform: { position: [0, 5, 0], rotation: [45, 0, 0], scale: [1, 1, 1] }, components: [component('sun-light', 'light', { data: { kind: 'directional', color: '#ffffff', intensity: 1 } })] },
      { id: 'actor', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
        component('actor-mesh', 'mesh-filter', { assetRef: 'RES-SPRITE', data: {} }),
        component('actor-renderer', 'mesh-renderer', { data: { material: { mode: 'standard' } } }),
        component('actor-collider', 'capsule-collider', { data: { radius: .5, height: 2, center: [0, 1, 0], direction: 'y', isTrigger: false } }),
        component('actor-body', 'rigidbody', { data: { isKinematic: false, useGravity: true, mass: 1 } }),
      ] },
    ] } }, '3d')
    expect(result.valid).toBe(true)
  })

  it('rejects undeclared component inventions instead of degrading them to Empty', () => {
    const result = audit({ schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: [], data: { nodes: [{ id: 'bad', components: [component('bad-component', 'invented-renderer', { data: {} })] }] } })
    expect(result.valid).toBe(false)
    expect(result.issues.join(' ')).toContain('Invalid option')
  })

  it('rejects cross-dimension physics components', () => {
    const result = audit({ schema: 'beegame-content.v1', id: 'scene', kind: 'scene-3d', assetRefs: [], data: { nodes: [{ id: 'bad', components: [component('bad-collider', 'box-collider-2d', { data: { size: [1, 1], offset: [0, 0], isTrigger: false } })] }] } }, '3d')
    expect(result.valid).toBe(false)
    expect(result.issues.join(' ')).toContain('cannot use 2D physics components')
  })

  it('rejects script components outside the closed scene vocabulary', () => {
    const result = audit({ schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: [], data: { nodes: [{ id: 'logic', components: [component('logic-component', 'script-component', { data: { scriptId: 'guard-controller' } })] }] } } as never)
    expect(result.valid).toBe(false)
    expect(result.issues.join(' ')).toContain('Invalid option: expected one of')
  })

  it('rejects legacy nested scene asset references', () => {
    const result = audit({ schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: ['RES-PARTICLE'], data: { nodes: [{ id: 'particles', components: [component('particles-system', 'particle-system', { data: { texture: { assetRef: 'RES-PARTICLE' } } }), component('particles-renderer', 'particle-system-renderer', { assetRef: 'RES-PARTICLE', data: {} })] }] } })
    expect(result.valid).toBe(false)
    expect(result.issues.join(' ')).toContain('stores legacy texture.assetRef in data')
  })

  it('resolves asset members only from the owning resource profile or file stem', () => {
    const activeManifest: BeeGameAssetManifest = {
      ...manifest,
      resources: manifest.resources.map(resource => resource.id === 'RES-SPRITE'
        ? {
          ...resource,
          file_paths: ['assets/runtime/img/forest_sprite.webp'],
          content_profile: { components: [{ id: 'explicit-frame', kind: 'sprite-frame', specs: { x: 0, y: 0, width: 1, height: 1 } }] },
        }
        : resource),
    }
    const accepted = audit({ schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: ['RES-SPRITE'], data: { nodes: [{ id: 'tree', components: [component('tree-sprite', 'sprite-renderer', { assetRef: 'RES-SPRITE', data: { member: 'forest_sprite' } })] }] } }, '2d', activeManifest)
    expect(accepted.valid).toBe(true)
    const explicit = audit({ schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: ['RES-SPRITE'], data: { nodes: [{ id: 'tree', components: [component('tree-sprite', 'sprite-renderer', { assetRef: 'RES-SPRITE', data: { member: 'explicit-frame' } })] }] } }, '2d', activeManifest)
    expect(explicit.valid).toBe(true)
    const rejected = audit({ schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: ['RES-SPRITE'], data: { nodes: [{ id: 'tree', components: [component('tree-sprite', 'sprite-renderer', { assetRef: 'RES-SPRITE', data: { member: 'other-resource-member' } })] }] } }, '2d', activeManifest)
    expect(rejected.valid).toBe(false)
    expect(rejected.issues.join(' ')).toContain('does not resolve member other-resource-member in asset RES-SPRITE')
  })
})
