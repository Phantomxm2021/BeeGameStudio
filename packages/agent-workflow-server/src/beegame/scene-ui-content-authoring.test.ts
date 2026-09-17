import { describe, expect, test } from 'bun:test'
import type { BeeGameAssetManifest } from './asset-contracts'
import { buildSceneUiContentAuthoringAuthority } from './scene-ui-content-authoring'

const revision = (value: string) => value.repeat(64)

const manifest: BeeGameAssetManifest = {
  version: 9,
  requirements: [],
  resources: [],
}

describe('Scene and UI direct CLI authority', () => {
  test('contains one bounded content task without prescribing agent mechanics', () => {
    const authority = buildSceneUiContentAuthoringAuthority({
      gameIr: {
        resultId: revision('a'),
        foundationRevision: revision('b'),
        publicationId: 'publication-1',
        parameters: {}, assets: [],
        scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }],
        ui: [], vfx: [], logic: {},
      },
      assetManifestRevision: revision('c'),
      manifest,
    })

    expect(authority.task).toBe('SCENE_UI_CONTENT')
    expect(authority.allowedPaths).toEqual(['content/'])
    expect(authority.contract.output.kinds).toEqual([
      'scene-2d',
      'ui-screen',
      'ui-hud',
      'ui-flow',
    ])
    expect(authority.prompt).toContain('Keep world-space Scene content and screen-space UI content separate')
    expect(authority.prompt).toContain('canonical editable source')
    expect(authority.prompt).toContain('do not create another derived Scene or UI config')
    expect(authority.prompt).toContain('frameRef')
    expect(authority.prompt).not.toMatch(/subagent|skill|retry|tool call|step-by-step/i)
  })

  test('rejects an unversioned authority', () => {
    expect(() =>
      buildSceneUiContentAuthoringAuthority({
        gameIr: {
          resultId: 'unversioned',
          foundationRevision: revision('b'),
          publicationId: 'publication-1',
          parameters: {}, assets: [],
          scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }],
          ui: [], vfx: [], logic: {},
        },
        assetManifestRevision: revision('c'),
        manifest,
      }),
    ).toThrow()
  })
})
