import { spriteSheetSelection, parseGridData, parseTilemapData, parseTilemapRendererData, validateTilemapGrid } from '@beegame/scene-editor';
import type { MaterialOverride, SceneAsset, SceneComponent, SceneDocument, SceneNode, Transform } from '@beegame/scene-editor';
import type { BeeGameContentNode, BeeGameSceneContentDocument } from '../../services/beeGameAdapter';

const PIXELS_PER_EDITOR_UNIT = 100;
type CanvasMetrics = { width: number; height: number; pixelsPerUnit: number };
type CanonicalComponent = NonNullable<BeeGameContentNode['components']>[number];

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const finite = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const sourceAssetId = (assetId?: string): string | undefined => assetId?.split(':', 1)[0];
const componentData = (component: CanonicalComponent): Record<string, unknown> => structuredClone(component.data ?? {});
const vec2 = (value: unknown, fallback: [number, number]): [number, number] => Array.isArray(value) ? [finite(value[0], fallback[0]), finite(value[1], fallback[1])] : [finite(record(value)?.x, fallback[0]), finite(record(value)?.y, fallback[1])];
const vec3 = (value: unknown, fallback: [number, number, number]): [number, number, number] => Array.isArray(value) ? [finite(value[0], fallback[0]), finite(value[1], fallback[1]), finite(value[2], fallback[2])] : [finite(record(value)?.x, fallback[0]), finite(record(value)?.y, fallback[1]), finite(record(value)?.z, fallback[2])];

function canvasMetrics(settings?: Record<string, unknown>): CanvasMetrics {
  const coordinateSystem = record(settings?.coordinateSystem);
  const camera = record(settings?.camera);
  const viewport = record(camera?.viewport);
  const width = Math.max(1, finite(coordinateSystem?.width, finite(viewport?.width, 1280)));
  const height = Math.max(1, finite(coordinateSystem?.height, finite(viewport?.height, 720)));
  const pixelsPerUnit = Math.max(.0001, finite(coordinateSystem?.pixelsPerUnit, PIXELS_PER_EDITOR_UNIT));
  return { width, height, pixelsPerUnit };
}

function layerOrders(settings?: Record<string, unknown>): Map<string, number> {
  if (!Array.isArray(settings?.layers)) return new Map();
  return new Map(settings.layers.flatMap((item, index) => { const layer = record(item); return typeof layer?.id === 'string' ? [[layer.id, finite(layer.order, index + 1)] as const] : []; }));
}

function editorTransform(node: BeeGameContentNode, dimension: '2d' | '3d', layers: Map<string, number>, metrics: CanvasMetrics): Transform {
  const position = node.transform?.position ?? [0, 0, 0];
  const rotation = node.transform?.rotation ?? [0, 0, 0];
  const scale = node.transform?.scale ?? [1, 1, 1];
  if (dimension === '3d') return { position: [...position], rotation: [...rotation], scale: [...scale] };
  const rootOffsetX = node.parentId ? 0 : metrics.width / 2;
  const rootOffsetY = node.parentId ? 0 : metrics.height / 2;
  const layerDepth = (node.zIndex ?? (node.layer ? layers.get(node.layer) ?? 0 : 0)) * .01;
  return {
    // Canonical 2D scenes use top-left logical pixels; the editor uses a
    // centered, y-up world. Parent transforms remain local pixel offsets.
    position: [(position[0] - rootOffsetX) / metrics.pixelsPerUnit, (rootOffsetY - position[1]) / metrics.pixelsPerUnit, position[2] / metrics.pixelsPerUnit + layerDepth],
    rotation: [-rotation[0], rotation[1], -rotation[2]],
    // Renderer dimensions are geometry, not Transform scale. Keeping them
    // separate prevents child GameObjects inheriting a parent's sprite size.
    scale: [...scale],
  };
}

function explicitMember(data: Record<string, unknown>): string | undefined {
  return typeof data.member === 'string' ? data.member : undefined;
}

