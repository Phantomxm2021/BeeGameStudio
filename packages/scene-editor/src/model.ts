export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]
export interface Transform { position: Vec3; rotation: Vec3; quaternion?: Quat; scale: Vec3 }
export interface MaterialOverride { mode: 'standard' | 'unlit'; color: string; metalness: number; roughness: number; opacity: number; alphaMode: 'opaque' | 'mask' | 'blend'; textureAssetId?: string; textureRegion?: { x: number; y: number; width: number; height: number } }
export type LightKind = 'ambient' | 'directional' | 'point' | 'spot'
export interface LightData { kind: LightKind; color: string; intensity: number; alpha?: number; distance?: number; angle?: number; penumbra?: number }

type ComponentBase<T extends string> = { id: string; type: T; enabled: boolean }
export type SpriteRendererComponent = ComponentBase<'sprite-renderer'> & { assetId: string; member?: string; material: MaterialOverride; frame?: { x: number; y: number; width: number; height: number }; animation?: { frameWidth: number; frameHeight: number; framesPerFacing: number; facings?: string[]; initialFacing?: string; frameDurationMs?: number[]; loop?: boolean }; properties: Record<string, unknown> }
export type MeshFilterComponent = ComponentBase<'mesh-filter'> & { assetId: string; member?: string; properties: Record<string, unknown> }
export type MeshRendererComponent = ComponentBase<'mesh-renderer'> & { assetId?: string; material: MaterialOverride; properties: Record<string, unknown> }
export type SkinnedMeshRendererComponent = ComponentBase<'skinned-mesh-renderer'> & { assetId: string; member?: string; material: MaterialOverride; properties: Record<string, unknown> }
export type GridComponent = ComponentBase<'grid'> & { properties: Record<string, unknown> }
export type TilemapComponent = ComponentBase<'tilemap'> & { assetId: string; member?: string; properties: Record<string, unknown> }
export type TilemapRendererComponent = ComponentBase<'tilemap-renderer'> & { properties: Record<string, unknown> }
export type AnimatorComponent = ComponentBase<'animator'> & { assetId?: string; controller: Record<string, unknown> }
export type BoxCollider2DComponent = ComponentBase<'box-collider-2d'> & { size: Vec2; offset: Vec2; isTrigger: boolean }
export type CircleCollider2DComponent = ComponentBase<'circle-collider-2d'> & { radius: number; offset: Vec2; isTrigger: boolean }
export type CapsuleCollider2DComponent = ComponentBase<'capsule-collider-2d'> & { size: Vec2; offset: Vec2; direction: 'horizontal' | 'vertical'; isTrigger: boolean }
export type PolygonCollider2DComponent = ComponentBase<'polygon-collider-2d'> & { points: Vec2[]; offset: Vec2; isTrigger: boolean }
export type Rigidbody2DComponent = ComponentBase<'rigidbody-2d'> & { bodyType: 'dynamic' | 'kinematic' | 'static'; properties: Record<string, unknown> }
export type BoxColliderComponent = ComponentBase<'box-collider'> & { size: Vec3; center: Vec3; isTrigger: boolean }
export type SphereColliderComponent = ComponentBase<'sphere-collider'> & { radius: number; center: Vec3; isTrigger: boolean }
export type CapsuleColliderComponent = ComponentBase<'capsule-collider'> & { radius: number; height: number; direction: 'x' | 'y' | 'z'; center: Vec3; isTrigger: boolean }
export type MeshColliderComponent = ComponentBase<'mesh-collider'> & { assetId?: string; convex: boolean; isTrigger: boolean; properties: Record<string, unknown> }
export type RigidbodyComponent = ComponentBase<'rigidbody'> & { isKinematic: boolean; useGravity: boolean; mass: number; properties: Record<string, unknown> }
export type AudioSourceComponent = ComponentBase<'audio-source'> & { assetId?: string; properties: Record<string, unknown> }
export type AudioListenerComponent = ComponentBase<'audio-listener'> & { properties: Record<string, unknown> }
export type ParticleSystemComponent = ComponentBase<'particle-system'> & { properties: Record<string, unknown> }
export type ParticleSystemRendererComponent = ComponentBase<'particle-system-renderer'> & { assetId?: string; textureAssetId?: string; material: MaterialOverride; properties: Record<string, unknown> }
export type Light2DComponent = ComponentBase<'light-2d'> & { light: LightData; properties: Record<string, unknown> }
export type LightComponent = ComponentBase<'light'> & { light: LightData; properties: Record<string, unknown> }
export type CameraComponent = ComponentBase<'camera'> & { orthographic: boolean; orthographicSize?: number; nearClip?: number; farClip?: number; properties: Record<string, unknown> }
export type CanvasComponent = ComponentBase<'canvas'> & { renderMode: 'screen-space-overlay' | 'screen-space-camera' | 'world-space'; properties: Record<string, unknown> }
export type CanvasRendererComponent = ComponentBase<'canvas-renderer'> & { properties: Record<string, unknown> }
/** Unity RectTransform data for UI GameObjects. Coordinates are expressed in the
 * same editor units as Transform; anchors/pivot are normalized in the parent rect. */
