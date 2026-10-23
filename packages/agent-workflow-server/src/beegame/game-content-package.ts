import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { BeeGameAssetManifest } from './asset-contracts'
import { auditAssetContract } from './asset-contract-audit'
import { auditUiInteractiveBounds, readUiLayoutCameras } from './ui-layout-audit'
import { parseTilemapData, validateTilemapGrid } from '../../../scene-editor/src/tilemap-data'
import { uiFontKey } from '../../../scene-editor/src/ui-font-reference'
import { readTileSetResource } from './tilemap-contract'
import { resolveSceneCameraView, type SceneCameraInput } from '../../../scene-editor/src/scene-camera'

export * from './game-content-schema'
import { BEEGAME_CONTENT_ROOT, BEEGAME_CONTENT_INDEX, BEEGAME_UI_ASSET_BACKED_ROLES, BEEGAME_SCENE_COMPONENT_TYPES, BEEGAME_SCENE_ASSET_COMPONENT_TYPES, CONTENT_RESOURCE_LOCATOR_KEYS, contentIndexSchema, contentDocumentSchema, isContentEntryKind, type BeeGameContentIndex, type BeeGameContentDocument } from './game-content-schema'

export type BeeGameContentAuthority = Readonly<{
  documentRevision?: string
  assetManifestRevision?: string
  manifest: BeeGameAssetManifest
}>

export type BeeGameContentPackage = Readonly<{
  index: BeeGameContentIndex
  documents: readonly BeeGameContentDocument[]
  digest: string
}>

export type BeeGameContentPackageAudit = Readonly<{
  valid: boolean
  issues: readonly string[]
  package?: BeeGameContentPackage
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null'
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function safeContentFile(workspace: string, path: string): string | undefined {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    !path.endsWith('.json') ||
    path === 'index.json'
  )
    return undefined
  const root = resolve(workspace, BEEGAME_CONTENT_ROOT)
  const absolute = resolve(root, path)
  const fromRoot = relative(root, absolute)
  if (
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  )
    return undefined
  return absolute
}

function parseJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function listJsonFiles(root: string): string[] {
  const output: string[] = []
  function visit(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile() && entry.name.endsWith('.json'))
        output.push(relative(root, absolute).split(sep).join('/'))
    }
  }
  visit(root)
  return output.sort()
}

function validateTree(input: {
  path: string
  nodes: readonly { id: string; parentId?: string }[]
  rootId?: string
  issues: string[]
}): void {
  const ids = new Set<string>()
  for (const node of input.nodes) {
    if (ids.has(node.id)) input.issues.push(`${input.path}: duplicate node id ${node.id}.`)
    ids.add(node.id)
  }
  if (input.rootId && !ids.has(input.rootId))
    input.issues.push(`${input.path}: rootId does not resolve: ${input.rootId}.`)
  const parents = new Map<string, string>()
  for (const node of input.nodes) {
    if (!node.parentId) continue
    if (!ids.has(node.parentId))
      input.issues.push(`${input.path}: parentId does not resolve: ${node.parentId}.`)
    if (node.parentId === node.id)
      input.issues.push(`${input.path}: node cannot parent itself: ${node.id}.`)
    parents.set(node.id, node.parentId)
  }
  for (const id of ids) {
    const visited = new Set<string>()
    let cursor: string | undefined = id
    while (cursor && parents.has(cursor)) {
      if (visited.has(cursor)) {
        input.issues.push(`${input.path}: node hierarchy contains a cycle at ${cursor}.`)
        break
      }
      visited.add(cursor)
      cursor = parents.get(cursor)
    }
  }
  if (input.rootId) {
    const root = input.nodes.find(node => node.id === input.rootId)
    if (root?.parentId)
      input.issues.push(`${input.path}: UI root cannot have a parent.`)
    for (const node of input.nodes)
      if (node.id !== input.rootId && !node.parentId)
        input.issues.push(`${input.path}: non-root UI node requires parentId: ${node.id}.`)
  }
}

function validateNoResourcePathBypass(
  path: string,
  value: unknown,
  issues: string[],
  trail: string[] = [],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateNoResourcePathBypass(path, item, issues, [...trail, String(index)]),
    )
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    const nextTrail = [...trail, key]
    if (
      typeof item === 'string' &&
      /(?:path|url|src|href)$/i.test(key) &&
      (/^(?:https?:|data:|file:|\/|\.\.?(?:\/|$))/i.test(item) ||
        item.startsWith('assets/'))
    )
      issues.push(
        `${path}: ${nextTrail.join('.')} bypasses assetRefs with a path or URL.`,
      )
    validateNoResourcePathBypass(path, item, issues, nextTrail)
  }
}

