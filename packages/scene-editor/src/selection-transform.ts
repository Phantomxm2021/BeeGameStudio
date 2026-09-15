import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { operations } from './commands'
import type { SceneDocument, SceneOperation, Transform } from './model'

function localMatrix(transform: Transform): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion().setFromEuler(new Euler(...transform.rotation, 'XYZ')),
    new Vector3(...transform.scale),
  )
}

export function nodeWorldMatrix(document: SceneDocument, nodeId: string, path = new Set<string>()): Matrix4 {
  const node = document.nodes[nodeId]
  if (!node || path.has(nodeId)) throw new Error('Cannot transform an invalid hierarchy')
  const local = localMatrix(node.transform)
  return node.parentId ? nodeWorldMatrix(document, node.parentId, new Set(path).add(nodeId)).multiply(local) : local
}

function fromMatrix(matrix: Matrix4): Transform {
  if (Math.abs(matrix.determinant()) < 1e-10) throw new Error('Selection transform would produce a singular matrix')
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
  matrix.decompose(position, rotation, scale)
  const recomposed = new Matrix4().compose(position, rotation, scale)
  if (matrix.elements.some((value, index) => Math.abs(value - recomposed.elements[index]) > 1e-5)) {
    throw new Error('This selection transform would introduce unsupported shear')
  }
  const euler = new Euler().setFromQuaternion(rotation, 'XYZ')
  return { position: position.toArray(), rotation: [euler.x, euler.y, euler.z], scale: scale.toArray() }
}

/** Apply the active object's world-space delta once to each selected subtree. */
export function transformSelection(document: SceneDocument, selectedIds: readonly string[], primaryId: string, nextPrimaryTransform: Transform): SceneOperation[] {
  const primary = document.nodes[primaryId]
  if (!primary) throw new Error('The active object no longer exists')
  const selected = new Set(selectedIds.length ? selectedIds : [primaryId])
  selected.add(primaryId)
  const oldPrimaryWorld = nodeWorldMatrix(document, primaryId)
  const parentWorld = primary.parentId ? nodeWorldMatrix(document, primary.parentId) : new Matrix4()
  const newPrimaryWorld = parentWorld.clone().multiply(localMatrix(nextPrimaryTransform))
  if (Math.abs(oldPrimaryWorld.determinant()) < 1e-10) throw new Error('Cannot transform a singular selection')
  const delta = newPrimaryWorld.multiply(oldPrimaryWorld.clone().invert())
  const roots = [...selected].filter(id => {
    let parent = document.nodes[id]?.parentId
    while (parent) {
      if (selected.has(parent)) return false
      parent = document.nodes[parent]?.parentId
    }
    return true
  })
  return roots.map(id => {
    const node = document.nodes[id]
    if (!node || node.locked || node.editable === false) throw new Error('Selection contains a locked or read-only object')
    const currentParent = node.parentId ? nodeWorldMatrix(document, node.parentId) : new Matrix4()
    const nextLocal = currentParent.invert().multiply(delta.clone().multiply(nodeWorldMatrix(document, id)))
    return operations.transform(id, fromMatrix(nextLocal), node.transform)
  })
}