export type RectTransformComponent = ComponentBase<'rect-transform'> & {
  anchorMin: Vec2
  anchorMax: Vec2
  pivot: Vec2
  anchoredPosition: Vec2
  sizeDelta: Vec2
  properties: Record<string, unknown>
}
export type ImageComponent = ComponentBase<'image'> & { assetId?: string; member?: string; material: MaterialOverride; properties: Record<string, unknown> }
/** Text is an authoring component.  A font reference is kept separately from
 * free-form properties so viewport/editor code can load the same authored font
 * as the UI renderer without inventing a second text format. */
export type TextComponent = ComponentBase<'text'> & { text: string; fontAssetId?: string; properties: Record<string, unknown> }
export type Collider2DComponent = BoxCollider2DComponent | CircleCollider2DComponent | CapsuleCollider2DComponent | PolygonCollider2DComponent
export type Collider3DComponent = BoxColliderComponent | SphereColliderComponent | CapsuleColliderComponent | MeshColliderComponent
export type SceneComponent = SpriteRendererComponent | MeshFilterComponent | MeshRendererComponent | SkinnedMeshRendererComponent | GridComponent | TilemapComponent | TilemapRendererComponent | AnimatorComponent | Collider2DComponent | Rigidbody2DComponent | Collider3DComponent | RigidbodyComponent | AudioSourceComponent | AudioListenerComponent | ParticleSystemComponent | ParticleSystemRendererComponent | Light2DComponent | LightComponent | CameraComponent | CanvasComponent | CanvasRendererComponent | RectTransformComponent | ImageComponent | TextComponent

export interface SceneGameObject { id: string; name: string; parentId: string | null; children: string[]; active: boolean; locked: boolean; editable?: boolean; transform: Transform; layer?: string; order?: number; tags: string[]; components: SceneComponent[]; metadata?: Record<string, unknown>; source?: { irId?: string; occurrenceId?: string } }
export type SceneNode = SceneGameObject
export type SpriteSheet = { frames: Record<string, { x: number; y: number; width: number; height: number }> } | { frameWidth: number; frameHeight: number; framesPerFacing?: number; facings?: string[]; states?: string[]; frameDurationMs?: number[] }
export interface SceneAsset { resourceId?: string; tileSet?: import('./tilemap-data').TileSetData; spriteSheet?: SpriteSheet; id: string; name: string; mimeType: string; path: string; bytes?: string; uri?: string; dependencies?: string[]; diagnostics?: string[] }
export interface SourceBinding { source: { kind: 'fixture'; fixtureId: string; fixtureDigest: string } | { kind: 'published-ir' | 'content-package'; publicationId: string; candidateDigest: string; sourceInputDigest: string }; contentDigest: string; contentRevision: string; contentSchemaVersion: string; adapterId: string; adapterVersion: string }
export interface SceneSettings { background: string; showGrid: boolean; ambientColor: string; ambientIntensity: number; exposure: number; fogEnabled: boolean; fogColor: string; fogNear: number; fogFar: number; selectionColor?: string; selectionWidth?: number }
export const DEFAULT_SCENE_SETTINGS: Readonly<SceneSettings> = { background: '#3c3f43', showGrid: true, ambientColor: '#ffffff', ambientIntensity: .2, exposure: 1, fogEnabled: false, fogColor: '#3c3f43', fogNear: 10, fogFar: 60, selectionColor: '#ffad46', selectionWidth: 3 }
export interface SceneDocument { pixelsPerUnit?: number; schemaVersion: 'scene-game-object.v2'; dimension: '2d' | '3d'; id: string; name: string; settings?: SceneSettings; revision: number; source: SourceBinding; rootIds: string[]; nodes: Record<string, SceneGameObject>; assets: Record<string, SceneAsset>; diagnostics: string[]; appliedTransactions?: Record<string, string> }