function resolveAssetId(resourceId: string | undefined, data: Record<string, unknown>, members?: Record<string, Record<string, string>>): string | undefined {
  if (!resourceId) return undefined;
  const options = members?.[resourceId] ?? {}; const explicit = explicitMember(data);
  if (explicit && options[explicit]) return options[explicit];
  return resourceId;
}

function material(data: Record<string, unknown>, assetId?: string): MaterialOverride {
  const source = record(data.material); const color = typeof source?.color === 'string' ? source.color : typeof data.color === 'string' ? data.color : '#ffffff';
  return { mode: source?.mode === 'standard' ? 'standard' : 'unlit', color, metalness: finite(source?.metalness, 0), roughness: finite(source?.roughness, 1), opacity: Math.min(1, Math.max(0, finite(source?.opacity, finite(data.opacity, finite(data.alpha, 1))))), alphaMode: ['opaque', 'mask', 'blend'].includes(String(source?.alphaMode)) ? source?.alphaMode as MaterialOverride['alphaMode'] : 'blend', ...(assetId ? { textureAssetId: assetId } : {}) };
}

export function lightData(data: Record<string, unknown>, pixelsPerUnit = 1) {
  const sourceKind = typeof data.kind === 'string' ? data.kind : data.lightType;
  const kind = ['ambient', 'directional', 'point', 'spot'].includes(String(sourceKind)) ? sourceKind as 'ambient' | 'directional' | 'point' | 'spot' : 'point';
  const colors = record(data.colors);
  const color = typeof data.color === 'string' ? data.color : typeof colors?.calm === 'string' ? colors.calm : '#ffffff';
  const intensity = finite(data.intensity, finite(data.strength, 1));
  const alpha = typeof data.alpha === 'number' ? data.alpha : typeof colors?.calmAlpha === 'number' ? colors.calmAlpha : undefined;
  const sourceDistance = typeof data.distance === 'number' ? data.distance : typeof data.range === 'number' ? data.range : undefined;
  // Canonical 2D measurements are logical pixels; editor lights use world units.
  const distance = sourceDistance === undefined ? undefined : sourceDistance / pixelsPerUnit;
  const angle = typeof data.angle === 'number' ? data.angle : typeof data.halfAngleDeg === 'number' ? data.halfAngleDeg * Math.PI / 180 : undefined;
  return { kind, color, intensity, ...(alpha === undefined ? {} : { alpha }), ...(distance === undefined ? {} : { distance }), ...(angle === undefined ? {} : { angle }), ...(typeof data.penumbra === 'number' ? { penumbra: data.penumbra } : {}) };
}

function editorParticleProperties(data: Record<string, unknown>, _metrics: CanvasMetrics): Record<string, unknown> {
  const zone = record(data.zone);
  if (!zone) return data;
  const width = finite(zone.width, 0); const height = finite(zone.height, 0);
  // Particle zones are local to their GameObject. The GameObject transform
  // already converts the canonical top-left origin into editor world space;
  // applying the canvas offset here as well moved the emitter twice.
  return { ...data, zone: { ...zone, x: finite(zone.x, 0), y: -finite(zone.y, 0) - height, width, height } };
}

function canonicalParticleProperties(data: Record<string, unknown>, _metrics: CanvasMetrics): Record<string, unknown> {
  const zone = record(data.zone);
  if (!zone) return data;
  const width = finite(zone.width, 0); const height = finite(zone.height, 0);
  return { ...data, zone: { ...zone, x: finite(zone.x, 0), y: -finite(zone.y, 0) - height, width, height } };
}

