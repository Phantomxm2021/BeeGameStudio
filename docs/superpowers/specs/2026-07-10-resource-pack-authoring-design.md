# Resource Pack Authoring Design

## Goal

Make Pack creation and resource organization the primary admin workflow. ZIP import remains available only as an administrator batch-migration tool, not as the normal authoring path.

## Product model

### Pack

A Pack is the boundary for a coherent visual/audio style and usage context. It may contain mixed 2D, 3D, UI, effects, audio, fonts, textures, animations, and scene data. Required creation metadata:

- name
- style
- dimension intent: 2D, 3D, or mixed
- applicable game types

Optional metadata includes description, license, version, cover, tags, and status. New Packs start as `draft`.

### Folder and element

Folders organize files for humans and AI. Each element also has semantic metadata independent of its folder: kind, category, dimensions, format, preview, dependencies, and optional style/dimension overrides. A folder is not treated as a type constraint; a 3D model can reference textures and animation files in sibling folders.

## Primary UI flow

1. Admin selects `+` beside “所有资源包” and chooses `创建 Pack`.
2. A focused creation form collects the four required fields first. Optional metadata can be completed later.
3. On create, the user enters the Pack authoring workspace.
4. The left pane shows a Finder-like folder tree with root and user-created folders. It supports create, rename, move, and delete with confirmation for non-empty folders.
5. The center pane shows the selected folder's elements in grid/list view and an upload dropzone. Upload accepts multiple files and folders, shows per-file progress, retry, cancel, and resumable state.
6. The right pane is an element inspector. It exposes file preview, path, detected format, semantic kind/category, tags, dimensions, dependencies, and overrides. Detection is a suggestion; admin can edit it.
7. Pack-level metadata is available from a persistent header action without leaving the workspace.
8. `保存草稿` persists incremental changes. `发布` validates required Pack metadata, upload completion, and referenced dependencies before changing status.
9. The existing ZIP action is placed under an overflow/admin action labelled `批量导入 ZIP`; imported content enters the same draft workspace and never bypasses validation.

## Layout and design language

Use the existing dark BeeGame design language and typography tokens. Do not add a new sidebar or dashboard frame. The workspace is a full page with:

- compact top bar: back, Pack name/status, save state, metadata, publish, overflow
- three-pane browser layout: tree / content / inspector
- restrained borders, no decorative summary cards inside the workspace
- empty states using the existing shadcn empty pattern: icon, concise explanation, primary action
- responsive collapse: inspector becomes a drawer, then folder tree becomes a drawer on narrow widths

## Data flow and API boundaries

- `POST /api/resource-packs` creates a draft Pack from metadata.
- `PATCH /api/resource-packs/:id` updates Pack metadata/status.
- `POST /api/resource-packs/:id/folders` and `PATCH`/`DELETE` manage folder nodes.
- `POST /api/resource-packs/:id/elements` uploads one element and its metadata using a resumable/progress-aware request.
- `PATCH /api/resource-elements/:id` updates inspector metadata.
- `DELETE /api/resource-elements/:id` removes metadata and its Storage object after confirmation.
- `POST /api/resource-packs/import` remains the ZIP migration endpoint and writes into the same Pack/element model.

Storage object paths are namespaced by Pack and folder path. Database metadata is the source of truth for hierarchy and semantic fields; Storage is the binary payload layer.

## Validation and failure handling

- Creation blocks only on the four required fields.
- Upload validates size, supported format, duplicate path, and folder traversal before starting.
- Failed uploads remain visible with the exact server error, retry, and remove actions.
- Metadata and binary writes use explicit states (`queued`, `uploading`, `ready`, `failed`) so refresh does not lose work.
- Publish is blocked by incomplete uploads, missing required metadata, invalid dependency references, or failed persistence.
- ZIP import reports per-file failures and leaves a recoverable draft instead of silently deleting successful files.

## AI consumption

AI receives a Pack manifest assembled from Pack metadata, folder tree, element semantic metadata, and dependency edges. It can select by style, game type, dimension, category, and capability without parsing filenames. Human edits to detected metadata are preserved as authoritative overrides.

## Testing strategy

- Core: Pack/folder/element validation, hierarchy operations, dependency validation, and publish preconditions.
- Server: CRUD routes, Storage path generation, resumable/progress state transitions, cleanup on failed binary or metadata writes, and ZIP migration compatibility.
- Frontend: creation wizard, tree navigation, upload queue states, inspector edits, draft persistence, publish blocking, and empty/error states.
- Acceptance: create a mixed 2D/3D Pack, upload a folder batch, refresh during upload, edit metadata, publish, and consume the resulting manifest through the AI resource-selection path.

## Out of scope for this iteration

- AI-generated assets
- automatic visual style inference beyond format/type suggestions
- end-user Pack authoring (this remains an admin capability)
- marketplace licensing and billing workflows