export type SceneOperation =
  | { type: 'scene.configure'; name: string; settings?: SceneSettings; expectedName?: string; expectedSettings?: SceneSettings | null }
  | { type: 'scene.renameGameObject'; nodeId: string; name: string; expectedName?: string }
  | { type: 'scene.setActive'; nodeId: string; active: boolean; expectedActive?: boolean }
  | { type: 'scene.setLocked'; nodeId: string; locked: boolean; expectedLocked?: boolean }
  | { type: 'scene.setTransform'; nodeId: string; transform: Transform; expectedTransform?: Transform }
  | { type: 'scene.addGameObject'; node: SceneGameObject; index?: number; expectedParentExists?: boolean }
  | { type: 'scene.removeGameObject'; nodeId: string; expectedExists?: boolean }
  | { type: 'scene.reparent'; nodeId: string; parentId: string | null; index?: number; expectedParentId?: string | null }
  | { type: 'scene.setComponent'; nodeId: string; component: SceneComponent; expectedComponent?: SceneComponent | null }
  | { type: 'scene.setTileCells'; nodeId: string; componentId: string; changes: Array<{ x: number; y: number; tileId: string | null; expectedTileId: string | null; index?: number }> }
  | { type: 'scene.removeComponent'; nodeId: string; componentId: string; expectedComponent?: SceneComponent }
  | { type: 'scene.addAsset'; asset: SceneAsset }
  | { type: 'scene.removeAsset'; assetId: string; expectedExists?: boolean }
export interface ScenePatchV1 { schemaVersion: 'scene-patch.v2'; domain: 'scene'; operationSchemaVersion: 'scene-game-object-operations.v1'; transactionId: string; documentId: string; base: SourceBinding; origin: 'human' | 'agent' | 'import'; label: string; operations: SceneOperation[] }
export interface ApplyResult { document: SceneDocument; inverse: SceneOperation[]; applied: boolean; diagnostic?: string }

export const clone = <T>(value: T): T => structuredClone(value)
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export const identityTransform = (): Transform => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })
export const newId = (prefix = 'game-object') => `${prefix}-${crypto.randomUUID()}`
export const componentOf = <T extends SceneComponent['type']>(node: SceneGameObject, type: T): Extract<SceneComponent, { type: T }> | undefined => node.components.find(component => component.type === type) as Extract<SceneComponent, { type: T }> | undefined
export const componentById = (node: SceneGameObject, id: string): SceneComponent | undefined => node.components.find(component => component.id === id)
export const primaryComponentType = (node: SceneGameObject): SceneComponent['type'] | 'transform' => ['camera', 'particle-system', 'sprite-renderer', 'skinned-mesh-renderer', 'mesh-renderer', 'tilemap-renderer', 'image', 'light-2d', 'light', 'audio-source', 'box-collider-2d', 'circle-collider-2d', 'box-collider', 'sphere-collider', 'rigidbody-2d', 'rigidbody', 'animator'].find(type => node.components.some(component => component.type === type)) as SceneComponent['type'] | undefined ?? 'transform'

export function makeFixture(): SceneDocument {
  const nodes: Record<string, SceneGameObject> = {}
  const add = (id: string, name: string, parentId: string | null, transform: Partial<Transform> = {}, components: SceneComponent[] = []) => { nodes[id] = { id, name, parentId, children: [], active: true, locked: false, transform: { ...identityTransform(), ...transform }, tags: [], components }; if (parentId) nodes[parentId].children.push(id) }
  add('root', 'Bee Meadow', null)
  add('hive', 'Hive', 'root', { position: [-1.7, .7, 0] }, [{ id: 'hive-collider', type: 'box-collider-2d', enabled: true, size: [1.2, 1.4], offset: [0, 0], isTrigger: false }])
  add('flower', 'Flower', 'root', { position: [1.4, 1.2, 0] })
  add('sun', 'Sun', 'root', { position: [3, 5, 2] }, [{ id: 'sun-light', type: 'light-2d', enabled: true, light: { kind: 'directional', color: '#fff2d5', intensity: 2 }, properties: {} }])
  add('camera', 'Main Camera', 'root', { position: [0, 0, -10] }, [{ id: 'camera', type: 'camera', enabled: true, orthographic: true, properties: {} }, { id: 'listener', type: 'audio-listener', enabled: true, properties: {} }])
  return { schemaVersion: 'scene-game-object.v2', dimension: '2d', id: 'scene-fixture-meadow', name: 'Bee Meadow', revision: 1, source: { source: { kind: 'fixture', fixtureId: 'bee-meadow-v2', fixtureDigest: '14102e86a257b500fe8b4bc17f3048b089965c2000fb8aa945f6a094eb6fe679' }, contentDigest: '6bbbeb1e8318a6d79dfb9592b56f824800fc184c345c94e4c769dcf03bc543a6', contentRevision: '1', contentSchemaVersion: 'beegame-content-v1', adapterId: 'unity-game-object-components', adapterVersion: '2.0.0' }, rootIds: ['root'], nodes, assets: {}, diagnostics: [] }
}
