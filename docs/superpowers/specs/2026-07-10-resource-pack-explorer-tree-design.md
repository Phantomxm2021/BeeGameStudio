# Resource Pack Explorer Tree Design

## Goal

Replace the resource Pack workspace's hand-rendered explorer with a virtualized,
Finder-style tree that remains responsive for large Packs while matching the
existing dark resource-library visual language.

## Library boundary

Use `react-arborist` only for flattening, virtualization, focus handling, and
expand/collapse state. The product owns the tree data adapter and every visible
node renderer. The library will not enable drag-and-drop, rename, or folder
selection.

## Tree model

The adapter exposes `ExplorerNode` values:

- `folder`: Pack root, persisted folders, and category-only folders. Folders
  have `children` and can only be expanded or collapsed.
- `file`: a `ResourceElement`. Files are leaves and the only selectable nodes.

Persisted `parentId` relationships determine folder nesting. A file appears
only under the node matching its direct parent path. Elements outside persisted
folders are grouped under a derived category folder. This prevents descendants
from appearing under both a parent and its child.

## Visual and interaction requirements

- Explorer remains fixed at 236px wide with independent vertical scrolling.
- Rows are 30px high. Folder rows use a compact disclosure chevron and folder
  glyph; file rows use a file glyph.
- Nesting uses subtle vertical guide lines and a fixed 18px indentation step.
- Folder rows do not show a selection state. Files use the existing muted
  orange-brown selection fill and remain selectable by pointer and keyboard.
- Hover is neutral zinc, never the primary selection color.
- The root Pack node starts expanded. Other folders preserve normal explicit
  expansion state.
- Empty folders remain visible and expandable.
- Tree keyboard navigation follows treeview conventions: up/down moves focus,
  left/right collapse/expand folders, and Enter selects a focused file.

## Testing

Unit tests cover adapter construction, direct-file placement, category-only
folders, and nested paths. Component tests cover folder non-selection, file
selection, accessible tree semantics, and the empty-folder presentation.
