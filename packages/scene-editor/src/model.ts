export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]
export type PrimitiveKind = 'empty' | 'box' | 'sphere' | 'plane' | 'model' | 'light'
export type LightKind = 'ambient' | 'directional' | 'point' | 'spot'
export type VolumeShape = 'box' | 'sphere' | 'capsule'

export interface Transform { position: Vec3; rotation: Vec3; quaternion?: Quat; scale: Vec3 }
export interface MaterialOverride {
  mode: 'standard' | 'unlit'; color: string; metalness: number; roughness: number
  opacity: number; alphaMode: 'opaque' | 'mask' | 'blend'; textureAssetId?: string
}
export interface LightData { kind: LightKind; color: string; intensity: number; distance?: number; angle?: number; penumbra?: number }
export interface VolumeVisual { role: 'collider' | 'trigger'; shape: VolumeShape; size: Vec3; offset: Vec3; rotation: Vec3 }

export interface SceneNode {
  id: string; name: string; kind: PrimitiveKind; parentId: string | null; children: string[]
  visible: boolean; locked: boolean; editable?: boolean; transform: Transform; source?: { irId?: string; occurrenceId?: string }
  material?: MaterialOverride; light?: LightData; volume?: VolumeVisual; assetId?: string
  /** Kept through round trips so adapters never erase content they do not own. */
  unknown?: Record<string, unknown>
}
export interface SceneAsset { id: string; name: string; mimeType: string; path: string; bytes?: string; dependencies?: string[]; diagnostics?: string[] }
export interface SourceBinding {
  source: { kind: 'fixture'; fixtureId: string; fixtureDigest: string } | { kind: 'published-ir'; publicationId: string; candidateDigest: string; sourceInputDigest: string }
  contentDigest: string; contentRevision: string; contentSchemaVersion: string; adapterId: string; adapterVersion: string
}
export interface SceneSettings {
  background: string
  showGrid: boolean
  ambientColor: string
  ambientIntensity: number
  exposure: number
  fogEnabled: boolean
  fogColor: string
  fogNear: number
  fogFar: number
  selectionColor?: string
  selectionWidth?: number
}
export const DEFAULT_SCENE_SETTINGS: Readonly<SceneSettings> = {
  background: '#3c3f43', showGrid: true, ambientColor: '#ffffff', ambientIntensity: .2,
  exposure: 1, fogEnabled: false, fogColor: '#3c3f43', fogNear: 10, fogFar: 60,
  selectionColor: '#ffad46', selectionWidth: 3,
}

export interface SceneDocument { schemaVersion: 'scene-authoring.v1'; id: string; name: string; settings?: SceneSettings; revision: number; source: SourceBinding; rootIds: string[]; nodes: Record<string, SceneNode>; assets: Record<string, SceneAsset>; diagnostics: string[]; appliedTransactions?: Record<string, string>; unknown?: Record<string, unknown> }

export type SceneOperation =
  | { type: 'scene.configure'; name: string; settings?: SceneSettings; expectedName?: string; expectedSettings?: SceneSettings | null }
  | { type: 'scene.renameNode'; nodeId: string; name: string; expectedName?: string }
  | { type: 'scene.setVisibility'; nodeId: string; visible: boolean; expectedVisible?: boolean }
  | { type: 'scene.setLocked'; nodeId: string; locked: boolean; expectedLocked?: boolean }
  | { type: 'scene.setTransform'; nodeId: string; transform: Transform; expectedTransform?: Transform }
  | { type: 'scene.addNode'; node: SceneNode; index?: number; expectedParentExists?: boolean }
  | { type: 'scene.removeNode'; nodeId: string; expectedExists?: boolean }
  | { type: 'scene.reparent'; nodeId: string; parentId: string | null; index?: number; expectedParentId?: string | null }
  | { type: 'scene.setMaterialOverride'; nodeId: string; material?: MaterialOverride; expectedMaterial?: MaterialOverride }
  | { type: 'scene.setLight'; nodeId: string; light?: LightData; expectedLight?: LightData }
  | { type: 'scene.setVolumeVisual'; nodeId: string; volume?: VolumeVisual; expectedVolume?: VolumeVisual }
  | { type: 'scene.addAsset'; asset: SceneAsset }
  | { type: 'scene.removeAsset'; assetId: string; expectedExists?: boolean }

export interface ScenePatchV1 {
  schemaVersion: 'scene-patch.v1'; domain: 'scene-3d'; operationSchemaVersion: 'scene-operations.v1'
  transactionId: string; documentId: string; base: SourceBinding; origin: 'human' | 'agent' | 'import'; label: string; operations: SceneOperation[]
}
export interface ApplyResult { document: SceneDocument; inverse: SceneOperation[]; applied: boolean; diagnostic?: string }

export const clone = <T>(value: T): T => structuredClone(value)
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export const identityTransform = (): Transform => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })
export const newId = (prefix = 'node') => `${prefix}-${crypto.randomUUID()}`

export function makeFixture(): SceneDocument {
  const nodes: Record<string, SceneNode> = {}
  const add = (id: string, name: string, kind: PrimitiveKind, parentId: string | null, transform: Partial<Transform> = {}, extra: Partial<SceneNode> = {}) => {
    nodes[id] = { id, name, kind, parentId, children: [], visible: true, locked: false, transform: { ...identityTransform(), ...transform }, ...extra }
    if (parentId) nodes[parentId].children.push(id)
  }
  add('root', 'Bee Meadow', 'empty', null)
  add('ground', 'Ground Plane', 'plane', 'root', { scale: [8, 1, 8] }, { material: { mode: 'standard', color: '#3f6f44', metalness: 0, roughness: 1, opacity: 1, alphaMode: 'opaque' } })
  add('hive', 'Hive Box', 'box', 'root', { position: [-1.7, 0.7, 0] }, { material: { mode: 'standard', color: '#d5a332', metalness: 0, roughness: .65, opacity: 1, alphaMode: 'opaque' }, volume: { role: 'collider', shape: 'box', size: [1.2, 1.4, 1.2], offset: [0, 0, 0], rotation: [0, 0, 0] } })
  add('flower', 'Flower Sphere', 'sphere', 'root', { position: [1.4, .55, .4], scale: [.55, .55, .55] }, { material: { mode: 'standard', color: '#df668d', metalness: .1, roughness: .4, opacity: 1, alphaMode: 'opaque' }, volume: { role: 'trigger', shape: 'sphere', size: [1.4, 1.4, 1.4], offset: [0, 0, 0], rotation: [0, 0, 0] } })
  add('sun', 'Sun Light', 'light', 'root', { position: [3, 5, 2] }, { light: { kind: 'directional', color: '#fff2d5', intensity: 2 } })
  add('fill', 'Fill Light', 'light', 'root', { position: [-3, 2, 2] }, { light: { kind: 'point', color: '#b9d9ff', intensity: 8, distance: 12 } })
  return { schemaVersion: 'scene-authoring.v1', id: 'scene-fixture-meadow', name: 'Bee Meadow', revision: 1, source: { source: { kind: 'fixture', fixtureId: 'bee-meadow-v1', fixtureDigest: '14102e86a257d500fe8b4bc17f3048b089965c2000fb8aa945f6a094eb6fe679' }, contentDigest: 'd18c4c7e5a78b9bb664701a2722979d7ae2b4ec320d4d750d51ef8cc0fc9c441', contentRevision: '1', contentSchemaVersion: 'beegame-content-v1', adapterId: 'three-scene-v1', adapterVersion: '1.0.0' }, rootIds: ['root'], nodes, assets: {}, diagnostics: [] }
}
