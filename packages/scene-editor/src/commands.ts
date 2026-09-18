import type { ApplyResult, SceneComponent, SceneDocument, SceneNode, SceneOperation, ScenePatchV1, Transform } from './model'
import { clone, same } from './model'
import { canonicalJson, sha256Sync } from './persistence'
import { assertSceneDocument, assertSceneSettings } from './validation'

const fail = (message: string): ApplyResult => ({ document: undefined as never, inverse: [], applied: false, diagnostic: message })
const nodeOrFail = (doc: SceneDocument, id: string) => doc.nodes[id]
const assertExpected = (actual: unknown, expected: unknown, label: string) => expected === undefined || same(actual, expected) ? undefined : `${label} is stale`
const assertEditable = (node: SceneNode, operation: string) => { if (node.editable === false && operation !== 'scene.setLocked') throw Error('Source node is read-only'); if (node.editable === false && operation === 'scene.setLocked') throw Error('Source node lock is read-only'); if (node.locked && operation !== 'scene.setLocked') throw Error('Node is locked') }
const assertTransform = (transform: Transform) => { const values = [...transform.position, ...transform.rotation, ...transform.scale]; if (!values.every(Number.isFinite)) throw Error('Transform values must be finite'); if (transform.scale.some(value => value === 0)) throw Error('Scale cannot be zero') }
function validateOperation(op: SceneOperation) {
  if (!op || typeof op !== 'object' || typeof op.type !== 'string') throw Error('Invalid scene operation')
  if ('nodeId' in op && (typeof op.nodeId !== 'string' || !op.nodeId.trim())) throw Error('Operation nodeId must be non-empty')
  const allowed: Record<string, string[]> = { 'scene.configure': ['type', 'name', 'settings', 'expectedName', 'expectedSettings'], 'scene.renameGameObject': ['type', 'nodeId', 'name', 'expectedName'], 'scene.setActive': ['type', 'nodeId', 'active', 'expectedActive'], 'scene.setLocked': ['type', 'nodeId', 'locked', 'expectedLocked'], 'scene.setTransform': ['type', 'nodeId', 'transform', 'expectedTransform'], 'scene.addGameObject': ['type', 'node', 'index', 'expectedParentExists'], 'scene.removeGameObject': ['type', 'nodeId', 'expectedExists'], 'scene.reparent': ['type', 'nodeId', 'parentId', 'index', 'expectedParentId'], 'scene.setComponent': ['type', 'nodeId', 'component', 'expectedComponent'], 'scene.removeComponent': ['type', 'nodeId', 'componentId', 'expectedComponent'], 'scene.addAsset': ['type', 'asset'], 'scene.removeAsset': ['type', 'assetId', 'expectedExists'] }
  if (!allowed[op.type] || Object.keys(op as object).some(key => !allowed[op.type].includes(key) || (op as any)[key] === undefined)) throw Error('Invalid or unknown scene operation property')
  switch (op.type) {
    case 'scene.configure':
      if (typeof op.name !== 'string' || !op.name.trim()) throw Error('Scene name must be non-empty')
      if (op.settings !== undefined) assertSceneSettings(op.settings)
      if (op.expectedName !== undefined && typeof op.expectedName !== 'string') throw Error('Invalid expected scene name')
      if (op.expectedSettings !== undefined && op.expectedSettings !== null) assertSceneSettings(op.expectedSettings)
      break
    case 'scene.renameGameObject': if (typeof op.name !== 'string' || !op.name.trim()) throw Error('GameObject name must be non-empty'); break
    case 'scene.setActive': if (typeof op.active !== 'boolean') throw Error('Active state must be boolean'); break
    case 'scene.setLocked': if (typeof op.locked !== 'boolean') throw Error('Lock must be boolean'); break
    case 'scene.setTransform': assertTransform(op.transform); break
    case 'scene.addGameObject': if (!op.node || typeof op.node.id !== 'string' || !op.node.id || !Array.isArray(op.node.children) || !Array.isArray(op.node.components) || !op.node.transform) throw Error('Invalid GameObject payload'); assertTransform(op.node.transform); break
    case 'scene.removeGameObject': if (op.expectedExists !== undefined && typeof op.expectedExists !== 'boolean') throw Error('expectedExists must be boolean'); break
    case 'scene.reparent': if (op.parentId !== null && typeof op.parentId !== 'string') throw Error('Parent ID must be string or null'); break
    case 'scene.setComponent': if (!op.component || typeof op.component.id !== 'string' || typeof op.component.type !== 'string' || typeof op.component.enabled !== 'boolean') throw Error('Invalid component'); break
    case 'scene.removeComponent': if (typeof op.componentId !== 'string' || !op.componentId) throw Error('Invalid component ID'); break
    case 'scene.addAsset': if (!op.asset || typeof op.asset.id !== 'string' || !op.asset.id || typeof op.asset.path !== 'string' || typeof op.asset.mimeType !== 'string' || typeof op.asset.name !== 'string') throw Error('Invalid scene asset'); break
    case 'scene.removeAsset': if (op.expectedExists !== undefined && typeof op.expectedExists !== 'boolean') throw Error('expectedExists must be boolean'); break
    default: throw Error('Unsupported scene operation')
  }
}

