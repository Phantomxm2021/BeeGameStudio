/**
 * One-time migration for the scene documents authored before the scene
 * component vocabulary was closed.
 *
 * This module deliberately does not teach the runtime to read the old
 * `mono-behaviour` component. It turns each known behaviour into node-owned
 * metadata and removes the old component. Unknown behaviours fail the whole
 * migration so an authored rule cannot silently disappear.
 */

export type LegacySceneComponent = {
  type: string
  assetRef?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

export type LegacySceneNode = {
  id: string
  parentId?: string
  name?: string
  semantic?: string[]
  enabled?: boolean
  transform?: Record<string, unknown>
  layer?: string
  zIndex?: number
  components?: LegacySceneComponent[]
  data?: Record<string, unknown>
  [key: string]: unknown
}

export type LegacySceneDocument = {
  schema: string
  id: string
  kind: string
  assetRefs?: string[]
  data: {
    nodes: LegacySceneNode[]
    cameraNodeId?: string
    settings?: Record<string, unknown>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type MigratedNodeBehavior = {
  id: string
  kind: string
  config: Record<string, unknown>
}

export type MigratedComponent = {
  id: string
  type: string
  assetRef?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

export type MigratedSceneNode = {
  id: string
  parentId?: string
  name?: string
  semantic?: string[]
  enabled?: boolean
  transform?: Record<string, unknown>
  layer?: string
  zIndex?: number
  components?: MigratedComponent[]
  data?: Record<string, unknown>
  [key: string]: unknown
}

export type SceneMigrationReport = {
  migratedBehaviorCount: number
  behaviorCounts: Readonly<Record<string, number>>
  generatedComponentIds: number
  undeclaredBehaviorAssets: readonly string[]
  unsupportedBehaviorIds: readonly string[]
  warnings: readonly string[]
}

export type SceneMigrationResult = {
  scene: LegacySceneDocument
  report: SceneMigrationReport
}

export type SceneMigrationOptions = {
  /** When supplied, every discovered behaviour asset must exist in the manifest. */
  verifiedAssetRefs?: ReadonlySet<string>
}

type BehaviorMapping = {
  type: string
}

/** Closed on purpose. Add a mapping only after deciding where the behaviour is consumed. */
export const LEGACY_BEHAVIOR_MIGRATIONS: Readonly<Record<string, BehaviorMapping>> = {
  'horizontal-drift': { type: 'motion.horizontal-drift' },
  'bush-hide-zone': { type: 'cover.bush' },
  'mailbox-delivery': { type: 'objective.mailbox-delivery' },
  'world-prompt-anchor': { type: 'world-prompt.anchor' },
  'decorative-only': { type: 'collision.decorative' },
  'letter-pickup': { type: 'pickup.letter' },
  'vertical-bob': { type: 'motion.vertical-bob' },
  'tree-canopy': { type: 'occlusion.tree-canopy' },
  'player-controller': { type: 'actor.player-controller' },
  'guard-ai': { type: 'actor.guard-patrol' },
  'guard-vision': { type: 'sensing.guard-vision' },
  'audio-director': { type: 'director.audio' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function behaviorId(nodeId: string, scriptId: string, occurrence: number): string {
  return `behavior:${nodeId}:${scriptId}:${occurrence + 1}`
}

function componentId(nodeId: string, type: string, occurrence: number): string {
  return `component:${nodeId}:${type}:${occurrence + 1}`
}

function collectAssetIds(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectAssetIds(item, output))
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    if ((key === 'assetRef' || key === 'cueBank') && typeof item === 'string') output.add(item)
    collectAssetIds(item, output)
  }
}

function addBehavior(
  node: LegacySceneNode,
  behavior: MigratedNodeBehavior,
): Record<string, unknown> {
  const data = isRecord(node.data) ? clone(node.data) : {}
  const existing = Array.isArray(data.behaviors) ? clone(data.behaviors) : []
  data.behaviors = [...existing, behavior]
  return data
}

/**
 * Convert a legacy scene in memory. The caller owns persistence. This makes it
 * safe to dry-run against a project and to inspect the report before writing.
 */
export function migrateLegacyScene(
  input: LegacySceneDocument,
  options: SceneMigrationOptions = {},
): SceneMigrationResult {
  const source = clone(input)
  if (!source.data || !Array.isArray(source.data.nodes)) throw new Error('Scene data.nodes is required.')

  const unsupported = new Set<string>()
  const behaviorCounts: Record<string, number> = {}
  const undeclaredAssets = new Set<string>()
  const declaredAssets = new Set(source.assetRefs ?? [])
  let migratedBehaviorCount = 0
  let generatedComponentIds = 0

  const migratedNodes = source.data.nodes.map((sourceNode) => {
    const node = clone(sourceNode)
    const sourceComponents = Array.isArray(sourceNode.components) ? sourceNode.components : []
    const occurrences = new Map<string, number>()
    const components: MigratedComponent[] = []
    let behaviorData: Record<string, unknown> | undefined = isRecord(sourceNode.data)
      ? clone(sourceNode.data)
      : undefined

    for (const sourceComponent of sourceComponents) {
      if (sourceComponent.type === 'mono-behaviour') {
        const sourceData = sourceComponent.data
        const scriptId = isRecord(sourceData) && typeof sourceData.scriptId === 'string'
          ? sourceData.scriptId
          : undefined
        if (!scriptId) {
          unsupported.add(`${sourceNode.id}:mono-behaviour:missing-scriptId`)
          continue
        }
        const mapping = LEGACY_BEHAVIOR_MIGRATIONS[scriptId]
        if (!mapping) {
          unsupported.add(scriptId)
          continue
        }
        const occurrence = occurrences.get(scriptId) ?? 0
        occurrences.set(scriptId, occurrence + 1)
        const config = isRecord(sourceData) ? clone(sourceData) : {}
        delete config.scriptId
        const migrated: MigratedNodeBehavior = {
          id: behaviorId(sourceNode.id, scriptId, occurrence),
          kind: mapping.type,
          config,
        }
        behaviorData = addBehavior({ ...sourceNode, data: behaviorData }, migrated)
        collectAssetIds(config, undeclaredAssets)
        behaviorCounts[scriptId] = (behaviorCounts[scriptId] ?? 0) + 1
        migratedBehaviorCount += 1
        continue
      }
      const occurrence = components.filter((component) => component.type === sourceComponent.type).length
      const next = clone(sourceComponent)
      delete next.id
      components.push({ ...next, id: componentId(sourceNode.id, sourceComponent.type, occurrence) })
      generatedComponentIds += 1
    }

    const migratedNode: MigratedSceneNode = {
      ...node,
      components,
      ...(behaviorData && Object.keys(behaviorData).length ? { data: behaviorData } : {}),
    }
    return migratedNode
  })

  const undeclaredBehaviorAssets = [...undeclaredAssets].filter((id) => !declaredAssets.has(id)).sort()
  if (options.verifiedAssetRefs) {
    const missingManifestAssets = undeclaredBehaviorAssets.filter((id) => !options.verifiedAssetRefs?.has(id))
    if (missingManifestAssets.length)
      throw new Error(`Migration refused: behaviour assets are missing from the verified manifest: ${missingManifestAssets.join(', ')}`)
  }
  for (const assetId of undeclaredAssets) if (!declaredAssets.has(assetId)) {
    // Behaviour references are still resource references. Add only their IDs;
    // manifest verification remains the authority's job.
    source.assetRefs = [...(source.assetRefs ?? []), assetId]
  }
  source.assetRefs = [...new Set(source.assetRefs ?? [])]

  const warnings: string[] = []
  if (source.data.nodes.filter((node) => !node.parentId).length > 20)
    warnings.push('Scene has more than 20 root GameObjects; group by visual/gameplay ownership only when local transforms can be preserved.')
  const camera = migratedNodes.find((node) => node.id === source.data.cameraNodeId)
  if (camera) {
    const cameraComponent = camera.components?.find((component) => component.type === 'camera')
    const cameraData = isRecord(cameraComponent?.data) ? clone(cameraComponent.data) : {}
    const viewport = isRecord(cameraData.viewport) ? cameraData.viewport : {}
    const width = typeof viewport.width === 'number' ? viewport.width : 1280
    const height = typeof viewport.height === 'number' ? viewport.height : 720
    cameraData.coordinateSpace = cameraData.orthographic === true ? 'logical-pixels' : 'world-units'
    cameraData.viewport = { width, height }
    const settings = isRecord(source.data.settings) ? source.data.settings : {}
    const coordinateSystem = isRecord(settings.coordinateSystem) ? settings.coordinateSystem : {}
    source.data.settings = {
      ...settings,
      coordinateSystem: {
        ...coordinateSystem,
        origin: 'top-left',
        units: 'logical-pixels',
        width,
        height,
        // The editor adapter's canonical logical-pixel conversion is 100 px/U.
        pixelsPerUnit: typeof coordinateSystem.pixelsPerUnit === 'number' && coordinateSystem.pixelsPerUnit > 0 ? coordinateSystem.pixelsPerUnit : 100,
      },
    }
    const pixelsPerUnit = (source.data.settings.coordinateSystem as Record<string, unknown>).pixelsPerUnit as number
    cameraData.orthographicSize = height / (2 * pixelsPerUnit)
    if (cameraComponent) cameraComponent.data = cameraData
  }

  const caughtFade = migratedNodes.find((node) => node.id === 'caught_fade')
  if (caughtFade) {
    const transform = isRecord(caughtFade.transform) ? clone(caughtFade.transform) : {}
    const scale = Array.isArray(transform.scale) ? transform.scale : undefined
    if (scale?.[0] === 1280 && scale?.[1] === 720) {
      transform.scale = [1, 1, 1]
      caughtFade.transform = transform
    }
    const fullScreenRect = {
      anchorMin: [0, 0],
      anchorMax: [1, 1],
      pivot: [0.5, 0.5],
      anchoredPosition: [0, 0],
      sizeDelta: [0, 0],
    }
    const components = Array.isArray(caughtFade.components) ? [...caughtFade.components] : []
    const rectIndex = components.findIndex((component) => component.type === 'rect-transform')
    if (rectIndex >= 0) components[rectIndex] = { ...components[rectIndex], data: fullScreenRect }
    else components.push({ id: componentId(caughtFade.id, 'rect-transform', components.filter((component) => component.type === 'rect-transform').length), type: 'rect-transform', data: fullScreenRect })
    if (!components.some((component) => component.type === 'canvas-renderer'))
      components.push({ id: componentId(caughtFade.id, 'canvas-renderer', components.filter((component) => component.type === 'canvas-renderer').length), type: 'canvas-renderer', data: {} })
    caughtFade.components = components

    const canvasAncestor = migratedNodes.find((node) => node.id === caughtFade.parentId)
    if (canvasAncestor?.components?.some((component) => component.type === 'canvas')) {
      const ancestorComponents = [...(canvasAncestor.components ?? [])]
      const ancestorRectIndex = ancestorComponents.findIndex((component) => component.type === 'rect-transform')
      if (ancestorRectIndex >= 0) ancestorComponents[ancestorRectIndex] = { ...ancestorComponents[ancestorRectIndex], data: fullScreenRect }
      else ancestorComponents.push({ id: componentId(canvasAncestor.id, 'rect-transform', ancestorComponents.filter((component) => component.type === 'rect-transform').length), type: 'rect-transform', data: fullScreenRect })
      canvasAncestor.components = ancestorComponents
    }
  }

  const unsupportedBehaviorIds = [...unsupported].sort()
  if (unsupportedBehaviorIds.length)
    throw new Error(`Migration refused: unsupported behaviours: ${unsupportedBehaviorIds.join(', ')}`)

  const result: LegacySceneDocument = {
    ...source,
    data: {
      ...source.data,
      nodes: migratedNodes,
    },
  }
  return {
    scene: result,
    report: {
      migratedBehaviorCount,
      behaviorCounts,
      generatedComponentIds,
      undeclaredBehaviorAssets,
      unsupportedBehaviorIds,
      warnings,
    },
  }
}
