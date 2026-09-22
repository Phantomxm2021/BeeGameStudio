/** Optional, browser-safe consumption helpers, not a game engine.
 * Uses the same schema and geometry/atlas functions as BGS; no filesystem,
 * workflow, networking, physics or gameplay policy belongs in this module. */
export * from './game-content-schema'
export * from '../../../scene-editor/src/content-coordinates'
export { parseSpriteSheet, spriteSheetSelection, validateSpriteSheetBounds, atlasFrameName } from '../../../scene-editor/src/sprite-sheet'
import { parseBeeGameContentDocument } from './game-content-schema'

export function readSceneData(value: unknown) {
  const document = parseBeeGameContentDocument(value)
  if (document.kind !== 'scene-2d' && document.kind !== 'scene-3d')
    throw new Error(`Expected scene content, received ${document.kind}`)
  return document.data
}

export function readUiData(value: unknown) {
  const document = parseBeeGameContentDocument(value)
  if (document.kind !== 'ui-screen' && document.kind !== 'ui-hud' && document.kind !== 'ui-flow')
    throw new Error(`Expected UI content, received ${document.kind}`)
  return document.data
}