function subtree(doc: SceneDocument, id: string): SceneNode[] {
  const n = doc.nodes[id]; if (!n) return []
  return [clone(n), ...n.children.flatMap(child => subtree(doc, child))]
}
function removeFromParent(doc: SceneDocument, node: SceneNode) {
  if (node.parentId) { const p = doc.nodes[node.parentId]; if (p) p.children = p.children.filter(id => id !== node.id) }
  else doc.rootIds = doc.rootIds.filter(id => id !== node.id)
}
function insertChild(doc: SceneDocument, node: SceneNode, index?: number) {
  if (node.parentId) {
    const p = doc.nodes[node.parentId]; if (!p) throw new Error(`Parent ${node.parentId} does not exist`)
    p.children = p.children.filter(id => id !== node.id); const i = index === undefined ? p.children.length : Math.max(0, Math.min(index, p.children.length)); p.children.splice(i, 0, node.id)
  } else { doc.rootIds = doc.rootIds.filter(id => id !== node.id); const i = index === undefined ? doc.rootIds.length : Math.max(0, Math.min(index, doc.rootIds.length)); doc.rootIds.splice(i, 0, node.id) }
}
function isDescendant(doc: SceneDocument, possibleChild: string, ancestor: string): boolean {
  let current = doc.nodes[possibleChild]?.parentId
  while (current) { if (current === ancestor) return true; current = doc.nodes[current]?.parentId }
  return false
}
function assertParentEditable(doc: SceneDocument, parentId: string | null) { if (!parentId) return; const parent = doc.nodes[parentId]; if (!parent) throw Error('Parent does not exist'); if (parent.editable === false) throw Error('Parent is source read-only'); if (parent.locked) throw Error('Parent is locked') }

