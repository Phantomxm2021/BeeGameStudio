import type { KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import { Tree, type NodeRendererProps, type RowRendererProps } from 'react-arborist'
import type { ExplorerNode } from './resourcePackExplorerTree'

type ResourcePackExplorerProps = {
  tree: ExplorerNode
  selectedElementId?: string
  onElement: (element: NonNullable<ExplorerNode['element']>) => void
  height?: number
}

const TREE_WIDTH = 236
const ROW_HEIGHT = 30
const INDENT = 18

export function ResourcePackExplorer({
  tree,
  selectedElementId,
  onElement,
  height = 560,
}: ResourcePackExplorerProps) {
  const selectedNodeId = selectedElementId ? `file:${selectedElementId}` : undefined
  const activateFile = (node: { data: ExplorerNode }) => {
    if (node.data.kind === 'file' && node.data.element) onElement(node.data.element)
  }

  const renderRow = (props: RowRendererProps<ExplorerNode>): ReactElement => (
    <ExplorerRow {...props} />
  )

  const renderNode = (props: NodeRendererProps<ExplorerNode>): ReactElement => (
    <ExplorerNodeRow {...props} selectedElementId={selectedElementId} />
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
    event.preventDefault()
    if (node.data.kind === 'folder') {
      node.toggle()
      return
    }
    node.handleClick(event)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (node.data.kind === 'folder') node.toggle()
    else node.handleClick(event as unknown as MouseEvent<HTMLDivElement>)
  }

  return (
    <div
      {...attrs}
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

function ExplorerNodeRow({ node, selectedElementId, style }: NodeRendererProps<ExplorerNode> & { selectedElementId?: string }) {
  const isFolder = node.data.kind === 'folder'
  const isSelected = Boolean(selectedElementId && node.data.element?.id === selectedElementId)
  const guideLeft = Math.max(6, node.level * INDENT - 9)

  return (
    <div
      className={`relative flex h-[30px] min-w-0 items-center gap-1 rounded-[5px] pr-2 text-[12px] leading-none transition-colors ${
        isSelected
          ? 'bg-[#5b3d17] text-[#f5d19b]'
          : 'text-[#b9bac1] hover:bg-white/[0.055] hover:text-[#f0f0f2]'
      }`}
      style={style}
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
}