function validateNoLegacyScriptFields(
  path: string,
  value: unknown,
  issues: string[],
  trail: string[] = [],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateNoLegacyScriptFields(path, item, issues, [...trail, String(index)]),
    )
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    const nextTrail = [...trail, key]
    if (key === 'scriptId' || key === 'monoBehaviour' || key === 'mono-behaviour' || key === 'behavior')
      issues.push(`${path}: ${nextTrail.join('.')} is a retired script component field; use node.data.behaviors metadata.`)
    validateNoLegacyScriptFields(path, item, issues, nextTrail)
  }
}

function validateDeclaredAssetReferences(
  path: string,
  value: unknown,
  declaredAssets: ReadonlySet<string>,
  issues: string[],
  trail: string[] = [],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateDeclaredAssetReferences(path, item, declaredAssets, issues, [
        ...trail,
        String(index),
      ]),
    )
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    const nextTrail = [...trail, key]
    if (
      key === 'assetRef' &&
      typeof item === 'string' &&
      !declaredAssets.has(item)
    )
      issues.push(
        `${path}: ${nextTrail.join('.')} uses undeclared assetRef ${item}.`,
      )
    validateDeclaredAssetReferences(
      path,
      item,
      declaredAssets,
      issues,
      nextTrail,
    )
  }
}

/** Declaration consistency is checkable even before a resource manifest exists. */
export function undeclaredAssetReferenceIssues(path: string, document: BeeGameContentDocument): string[] {
  const issues: string[] = []
  validateDeclaredAssetReferences(path, document.data, new Set(document.assetRefs), issues)
  return issues
}

/** Binding readiness without a final package authority, geometry run or source writes. */
export function contentBindingIssues(path: string, document: BeeGameContentDocument): string[] {
  const issues = undeclaredAssetReferenceIssues(path, document)
  validateNoResourcePathBypass(path, document.data, issues)
  if (document.kind === 'ui-screen' || document.kind === 'ui-hud' || document.kind === 'ui-flow')
    validateUiVocabulary({ path, document, issues })
  if (document.kind === 'scene-2d' || document.kind === 'scene-3d')
    validateComponentScene({ path, document, issues })
  return issues
}

function validateAssetMembers(
  path: string,
  value: unknown,
  manifest: BeeGameAssetManifest,
  issues: string[],
  trail: string[] = [],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateAssetMembers(path, item, manifest, issues, [...trail, String(index)]),
    )
    return
  }
  if (!isRecord(value)) return
  const assetRef = typeof value.assetRef === 'string' ? value.assetRef : undefined
  const data = isRecord(value.data) ? value.data : undefined
  for (const locator of CONTENT_RESOURCE_LOCATOR_KEYS.filter(key => key === 'member' || key === 'atlasMember')) {
    const member = typeof value[locator] === 'string'
      ? value[locator] as string
      : typeof data?.[locator] === 'string' ? data[locator] as string : undefined
    if (assetRef && member) {
      const resource = manifest.resources.find(item => item.id === assetRef)
      const profile = resource && isRecord(resource.content_profile) ? resource.content_profile : undefined
      const components = profile && Array.isArray(profile.components) ? profile.components : []
      const explicitMember = components.some(component => isRecord(component) && component.id === member)
      const fileStemMember = resource?.file_paths.some(filePath => {
        const name = basename(filePath)
        return name.length > 0 && basename(name, extname(name)) === member
      }) ?? false
      if (!explicitMember && !fileStemMember && !resource?.file_paths.includes(member)) issues.push(
        `${path}: ${[...trail, ...(typeof value[locator] === 'string' ? [] : ['data']), locator].join('.')} does not resolve member ${member} in asset ${assetRef}.`,
      )
    }
  }
  for (const [key, item] of Object.entries(value))
    validateAssetMembers(path, item, manifest, issues, [...trail, key])
}