function applyOne(doc: SceneDocument, op: SceneOperation): SceneOperation[] {
  switch (op.type) {
    case 'scene.configure': {
      const stale = assertExpected(doc.name, op.expectedName, 'scene name') ?? assertExpected(doc.settings ?? null, op.expectedSettings, 'scene settings')
      if (stale) throw Error(stale)
      const oldName = doc.name, oldSettings = doc.settings
      doc.name = op.name
      if (op.settings === undefined) delete doc.settings
      else doc.settings = clone(op.settings)
      return [{ type: op.type, name: oldName, ...(oldSettings ? { settings: clone(oldSettings) } : {}), expectedName: op.name, expectedSettings: op.settings ? clone(op.settings) : null }]
    }
    case 'scene.renameGameObject': { const n = nodeOrFail(doc, op.nodeId); if (!n) throw Error('GameObject does not exist'); assertEditable(n, op.type); const stale = assertExpected(n.name, op.expectedName, 'name'); if (stale) throw Error(stale); const old = n.name; n.name = op.name; return [{ type: op.type, nodeId: op.nodeId, name: old, expectedName: op.name }] }
    case 'scene.setActive': { const n = nodeOrFail(doc, op.nodeId); if (!n) throw Error('GameObject does not exist'); assertEditable(n, op.type); const stale = assertExpected(n.active, op.expectedActive, 'active state'); if (stale) throw Error(stale); const old = n.active; n.active = op.active; return [{ type: op.type, nodeId: op.nodeId, active: old, expectedActive: op.active }] }
    case 'scene.setLocked': { const n = nodeOrFail(doc, op.nodeId); if (!n) throw Error('Node does not exist'); if (n.editable === false && !op.locked) throw Error('Source node lock is read-only'); const stale = assertExpected(n.locked, op.expectedLocked, 'lock'); if (stale) throw Error(stale); const old = n.locked; n.locked = op.locked; return [{ type: op.type, nodeId: op.nodeId, locked: old, expectedLocked: op.locked }] }
    case 'scene.setTransform': { const n = nodeOrFail(doc, op.nodeId); if (!n) throw Error('Node does not exist'); assertEditable(n, op.type); assertTransform(op.transform); const stale = assertExpected(n.transform, op.expectedTransform, 'transform'); if (stale) throw Error(stale); const old = clone(n.transform); n.transform = clone(op.transform); return [{ type: op.type, nodeId: op.nodeId, transform: old, expectedTransform: clone(op.transform) }] }
    case 'scene.addGameObject': { if (doc.nodes[op.node.id]) throw Error('GameObject already exists'); assertParentEditable(doc, op.node.parentId); doc.nodes[op.node.id] = clone(op.node); insertChild(doc, op.node, op.index); return [{ type: 'scene.removeGameObject', nodeId: op.node.id, expectedExists: true }] }
    case 'scene.removeGameObject': { const n = nodeOrFail(doc, op.nodeId); if (!n) { if (op.expectedExists === false) return []; throw Error('GameObject does not exist') } assertEditable(n, op.type); if (op.expectedExists === false) throw Error('GameObject unexpectedly exists'); const all = subtree(doc, op.nodeId); if (all.some(item => item !== n && (item.locked || item.editable === false))) throw Error('Subtree contains locked or read-only GameObjects'); const parent = n.parentId; const siblings = parent ? doc.nodes[parent].children : doc.rootIds; const index = siblings.indexOf(n.id); removeFromParent(doc, n); for (const item of all) delete doc.nodes[item.id]; return all.map((item, itemIndex) => itemIndex === 0 ? { type: 'scene.addGameObject', node: item, index } : { type: 'scene.addGameObject', node: item }) }
    case 'scene.reparent': { const n = nodeOrFail(doc, op.nodeId); if (!n) throw Error('Node does not exist'); assertEditable(n, op.type); assertParentEditable(doc, op.parentId); const stale = assertExpected(n.parentId, op.expectedParentId, 'parent'); if (stale) throw Error(stale); if (op.parentId === n.id || (op.parentId && isDescendant(doc, op.parentId, n.id))) throw Error('Cannot create a hierarchy cycle'); const oldParent = n.parentId; const oldSiblings = oldParent ? doc.nodes[oldParent].children : doc.rootIds; const oldIndex = oldSiblings.indexOf(n.id); removeFromParent(doc, n); n.parentId = op.parentId; insertChild(doc, n, op.index); return [{ type: op.type, nodeId: n.id, parentId: oldParent, index: oldIndex, expectedParentId: op.parentId }] }
    case 'scene.setComponent': { const n = nodeOrFail(doc, op.nodeId); if (!n) throw Error('GameObject does not exist'); assertEditable(n, op.type); const index = n.components.findIndex(component => component.id === op.component.id); const old = index >= 0 ? clone(n.components[index]) : null; const stale = assertExpected(old, op.expectedComponent, 'component'); if (stale) throw Error(stale); if (index >= 0) n.components[index] = clone(op.component); else n.components.push(clone(op.component)); return old ? [{ type: op.type, nodeId: n.id, component: old, expectedComponent: clone(op.component) }] : [{ type: 'scene.removeComponent', nodeId: n.id, componentId: op.component.id, expectedComponent: clone(op.component) }] }
    case 'scene.removeComponent': { const n = nodeOrFail(doc, op.nodeId); if (!n) throw Error('GameObject does not exist'); assertEditable(n, op.type); const index = n.components.findIndex(component => component.id === op.componentId); if (index < 0) throw Error('Component does not exist'); const old = clone(n.components[index]); const stale = assertExpected(old, op.expectedComponent, 'component'); if (stale) throw Error(stale); n.components.splice(index, 1); return [{ type: 'scene.setComponent', nodeId: n.id, component: old, expectedComponent: null }] }
    case 'scene.addAsset': { if (doc.assets[op.asset.id]) throw Error('Asset already exists'); doc.assets[op.asset.id] = clone(op.asset); return [{ type: 'scene.removeAsset', assetId: op.asset.id, expectedExists: true }] }
    case 'scene.removeAsset': { const asset = doc.assets[op.assetId]; if (!asset) { if (op.expectedExists === false) return []; throw Error('Asset does not exist') } if (op.expectedExists === false) throw Error('Asset unexpectedly exists'); if (Object.values(doc.nodes).some(node => node.components.some(component => ('assetId' in component && component.assetId === op.assetId) || ('textureAssetId' in component && component.textureAssetId === op.assetId)))) throw Error('Asset is still referenced'); delete doc.assets[op.assetId]; return [{ type: 'scene.addAsset', asset }] }
    default: throw Error('Unsupported scene operation')
  }
}

