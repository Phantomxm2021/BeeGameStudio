import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BeeGameAssetManifest } from './asset-contracts'
import {
  acceptBeeGameContentPackage,
  auditBeeGameContentPackage,
  loadBeeGameContentDocument,
  loadBeeGameContentPackageForEditing,
  parseBeeGameContentDocument,
  recoverBeeGameContentRevision,
  saveBeeGameContentDocument,
} from './game-content-package'

const IR_REVISION = 'a'.repeat(64)
const ASSET_REVISION = 'b'.repeat(64)
const workspaces: string[] = []

afterEach(() => {
  for (const workspace of workspaces.splice(0))
    rmSync(workspace, { recursive: true, force: true })
})

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), 'beegame-content-package-'))
  workspaces.push(path)
  return path
}

function manifest(): BeeGameAssetManifest {
  return {
    version: 9,
    requirements: [],
    resources: [
      {
        id: 'asset.background',
        fulfills: [],
        source: {
          type: 'agent-authored',
          created_at: '2026-09-15T00:00:00.000Z',
          reason: 'test fixture',
        },
        root_path: 'assets/runtime/background.png',
        file_paths: ['assets/runtime/background.png'],
        provisional: false,
        status: 'verified',
        selected_at: '2026-09-15T00:00:00.000Z',
        selection_reason: ['matches art direction'],
      },
      {
        id: 'asset.unverified',
        fulfills: [],
        source: {
          type: 'agent-authored',
          created_at: '2026-09-15T00:00:00.000Z',
          reason: 'test fixture',
        },
        root_path: 'assets/runtime/unverified.png',
        file_paths: ['assets/runtime/unverified.png'],
        provisional: true,
        status: 'available',
        selected_at: '2026-09-15T00:00:00.000Z',
        selection_reason: ['not ready'],
      },
      {
        id: 'asset.replacement',
        fulfills: [],
        source: {
          type: 'agent-authored',
          created_at: '2026-09-15T00:00:00.000Z',
          reason: 'replacement fixture',
        },
        root_path: 'assets/runtime/replacement.png',
        file_paths: ['assets/runtime/replacement.png'],
        provisional: false,
        status: 'verified',
        selected_at: '2026-09-15T00:00:00.000Z',
        selection_reason: ['user selected replacement'],
      },
      {
        id: 'asset.atlas',
        fulfills: [],
        source: {
          type: 'agent-authored',
          created_at: '2026-09-15T00:00:00.000Z',
          reason: 'atlas fixture',
        },
        root_path: 'assets/runtime/characters.png',
        file_paths: ['assets/runtime/characters.png'],
        provisional: false,
        status: 'verified',
        selected_at: '2026-09-15T00:00:00.000Z',
        selection_reason: ['contains the required character frame'],
        asset_kind: 'sprite-atlas',
        content_profile: {
          packaging: 'self-contained',
          inspection: { status: 'complete', source: 'server' },
          components: [{
            id: 'player.idle.0',
            kind: 'atlas-region',
            specs: { x: 32, y: 16, width: 24, height: 28 },
          }],
        },
      },
    ],
  }
}