function toEditorComponent(input: { node: BeeGameContentNode; component: CanonicalComponent; dimension: '2d' | '3d'; metrics: CanvasMetrics; members?: Record<string, Record<string, string>>; assets?: Record<string, SceneAsset> }): SceneComponent {
  const { node, component, metrics } = input; const id = component.id; if (!id) throw new Error(`Component ${node.id} is missing persistent id`); const data = componentData(component); const enabled = data.enabled !== false;
  const resourceId = component.assetRef; const assetId = resolveAssetId(resourceId, data, input.members); const member = assetId?.includes(':') ? assetId.slice(assetId.indexOf(':') + 1) : explicitMember(data);
  if (component.type === 'grid') parseGridData(data);
  if (component.type === 'tilemap') parseTilemapData(data);
  if (component.type === 'tilemap' && explicitMember(data) && !input.members?.[resourceId!]?.[explicitMember(data)!]) throw new Error(`Tilemap ${node.id}: missing exact TileSet member ${explicitMember(data)}`);
  if (component.type === 'tilemap-renderer') parseTilemapRendererData(data);
  if (component.type === 'sprite-renderer' || component.type === 'image') {
    if (component.type === 'sprite-renderer' && !assetId) throw new Error(`${component.type} ${node.id} requires assetRef`);
    const animator = node.components?.find(c => c.type === 'animator');
    const selectionData = { ...data, frameSize: data.frameSize ?? (animator ? componentData(animator).frameSize : undefined) };
    const { frame: region, animation } = spriteSheetSelection(assetId ? input.assets?.[assetId]?.spriteSheet : undefined, selectionData);
    const common = { id, enabled, ...(assetId ? { assetId } : {}), ...(member ? { member } : {}), material: { ...material(data, assetId), ...(region ? { textureRegion: region } : {}) }, properties: data };
    return component.type === 'sprite-renderer' ? { ...common, assetId: assetId!, type: 'sprite-renderer', ...(region ? { frame: region } : {}), ...(animation ? { animation } : {}) } : { ...common, type: 'image' };
  }
  if (component.type === 'mesh-filter' || component.type === 'tilemap') { if (!assetId) throw new Error(`${component.type} ${node.id} requires assetRef`); const selectedMember = component.type === 'tilemap' ? explicitMember(data) : member; return { id, type: component.type, enabled, assetId, ...(selectedMember ? { member: selectedMember } : {}), properties: data }; }
  if (component.type === 'mesh-renderer') return { id, type: 'mesh-renderer', enabled, ...(assetId ? { assetId } : {}), material: material(data, assetId), properties: data };
  if (component.type === 'skinned-mesh-renderer') { if (!assetId) throw new Error(`skinned-mesh-renderer ${node.id} requires assetRef`); return { id, type: 'skinned-mesh-renderer', enabled, assetId, ...(member ? { member } : {}), material: material(data, assetId), properties: data }; }
  if (component.type === 'particle-system') return { id, type: component.type, enabled, properties: input.dimension === '2d' ? editorParticleProperties(data, metrics) : data };
  if (component.type === 'grid' || component.type === 'audio-listener' || component.type === 'canvas-renderer') return { id, type: component.type, enabled, properties: data };
  if (component.type === 'tilemap-renderer') return { id, type: 'tilemap-renderer', enabled, properties: data };
  if (component.type === 'animator') return { id, type: 'animator', enabled, ...(assetId ? { assetId } : {}), controller: data };
  const unit = input.dimension === '2d' ? metrics.pixelsPerUnit : 1;
  const point = (value: [number, number]): [number, number] => [value[0] / unit, value[1] / unit * (input.dimension === '2d' ? -1 : 1)];
  const size2 = vec2(data.size, [unit, unit]).map(value => value / unit) as [number, number]; const offset2 = point(vec2(data.offset, [0, 0])); const center3 = vec3(data.center, [0, 0, 0]);
  if (component.type === 'box-collider-2d') return { id, type: 'box-collider-2d', enabled, size: size2, offset: offset2, isTrigger: data.isTrigger === true };
  if (component.type === 'circle-collider-2d') return { id, type: 'circle-collider-2d', enabled, radius: finite(data.radius, .5 * unit) / unit, offset: offset2, isTrigger: data.isTrigger === true };
  if (component.type === 'capsule-collider-2d') return { id, type: 'capsule-collider-2d', enabled, size: size2, offset: offset2, direction: data.direction === 'horizontal' ? 'horizontal' : 'vertical', isTrigger: data.isTrigger === true };
  if (component.type === 'polygon-collider-2d') return { id, type: 'polygon-collider-2d', enabled, points: Array.isArray(data.points) ? data.points.map(value => point(vec2(value, [0, 0]))) : [[-.5, -.5], [.5, -.5], [0, .5]], offset: offset2, isTrigger: data.isTrigger === true };
  if (component.type === 'rigidbody-2d') return { id, type: 'rigidbody-2d', enabled, bodyType: ['dynamic', 'kinematic', 'static'].includes(String(data.bodyType)) ? data.bodyType as 'dynamic' | 'kinematic' | 'static' : 'dynamic', properties: data };
  if (component.type === 'box-collider') return { id, type: 'box-collider', enabled, size: vec3(data.size, [1, 1, 1]), center: center3, isTrigger: data.isTrigger === true };
  if (component.type === 'sphere-collider') return { id, type: 'sphere-collider', enabled, radius: finite(data.radius, .5), center: center3, isTrigger: data.isTrigger === true };
  if (component.type === 'capsule-collider') return { id, type: 'capsule-collider', enabled, radius: finite(data.radius, .5), height: finite(data.height, 2), direction: ['x', 'y', 'z'].includes(String(data.direction)) ? data.direction as 'x' | 'y' | 'z' : 'y', center: center3, isTrigger: data.isTrigger === true };
  if (component.type === 'mesh-collider') return { id, type: 'mesh-collider', enabled, ...(assetId ? { assetId } : {}), convex: data.convex === true, isTrigger: data.isTrigger === true, properties: data };
  if (component.type === 'rigidbody') return { id, type: 'rigidbody', enabled, isKinematic: data.isKinematic === true, useGravity: data.useGravity !== false, mass: Math.max(.0001, finite(data.mass, 1)), properties: data };
  if (component.type === 'audio-source') return { id, type: 'audio-source', enabled, ...(assetId ? { assetId } : {}), properties: data };
  if (component.type === 'particle-system-renderer') return { id, type: 'particle-system-renderer', enabled, ...(assetId ? { assetId, textureAssetId: assetId } : {}), material: material(data, assetId), properties: data };
  if (component.type === 'light-2d' || component.type === 'light') return { id, type: component.type, enabled, light: lightData(data, component.type === 'light-2d' ? metrics.pixelsPerUnit : 1), properties: data };
  if (component.type === 'camera') {
    const orthographic = data.orthographic === true || data.projection === 'orthographic';
    const viewport = record(record(data.viewport)?.width !== undefined ? data.viewport : undefined);
    const orthographicSize = finite(data.orthographicSize, viewport ? finite(viewport.height, 720) / 2 / metrics.pixelsPerUnit : 3.6);
    return { id, type: 'camera', enabled, orthographic, orthographicSize, ...(typeof data.nearClip === 'number' ? { nearClip: data.nearClip } : {}), ...(typeof data.farClip === 'number' ? { farClip: data.farClip } : {}), properties: data };
  }
  if (component.type === 'canvas') return { id, type: 'canvas', enabled, renderMode: ['screen-space-overlay', 'screen-space-camera', 'world-space'].includes(String(data.renderMode)) ? data.renderMode as 'screen-space-overlay' | 'screen-space-camera' | 'world-space' : 'world-space', properties: data };
  if (component.type === 'rect-transform') {
    const min = vec2(data.anchorMin, [0, 0]), max = vec2(data.anchorMax, [1, 1]), pivot = vec2(data.pivot, [.5, .5]);
    const offset = vec2(data.anchoredPosition, [0, 0]), size = vec2(data.sizeDelta, [0, 0]);
    // Rects always use top-left coordinates, including Canvas UI in a 3D scene.
    return { id, type: 'rect-transform', enabled, anchorMin: [min[0], 1-max[1]], anchorMax: [max[0], 1-min[1]], pivot: [pivot[0], 1-pivot[1]], anchoredPosition: [offset[0]/unit, -offset[1]/unit], sizeDelta: [size[0]/unit, size[1]/unit], properties: data };
  }
  if (component.type === 'text') return { id, type: 'text', enabled, text: typeof data.text === 'string' ? data.text : '', properties: data };
  throw new Error(`Unsupported scene component ${component.type}`);
}

