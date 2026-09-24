import type { z } from 'zod/v4'
import { string, number, array, strictObject, tuple, enum as enumeration, record, unknown, boolean, literal, discriminatedUnion } from 'zod/v4'
import { UI_ANCHORS } from '../../../scene-editor/src/content-coordinates'
import { parseGridData, parseTilemapData, parseTilemapRendererData } from '../../../scene-editor/src/tilemap-data'

// Pure contract shared by authoring validation, editors and optional game consumers.
export const BEEGAME_CONTENT_ROOT = 'content' as const
export const BEEGAME_CONTENT_INDEX = 'content/index.json' as const
export const BEEGAME_CONTENT_PACKAGE_SCHEMA =
  'beegame-content-package.v2' as const
export const BEEGAME_CONTENT_DOCUMENT_SCHEMA = 'beegame-content.v1' as const

/**
 * Canonical UI object roles accepted by the engine-neutral content contract.
 *
 * A role describes the node's authored purpose; it is not an asset kind. Keep
 * this vocabulary closed so an author cannot silently invent a runtime type.
 */
export const BEEGAME_UI_NODE_ROLES = [
  'screen-root',
  'hud-root',
  'flow-root',
  'flow-screen',
  'container',
  'text',
  'image',
  'sprite',
  'nineSlicePanel',
  'button',
  'slider',
  'toggle',
  'dropdown',
  'tab',
  'shape',
  'keycap',
  'toast',
  'worldPrompt',
  'capsuleSegment',
  'emitter',
] as const

export type BeeGameUiNodeRole = (typeof BEEGAME_UI_NODE_ROLES)[number]

export const BEEGAME_UI_ASSET_BACKED_ROLES = [
  'image',
  'sprite',
  'nineSlicePanel',
] as const satisfies readonly BeeGameUiNodeRole[]

export const BEEGAME_SCENE_MODEL = 'game-object-v2' as const
export const BEEGAME_SCENE_COMPONENT_TYPES = [
  'sprite-renderer',
  'mesh-filter',
  'mesh-renderer',
  'skinned-mesh-renderer',
  'grid',
  'tilemap',
  'tilemap-renderer',
  'animator',
  'box-collider-2d',
  'circle-collider-2d',
  'capsule-collider-2d',
  'polygon-collider-2d',
  'rigidbody-2d',
  'box-collider',
  'sphere-collider',
  'capsule-collider',
  'mesh-collider',
  'rigidbody',
  'audio-source',
  'audio-listener',
  'particle-system',
  'particle-system-renderer',
  'light-2d',
  'light',
  'camera',
  'canvas',
  'canvas-renderer',
  'rect-transform',
  'image',
  'text',
] as const
export const BEEGAME_SCENE_ASSET_COMPONENT_TYPES = [
  'sprite-renderer',
  'mesh-filter',
  'mesh-renderer',
  'skinned-mesh-renderer',
  'tilemap',
  'animator',
  'audio-source',
  'particle-system-renderer',
  'image',
] as const satisfies readonly (typeof BEEGAME_SCENE_COMPONENT_TYPES)[number][]

const digestSchema = string().regex(/^[a-f0-9]{64}$/)
const finiteNumber = number().finite()
const identifier = string().trim().min(1).max(256)
const uniqueIdentifiers = array(identifier)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length)
      context.addIssue({ code: 'custom', message: 'values must be unique' })
  })

export const contentDocumentRegistryEntrySchema = strictObject({
    id: identifier,
    kind: enumeration(['scene-2d', 'scene-3d', 'ui-screen', 'ui-hud', 'ui-flow', 'vfx']),
    path: identifier,
    loadPhase: enumeration(['startup', 'on-demand']),
  })

export const contentIndexSchema = strictObject({
    schema: literal(BEEGAME_CONTENT_PACKAGE_SCHEMA),
    id: identifier,
    dimension: enumeration(['2d', '3d']),
    documentRevision: digestSchema,
    assetManifestRevision: digestSchema,
    entryScene: identifier,
    files: uniqueIdentifiers.min(1),
    /** Optional on existing v2 packages; new packages use this to avoid loading every document at startup. */
    documents: array(contentDocumentRegistryEntrySchema).optional(),
    sceneModel: literal(BEEGAME_SCENE_MODEL),
  })

const transformSchema = strictObject({
    position: tuple([finiteNumber, finiteNumber, finiteNumber]),
    rotation: tuple([finiteNumber, finiteNumber, finiteNumber]).optional(),
    scale: tuple([finiteNumber, finiteNumber, finiteNumber]).optional(),
  })

const sceneComponentSchema = strictObject({
    /** Stable identity: editor/runtime references must not depend on array order. */
    id: identifier,
    type: enumeration(BEEGAME_SCENE_COMPONENT_TYPES),
    assetRef: identifier.optional(),
    data: record(string(), unknown()).optional(),
  }).superRefine((component, context) => {
    try {
      if (component.type === 'grid') parseGridData(component.data)
      if (component.type === 'tilemap') parseTilemapData(component.data)
      if (component.type === 'tilemap-renderer') parseTilemapRendererData(component.data)
    } catch (error) { context.addIssue({ code: 'custom', path: ['data'], message: String(error) }) }
  })