export function applyPatch(document: SceneDocument, patch: ScenePatchV1): ApplyResult {
  if (patch.schemaVersion !== 'scene-patch.v2' || patch.domain !== 'scene' || patch.operationSchemaVersion !== 'scene-game-object-operations.v1') return fail('Unsupported scene patch schema')
  if (typeof patch.transactionId !== 'string' || !patch.transactionId.trim() || typeof patch.documentId !== 'string' || !patch.documentId.trim() || typeof patch.label !== 'string' || !patch.label.trim() || !['human', 'agent', 'import'].includes(patch.origin) || !Array.isArray(patch.operations) || patch.operations.length === 0) return fail('Invalid scene patch envelope')
  const envelopeKeys = ['schemaVersion', 'domain', 'operationSchemaVersion', 'transactionId', 'documentId', 'base', 'origin', 'label', 'operations']; if (Object.keys(patch as object).some(key => !envelopeKeys.includes(key) || (patch as any)[key] === undefined)) return fail('Invalid or unknown scene patch property')
  if (patch.documentId !== document.id) return fail('Patch documentId does not match current document')
  const transactionKey = `${patch.domain}:${patch.documentId}:${patch.transactionId}`; let fingerprint: string
  try { fingerprint = sha256Sync(canonicalJson({ base: patch.base, origin: patch.origin, label: patch.label, operations: patch.operations })) } catch (error) { return fail(error instanceof Error ? error.message : 'Invalid operation values') }
  const seen = document.appliedTransactions?.[transactionKey]
  if (seen) return seen === fingerprint ? { document, inverse: [], applied: true, diagnostic: 'Transaction already applied' } : fail('Transaction ID was already used with different operations')
  if (!patch.base || typeof patch.base !== 'object' || typeof patch.base.contentDigest !== 'string' || typeof patch.base.contentRevision !== 'string' || typeof patch.base.contentSchemaVersion !== 'string' || typeof patch.base.adapterId !== 'string' || typeof patch.base.adapterVersion !== 'string' || !patch.base.source) return fail('Invalid scene patch base')
  if (patch.base.contentSchemaVersion !== document.source.contentSchemaVersion) return fail('Patch content schema does not match current document')
  if (patch.base.contentDigest !== document.source.contentDigest || patch.base.contentRevision !== document.source.contentRevision) return fail('Patch base content is stale')
  if (patch.base.adapterId !== document.source.adapterId || patch.base.adapterVersion !== document.source.adapterVersion) return fail('Patch adapter does not match current document')
  if (!same(patch.base.source, document.source.source)) return fail('Patch source binding does not match current document')
  const next = clone(document); const inverse: SceneOperation[] = []
  try { const added = new Set(patch.operations.filter(op => op.type === 'scene.addGameObject').map(op => op.node.id)); for (const op of patch.operations) { validateOperation(op); if (op.type === 'scene.addGameObject' && op.node.children.some(child => !added.has(child) && !document.nodes[child])) throw Error('Added GameObject has dangling child reference'); inverse.unshift(...applyOne(next, op)) } }
  catch (error) { return fail(error instanceof Error ? error.message : 'Patch rejected') }
  next.revision += 1; next.source.contentRevision = String(next.revision); next.appliedTransactions = { ...(next.appliedTransactions ?? {}), [transactionKey]: fingerprint }; const digestable = clone(next); digestable.source.contentDigest = ''; next.source.contentDigest = sha256Sync(canonicalJson(digestable))
  try { assertSceneDocument(next) } catch (error) { return fail(error instanceof Error ? error.message : 'Patch produced an invalid scene document') }
  return { document: next, inverse, applied: true }
}