const childrenByParent = (nodes: BeeGameContentNode[]) => { const result = new Map<string, string[]>(); for (const node of nodes) if (node.parentId) result.set(node.parentId, [...(result.get(node.parentId) ?? []), node.id]); return result; };

export function sceneContentToEditorDocument(input: { document: BeeGameSceneContentDocument; documentRevision: string; foundationDocumentRevision: string; assetManifestRevision: string; assets?: Record<string, SceneAsset>; assetMembers?: Record<string, Record<string, string>> }): SceneDocument {
  for (const node of input.document.data.nodes) for (const component of node.components ?? []) if (component.type === 'tilemap') {
    if (input.document.kind !== 'scene-2d') throw new Error('Tilemap currently supports rectangular 2D scenes only');
    validateTilemapGrid(input.document.data.nodes, node, parseTilemapData(component.data));
  }
  const dimension = input.document.kind === 'scene-3d' ? '3d' : '2d'; const layers = layerOrders(input.document.data.settings); const metrics = canvasMetrics(input.document.data.settings); const children = childrenByParent(input.document.data.nodes);
  const nodes = Object.fromEntries(input.document.data.nodes.map(node => [node.id, { id: node.id, name: node.name ?? node.id, parentId: node.parentId ?? null, children: children.get(node.id) ?? [], active: node.enabled !== false, locked: false, transform: editorTransform(node, dimension, layers, metrics), ...(node.layer ? { layer: node.layer } : {}), ...(node.zIndex === undefined ? {} : { order: node.zIndex }), tags: [...(node.semantic ?? [])], metadata: structuredClone(node.data ?? {}), components: (node.components ?? []).map(component => toEditorComponent({ node, component, dimension, metrics, members: input.assetMembers, assets: input.assets })) } satisfies SceneNode]));
  // Opening an editor must not infer and persist rotations from gameplay labels.
  return { schemaVersion: 'scene-game-object.v2', pixelsPerUnit: dimension === '2d' ? metrics.pixelsPerUnit : 1, dimension, id: input.document.id, name: input.document.id, revision: 0, settings: { background: '#181a20', showGrid: true, ambientColor: '#ffffff', ambientIntensity: 1, exposure: 1, fogEnabled: false, fogColor: '#181a20', fogNear: 10, fogFar: 60 }, source: { source: { kind: 'content-package', publicationId: input.document.id, candidateDigest: input.foundationDocumentRevision, sourceInputDigest: input.assetManifestRevision }, contentDigest: input.documentRevision, contentRevision: input.documentRevision, contentSchemaVersion: input.document.schema, adapterId: 'unity-game-object-components', adapterVersion: '2.0.0' }, rootIds: input.document.data.nodes.filter(node => !node.parentId).map(node => node.id), nodes, assets: input.assets ?? {}, diagnostics: [] };
}

