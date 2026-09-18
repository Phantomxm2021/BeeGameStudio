import type { Dispatch, MouseEvent, SetStateAction } from 'react'
import { ChevronRight, Eye, EyeOff, MousePointer2, MousePointerBan } from 'lucide-react'
import { ObjectIcon } from './inspector'
import { primaryComponentType, type SceneDocument } from './model'
import type { ModelSelection, ModelStructure } from './model-structure'

type DropPosition = 'before' | 'inside' | 'after'
type TreeProps = {
  id: string; document: SceneDocument; structures: Record<string, ModelStructure | null>; modelSelection: ModelSelection | null
  query: string; selectedIds: string[]; expanded: Record<string, boolean>; hiddenIds: Set<string>; unpickableIds: Set<string>
  renaming: string | null; dropPreview: { id: string; position: DropPosition } | null; depth?: number
  onSelect: (id: string, event: MouseEvent) => void; onToggleExpand: (id: string) => void
  onToggleHidden: (id: string) => void; onTogglePickable: (id: string) => void
  onRename: (id: string, name: string) => void; onBeginRename: (id: string) => void; onFrame: (id: string) => void
  onDragPreview: (value: { id: string; position: DropPosition } | null) => void; onDrop: (id: string, position: DropPosition) => void
  setContext: (value: { id: string; x: number; y: number } | null) => void
  onSelectPart: (ownerId: string, nodeIndex: number) => void; onFramePart: (ownerId: string, nodeIndex: number) => void
}
const partKey = (ownerId: string, index: number) => `${ownerId}:model:${index}`

export function matchesTreeNode(document: SceneDocument, id: string, query: string, structures: TreeProps['structures']): boolean {
  const node = document.nodes[id]
  if (!node) return false
  const value = query.toLowerCase()
  return !query || node.name.toLowerCase().includes(value) || node.tags.some(tag => tag.toLowerCase().includes(value)) || node.components.some(component => component.type.includes(value)) || node.children.some(child => matchesTreeNode(document, child, query, structures))
}

