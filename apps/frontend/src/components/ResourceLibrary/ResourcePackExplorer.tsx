import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react'
import { ChevronRight, File, Folder, FolderOpen, FolderPlus, Pencil, Trash2, Upload } from 'lucide-react'
import { Tree, type NodeRendererProps, type RowRendererProps } from 'react-arborist'
import type { ExplorerNode } from './resourcePackExplorerTree'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../ui/context-menu'

type ResourcePackExplorerProps = {
  tree: ExplorerNode
  selectedElementId?: string
  selectedElementIds?: string[]
  onElement: (element: NonNullable<ExplorerNode['element']>) => void
  onSelectionChange?: (elements: Array<NonNullable<ExplorerNode['element']>>) => void
  height?: number
  onUploadToFolder?: (node: ExplorerNode) => void
  onDropFilesToFolder?: (files: File[], node: ExplorerNode) => void
  onRenameFolder?: (node: ExplorerNode) => void
  onDeleteFolder?: (node: ExplorerNode) => void
  onRenameElement?: (element: NonNullable<ExplorerNode['element']>) => void
  onDeleteElement?: (element: NonNullable<ExplorerNode['element']>) => void
  onMoveElements?: (elements: Array<NonNullable<ExplorerNode['element']>>, destination: ExplorerNode) => void
  onCreateFolder?: () => void
  labels?: { upload: string; rename: string; delete: string; newFolder: string }
}

const TREE_WIDTH = 236
const ROW_HEIGHT = 30
const INDENT = 18

export function ResourcePackExplorer({
  tree,
  selectedElementId,
  selectedElementIds = [],
  onElement,
  onSelectionChange,
  height = 560,
  onUploadToFolder,
  onDropFilesToFolder,
  onRenameFolder,
  onDeleteFolder,
  onRenameElement,
  onDeleteElement,
  onMoveElements,
  onCreateFolder,
  labels = { upload: 'Upload', rename: 'Rename', delete: 'Delete', newFolder: 'New folder' },
}: ResourcePackExplorerProps) {
  const nodesById = useMemo(() => {
    const nodes = new Map<string, ExplorerNode>()
    const visit = (node: ExplorerNode) => { nodes.set(node.id, node); node.children?.forEach(visit) }
    visit(tree)
    return nodes
  }, [tree])
  const fileNodesByElementId = useMemo(() => {
    const nodes = new Map<string, ExplorerNode>()
    for (const node of nodesById.values()) {
      if (node.kind === 'file' && node.element) nodes.set(node.element.id, node)
    }
    return nodes
  }, [nodesById])
  const selectedNodeId = selectedElementId
    ? fileNodesByElementId.get(selectedElementId)?.id
    : undefined
  const [contextNode, setContextNode] = useState<ExplorerNode | undefined>()
  const selectionAnchorIdRef = useRef<string | undefined>(undefined)
  const selectedIds = new Set(selectedElementIds)
  const selectedElements = selectedElementIds.flatMap(id => fileNodesByElementId.get(id)?.element ?? [])
  const renderRow = (props: RowRendererProps<ExplorerNode>): ReactElement => (
    <ExplorerRow {...props} onFileClick={(element, event, node) => {
      const additive = event.metaKey || event.ctrlKey
      const anchorId = selectionAnchorIdRef.current
      const range = event.shiftKey && anchorId
        ? node.tree.nodesBetween(anchorId, node.id).flatMap(rangeNode => rangeNode.data.kind === 'file' && rangeNode.data.element ? [rangeNode.data.element.id] : [])
        : undefined
      const next = range
        ? (additive ? [...new Set([...selectedElementIds, ...range])] : range)
        : additive
          ? (selectedIds.has(element.id) ? selectedElementIds.filter(id => id !== element.id) : [...selectedElementIds, element.id])
          : [element.id]
      if (!event.shiftKey) selectionAnchorIdRef.current = node.id
      const nextElements = next.flatMap(id => fileNodesByElementId.get(id)?.element ?? [])
      onSelectionChange?.(nextElements)
      // A preview can only represent one file. Do not choose an arbitrary
      // active file while the user is editing a multi-selection.
      if (nextElements.length === 1) onElement(nextElements[0])
    }} />
  )

  const renderNode = (props: NodeRendererProps<ExplorerNode>): ReactElement => (
    <ExplorerNodeRow {...props} selectedElementId={selectedElementId} selectedElementIds={selectedIds} selectedElements={selectedElements} onMoveElements={onMoveElements} onDropFilesToFolder={onDropFilesToFolder} />
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <div className="h-full w-full" onContextMenu={(event) => setContextNode(nodesById.get((event.target as Element).closest('[data-resource-node]')?.getAttribute('data-resource-node') || 'root'))}>
      <Tree<ExplorerNode>
      aria-label="Pack files"
      className="overflow-hidden bg-transparent text-[#c6c6cc]"
      data={[tree]}
      disableDrag
      disableDrop
      disableSelect={(node) => node.kind === 'folder'}
      height={height}
      indent={INDENT}
      initialOpenState={{ root: true }}
      openByDefault={false}
      overscanCount={12}
      renderRow={renderRow}
      rowHeight={ROW_HEIGHT}
      selection={selectedNodeId}
      width={TREE_WIDTH}
    >
      {renderNode}
      </Tree>
    </div>
      </ContextMenuTrigger>
      <ExplorerContextMenu node={contextNode} tree={tree} labels={labels} onCreateFolder={onCreateFolder} onUploadToFolder={onUploadToFolder} onRenameFolder={onRenameFolder} onDeleteFolder={onDeleteFolder} onRenameElement={onRenameElement} onDeleteElement={onDeleteElement} />
    </ContextMenu>
  )
}