function toCanonicalComponent(component: SceneComponent, metrics: CanvasMetrics, dimension: '2d' | '3d'): CanonicalComponent {
  const unit = dimension === '2d' ? metrics.pixelsPerUnit : 1;
  const point = (value: [number, number]) => [value[0] * unit, value[1] * unit * (dimension === '2d' ? -1 : 1)];
  const enabled = component.enabled ? {} : { enabled: false }; const props = 'properties' in component ? structuredClone(component.properties) : {};
  if (component.type === 'sprite-renderer') return { id: component.id, type: component.type, assetRef: sourceAssetId(component.assetId), data: { ...props, ...(component.member ? { member: component.member } : {}), ...enabled } };
  if (component.type === 'image') return { id: component.id, type: component.type, ...(component.assetId ? { assetRef: sourceAssetId(component.assetId) } : {}), data: { ...props, ...(component.member ? { member: component.member } : {}), ...enabled } };
  if (component.type === 'mesh-filter' || component.type === 'tilemap' || component.type === 'skinned-mesh-renderer') return { id: component.id, type: component.type, assetRef: sourceAssetId(component.assetId), data: { ...props, ...(component.member ? { member: component.member } : {}), ...enabled } };
  if (component.type === 'mesh-renderer') return { id: component.id, type: component.type, ...(component.assetId ? { assetRef: sourceAssetId(component.assetId) } : {}), data: { ...props, ...enabled } };
  if (component.type === 'tilemap-renderer') return { id: component.id, type: component.type, data: { ...props, ...enabled } };
  if (component.type === 'particle-system') return { id: component.id, type: component.type, data: { ...(dimension === '2d' ? canonicalParticleProperties(props, metrics) : props), ...enabled } };
  if (component.type === 'grid' || component.type === 'audio-listener' || component.type === 'canvas-renderer') return { id: component.id, type: component.type, data: { ...props, ...enabled } };
  if (component.type === 'animator') return { id: component.id, type: 'animator', ...(component.assetId ? { assetRef: sourceAssetId(component.assetId) } : {}), data: { ...structuredClone(component.controller), ...enabled } };
  if (component.type === 'box-collider-2d' || component.type === 'capsule-collider-2d') return { id: component.id, type: component.type, data: { size: component.size.map(value => value * unit), offset: point(component.offset), ...(component.type === 'capsule-collider-2d' ? { direction: component.direction } : {}), isTrigger: component.isTrigger, ...enabled } };
  if (component.type === 'circle-collider-2d') return { id: component.id, type: component.type, data: { radius: component.radius * unit, offset: point(component.offset), isTrigger: component.isTrigger, ...enabled } };
  if (component.type === 'polygon-collider-2d') return { id: component.id, type: component.type, data: { points: component.points.map(point), offset: point(component.offset), isTrigger: component.isTrigger, ...enabled } };
  if (component.type === 'rigidbody-2d') return { id: component.id, type: component.type, data: { ...props, bodyType: component.bodyType, ...enabled } };
  if (component.type === 'box-collider') return { id: component.id, type: component.type, data: { size: component.size, center: component.center, isTrigger: component.isTrigger, ...enabled } };
  if (component.type === 'sphere-collider') return { id: component.id, type: component.type, data: { radius: component.radius, center: component.center, isTrigger: component.isTrigger, ...enabled } };
  if (component.type === 'capsule-collider') return { id: component.id, type: component.type, data: { radius: component.radius, height: component.height, direction: component.direction, center: component.center, isTrigger: component.isTrigger, ...enabled } };
  if (component.type === 'mesh-collider') return { id: component.id, type: component.type, ...(component.assetId ? { assetRef: sourceAssetId(component.assetId) } : {}), data: { ...props, convex: component.convex, isTrigger: component.isTrigger, ...enabled } };
  if (component.type === 'rigidbody') return { id: component.id, type: component.type, data: { ...props, isKinematic: component.isKinematic, useGravity: component.useGravity, mass: component.mass, ...enabled } };
  if (component.type === 'audio-source') return { id: component.id, type: component.type, ...(component.assetId ? { assetRef: sourceAssetId(component.assetId) } : {}), data: { ...props, ...enabled } };
  if (component.type === 'particle-system-renderer') return { id: component.id, type: component.type, ...(component.assetId ? { assetRef: sourceAssetId(component.assetId) } : {}), data: { ...props, ...enabled } };
  if (component.type === 'light-2d' || component.type === 'light') return { id: component.id, type: component.type, data: { ...props, ...component.light, ...(component.light.distance === undefined ? {} : { distance: component.light.distance * (component.type === 'light-2d' ? metrics.pixelsPerUnit : 1) }), ...enabled } };
  if (component.type === 'camera') return { id: component.id, type: component.type, data: { ...props, orthographic: component.orthographic, ...(component.orthographicSize === undefined ? {} : { orthographicSize: component.orthographicSize }), ...(component.nearClip === undefined ? {} : { nearClip: component.nearClip }), ...(component.farClip === undefined ? {} : { farClip: component.farClip }), ...enabled } };
  if (component.type === 'canvas') return { id: component.id, type: component.type, data: { ...props, renderMode: component.renderMode, ...enabled } };
  if (component.type === 'rect-transform') return { id: component.id, type: component.type, data: { ...props, anchorMin: [component.anchorMin[0], 1-component.anchorMax[1]], anchorMax: [component.anchorMax[0], 1-component.anchorMin[1]], pivot: [component.pivot[0], 1-component.pivot[1]], anchoredPosition: [component.anchoredPosition[0]*unit, -component.anchoredPosition[1]*unit], sizeDelta: component.sizeDelta.map(value => value * unit), ...enabled } };
  if (component.type === 'text') return { id: component.id, type: component.type, data: { ...props, text: component.text, ...enabled } };
  throw new Error(`Unsupported scene component ${component satisfies never}`);
}