export function TreeNode(props: TreeProps) {
  const { id, document, structures, modelSelection, query, selectedIds, expanded, hiddenIds, unpickableIds, renaming, dropPreview, onSelect, onToggleExpand, onToggleHidden, onTogglePickable, onRename, onFrame, onDragPreview, onDrop, setContext, depth = 0 } = props
  const node = document.nodes[id]
  if (!node || !matchesTreeNode(document, id, query, structures)) return null
  const hasChildren = Boolean(node.children.length)
  const isOpen = Boolean(query) || expanded[id] !== false
  const preview = dropPreview?.id === id ? dropPreview.position : null
  const pickable = !unpickableIds.has(id)
  const selected = selectedIds.includes(id) && !modelSelection
  return <div className="tree-node" role="treeitem" aria-label={node.name} aria-level={depth + 1} aria-selected={selected} aria-expanded={hasChildren ? isOpen : undefined}>
    <div data-testid={`scene-tree-item-${id}`} className={`tree-row ${selected ? 'selected' : ''} ${hiddenIds.has(id) ? 'is-hidden' : ''} ${preview ? `drop-${preview}` : ''}`} draggable={node.editable !== false && !node.locked}
      onClick={event => { event.stopPropagation(); onSelect(id, event) }} onDoubleClick={() => onFrame(id)}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!selected) onSelect(id, event); setContext({ id, x: event.clientX, y: event.clientY }) }}
      onDragStart={event => { event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/scene-node', id); if (!selected) onSelect(id, event as unknown as MouseEvent) }}
      onDragOver={event => { event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); const ratio = (event.clientY - rect.top) / rect.height; onDragPreview({ id, position: ratio < .25 ? 'before' : ratio > .75 ? 'after' : 'inside' }) }}
      onDragLeave={() => onDragPreview(null)} onDrop={event => { event.preventDefault(); event.stopPropagation(); onDrop(id, dropPreview?.id === id ? dropPreview.position : 'inside'); onDragPreview(null) }}>
      <button className={`chevron ${hasChildren && isOpen ? 'expanded' : ''}`} title={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`} aria-label={isOpen ? 'Collapse' : 'Expand'} disabled={!hasChildren} onClick={event => { event.stopPropagation(); onToggleExpand(id) }}>{hasChildren && <ChevronRight size={12} />}</button>
      <span className={`node-icon ${primaryComponentType(node)}`}><ObjectIcon kind={primaryComponentType(node)} /></span>
      {renaming === id ? <input autoFocus title="Rename object" className="tree-rename-input" defaultValue={node.name} onBlur={event => onRename(id, event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') onRename(id, node.name) }} /> : <span className="node-name" title={node.name}>{node.name}</span>}
      <button className="row-action" title={hiddenIds.has(id) ? 'Show in scene' : 'Hide in scene'} aria-label={hiddenIds.has(id) ? 'Show in scene' : 'Hide in scene'} onClick={event => { event.stopPropagation(); onToggleHidden(id) }}>{hiddenIds.has(id) ? <EyeOff size={12} /> : <Eye size={12} />}</button>
      <button className="row-action" title={pickable ? 'Make unpickable' : 'Make pickable'} aria-label={pickable ? 'Make unpickable' : 'Make pickable'} onClick={event => { event.stopPropagation(); onTogglePickable(id) }}>{pickable ? <MousePointer2 size={12} /> : <MousePointerBan size={12} />}</button>
    </div>
    {isOpen && hasChildren && <div className="tree-children" role="group">
      {node.children.map(child => <TreeNode {...props} key={child} id={child} depth={depth + 1} />)}
    </div>}
  </div>
}

function ModelTreeNode({ ownerId, index, structure, props, depth }: { ownerId: string; index: number; structure: ModelStructure; props: TreeProps; depth: number }) {
  const part = structure.nodes[index]
  const key = partKey(ownerId, index)
  const selected = props.modelSelection?.ownerId === ownerId && props.modelSelection.nodeIndex === index
  const open = Boolean(props.query) || props.expanded[key] !== false
  const matches = (index: number): boolean => structure.nodes[index].name.toLowerCase().includes(props.query.toLowerCase()) || structure.nodes[index].children.some(matches)
  if (props.query && !matches(index)) return null
  return <div className="tree-node model-tree-node" role="treeitem" aria-label={part.name} aria-level={depth + 1} aria-selected={selected} aria-expanded={part.children.length ? open : undefined}>
    <div className={`tree-row ${selected ? 'selected' : ''}`} data-testid={`scene-model-part-${ownerId}-${index}`} onClick={event => { event.stopPropagation(); props.onSelectPart(ownerId, index) }} onDoubleClick={() => props.onFramePart(ownerId, index)} onContextMenu={event => event.preventDefault()}>
      <button className={`chevron ${open ? 'expanded' : ''}`} title={`${open ? 'Collapse' : 'Expand'} ${part.name}`} aria-label={open ? 'Collapse' : 'Expand'} disabled={!part.children.length} onClick={event => { event.stopPropagation(); props.onToggleExpand(key) }}>{Boolean(part.children.length) && <ChevronRight size={12} />}</button>
      <span className="node-icon"><ObjectIcon kind={part.kind} /></span><span className="node-name" title={`${part.name} · Imported ${part.kind}`}>{part.name}</span><span className="model-node-kind">{part.kind}</span>
    </div>
    {open && Boolean(part.children.length) && <div className="tree-children" role="group">{part.children.map(child => <ModelTreeNode key={child} ownerId={ownerId} index={child} structure={structure} props={props} depth={depth + 1} />)}</div>}
  </div>
}

export function navigateModelTree(key: string, selection: ModelSelection, structure: ModelStructure, expanded: Record<string, boolean>, setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>, selectPart: TreeProps['onSelectPart'], selectOwner: (ids: string[]) => void) {
  const { ownerId, nodeIndex } = selection
  const part = structure.nodes[nodeIndex]
  const currentKey = partKey(ownerId, nodeIndex)
  if (!part) return
  if (key === 'ArrowLeft') {
    if (part.children.length && expanded[currentKey] !== false) setExpanded(value => ({ ...value, [currentKey]: false }))
    else { const parent = Object.values(structure.nodes).find(node => node.children.includes(nodeIndex)); if (parent) selectPart(ownerId, parent.index); else selectOwner([ownerId]) }
  } else if (key === 'ArrowRight') {
    if (expanded[currentKey] === false) setExpanded(value => ({ ...value, [currentKey]: true }))
    else if (part.children.length) selectPart(ownerId, part.children[0])
  } else {
    const visible: number[] = []
    const visit = (index: number) => { visible.push(index); if (expanded[partKey(ownerId, index)] !== false) structure.nodes[index].children.forEach(visit) }
    structure.roots.forEach(visit)
    const next = visible.indexOf(nodeIndex) + (key === 'ArrowUp' ? -1 : 1)
    if (next < 0) selectOwner([ownerId]); else if (visible[next] !== undefined) selectPart(ownerId, visible[next])
  }
}