function validateUiVocabulary(input: {
  path: string
  document: Extract<BeeGameContentDocument, { kind: 'ui-screen' | 'ui-hud' | 'ui-flow' }>
  issues: string[]
  bindingsPending?: boolean
}): void {
  const root = input.document.data.nodes.find(
    node => node.id === input.document.data.rootId,
  )
  const expectedRootRole = input.document.kind === 'ui-screen'
    ? 'screen-root'
    : input.document.kind === 'ui-hud'
      ? 'hud-root'
      : 'flow-root'
  if (root && root.role !== expectedRootRole)
    input.issues.push(
      `${input.path}: ${input.document.kind} root must use role ${expectedRootRole}, received ${root.role}.`,
    )

  const assetBackedRoles = new Set<string>(BEEGAME_UI_ASSET_BACKED_ROLES)
  for (const node of input.document.data.nodes) {
    if (node.data?.font !== undefined && !uiFontKey(node.data.font))
      input.issues.push(`${input.path}: UI node ${node.id} requires data.font {assetRef, member?} with nonempty strings; omit data.font for the default font.`)
    const rootRole = node.role === 'screen-root' || node.role === 'hud-root' || node.role === 'flow-root'
    if (rootRole && node.id !== input.document.data.rootId)
      input.issues.push(
        `${input.path}: root role ${node.role} is only valid on data.rootId (${node.id}).`,
      )
    if (input.document.kind === 'ui-flow') {
      if (node.id !== input.document.data.rootId && node.role !== 'flow-screen')
        input.issues.push(
          `${input.path}: ui-flow child ${node.id} must use role flow-screen, received ${node.role}.`,
        )
    } else if (node.role === 'flow-root' || node.role === 'flow-screen') {
      input.issues.push(
        `${input.path}: role ${node.role} is only valid in a ui-flow document (${node.id}).`,
      )
    }
    if (!input.bindingsPending && assetBackedRoles.has(node.role) && !node.assetRef)
      input.issues.push(
        `${input.path}: asset-backed UI role ${node.role} requires assetRef (${node.id}).`,
      )
    if (!assetBackedRoles.has(node.role) && node.assetRef)
      input.issues.push(
        `${input.path}: UI role ${node.role} is not an asset type and cannot own assetRef (${node.id}); reference assets from its image/texture data instead.`,
      )
  }
}