const behaviorMetadataSchema = strictObject({
    id: identifier,
    /** Closed at the shape level, intentionally open at the behavior vocabulary level. */
    kind: identifier,
    config: record(string(), unknown()),
  })

const sceneNodeDataSchema = record(string(), unknown())
  .superRefine((value, context) => {
    if (value.behaviors === undefined) return
    if (!Array.isArray(value.behaviors)) {
      context.addIssue({
        code: 'custom',
        path: ['behaviors'],
        message: 'behaviors must be an array of authored behavior metadata.',
      })
      return
    }
    const ids = new Set<string>()
    value.behaviors.forEach((behavior, index) => {
      const parsed = behaviorMetadataSchema.safeParse(behavior)
      if (!parsed.success) {
        context.addIssue({
          code: 'custom',
          path: ['behaviors', index],
          message: 'behavior entries require id, kind and config.',
        })
        return
      }
      if (ids.has(parsed.data.id)) {
        context.addIssue({
          code: 'custom',
          path: ['behaviors', index, 'id'],
          message: `duplicate behavior id ${parsed.data.id}.`,
        })
      }
      ids.add(parsed.data.id)
    })
  })

const componentSceneNodeSchema = strictObject({
    id: identifier,
    parentId: identifier.optional(),
    name: string().trim().min(1).max(512).optional(),
    semantic: uniqueIdentifiers.optional(),
    enabled: boolean().optional(),
    transform: transformSchema.optional(),
    layer: identifier.optional(),
    zIndex: finiteNumber.optional(),
    components: array(sceneComponentSchema).optional(),
    data: sceneNodeDataSchema.optional(),
  })

const uiLayoutSchema = strictObject({
    anchor: enumeration(Object.keys(UI_ANCHORS) as [keyof typeof UI_ANCHORS, ...(keyof typeof UI_ANCHORS)[]]).optional(),
    position: tuple([finiteNumber, finiteNumber]).optional(),
    size: tuple([finiteNumber.nonnegative(), finiteNumber.nonnegative()]).optional(),
    rotation: finiteNumber.optional(),
    scale: tuple([finiteNumber, finiteNumber]).optional(),
  })

const uiNodeSchema = strictObject({
    id: identifier,
    parentId: identifier.optional(),
    role: enumeration(BEEGAME_UI_NODE_ROLES),
    enabled: boolean().optional(),
    name: string().trim().min(1).max(512).optional(),
    text: string().optional(),
    assetRef: identifier.optional(),
    layout: uiLayoutSchema.optional(),
    bindings: record(string(), string()).optional(),
    actions: record(string(), identifier).optional(),
    style: record(string(), unknown()).optional(),
    data: record(string(), unknown()).optional(),
  })

const vfxNodeSchema = strictObject({
    id: identifier,
    parentId: identifier.optional(),
    name: string().trim().min(1).max(512).optional(),
    type: identifier,
    assetRef: identifier.optional(),
    data: record(string(), unknown()).optional(),
  })

const contentHeader = {
  schema: literal(BEEGAME_CONTENT_DOCUMENT_SCHEMA),
  id: identifier,
  assetRefs: uniqueIdentifiers,
} as const

const sceneDocumentBaseSchema = strictObject({
    ...contentHeader,
    kind: string(),
    data: strictObject({
        nodes: array(componentSceneNodeSchema).min(1),
        cameraNodeId: identifier.optional(),
        settings: record(string(), unknown()).optional(),
      }),
  })
const scene2dDocumentSchema = sceneDocumentBaseSchema.extend({ kind: literal('scene-2d') })
const scene3dDocumentSchema = sceneDocumentBaseSchema.extend({ kind: literal('scene-3d') })

const uiDocumentSchema = strictObject({
    ...contentHeader,
    kind: enumeration(['ui-screen', 'ui-hud', 'ui-flow']),
    data: strictObject({
        rootId: identifier,
        nodes: array(uiNodeSchema).min(1),
      }),
  })

const vfxDocumentSchema = strictObject({
    ...contentHeader,
    kind: literal('vfx'),
    data: strictObject({
        nodes: array(vfxNodeSchema).min(1),
      }),
  })

export const contentDocumentSchema = discriminatedUnion('kind', [
  scene2dDocumentSchema,
  scene3dDocumentSchema,
  uiDocumentSchema,
  vfxDocumentSchema,
])

export type BeeGameContentIndex = z.infer<typeof contentIndexSchema>
export type BeeGameContentDocument = z.infer<typeof contentDocumentSchema>
export type BeeGameSceneContentDocument = Extract<
  BeeGameContentDocument,
  { kind: 'scene-2d' | 'scene-3d' }
>

export function parseBeeGameContentIndex(value: unknown): BeeGameContentIndex {
  return contentIndexSchema.parse(structuredClone(value))
}

export function parseBeeGameContentDocument(
  value: unknown,
): BeeGameContentDocument {
  return contentDocumentSchema.parse(structuredClone(value))
}
