import { z } from 'zod/v4'
import type { BeeGameAssetManifest } from './asset-contracts'
import {
  BEEGAME_CONTENT_DOCUMENT_SCHEMA,
  BEEGAME_CONTENT_INDEX,
  BEEGAME_CONTENT_PACKAGE_SCHEMA,
  BEEGAME_CONTENT_ROOT,
} from './game-content-package'

const digest = z.string().regex(/^[a-f0-9]{64}$/)

const inputSchema = z
  .strictObject({
    documentRevision: digest,
    assetManifestRevision: digest,
    manifest: z.unknown(),
  })

export type SceneUiContentAuthoringInput = Readonly<{
  documentRevision: string
  assetManifestRevision: string
  manifest: BeeGameAssetManifest
}>

export type SceneUiContentAuthoringAuthority = Readonly<{
  task: 'SCENE_UI_CONTENT'
  allowedPaths: readonly ['content/']
  prompt: string
  contract: Readonly<{
    documentRevision: string
    assetManifestRevision: string
    assetManifest: BeeGameAssetManifest
    output: Readonly<{
      root: typeof BEEGAME_CONTENT_ROOT
      index: typeof BEEGAME_CONTENT_INDEX
      packageSchema: typeof BEEGAME_CONTENT_PACKAGE_SCHEMA
      documentSchema: typeof BEEGAME_CONTENT_DOCUMENT_SCHEMA
      kinds: readonly ['scene-2d', 'ui-screen', 'ui-hud', 'ui-flow']
    }>
  }>
}>

/**
 * Build the complete authority for one normal direct CLI turn.  This function
 * deliberately says what must be produced, not how the Agent must work.
 */
export function buildSceneUiContentAuthoringAuthority(
  input: SceneUiContentAuthoringInput,
): SceneUiContentAuthoringAuthority {
  const parsed = inputSchema.parse(structuredClone(input))
  const contract = {
    documentRevision: parsed.documentRevision,
    assetManifestRevision: parsed.assetManifestRevision,
    assetManifest: parsed.manifest as BeeGameAssetManifest,
    output: {
      root: BEEGAME_CONTENT_ROOT,
      index: BEEGAME_CONTENT_INDEX,
      packageSchema: BEEGAME_CONTENT_PACKAGE_SCHEMA,
      documentSchema: BEEGAME_CONTENT_DOCUMENT_SCHEMA,
      kinds: ['scene-2d', 'ui-screen', 'ui-hud', 'ui-flow'],
    },
  } as const
  const prompt = [
    'Create the engine-neutral Scene2D and UI content package for this game in content/.',
    'Read the accepted Foundation documents in the workspace as the game requirements and rule authority, and use the injected Asset Manifest as the sole resource authority; this package owns Scene and UI assembly.',
    'Write content/index.json, scene files under content/scenes/, and UI files under content/ui/. Keep world-space Scene content and screen-space UI content separate.',
    'These Scene and UI files are the canonical editable source used by editors and consumed directly by target implementations; do not create another derived Scene or UI config.',
    'Reference verified Manifest resources through assetRefs. Keep file paths and URLs out of content data.',
    'When a Scene sprite uses a sprite sheet or atlas, set its frameRef to a sprite-frame or atlas-region id from that Manifest resource content_profile; do not copy frame rectangles into Scene data.',
    'Express the complete Scene and UI required by the authority. Do not create VFX, character, animation, audio, gameplay, target-engine source code, or a second resource registry in this task.',
    'Finish after the Scene and UI package is coherent. The host validates syntax, versions, references and hierarchy.',
  ].join(' ')
  return Object.freeze({
    task: 'SCENE_UI_CONTENT',
    allowedPaths: ['content/'] as const,
    prompt,
    contract,
  })
}