function validateComponentScene(input: {
  path: string
  document: Extract<BeeGameContentDocument, { kind: 'scene-2d' | 'scene-3d' }>
  issues: string[]
  bindingsPending?: boolean
}): void {
  const componentTypes = new Set<string>(BEEGAME_SCENE_COMPONENT_TYPES)
  const assetComponentTypes = new Set<string>(BEEGAME_SCENE_ASSET_COMPONENT_TYPES)
  const tuple = (value: unknown, length: number): boolean => Array.isArray(value) && value.length === length && value.every(item => typeof item === 'number' && Number.isFinite(item))
  const issue = (nodeId: string, type: string, message: string): void => { input.issues.push(`${input.path}: ${type} on ${nodeId} ${message}.`) }
  const nodeById = new Map(input.document.data.nodes.map(node => [node.id, node]))
  const hasAncestorComponent = (nodeId: string, type: string): boolean => {
    const visited = new Set<string>()
    let cursor = nodeById.get(nodeId)?.parentId
    while (cursor) {
      if (visited.has(cursor)) return false
      visited.add(cursor)
      const node = nodeById.get(cursor)
      if (!node) return false
      if (node.components?.some(component => component.type === type)) return true
      cursor = node.parentId
    }
    return false
  }
  const componentIds = new Set<string>()
  const findEmbeddedReference = (
    value: unknown,
    trail: readonly string[] = [],
  ): string | undefined => {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const match = findEmbeddedReference(value[index], [...trail, String(index)])
        if (match) return match
      }
      return undefined
    }
    if (!isRecord(value)) return undefined
    for (const [key, item] of Object.entries(value)) {
      const nextTrail = [...trail, key]
      if (key === 'assetRef' || key === 'frameRef') return nextTrail.join('.')
      const match = findEmbeddedReference(item, nextTrail)
      if (match) return match
    }
    return undefined
  }
  for (const node of input.document.data.nodes) {
    const nodeTypes = new Set((node.components ?? []).map(component => component.type))
    const nodeReference = findEmbeddedReference(node.data)
    if (nodeReference)
      input.issues.push(
        `${input.path}: Scene GameObject ${node.id} stores legacy ${nodeReference} in node data; resources belong on a consuming component.`,
      )
    for (const component of node.components ?? []) {
      if (componentIds.has(component.id))
        input.issues.push(`${input.path}: duplicate scene component id ${component.id}.`)
      componentIds.add(component.id)
      if (!componentTypes.has(component.type)) {
        input.issues.push(
          `${input.path}: Scene GameObject ${node.id} uses unknown component type ${component.type}.`,
        )
        continue
      }
      if (!assetComponentTypes.has(component.type) && component.assetRef)
        input.issues.push(
          `${input.path}: Scene component ${component.type} is not an asset consumer and cannot own assetRef (${node.id}).`,
        )
      // The shared 2D surface already renders color-only sprites. They consume
      // authored geometry/color, not an external asset; other consumers still
      // require their actual resource binding.
      const colorSprite = input.document.kind === 'scene-2d' && component.type === 'sprite-renderer' &&
        typeof component.data?.color === 'string' && component.data.color.trim().length > 0
      if (!input.bindingsPending && ['sprite-renderer', 'mesh-filter', 'skinned-mesh-renderer', 'tilemap'].includes(component.type) && !component.assetRef && !colorSprite)
        input.issues.push(
          `${input.path}: Scene component ${component.type} requires assetRef (${node.id}).`,
        )
      const data = component.data ?? {}
      if (component.type === 'tilemap') {
        try {
          if (input.document.kind !== 'scene-2d') throw Error('Rectangular Tilemap requires a 2D scene')
          validateTilemapGrid(input.document.data.nodes, node, parseTilemapData(data))
          if (!node.components?.some(c => c.type === 'tilemap-renderer')) throw Error('Tilemap requires TilemapRenderer')
        } catch (error) { issue(node.id, component.type, String(error)) }
      }
      if (component.type === 'text' && data.font !== undefined) {
        const font = data.font
        if (!isRecord(font) || typeof font.assetRef !== 'string' || !font.assetRef.trim() ||
          (font.member !== undefined && (typeof font.member !== 'string' || !font.member.trim())) ||
          Object.keys(font).some(key => key !== 'assetRef' && key !== 'member'))
          issue(node.id, component.type, 'requires data.font {assetRef, member?} with nonempty strings')
      }
      // Text's canonical font is the only nested Scene resource location.
      // Its closed shape is checked above; other embedded references stay invalid.
      const embeddedReference = findEmbeddedReference(component.type === 'text' ? { ...data, font: undefined } : data)
      if (embeddedReference)
        input.issues.push(
          `${input.path}: Scene component ${component.type} on ${node.id} stores legacy ${embeddedReference} in data; use the component assetRef and data.member fields.`,
        )
      if (component.type === 'camera' && typeof data.orthographic !== 'boolean') issue(node.id, component.type, 'requires boolean data.orthographic')
      if (component.type === 'camera') {
        if (data.framing !== undefined) {
          try { resolveSceneCameraView(data as unknown as SceneCameraInput, { width: 960, height: 540 }) }
          catch (error) { issue(node.id, component.type, error instanceof Error ? error.message : String(error)) }
        }
        if (data.orthographic === true && !(typeof data.orthographicSize === 'number' && Number.isFinite(data.orthographicSize) && data.orthographicSize > 0))
          issue(node.id, component.type, 'requires positive data.orthographicSize for orthographic projection')
        if (data.orthographic === false && !(typeof data.fieldOfView === 'number' && Number.isFinite(data.fieldOfView) && data.fieldOfView > 0 && data.fieldOfView < 180))
          issue(node.id, component.type, 'requires data.fieldOfView in (0,180) for perspective projection')
        if (!['logical-pixels', 'world-units'].includes(String(data.coordinateSpace)))
          issue(node.id, component.type, 'requires data.coordinateSpace logical-pixels or world-units')
        if (String(data.coordinateSpace) === 'logical-pixels') {
          const viewport = isRecord(data.viewport) ? data.viewport : undefined
          if (!(typeof viewport?.width === 'number' && Number.isFinite(viewport.width) && viewport.width > 0 && typeof viewport.height === 'number' && Number.isFinite(viewport.height) && viewport.height > 0))
            issue(node.id, component.type, 'requires positive data.viewport.width and data.viewport.height for logical-pixels')
        }
        if (input.document.kind === 'scene-2d' && data.orthographic !== true)
          issue(node.id, component.type, 'must be orthographic in a 2D scene')
      }
      if (component.type === 'rect-transform') {
        const fields: Array<[string, number]> = [
          ['anchorMin', 2], ['anchorMax', 2], ['anchoredPosition', 2], ['sizeDelta', 2], ['pivot', 2],
        ]
        for (const [field, length] of fields)
          if (!tuple(data[field], length)) issue(node.id, component.type, `requires data.${field}[${length}]`)
      }
      if (component.type === 'box-collider-2d' && (!tuple(data.size, 2) || !tuple(data.offset, 2) || typeof data.isTrigger !== 'boolean')) issue(node.id, component.type, 'requires data.size[2], data.offset[2], and boolean data.isTrigger')
      if (component.type === 'circle-collider-2d' && (!(typeof data.radius === 'number' && Number.isFinite(data.radius) && data.radius > 0) || !tuple(data.offset, 2) || typeof data.isTrigger !== 'boolean')) issue(node.id, component.type, 'requires positive data.radius, data.offset[2], and boolean data.isTrigger')
      if (component.type === 'capsule-collider-2d' && (!tuple(data.size, 2) || !tuple(data.offset, 2) || !['horizontal', 'vertical'].includes(String(data.direction)) || typeof data.isTrigger !== 'boolean')) issue(node.id, component.type, 'requires data.size[2], data.offset[2], direction, and boolean data.isTrigger')
      if (component.type === 'polygon-collider-2d' && (!Array.isArray(data.points) || data.points.length < 3 || !data.points.every(point => tuple(point, 2)) || !tuple(data.offset, 2) || typeof data.isTrigger !== 'boolean')) issue(node.id, component.type, 'requires at least three data.points[2], data.offset[2], and boolean data.isTrigger')
      if (component.type === 'rigidbody-2d' && !['dynamic', 'kinematic', 'static'].includes(String(data.bodyType))) issue(node.id, component.type, 'requires a valid data.bodyType')
      if (component.type === 'box-collider' && (!tuple(data.size, 3) || !tuple(data.center, 3) || typeof data.isTrigger !== 'boolean')) issue(node.id, component.type, 'requires data.size[3], data.center[3], and boolean data.isTrigger')
      if (component.type === 'sphere-collider' && (!(typeof data.radius === 'number' && Number.isFinite(data.radius) && data.radius > 0) || !tuple(data.center, 3) || typeof data.isTrigger !== 'boolean')) issue(node.id, component.type, 'requires positive data.radius, data.center[3], and boolean data.isTrigger')
      if (component.type === 'capsule-collider' && (!(typeof data.radius === 'number' && Number.isFinite(data.radius) && data.radius > 0) || !(typeof data.height === 'number' && Number.isFinite(data.height) && data.height > 0) || !tuple(data.center, 3) || !['x', 'y', 'z'].includes(String(data.direction)) || typeof data.isTrigger !== 'boolean')) issue(node.id, component.type, 'requires radius, height, center[3], direction, and boolean data.isTrigger')
      if (component.type === 'mesh-collider' && (typeof data.convex !== 'boolean' || typeof data.isTrigger !== 'boolean')) issue(node.id, component.type, 'requires boolean data.convex and data.isTrigger')
      if (component.type === 'rigidbody' && (typeof data.isKinematic !== 'boolean' || typeof data.useGravity !== 'boolean' || !(typeof data.mass === 'number' && Number.isFinite(data.mass) && data.mass > 0))) issue(node.id, component.type, 'requires boolean data.isKinematic, boolean data.useGravity, and positive data.mass')
      if (component.type === 'canvas' && !['screen-space-overlay', 'screen-space-camera', 'world-space'].includes(String(data.renderMode))) issue(node.id, component.type, 'requires a valid data.renderMode')
      if (component.type === 'text' && typeof data.text !== 'string') issue(node.id, component.type, 'requires string data.text')
      if (component.type === 'canvas' && !nodeTypes.has('rect-transform')) issue(node.id, component.type, 'requires RectTransform on the same GameObject')
      if ((component.type === 'image' || component.type === 'text') && !nodeTypes.has('rect-transform')) issue(node.id, component.type, 'requires RectTransform on the same GameObject')
      if ((component.type === 'image' || component.type === 'text') && !nodeTypes.has('canvas-renderer')) issue(node.id, component.type, 'requires CanvasRenderer on the same GameObject')
      if ((component.type === 'image' || component.type === 'text') && !hasAncestorComponent(node.id, 'canvas')) issue(node.id, component.type, 'requires a Canvas ancestor')
    }
    const types = [...nodeTypes]
    const physics2d = types.some(type => type.endsWith('-collider-2d') || type === 'rigidbody-2d')
    const physics3d = types.some(type => ['box-collider', 'sphere-collider', 'capsule-collider', 'mesh-collider', 'rigidbody'].includes(type))
    if (input.document.kind === 'scene-2d' && physics3d) input.issues.push(`${input.path}: 2D scene GameObject ${node.id} cannot use 3D physics components.`)
    if (input.document.kind === 'scene-3d' && physics2d) input.issues.push(`${input.path}: 3D scene GameObject ${node.id} cannot use 2D physics components.`)
    if (input.document.kind === 'scene-2d' && nodeTypes.has('light')) input.issues.push(`${input.path}: 2D scene GameObject ${node.id} must use Light2D.`)
    if (input.document.kind === 'scene-3d' && nodeTypes.has('light-2d')) input.issues.push(`${input.path}: 3D scene GameObject ${node.id} must use Light.`)
    if (nodeTypes.has('rigidbody') && nodeTypes.has('rigidbody-2d'))
      input.issues.push(`${input.path}: GameObject ${node.id} cannot mix Rigidbody and Rigidbody2D.`)
    if (nodeTypes.has('mesh-renderer') && !nodeTypes.has('mesh-filter'))
      input.issues.push(`${input.path}: MeshRenderer requires MeshFilter on the same GameObject (${node.id}).`)
    if (nodeTypes.has('tilemap-renderer') && !nodeTypes.has('tilemap'))
      input.issues.push(`${input.path}: TilemapRenderer requires Tilemap on the same GameObject (${node.id}).`)
    if (nodeTypes.has('particle-system-renderer') && !nodeTypes.has('particle-system'))
      input.issues.push(`${input.path}: ParticleSystemRenderer requires ParticleSystem on the same GameObject (${node.id}).`)
    if (node.data)
      validateNoLegacyScriptFields(input.path, node.data, input.issues, ['nodes', node.id, 'data'])
  }
  if (input.document.kind === 'scene-2d') {
    const settings = input.document.data.settings
    const coordinateSystem = isRecord(settings?.coordinateSystem)
      ? settings.coordinateSystem
      : undefined
    if (!coordinateSystem)
      input.issues.push(`${input.path}: 2D scene requires data.settings.coordinateSystem.`)
    else {
      if (coordinateSystem.origin !== 'top-left')
        input.issues.push(`${input.path}: 2D coordinateSystem.origin must be top-left.`)
      if (coordinateSystem.units !== 'logical-pixels')
        input.issues.push(`${input.path}: 2D coordinateSystem.units must be logical-pixels.`)
      for (const field of ['width', 'height', 'pixelsPerUnit'])
        if (!(typeof coordinateSystem[field] === 'number' && Number.isFinite(coordinateSystem[field]) && coordinateSystem[field] > 0))
          input.issues.push(`${input.path}: 2D coordinateSystem.${field} must be a positive number.`)
    }
  }
  if (input.document.data.cameraNodeId) {
    const camera = input.document.data.nodes.find(
      node => node.id === input.document.data.cameraNodeId,
    )
    if (camera && !camera.components?.some(component => component.type === 'camera'))
      input.issues.push(
        `${input.path}: cameraNodeId must reference a GameObject with Camera (${camera.id}).`,
      )
  }
}

