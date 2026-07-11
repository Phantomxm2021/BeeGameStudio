import type { ResourceElement, ResourceFolder, ResourcePackSummary } from '../../services/resourceLibraryApi'

export type ExplorerNode = {
  id: string
  kind: 'folder' | 'file'
  name: string
  element?: ResourceElement
  folder?: ResourceFolder
  children?: ExplorerNode[]
}

const compareByName = <T extends { id: string; name: string }>(left: T, right: T) =>
  left.name.localeCompare(right.name, 'en', { numeric: true, sensitivity: 'base' }) || left.id.localeCompare(right.id)

const normalisePath = (path: string) => path.replace(/^\/+|\/+$/g, '')

const parentPath = (path: string) => {
  const normalised = normalisePath(path)
  const separator = normalised.lastIndexOf('/')
  return separator < 0 ? '' : normalised.slice(0, separator)
}

function hasCircularParent(folder: ResourceFolder, foldersById: ReadonlyMap<string, ResourceFolder>) {
  const seen = new Set<string>([folder.id])
  let parentId = folder.parentId
  while (parentId) {
    if (seen.has(parentId)) return true
    seen.add(parentId)
    parentId = foldersById.get(parentId)?.parentId
  }
  return false
}

/**
 * Converts the persisted folder graph and Pack elements into the display tree.
 * A file is attached only when its immediate path parent is a persisted folder;
 * otherwise it remains at its derived category folder.
 */
export function buildExplorerTree(
  pack: ResourcePackSummary,
  folders: readonly ResourceFolder[],
  elements: readonly ResourceElement[],
  categoryLabel: (category: string) => string = (category) => category,
): ExplorerNode {
  const root: ExplorerNode = { id: 'root', kind: 'folder', name: pack.name, children: [] }
  const packFolders = folders.filter((folder) => folder.packId === pack.id)
  const packElements = elements.filter((element) => element.packId === pack.id).sort(compareByName)
  const foldersById = new Map(packFolders.map((folder) => [folder.id, folder]))
  const foldersByPath = new Map<string, ResourceFolder>()
  for (const folder of [...packFolders].sort((left, right) => normalisePath(left.path).localeCompare(normalisePath(right.path)) || left.id.localeCompare(right.id))) {
    const path = normalisePath(folder.path)
    if (path && !foldersByPath.has(path)) foldersByPath.set(path, folder)
  }
  // The database enforces a unique (pack_id, path) constraint. This keeps old
  // malformed rows deterministic too: a duplicate never becomes an empty,
  // visible folder that cannot own its files.
  const canonicalFolders = [...foldersByPath.values()]
  const folderNodes = new Map<string, ExplorerNode>()
  for (const folder of canonicalFolders) {
    folderNodes.set(folder.id, {
      id: `folder:${folder.id}`,
      kind: 'folder',
      name: folder.name,
      folder,
      children: [],
    })
  }
  for (const folder of canonicalFolders) {
    const node = folderNodes.get(folder.id)!
    const parent = folder.parentId ? foldersById.get(folder.parentId) : undefined
    const canonicalParent = parent ? foldersByPath.get(normalisePath(parent.path)) : undefined
    const parentNode = canonicalParent && !hasCircularParent(folder, foldersById) ? folderNodes.get(canonicalParent.id) : undefined
    ;(parentNode?.children ?? root.children)!.push(node)
  }

  const categoryNodes = new Map<string, ExplorerNode>()
  for (const element of packElements) {
    const file: ExplorerNode = { id: `file:${element.id}`, kind: 'file', name: element.name, element }
    const directParent = foldersByPath.get(parentPath(element.path))
    if (directParent) {
      folderNodes.get(directParent.id)!.children!.push(file)
      continue
    }

    const category = element.category.trim() || 'uncategorized'
    let categoryNode = categoryNodes.get(category)
    if (!categoryNode) {
      categoryNode = { id: `category:${category}`, kind: 'folder', name: categoryLabel(category), children: [] }
      categoryNodes.set(category, categoryNode)
      root.children!.push(categoryNode)
    }
    categoryNode.children!.push(file)
  }

  const sortChildren = (node: ExplorerNode) => {
    if (!node.children) return
    const files = node.children.filter((child) => child.kind === 'file').sort(compareByName)
    const folders = node.children.filter((child) => child.kind === 'folder').sort(compareByName)
    node.children = [...files, ...folders]
    node.children.forEach(sortChildren)
  }
  root.children = [
    ...root.children!.filter((node) => node.id.startsWith('folder:')).sort(compareByName),
    ...root.children!.filter((node) => node.id.startsWith('category:')).sort(compareByName),
  ]
  root.children.forEach(sortChildren)
  return root
}
