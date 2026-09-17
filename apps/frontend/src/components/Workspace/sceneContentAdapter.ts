import type { SceneAsset, SceneDocument, SceneNode, Transform } from '@beegame/scene-editor';
import type {
  BeeGameContentNode,
  BeeGameSceneContentDocument,
} from '../../services/beeGameAdapter';

const DEFAULT_MATERIAL = {
  mode: 'unlit' as const,
  color: '#ffffff',
  metalness: 0,
  roughness: 1,
  opacity: 1,
  alphaMode: 'blend' as const,
};

const PIXELS_PER_EDITOR_UNIT = 100;

type NodeSize = { width: number; height: number };
type NodePoint = { x: number; y: number };

export type SpriteFrameTable = {
  frameWidth: number;
  frameHeight: number;
  framesPerFacing: number;
  facings?: string[];
  states?: string[];
  frameDurationMs?: number[];
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nodeSize(node: BeeGameContentNode): NodeSize {
  const data = record(node.data);
  const size = record(data?.size) ?? record(record(data?.sprite)?.logicalSize);
  return {
    width: Math.max(1, finiteNumber(size?.width, PIXELS_PER_EDITOR_UNIT)),
    height: Math.max(1, finiteNumber(size?.height, PIXELS_PER_EDITOR_UNIT)),
  };
}

function nodeAnchor(node: BeeGameContentNode): NodePoint {
  const anchor = record(record(node.data)?.anchor);
  return {
    x: finiteNumber(anchor?.x, 0.5),
    y: finiteNumber(anchor?.y, 0.5),
  };
}

function nodePosition(node: BeeGameContentNode): [number, number] {
  if (node.transform?.position) return node.transform.position;
  const offset = record(record(node.data)?.offset);
  return [finiteNumber(offset?.x, 0), finiteNumber(offset?.y, 0)];
}

function layerOrders(nodes: BeeGameContentNode[]): Map<string, number> {
  const config = nodes.find(node => node.kind === 'world-config');
  const layers = record(config?.data)?.layers;
  if (!Array.isArray(layers)) return new Map();
  return new Map(layers.flatMap((item, index) => {
    const layer = record(item);
    return typeof layer?.id === 'string'
      ? [[layer.id, finiteNumber(layer.order, index + 1)] as const]
      : [];
  }));
}

function editorKind(node: BeeGameContentNode): SceneNode['kind'] {
  const sprite = record(record(node.data)?.sprite);
  if (node.assetRef || typeof sprite?.assetRef === 'string' || node.kind === 'sprite' || node.kind === 'tilemap') return 'plane';
  const kind = node.kind;
  if (kind === 'light') return 'light';
  if (kind === 'box' || kind === 'sphere' || kind === 'plane') return kind;
  return 'empty';
}

function explicitAssetMember(node: BeeGameContentNode): string | undefined {
  const data = record(node.data);
  if (typeof data?.member === 'string') return data.member;
  const texture = record(data?.texture);
  if (typeof texture?.member === 'string') return texture.member;
  const actions = record(record(data?.sprite)?.actions);
  const idle = record(actions?.idle);
  if (typeof idle?.member === 'string') return idle.member;
  const firstAction = actions ? Object.values(actions).map(record).find(Boolean) : undefined;
  return typeof firstAction?.member === 'string' ? firstAction.member : undefined;
}

function normalizedTokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(token => token && !/^\d+$/.test(token));
}

function matchingMember(node: BeeGameContentNode, members: Record<string, string>): string | undefined {
  const explicit = explicitAssetMember(node);
  if (explicit && members[explicit]) return members[explicit];
  if (members[node.id]) return members[node.id];
  const nodeTokens = normalizedTokens(node.id).filter(token => !['bg', 'deco', 'post'].includes(token));
  let best: { assetId: string; score: number } | undefined;
  for (const [member, assetId] of Object.entries(members)) {
    const memberTokens = normalizedTokens(member).filter(token => !['sp', 'prop', 'ui', 'fx'].includes(token));
    const score = nodeTokens.filter(token => memberTokens.includes(token)).length;
    if (score > 0 && (!best || score > best.score)) best = { assetId, score };
  }
  return best?.assetId;
}