/** Reuse production structure rules for an unbound planning source. Only
 * unavailable resource bindings are deferred; geometry/component rules stay. */
export function sceneLayoutDraftIssues(path: string, document: Extract<BeeGameContentDocument, { kind: 'scene-2d' | 'scene-3d' }>) {
  const issues: string[] = []
  validateTree({ path, nodes: document.data.nodes, issues })
  validateNoLegacyScriptFields(path, document.data, issues, ['data'])
  validateComponentScene({ path, document, issues, bindingsPending: true })
  if (document.data.cameraNodeId && !document.data.nodes.some(node => node.id === document.data.cameraNodeId))
    issues.push(path + ': cameraNodeId does not resolve: ' + document.data.cameraNodeId)
  validateNoResourcePathBypass(path, document.data, issues)
  return issues
}

/** Save-time structural feedback reuses production rules, without requiring
 * resources, an index, finished prose or a semantic verdict. */
export function contentDraftStructureIssues(path: string, document: BeeGameContentDocument) {
  if (document.kind === 'scene-2d' || document.kind === 'scene-3d') return sceneLayoutDraftIssues(path, document)
  const issues: string[] = []
  validateTree({ path, nodes: document.data.nodes,
    ...('rootId' in document.data ? { rootId: document.data.rootId } : {}), issues })
  if (document.kind === 'ui-screen' || document.kind === 'ui-hud' || document.kind === 'ui-flow')
    validateUiVocabulary({ path, document, issues, bindingsPending: true })
  validateNoResourcePathBypass(path, document.data, issues)
  return issues
}