function ExplorerRow({ attrs, children, innerRef, node, onFileClick }: RowRendererProps<ExplorerNode> & { onFileClick: (element: NonNullable<ExplorerNode['element']>, event: MouseEvent<HTMLDivElement>, node: RowRendererProps<ExplorerNode>['node']) => void }) {
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    node.focus()
    if (node.data.kind === 'folder') {
      node.toggle()
      return
    }
    if (node.data.element) onFileClick(node.data.element, event, node)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key !== 'Enter' && event.key !== ' ') || node.data.kind !== 'file' || !node.data.element) return
    event.preventDefault()
    event.stopPropagation()
    onFileClick(node.data.element, event as unknown as MouseEvent<HTMLDivElement>, node)
  }

  const rowAttributes = node.data.kind === 'file'
    ? (() => {
        const { 'aria-expanded': _ariaExpanded, ...fileAttributes } = attrs
        return fileAttributes
      })()
    : attrs

  return (
    <div
      data-resource-node={node.data.id}
      {...rowAttributes}
      ref={innerRef}
      className="focus:outline-none"
      onClick={onClick}
      onFocus={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}

function ExplorerNodeRow({ node, selectedElementId, selectedElementIds, selectedElements, style, onMoveElements, onDropFilesToFolder }: NodeRendererProps<ExplorerNode> & Pick<ResourcePackExplorerProps, 'onMoveElements' | 'onDropFilesToFolder'> & { selectedElementId?: string; selectedElementIds: Set<string>; selectedElements: Array<NonNullable<ExplorerNode['element']>> }) {
  const isFolder = node.data.kind === 'folder'
  const isSelected = Boolean(node.data.element && (selectedElementIds.has(node.data.element.id) || selectedElementId === node.data.element.id))
  const guideLeft = Math.max(6, node.level * INDENT - 9)

  return <div
      className={`relative flex h-[30px] min-w-0 items-center gap-1 rounded-[5px] pr-2 text-[12px] leading-none transition-colors ${
        isSelected
          ? 'bg-[#5b3d17] text-[#f5d19b]'
          : 'text-[#b9bac1] hover:bg-white/[0.055] hover:text-[#f0f0f2]'
      }`}
      style={style}
      draggable={!isFolder}
      onDragStart={(event) => { if (node.data.element) event.dataTransfer.setData('application/x-resource-elements', JSON.stringify(selectedElementIds.has(node.data.element.id) ? selectedElements : [node.data.element])) }}
      onDragOver={(event) => { if (isFolder && node.data.folder) event.preventDefault() }}
      onDrop={(event) => {
        if (!isFolder || !node.data.folder) return
        const files = Array.from(event.dataTransfer.files)
        if (files.length) { event.preventDefault(); onDropFilesToFolder?.(files, node.data); return }
        const serialized = event.dataTransfer.getData('application/x-resource-elements')
        if (!serialized) return
        try { const elements = JSON.parse(serialized) as Array<NonNullable<ExplorerNode['element']>>; event.preventDefault(); onMoveElements?.(elements, node.data) } catch { /* Ignore drags not created by this explorer. */ }
      }}
    >
      {node.level > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/[0.07]"
          style={{ left: guideLeft }}
        />
      ) : null}
      {isFolder ? (
        <ChevronRight
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 text-[#888a93] transition-transform ${node.isOpen ? 'rotate-90' : ''}`}
        />
      ) : (
        <span aria-hidden="true" className="w-3 shrink-0" />
      )}
      {isFolder ? (
        node.isOpen ? <FolderOpen aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#c6a367]" /> : <Folder aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#aaaeb7]" />
      ) : (
        <File aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#838691]" />
      )}
      <span className="min-w-0 truncate">{node.data.name}</span>
    </div>
}

function ExplorerContextMenu({ node, tree, labels, onCreateFolder, onUploadToFolder, onRenameFolder, onDeleteFolder, onRenameElement, onDeleteElement }: Pick<ResourcePackExplorerProps, 'labels' | 'onCreateFolder' | 'onUploadToFolder' | 'onRenameFolder' | 'onDeleteFolder' | 'onRenameElement' | 'onDeleteElement'> & { node?: ExplorerNode; tree: ExplorerNode }) {
  const current = node ?? tree
  const menuLabels = labels ?? { upload: 'Upload', rename: 'Rename', delete: 'Delete', newFolder: 'New folder' }
  if (current.kind === 'file' && current.element) return <ContextMenuContent><ContextMenuItem onSelect={() => onRenameElement?.(current.element!)}><Pencil />{menuLabels.rename}</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => onDeleteElement?.(current.element!)}><Trash2 />{menuLabels.delete}</ContextMenuItem></ContextMenuContent>
  if (current.id !== 'root') return <ContextMenuContent><ContextMenuItem onSelect={() => onUploadToFolder?.(current)}><Upload />{menuLabels.upload}</ContextMenuItem>{current.folder ? <><ContextMenuItem onSelect={() => onRenameFolder?.(current)}><Pencil />{menuLabels.rename}</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => onDeleteFolder?.(current)}><Trash2 />{menuLabels.delete}</ContextMenuItem></> : null}</ContextMenuContent>
  return <ContextMenuContent><ContextMenuItem onSelect={onCreateFolder}><FolderPlus />{menuLabels.newFolder}</ContextMenuItem><ContextMenuItem onSelect={() => onUploadToFolder?.(tree)}><Upload />{menuLabels.upload}</ContextMenuItem></ContextMenuContent>
}
