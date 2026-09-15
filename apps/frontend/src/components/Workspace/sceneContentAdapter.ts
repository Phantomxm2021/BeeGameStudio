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

function editorKind(kind: string): SceneNode['kind'] {
  if (kind === 'sprite' || kind === 'tilemap') return 'plane';
  if (kind === 'light') return 'light';
  if (kind === 'box' || kind === 'sphere' || kind === 'plane') return kind;
  return 'empty';
}

function editorTransform(node: BeeGameContentNode): Transform {
  const position = node.transform?.position ?? [0, 0];
  const scale = node.transform?.scale ?? [1, 1];
  return {
    position: [position[0], node.zIndex ?? 0, position[1]],
    rotation: [0, -(node.transform?.rotation ?? 0), 0],
    scale: [scale[0], 1, scale[1]],
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
  irRevision: string;
  assetManifestRevision: string;
  assets?: Record<string, SceneAsset>;
}): SceneDocument {
  const children = childrenByParent(input.document.data.nodes);
  const nodes = Object.fromEntries(
    input.document.data.nodes.map(node => {
      const kind = editorKind(node.kind);
      const editorNode: SceneNode = {
        id: node.id,
        name: node.name ?? node.id,
        kind,
        parentId: node.parentId ?? null,
        children: children.get(node.id) ?? [],
        visible: node.enabled !== false,
        locked: false,
        transform: editorTransform(node),
        ...(kind === 'plane' ? {
          material: {
            ...DEFAULT_MATERIAL,
            ...(node.assetRef && input.assets?.[node.assetRef]
              ? { textureAssetId: node.assetRef }
              : {}),
          },
        } : {}),
        unknown: { canonicalNode: structuredClone(node) },
      };
      return [node.id, editorNode];
    }),
  );
  return {
    schemaVersion: 'scene-authoring.v1',
    id: input.document.id,
    name: input.document.id,
    revision: 0,
    source: {
      source: {
        kind: 'published-ir',
        publicationId: input.document.id,
        candidateDigest: input.irRevision,
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

function updateCanonicalNode(node: SceneNode): BeeGameContentNode {
  const base = canonicalBase(node);
  const output: BeeGameContentNode = base ?? {
    id: node.id,
    kind: canonicalKind(node.kind),
  };
  output.id = node.id;
  if (node.parentId) output.parentId = node.parentId;
  else delete output.parentId;
  if (!base || node.name !== (base.name ?? base.id)) output.name = node.name;
  if (!base || node.visible !== (base.enabled !== false)) output.enabled = node.visible;

  const baseline = base ? editorTransform(base) : undefined;
  if (!baseline || !sameTransform(node.transform, baseline)) {
    output.transform = {
      position: [node.transform.position[0], node.transform.position[2]],
      rotation: -node.transform.rotation[1],
      scale: [node.transform.scale[0], node.transform.scale[2]],
    };
    output.zIndex = node.transform.position[1];
  }
  return output;
}

export function editorDocumentToSceneContent(
  editorDocument: SceneDocument,
  original: BeeGameSceneContentDocument,
): BeeGameSceneContentDocument {
  const previousOrder = new Map(
    original.data.nodes.map((node, index) => [node.id, index]),
  );
  const nodes = Object.values(editorDocument.nodes)
    .sort((left, right) => {
      const leftOrder = previousOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = previousOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    })
    .map(updateCanonicalNode);
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