export function validateContentDocument(input: {
  workspacePath: string
  path: string
  document: BeeGameContentDocument
  authority: BeeGameContentAuthority
  issues: string[]
}): void {
  const resourceById = new Map(
    input.authority.manifest.resources.map(resource => [resource.id, resource]),
  )
  for (const id of input.document.assetRefs) {
    const resource = resourceById.get(id)
    if (!resource) input.issues.push(`${input.path}: unknown asset ${id}.`)
    else if (resource.status !== 'verified')
      input.issues.push(`${input.path}: asset is not verified: ${id}.`)
  }
  const declaredAssets = new Set(input.document.assetRefs)
  validateDeclaredAssetReferences(
    input.path,
    input.document.data,
    declaredAssets,
    input.issues,
  )
  validateAssetMembers(
    input.path,
    input.document.data,
    input.authority.manifest,
    input.issues,
  )
  if (input.document.kind === 'scene-2d' || input.document.kind === 'scene-3d')
    validateNoLegacyScriptFields(input.path, input.document.data, input.issues, ['data'])
  validateTree({
    path: input.path,
    nodes: input.document.data.nodes,
    ...(input.document.kind === 'ui-screen' ||
      input.document.kind === 'ui-hud' ||
      input.document.kind === 'ui-flow'
      ? { rootId: input.document.data.rootId }
      : {}),
    issues: input.issues,
  })
  if (
    input.document.kind === 'ui-screen' ||
    input.document.kind === 'ui-hud' ||
    input.document.kind === 'ui-flow'
  ) {
    validateUiVocabulary({
      path: input.path,
      document: input.document,
      issues: input.issues,
    })
    try {
      const document = input.document
      for (const issue of readUiLayoutCameras(input.workspacePath, document).flatMap(options => auditUiInteractiveBounds(document, options)))
        input.issues.push(`${input.path}: ${issue}`)
    } catch (error) { input.issues.push(`${input.path}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  if (input.document.kind === 'scene-2d' || input.document.kind === 'scene-3d') {
    const cameraNodeId = input.document.data.cameraNodeId
    if (
      cameraNodeId &&
      !input.document.data.nodes.some(node => node.id === cameraNodeId)
    )
      input.issues.push(
        `${input.path}: cameraNodeId does not resolve: ${cameraNodeId}.`,
      )
    validateComponentScene({
      path: input.path,
      document: input.document,
      issues: input.issues,
    })
  }
  validateNoResourcePathBypass(input.path, input.document.data, input.issues)
}

const validateDocument = validateContentDocument

export function auditBeeGameContentPackage(
  workspacePath: string,
  authority: BeeGameContentAuthority,
): BeeGameContentPackageAudit {
  const issues: string[] = []
  const workspace = resolve(workspacePath)
  const root = resolve(workspace, BEEGAME_CONTENT_ROOT)
  const assetAudit = auditAssetContract(workspace)
  if (assetAudit.present) issues.push(...assetAudit.issues)
  const indexPath = resolve(workspace, BEEGAME_CONTENT_INDEX)
  if (!existsSync(indexPath) || !statSync(indexPath).isFile())
    return { valid: false, issues: [`Missing ${BEEGAME_CONTENT_INDEX}.`] }

  let index: BeeGameContentIndex
  try {
    index = contentIndexSchema.parse(parseJson(indexPath))
  } catch (error) {
    return {
      valid: false,
      issues: [
        `${BEEGAME_CONTENT_INDEX}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }
  if (authority.documentRevision !== undefined && index.documentRevision !== authority.documentRevision)
    issues.push(`${BEEGAME_CONTENT_INDEX}: documentRevision does not match the supplied source revision. Refresh the index metadata from current saved inputs before building/measuring; if sources change again, the previous build/evidence is not current.`)
  if (authority.assetManifestRevision !== undefined && index.assetManifestRevision !== authority.assetManifestRevision)
    issues.push(
      `${BEEGAME_CONTENT_INDEX}: assetManifestRevision does not match the supplied Manifest revision. Refresh the index metadata from the actual saved Manifest before building/measuring.`,
    )
  const documents: BeeGameContentDocument[] = []
  const documentPathById = new Map<string, string>()
  const documentPaths = new Set(index.files)
  const actualPaths = existsSync(root)
    ? listJsonFiles(root).filter(path => path !== 'index.json')
    : []
  for (const path of actualPaths)
    if (!documentPaths.has(path))
      issues.push(`${BEEGAME_CONTENT_INDEX}: unregistered content file ${path}.`)

  for (const path of index.files) {
    const absolute = safeContentFile(workspace, path)
    if (!absolute) {
      issues.push(`${BEEGAME_CONTENT_INDEX}: unsafe content path ${path}.`)
      continue
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      issues.push(`${BEEGAME_CONTENT_INDEX}: missing content file ${path}.`)
      continue
    }
    let document: BeeGameContentDocument
    try {
      document = contentDocumentSchema.parse(parseJson(absolute))
    } catch (error) {
      issues.push(
        `${BEEGAME_CONTENT_ROOT}/${path}: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }
    const wrongDirectory =
      ((document.kind === 'scene-2d' || document.kind === 'scene-3d') && !path.startsWith('scenes/')) ||
      (document.kind === 'vfx' && !path.startsWith('vfx/')) ||
      (document.kind !== 'scene-2d' && document.kind !== 'scene-3d' &&
        document.kind !== 'vfx' &&
        !path.startsWith('ui/'))
    if (wrongDirectory)
      issues.push(`${BEEGAME_CONTENT_ROOT}/${path}: kind is stored in the wrong directory.`)
    validateDocument({
      workspacePath,
      path: `${BEEGAME_CONTENT_ROOT}/${path}`,
      document,
      authority,
      issues,
    })
    documentPathById.set(document.id, path)
    if (document.kind === 'scene-2d' || document.kind === 'scene-3d') {
      for (const node of document.data.nodes) for (const component of node.components ?? []) {
        if (component.type !== 'tilemap' || !component.assetRef) continue
        try {
          const map = parseTilemapData(component.data)
          const tileset = readTileSetResource(workspace, authority.manifest, component.assetRef, map.member)
          for (const cell of map.cells) if (!Object.hasOwn(tileset.tiles, cell.tileId))
            throw Error(`Missing tile ${cell.tileId} at [${cell.x},${cell.y}]`)
        } catch (error) { issues.push(`${path}: Tilemap ${node.id}: ${String(error)}`) }
      }
    }
    documents.push(document)
  }

  const ids = new Set<string>()
  for (const document of documents) {
    if (ids.has(document.id)) issues.push(`Duplicate content id: ${document.id}.`)
    ids.add(document.id)
  }
  if (index.documents) {
    const registryIds = new Set<string>()
    const registryPaths = new Set<string>()
    for (const entry of index.documents) {
      if (registryIds.has(entry.id)) issues.push(`${BEEGAME_CONTENT_INDEX}: duplicate document registry id ${entry.id}.`)
      if (registryPaths.has(entry.path)) issues.push(`${BEEGAME_CONTENT_INDEX}: duplicate document registry path ${entry.path}.`)
      registryIds.add(entry.id)
      registryPaths.add(entry.path)
      if (!index.files.includes(entry.path))
        issues.push(`${BEEGAME_CONTENT_INDEX}: document registry path is not listed in files: ${entry.path}.`)
      const document = documents.find(value => value.id === entry.id)
      if (!document) issues.push(`${BEEGAME_CONTENT_INDEX}: document registry id does not resolve: ${entry.id}.`)
      else {
        if (document.kind !== entry.kind)
          issues.push(`${BEEGAME_CONTENT_INDEX}: document registry kind mismatch for ${entry.id}.`)
        const actualPath = documentPathById.get(entry.id)
        if (actualPath !== entry.path)
          issues.push(`${BEEGAME_CONTENT_INDEX}: document registry path mismatch for ${entry.id}.`)
      }
    }
    for (const path of index.files)
      if (!registryPaths.has(path)) issues.push(`${BEEGAME_CONTENT_INDEX}: file is missing from document registry: ${path}.`)
    const entryScene = index.documents.find(value => value.id === index.entryScene)
    if (entryScene && entryScene.loadPhase !== 'startup')
      issues.push(`${BEEGAME_CONTENT_INDEX}: entryScene must use startup loadPhase.`)
  }
  const entry = documents.find(document => document.id === index.entryScene)
  if (!entry) issues.push(`Entry scene does not resolve: ${index.entryScene}.`)
  else if (!isContentEntryKind(entry.kind, index.dimension))
    issues.push(`Entry content must be scene-${index.dimension}, ui-screen or ui-hud: ${index.entryScene}.`)

  if (issues.length) return { valid: false, issues }
  const value = { index, documents }
  return {
    valid: true,
    issues: [],
    package: Object.freeze({ ...value, digest: digest(value) }),
  }
}