export function patchFor(document: SceneDocument, operations: SceneOperation[], label: string, origin: ScenePatchV1['origin'] = 'human'): ScenePatchV1 {
  return { schemaVersion: 'scene-patch.v2', domain: 'scene', operationSchemaVersion: 'scene-game-object-operations.v1', transactionId: crypto.randomUUID(), documentId: document.id, base: clone(document.source), origin, label, operations: clone(operations) }
}
export const operations = {
  rename: (nodeId: string, name: string, expectedName?: string): SceneOperation => ({ type: 'scene.renameGameObject', nodeId, name, ...(expectedName === undefined ? {} : { expectedName }) }),
  active: (nodeId: string, active: boolean, expectedActive?: boolean): SceneOperation => ({ type: 'scene.setActive', nodeId, active, ...(expectedActive === undefined ? {} : { expectedActive }) }),
  locked: (nodeId: string, locked: boolean, expectedLocked?: boolean): SceneOperation => ({ type: 'scene.setLocked', nodeId, locked, ...(expectedLocked === undefined ? {} : { expectedLocked }) }),
  transform: (nodeId: string, transform: Transform, expectedTransform?: Transform): SceneOperation => ({ type: 'scene.setTransform', nodeId, transform, ...(expectedTransform === undefined ? {} : { expectedTransform }) }),
  component: (nodeId: string, component: SceneComponent, expectedComponent?: SceneComponent | null): SceneOperation => ({ type: 'scene.setComponent', nodeId, component, ...(expectedComponent === undefined ? {} : { expectedComponent }) }),
  reparent: (nodeId: string, parentId: string | null, index?: number, expectedParentId?: string | null): SceneOperation => ({ type: 'scene.reparent', nodeId, parentId, ...(index === undefined ? {} : { index }), ...(expectedParentId === undefined ? {} : { expectedParentId }) }),
  addAsset: (asset: import('./model').SceneAsset): SceneOperation => ({ type: 'scene.addAsset', asset: clone(asset) }),
  removeAsset: (assetId: string, expectedExists?: boolean): SceneOperation => ({ type: 'scene.removeAsset', assetId, ...(expectedExists === undefined ? {} : { expectedExists }) }),
}
