import type { KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { ChevronRight, File, Folder, FolderOpen, Pencil, Trash2, Upload } from 'lucide-react'
import { Tree, type NodeRendererProps, type RowRendererProps } from 'react-arborist'
import type { ExplorerNode } from './resourcePackExplorerTree'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../ui/context-menu'

type ResourcePackExplorerProps = {
  tree: ExplorerNode
  selectedElementId?: string
  onElement: (element: NonNullable<ExplorerNode['element']>) => void
  height?: number
  onUploadToFolder?: (node: ExplorerNode) => void
  onRenameFolder?: (node: ExplorerNode) => void
  onDeleteFolder?: (node: ExplorerNode) => void
  onRenameElement?: (element: NonNullable<ExplorerNode['element']>) => void
  onDeleteElement?: (element: NonNullable<ExplorerNode['element']>) => void
  onMoveElement?: (element: NonNullable<ExplorerNode['element']>, destination: ExplorerNode) => void
}

const TREE_WIDTH = 236
const ROW_HEIGHT = 30
const INDENT = 18

export function ResourcePackExplorer({
  tree,
  selectedElementId,
  onElement,
  height = 560,
  onUploadToFolder,
  onRenameFolder,
  onDeleteFolder,
  onRenameElement,
  onDeleteElement,
  onMoveElement,
}: ResourcePackExplorerProps) {
  const selectedNodeId = selectedElementId ? `file:${selectedElementId}` : undefined
  const activateFile = (node: { data: ExplorerNode }) => {
    if (node.data.kind === 'file' && node.data.element) onElement(node.data.element)
  }

  const renderRow = (props: RowRendererProps<ExplorerNode>): ReactElement => (
    <ExplorerRow {...props} />
  )

  const renderNode = (props: NodeRendererProps<ExplorerNode>): ReactElement => (
    <ExplorerNodeRow {...props} selectedElementId={selectedElementId} onUploadToFolder={onUploadToFolder} onRenameFolder={onRenameFolder} onDeleteFolder={onDeleteFolder} onRenameElement={onRenameElement} onDeleteElement={onDeleteElement} onMoveElement={onMoveElement} />
  )

  return (
    <Tree<ExplorerNode>
      aria-label="Pack files"
      className="overflow-hidden bg-transparent text-[#c6c6cc]"
      data={[tree]}
      disableDrag
      disableDrop
      disableMultiSelection
      disableSelect={(node) => node.kind === 'folder'}
      height={height}
      indent={INDENT}
      initialOpenState={{ root: true }}
      onActivate={activateFile}
      openByDefault={false}
      overscanCount={12}
      renderRow={renderRow}
      rowHeight={ROW_HEIGHT}
      selection={selectedNodeId}
      width={TREE_WIDTH}
    >
      {renderNode}
    </Tree>
  )
}

function ExplorerRow({ attrs, children, innerRef, node }: RowRendererProps<ExplorerNode>) {
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    node.focus()
    if (node.data.kind === 'folder') {
      node.toggle()
      return
    }
    node.handleClick(event)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || node.data.kind !== 'file') return
    event.preventDefault()
    event.stopPropagation()
    node.handleClick(event as unknown as MouseEvent<HTMLDivElement>)
  }

  const rowAttributes = node.data.kind === 'file'
    ? (() => {
        const { 'aria-expanded': _ariaExpanded, ...fileAttributes } = attrs
        return fileAttributes
      })()
    : attrs

  return (
    <div
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

function ExplorerNodeRow({ node, selectedElementId, style, onUploadToFolder, onRenameFolder, onDeleteFolder, onRenameElement, onDeleteElement, onMoveElement }: NodeRendererProps<ExplorerNode> & Pick<ResourcePackExplorerProps, 'onUploadToFolder' | 'onRenameFolder' | 'onDeleteFolder' | 'onRenameElement' | 'onDeleteElement' | 'onMoveElement'> & { selectedElementId?: string }) {
  const isFolder = node.data.kind === 'folder'
  const isSelected = Boolean(selectedElementId && node.data.element?.id === selectedElementId)
  const guideLeft = Math.max(6, node.level * INDENT - 9)

  const menu = isFolder && node.data.id !== 'root' ? (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => onUploadToFolder?.(node.data)}><Upload />上传</ContextMenuItem>
      {node.data.folder ? <><ContextMenuItem onSelect={() => onRenameFolder?.(node.data)}><Pencil />重命名</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => onDeleteFolder?.(node.data)}><Trash2 />删除</ContextMenuItem></> : null}
    </ContextMenuContent>
  ) : !isFolder && node.data.element ? (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => onRenameElement?.(node.data.element!)}><Pencil />重命名</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => onDeleteElement?.(node.data.element!)}><Trash2 />删除</ContextMenuItem>
    </ContextMenuContent>
  ) : null
  const content = (
    <div
      className={`relative flex h-[30px] min-w-0 items-center gap-1 rounded-[5px] pr-2 text-[12px] leading-none transition-colors ${
        isSelected
          ? 'bg-[#5b3d17] text-[#f5d19b]'
          : 'text-[#b9bac1] hover:bg-white/[0.055] hover:text-[#f0f0f2]'
      }`}
      style={style}
      draggable={!isFolder}
      onDragStart={(event) => { if (node.data.element) event.dataTransfer.setData('application/x-resource-element', JSON.stringify(node.data.element)) }}
      onDragOver={(event) => { if (isFolder && node.data.folder) event.preventDefault() }}
      onDrop={(event) => { if (!isFolder || !node.data.folder) return; const serialized = event.dataTransfer.getData('application/x-resource-element'); if (!serialized) return; try { const element = JSON.parse(serialized) as NonNullable<ExplorerNode['element']>; event.preventDefault(); onMoveElement?.(element, node.data) } catch { /* Ignore drags not created by this explorer. */ } }}
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
  )
  return menu ? <ContextMenu><ContextMenuTrigger asChild>{content}</ContextMenuTrigger>{menu}</ContextMenu> : content
}