function initialVisibility(node: BeeGameContentNode): boolean {
  if (node.enabled === false) return false;
  const condition = record(node.data)?.visibleWhen;
  if (typeof condition !== 'string') return true;
  // The editor opens in the calm, uncollected authoring state. Stateful
  // variants remain in the hierarchy and can still be made visible manually.
  return condition === 'state != caught' || condition.endsWith('.notCollected');
}

function spritePreview(
  node: BeeGameContentNode,
  resourceId: string | undefined,
  member: string | undefined,
  frameTables: Record<string, Record<string, SpriteFrameTable>> | undefined,
): Record<string, unknown> | undefined {
  if (!resourceId || !member) return undefined;
  const table = frameTables?.[resourceId]?.[member];
  if (!table) return undefined;
  const data = record(node.data);
  const actions = record(record(data?.sprite)?.actions);
  const idle = record(actions?.idle);
  const initialFacing = typeof data?.initialFacing === 'string' ? data.initialFacing : table.facings?.[0];
  return {
    ...table,
    ...(initialFacing ? { initialFacing } : {}),
    loop: Boolean(actions) && idle?.loop !== false,
  };
}

function firstSpriteRegion(preview: Record<string, unknown> | undefined): NonNullable<SceneNode['material']>['textureRegion'] | undefined {
  if (!preview) return undefined;
  const width = finiteNumber(preview.frameWidth, 0);
  const height = finiteNumber(preview.frameHeight, 0);
  const framesPerFacing = Math.max(1, Math.floor(finiteNumber(preview.framesPerFacing, 1)));
  const facings = Array.isArray(preview.facings) ? preview.facings.filter((value): value is string => typeof value === 'string') : [];
  const facing = typeof preview.initialFacing === 'string' ? preview.initialFacing : facings[0];
  const facingIndex = Math.max(0, facings.indexOf(facing));
  return width > 0 && height > 0
    ? { x: facingIndex * framesPerFacing * width, y: 0, width, height }
    : undefined;
}

function editorTransform(node: BeeGameContentNode, layers: Map<string, number>): Transform {
  const position = nodePosition(node);
  const scale = node.transform?.scale ?? [1, 1];
  const size = nodeSize(node);
  const anchor = nodeAnchor(node);
  const centerX = position[0] + (0.5 - anchor.x) * size.width;
  const centerY = position[1] + (0.5 - anchor.y) * size.height;
  const layer = node.layer ? layers.get(node.layer) ?? 0 : 0;
  return {
    position: [centerX / PIXELS_PER_EDITOR_UNIT, (node.zIndex ?? layer) * 0.01, centerY / PIXELS_PER_EDITOR_UNIT],
    rotation: [0, -(node.transform?.rotation ?? 0), 0],
    scale: [size.width / PIXELS_PER_EDITOR_UNIT * scale[0], 1, size.height / PIXELS_PER_EDITOR_UNIT * scale[1]],
  };
}

function childrenByParent(nodes: BeeGameContentNode[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const current = children.get(node.parentId) ?? [];
    current.push(node.id);
    children.set(node.parentId, current);
  }
  return children;
}