export function editorDocumentToSceneContent(editorDocument: SceneDocument, original: BeeGameSceneContentDocument): BeeGameSceneContentDocument {
  const previousOrder = new Map(original.data.nodes.map((node, index) => [node.id, index])); const metrics = canvasMetrics(original.data.settings);
  const nodes = Object.values(editorDocument.nodes).sort((a, b) => (previousOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (previousOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER)).map(node => {
    const components = node.components.map(component => toCanonicalComponent(component, metrics, editorDocument.dimension)); const base: BeeGameContentNode = { id: node.id, ...(node.parentId ? { parentId: node.parentId } : {}), ...(node.name === node.id ? {} : { name: node.name }), ...(node.tags.length ? { semantic: [...node.tags] } : {}), ...(node.active ? {} : { enabled: false }), ...(node.layer ? { layer: node.layer } : {}), ...(node.order === undefined ? {} : { zIndex: node.order }), components, ...(node.metadata && Object.keys(node.metadata).length ? { data: structuredClone(node.metadata) } : {}) };
    if (editorDocument.dimension === '3d') base.transform = structuredClone(node.transform);
    else {
      const rootOffsetX = node.parentId ? 0 : metrics.width / 2, rootOffsetY = node.parentId ? 0 : metrics.height / 2;
      const layerDepth = (node.order ?? (node.layer ? layerOrders(original.data.settings).get(node.layer) ?? 0 : 0)) * .01;
      base.transform = { position: [node.transform.position[0] * metrics.pixelsPerUnit + rootOffsetX, rootOffsetY - node.transform.position[1] * metrics.pixelsPerUnit, (node.transform.position[2] - layerDepth) * metrics.pixelsPerUnit], rotation: [-node.transform.rotation[0], node.transform.rotation[1], -node.transform.rotation[2]], scale: [...node.transform.scale] };
    }
    return base;
  });
  const data = { ...structuredClone(original.data), nodes }; if (data.cameraNodeId && !editorDocument.nodes[data.cameraNodeId]) delete data.cameraNodeId;
  return { ...structuredClone(original), kind: editorDocument.dimension === '3d' ? 'scene-3d' : 'scene-2d', assetRefs: [...new Set(nodes.flatMap(node => node.components?.flatMap(component => component.assetRef ? [component.assetRef] : []) ?? []))], data };
}
