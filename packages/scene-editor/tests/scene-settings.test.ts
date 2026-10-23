import { describe, expect, it } from 'vitest'
import { DEFAULT_SCENE_SETTINGS, makeFixture, type SceneOperation } from '../src/model'
import { SceneHistory } from '../src/history'
import { applyPatch, patchFor } from '../src/commands'
import { exportPackage, importPackage, sceneContentKey } from '../src/persistence'

const settings = { ...DEFAULT_SCENE_SETTINGS, background: '#283442', showGrid: false, ambientIntensity: 2, exposure: 1.4, fogEnabled: true, fogNear: 5, fogFar: 40, selectionColor: '#33bbff', selectionWidth: 6 }

describe('scene configuration and save state', () => {
  it('undo restores an absent configuration and saved content despite newer revisions', () => {
    const document = makeFixture()
    const saved = sceneContentKey(document)
    const history = new SceneHistory(document)
    const operation: SceneOperation = { type: 'scene.configure', name: 'Night scene', settings, expectedName: document.name, expectedSettings: null }
    history.commit([operation], 'Configure scene')
    expect(sceneContentKey(history.document)).not.toBe(saved)
    expect(importPackage(exportPackage(history.document)).settings).toEqual(settings)
    history.undo()
    expect(history.document.settings).toBeUndefined()
    expect(history.document.name).toBe(document.name)
    expect(history.document.revision).toBeGreaterThan(document.revision)
    expect(sceneContentKey(history.document)).toBe(saved)
    history.redo()
    const reopened = importPackage(exportPackage(history.document))
    expect(reopened.settings).toEqual(settings)
    expect(sceneContentKey(reopened)).toBe(sceneContentKey(history.document))
  })

  it('rejects stale configuration and invalid environment parameters without mutations', () => {
    const document = makeFixture()
    for (const operation of [
      { type: 'scene.configure', name: 'New', settings, expectedName: 'Other scene' },
      { type: 'scene.configure', name: 'New', settings, expectedSettings: DEFAULT_SCENE_SETTINGS },
      { type: 'scene.configure', name: 'New', settings: { ...settings, fogFar: settings.fogNear } },
      { type: 'scene.configure', name: 'New', settings: { ...settings, exposure: -1 } },
      { type: 'scene.configure', name: 'New', settings: { ...settings, ambientIntensity: -1 } },
      { type: 'scene.configure', name: 'New', settings: { ...settings, background: 'invalid' } },
      { type: 'scene.configure', name: 'New', settings: { ...settings, selectionColor: 'invalid' } },
      { type: 'scene.configure', name: 'New', settings: { ...settings, selectionWidth: 0 } },
      { type: 'scene.configure', name: 'New', settings: { ...settings, selectionWidth: 9 } },
    ] as SceneOperation[]) {
      const before = structuredClone(document)
      const result = applyPatch(document, patchFor(document, [operation], 'Invalid settings'))
      expect(result.applied).toBe(false)
      expect(document).toEqual(before)
    }
  })

  it('opens existing settings without outline fields using the current defaults', () => {
    const document = makeFixture()
    const { selectionColor, selectionWidth, ...legacySettings } = settings
    document.settings = legacySettings
    const reopened = importPackage(exportPackage(document))
    expect({ ...DEFAULT_SCENE_SETTINGS, ...reopened.settings }).toMatchObject({ selectionColor: '#ffad46', selectionWidth: 3 })
  })
})