export function sceneContentToEditorDocument(input: {
  document: BeeGameSceneContentDocument;
  documentRevision: string;
  foundationDocumentRevision: string;
  assetManifestRevision: string;
  assets?: Record<string, SceneAsset>;
  assetRegions?: Record<string, Record<string, NonNullable<SceneNode['material']>['textureRegion']>>;
  assetMembers?: Record<string, Record<string, string>>;
  frameTables?: Record<string, Record<string, SpriteFrameTable>>;
}): SceneDocument {
  const layers = layerOrders(input.document.data.nodes);
  const children = childrenByParent(input.document.data.nodes);
  const canonicalNodes = new Map(input.document.data.nodes.map(node => [node.id, node]));
  const nodes = Object.fromEntries(
    input.document.data.nodes.map(node => {
      const kind = editorKind(node);
      const sprite = record(record(node.data)?.sprite);
      const texture = record(record(node.data)?.texture);
      const resourceId = node.assetRef
        ?? (typeof sprite?.assetRef === 'string' ? sprite.assetRef : undefined)
        ?? (typeof texture?.assetRef === 'string' ? texture.assetRef : undefined);
      const textureAssetId = resourceId
        ? matchingMember(node, input.assetMembers?.[resourceId] ?? {}) ?? resourceId
        : undefined;
      const textureMember = textureAssetId?.includes(':')
        ? textureAssetId.slice(textureAssetId.indexOf(':') + 1)
        : explicitAssetMember(node) ?? input.assets?.[textureAssetId ?? '']?.name.replace(/\.[^.]+$/, '');
      const previewSprite = spritePreview(node, resourceId, textureMember, input.frameTables);
      const spriteRegion = firstSpriteRegion(previewSprite);
      const alpha = finiteNumber(record(node.data)?.alpha, 1);
      const editorNode: SceneNode = {
        id: node.id,
        name: node.name ?? node.id,
        kind,
        parentId: node.parentId ?? null,
        children: children.get(node.id) ?? [],
        visible: initialVisibility(node),
        locked: false,
        transform: editorTransform(node, layers),
        ...(kind === 'plane' ? {
          material: {
            ...DEFAULT_MATERIAL,
            opacity: Math.min(1, Math.max(0, alpha)),
            ...(textureAssetId && input.assets?.[textureAssetId]
              ? {
                  textureAssetId,
                  ...(spriteRegion
                    ? { textureRegion: spriteRegion }
                    : node.frameRef && resourceId && input.assetRegions?.[resourceId]?.[node.frameRef]
                      ? { textureRegion: input.assetRegions[resourceId][node.frameRef] }
                    : {}),
                }
              : {}),
          },
        } : {}),
        unknown: {
          canonicalNode: structuredClone(node),
          preview2d: {
            ...(previewSprite ? { sprite: previewSprite } : {}),
            ...(node.kind === 'emitter' && textureAssetId
              ? { emitter: { ...structuredClone(record(node.data) ?? {}), textureAssetId } }
              : {}),
            ...(node.kind === 'visionCone'
              ? {
                  procedural: {
                    kind: 'visionCone',
                    ...structuredClone(record(node.data) ?? {}),
                    facing: typeof record(canonicalNodes.get(node.parentId ?? '')?.data)?.initialFacing === 'string'
                      ? record(canonicalNodes.get(node.parentId ?? '')?.data)?.initialFacing
                      : 'right',
                  },
                }
              : {}),
            ...(typeof record(node.data)?.blend === 'string' ? { blend: record(node.data)?.blend } : {}),
            ...(record(node.data)?.motion ? { motion: structuredClone(record(node.data)?.motion) } : {}),
            ...(record(node.data)?.patrol ? { patrol: structuredClone(record(node.data)?.patrol) } : {}),
            ...(record(node.data)?.animation ? { animation: structuredClone(record(node.data)?.animation) } : {}),
            ...(record(node.data)?.enterAnimation ? { animation: structuredClone(record(node.data)?.enterAnimation) } : {}),
          },
        },
      };
      return [node.id, editorNode];
    }),
  );
  return {
    schemaVersion: 'scene-authoring.v1',
    id: input.document.id,
    name: input.document.id,
    revision: 0,
    settings: {
      background: '#181a20',
      showGrid: false,
      ambientColor: '#ffffff',
      ambientIntensity: 1,
      exposure: 1,
      fogEnabled: false,
      fogColor: '#181a20',
      fogNear: 10,
      fogFar: 60,
    },
    source: {
      source: {
        kind: 'content-package',
        publicationId: input.document.id,
        candidateDigest: input.foundationDocumentRevision,
        sourceInputDigest: input.assetManifestRevision,
      },
      contentDigest: input.documentRevision,
      contentRevision: input.documentRevision,
      contentSchemaVersion: input.document.schema,
      adapterId: 'beegame-scene-2d-editor',
      adapterVersion: '1.0.0',
    },
    rootIds: input.document.data.nodes
      .filter(node => !node.parentId)
      .map(node => node.id),
    nodes,
    assets: input.assets ?? {},
    diagnostics: [],
  };
}