function writeJson(workspacePath: string, path: string, value: unknown): void {
  const absolute = join(workspacePath, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function validFiles(workspacePath: string): void {
  writeJson(workspacePath, 'content/index.json', {
    schema: 'beegame-content-package.v1',
    id: 'game-content',
    dimension: '2d',
    irRevision: IR_REVISION,
    assetManifestRevision: ASSET_REVISION,
    entryScene: 'scene.main',
    files: ['scenes/main.scene.json', 'ui/hud.ui.json'],
  })
  writeJson(workspacePath, 'content/scenes/main.scene.json', {
    schema: 'beegame-content.v1',
    id: 'scene.main',
    kind: 'scene-2d',
    irRefs: ['world.main'],
    assetRefs: ['asset.background'],
    data: {
      cameraNodeId: 'camera.main',
      nodes: [
        { id: 'world', kind: 'group' },
        {
          id: 'background',
          parentId: 'world',
          kind: 'sprite',
          layer: 'background',
          assetRef: 'asset.background',
          transform: { position: [0, 0] },
          components: [
            {
              type: 'sprite-renderer',
              assetRef: 'asset.background',
              data: { blend: 'normal' },
            },
          ],
        },
        {
          id: 'camera.main',
          parentId: 'world',
          kind: 'camera',
          transform: { position: [0, 0] },
        },
      ],
    },
  })
  writeJson(workspacePath, 'content/ui/hud.ui.json', {
    schema: 'beegame-content.v1',
    id: 'ui.hud',
    kind: 'ui-hud',
    irRefs: ['presentation.hud'],
    assetRefs: [],
    data: {
      rootId: 'hud.root',
      nodes: [
        { id: 'hud.root', role: 'hud' },
        {
          id: 'score',
          parentId: 'hud.root',
          role: 'status-text',
          text: '0',
          layout: {
            anchor: 'top-left',
            position: [24, 24],
            size: [160, 40],
          },
          bindings: { text: 'game.score' },
          actions: { click: 'score.inspect' },
          style: { color: 'text.primary' },
          data: { binding: 'game.score' },
        },
      ],
    },
  })
}

const authority = () => ({
  irRevision: IR_REVISION,
  assetManifestRevision: ASSET_REVISION,
  irEntryIds: ['world.main', 'presentation.hud'],
  manifest: manifest(),
})

describe('Game Content Package scene and UI contract', () => {
  test('accepts a version-bound Scene2D plus separate UI package', () => {
    const root = workspace()
    validFiles(root)

    const audit = auditBeeGameContentPackage(root, authority())

    expect(audit.issues).toEqual([])
    expect(audit.package?.documents.map(document => document.kind)).toEqual([
      'scene-2d',
      'ui-hud',
    ])
    expect(audit.package?.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(recoverBeeGameContentRevision(root, manifest())).toBe(audit.package!.digest)
    const contentRevision = audit.package?.digest
    if (!contentRevision) throw new Error('expected accepted content package')

    expect(acceptBeeGameContentPackage(root, authority())).toEqual({
      schemaVersion: 'game-content-ready.v1',
      contentRevision,
      irRevision: IR_REVISION,
      assetManifestRevision: ASSET_REVISION,
      indexPath: 'content/index.json',
      contentIds: ['scene.main', 'ui.hud'],
    })
  })

  test('rejects unknown IR, unavailable assets and asset path bypasses', () => {
    const root = workspace()
    validFiles(root)
    writeJson(root, 'content/scenes/main.scene.json', {
      schema: 'beegame-content.v1',
      id: 'scene.main',
      kind: 'scene-2d',
      irRefs: ['world.unknown'],
      assetRefs: ['asset.unverified'],
      data: {
        nodes: [
          {
            id: 'background',
            kind: 'sprite',
            assetRef: 'asset.unverified',
            data: { sourcePath: 'assets/runtime/unverified.png' },
          },
        ],
      },
    })

    const audit = auditBeeGameContentPackage(root, authority())

    expect(audit.valid).toBe(false)
    expect(audit.issues.join('\n')).toContain('unknown IR entry world.unknown')
    expect(audit.issues.join('\n')).toContain(
      'asset is not verified: asset.unverified',
    )
    expect(audit.issues.join('\n')).toContain('bypasses assetRefs')
  })

  test('resolves Scene sprite frames through Manifest atlas components', () => {
    const root = workspace()
    validFiles(root)
    const snapshot = loadBeeGameContentDocument(root, 'scenes/main.scene.json')
    const document = structuredClone(snapshot.document)
    if (document.kind !== 'scene-2d') throw new Error('expected scene fixture')
    const background = document.data.nodes.find(node => node.id === 'background')
    if (!background) throw new Error('expected background fixture')
    document.assetRefs = ['asset.atlas']
    background.assetRef = 'asset.atlas'
    background.frameRef = 'player.idle.0'
    if (background.components?.[0])
      background.components[0].assetRef = 'asset.atlas'
    writeJson(root, 'content/scenes/main.scene.json', document)

    expect(auditBeeGameContentPackage(root, authority()).issues).toEqual([])

    background.frameRef = 'player.missing'
    writeJson(root, 'content/scenes/main.scene.json', document)
    expect(auditBeeGameContentPackage(root, authority()).issues.join('\n')).toContain(
      'frameRef does not resolve to a usable sprite frame: player.missing',
    )

    background.frameRef = 'player.idle.0'
    background.kind = 'group'
    writeJson(root, 'content/scenes/main.scene.json', document)
    expect(auditBeeGameContentPackage(root, authority()).issues.join('\n')).toContain(
      'frameRef is only valid for a sprite',
    )
  })

  test('round-trips direct Scene and UI edits with stable identity', () => {
    const root = workspace()
    validFiles(root)
    const packageBefore = loadBeeGameContentPackageForEditing(root, authority())
    expect(packageBefore.documents.map(document => document.path)).toEqual([
      'scenes/main.scene.json',
      'ui/hud.ui.json',
    ])

    const sceneBefore = loadBeeGameContentDocument(root, 'scenes/main.scene.json')
    const sceneEdit = structuredClone(sceneBefore.document)
    if (sceneEdit.kind !== 'scene-2d') throw new Error('expected scene fixture')
    const background = sceneEdit.data.nodes.find(node => node.id === 'background')
    if (!background) throw new Error('expected background fixture')
    background.transform = { position: [120, 80], scale: [1.25, 0.75] }
    background.assetRef = 'asset.replacement'
    background.components = [
      {
        type: 'sprite-renderer',
        assetRef: 'asset.replacement',
        data: { blend: 'normal' },
      },
    ]
    sceneEdit.assetRefs = ['asset.replacement']

    const sceneAfter = saveBeeGameContentDocument({
      workspacePath: root,
      path: sceneBefore.path,
      expectedRevision: sceneBefore.revision,
      document: sceneEdit,
      authority: authority(),
    })
    expect(sceneAfter.revision).not.toBe(sceneBefore.revision)
    expect(sceneAfter.contentRevision).not.toBe(packageBefore.contentRevision)
    expect(sceneAfter.document.kind).toBe('scene-2d')
    if (sceneAfter.document.kind !== 'scene-2d') throw new Error('expected scene')
    expect(sceneAfter.document.data.nodes.find(node => node.id === 'background')).toMatchObject({
      assetRef: 'asset.replacement',
      transform: { position: [120, 80], scale: [1.25, 0.75] },
    })

    const uiBefore = loadBeeGameContentDocument(root, 'ui/hud.ui.json')
    const uiEdit = structuredClone(uiBefore.document)
    if (uiEdit.kind === 'scene-2d') throw new Error('expected UI fixture')
    const score = uiEdit.data.nodes.find(node => node.id === 'score')
    if (!score) throw new Error('expected score fixture')
    score.layout = {
      anchor: 'bottom-right',
      position: [-32, -24],
      size: [220, 48],
      scale: [1.1, 1.1],
    }
    score.bindings = { text: 'game.score.formatted' }
    score.actions = { click: 'score.details.open' }

    const uiAfter = saveBeeGameContentDocument({
      workspacePath: root,
      path: uiBefore.path,
      expectedRevision: uiBefore.revision,
      document: uiEdit,
      authority: authority(),
    })
    expect(uiAfter.contentRevision).not.toBe(sceneAfter.contentRevision)
    expect(uiAfter.document.kind).toBe('ui-hud')
    if (uiAfter.document.kind === 'scene-2d') throw new Error('expected UI')
    expect(uiAfter.document.data.nodes.find(node => node.id === 'score')).toMatchObject({
      layout: {
        anchor: 'bottom-right',
        position: [-32, -24],
        size: [220, 48],
        scale: [1.1, 1.1],
      },
      bindings: { text: 'game.score.formatted' },
      actions: { click: 'score.details.open' },
    })
    expect(
      loadBeeGameContentPackageForEditing(root, authority()).contentRevision,
    ).toBe(uiAfter.contentRevision)

    const undone = saveBeeGameContentDocument({
      workspacePath: root,
      path: sceneBefore.path,
      expectedRevision: sceneAfter.revision,
      document: sceneBefore.document,
      authority: authority(),
    })
    expect(undone.revision).toBe(sceneBefore.revision)
    expect(undone.contentRevision).not.toBe(uiAfter.contentRevision)
  })

  test('rejects stale and invalid editor saves without changing the file', () => {
    const root = workspace()
    validFiles(root)
    const before = loadBeeGameContentDocument(root, 'scenes/main.scene.json')
    const invalid = structuredClone(before.document)
    if (invalid.kind !== 'scene-2d') throw new Error('expected scene fixture')
    const background = invalid.data.nodes.find(node => node.id === 'background')
    if (!background) throw new Error('expected background fixture')
    background.assetRef = 'asset.unknown'

    expect(() =>
      saveBeeGameContentDocument({
        workspacePath: root,
        path: before.path,
        expectedRevision: before.revision,
        document: invalid,
        authority: authority(),
      }),
    ).toThrow('undeclared assetRef asset.unknown')
    expect(loadBeeGameContentDocument(root, before.path)).toEqual(before)

    expect(() =>
      saveBeeGameContentDocument({
        workspacePath: root,
        path: before.path,
        expectedRevision: '0'.repeat(64),
        document: before.document,
        authority: authority(),
      }),
    ).toThrow('revision changed')
    expect(loadBeeGameContentDocument(root, before.path)).toEqual(before)

    expect(() =>
      saveBeeGameContentDocument({
        workspacePath: root,
        path: before.path,
        expectedRevision: before.revision,
        document: before.document,
        authority: { ...authority(), irRevision: 'f'.repeat(64) },
      }),
    ).toThrow('IR revision does not match')
    expect(loadBeeGameContentDocument(root, before.path)).toEqual(before)
  })

  test('rejects broken UI hierarchy and unregistered content files', () => {
    const root = workspace()
    validFiles(root)
    writeJson(root, 'content/ui/hud.ui.json', {
      schema: 'beegame-content.v1',
      id: 'ui.hud',
      kind: 'ui-hud',
      irRefs: ['presentation.hud'],
      assetRefs: [],
      data: {
        rootId: 'hud.root',
        nodes: [
          { id: 'hud.root', parentId: 'child', role: 'hud' },
          { id: 'child', parentId: 'hud.root', role: 'status-text' },
        ],
      },
    })
    writeJson(root, 'content/ui/unregistered.ui.json', {
      schema: 'beegame-content.v1',
      id: 'ui.unregistered',
      kind: 'ui-screen',
      irRefs: ['presentation.hud'],
      assetRefs: [],
      data: {
        rootId: 'root',
        nodes: [{ id: 'root', role: 'screen' }],
      },
    })

    const audit = auditBeeGameContentPackage(root, authority())

    expect(audit.valid).toBe(false)
    expect(audit.issues.join('\n')).toContain('unregistered content file')
    expect(audit.issues.join('\n')).toContain('contains a cycle')
    expect(audit.issues.join('\n')).toContain('UI root cannot have a parent')
  })

  test('does not silently accept not-yet-implemented content kinds', () => {
    expect(() =>
      parseBeeGameContentDocument({
        schema: 'beegame-content.v1',
        id: 'vfx.hit',
        kind: 'vfx-2d',
        irRefs: ['presentation.vfx'],
        assetRefs: [],
        data: {},
      }),
    ).toThrow()
  })
})