function canonicalBase(node: SceneNode): BeeGameContentNode | undefined {
  const value = node.unknown?.canonicalNode;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return structuredClone(value) as BeeGameContentNode;
}

function sameTransform(left: Transform, right: Transform): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalKind(kind: SceneNode['kind']): string {
  if (kind === 'empty') return 'group';
  return kind;
}

function updateCanonicalNode(node: SceneNode, layers: Map<string, number>): BeeGameContentNode {
  const base = canonicalBase(node);
  const output: BeeGameContentNode = base ?? {
    id: node.id,
    kind: canonicalKind(node.kind),
  };
  output.id = node.id;
  if (node.parentId) output.parentId = node.parentId;
  else delete output.parentId;
  if (!base || node.name !== (base.name ?? base.id)) output.name = node.name;
  const condition = base ? record(base.data)?.visibleWhen : undefined;
  if (typeof condition !== 'string' && (!base || node.visible !== (base.enabled !== false))) output.enabled = node.visible;

  const baseline = base ? editorTransform(base, layers) : undefined;
  if (!baseline || !sameTransform(node.transform, baseline)) {
    const size = base ? nodeSize(base) : { width: PIXELS_PER_EDITOR_UNIT, height: PIXELS_PER_EDITOR_UNIT };
    const anchor = base ? nodeAnchor(base) : { x: 0.5, y: 0.5 };
    const position: [number, number] = [
      node.transform.position[0] * PIXELS_PER_EDITOR_UNIT - (0.5 - anchor.x) * size.width,
      node.transform.position[2] * PIXELS_PER_EDITOR_UNIT - (0.5 - anchor.y) * size.height,
    ];
    const nextTransform = {
      position,
      rotation: -node.transform.rotation[1],
      scale: [
        node.transform.scale[0] * PIXELS_PER_EDITOR_UNIT / size.width,
        node.transform.scale[2] * PIXELS_PER_EDITOR_UNIT / size.height,
      ] as [number, number],
    };
    if (base && !base.transform && record(base.data)?.offset) {
      output.data = { ...structuredClone(base.data), offset: { x: position[0], y: position[1] } };
    } else {
      output.transform = nextTransform;
    }
  }
  return output;
}

export function editorDocumentToSceneContent(
  editorDocument: SceneDocument,
  original: BeeGameSceneContentDocument,
): BeeGameSceneContentDocument {
  const layers = layerOrders(original.data.nodes);
  const previousOrder = new Map(
    original.data.nodes.map((node, index) => [node.id, index]),
  );
  const nodes = Object.values(editorDocument.nodes)
    .sort((left, right) => {
      const leftOrder = previousOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = previousOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    })
    .map(node => updateCanonicalNode(node, layers));
  const data = {
    ...structuredClone(original.data),
    nodes,
  };
  if (data.cameraNodeId && !editorDocument.nodes[data.cameraNodeId]) {
    delete data.cameraNodeId;
  }
  return {
    ...structuredClone(original),
    assetRefs: [...new Set([
      ...original.assetRefs,
      ...nodes.flatMap(node => node.assetRef ? [node.assetRef] : []),
    ])],
    data,
  };
}
