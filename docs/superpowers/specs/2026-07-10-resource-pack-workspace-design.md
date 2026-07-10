# Resource Pack Workspace design

## Goal

Turn the Pack detail page into a fixed asset-workspace for administrators: a
scrolling file explorer on the left, a fixed preview stage on the right, and a
deliberate inspector that opens only on request. Pack creation, editing, cover
upload, publishing, and deletion use real resource-service and Supabase Storage
operations.

## Workspace layout

The Pack workspace fills the resource-library page viewport below its global
header. The page itself does not scroll. It has a fixed Pack toolbar and a
two-column body:

- The left explorer has a fixed width and is the only scrolling region. Pack
  root and folders are expand/collapse controls only; they never select or
  preview assets. Files are the only selectable rows.
- The right preview stage fills the remaining area. It has no breadcrumb,
  folder name, grid/list switcher, or resource-type shortcuts.
- With no selected file, the stage shows an empty state: “尚未选择文件” and a
  concise prompt to select a file from the explorer.
- With a selected file, a top-left read-only overlay has one value per line:
  filename including extension, format, file size, and type-specific summary.
  For models the summary includes triangle count when available.
- The top-right Info button appears only while the inspector is closed. Clicking
  it opens the right-side overlay inspector and hides the button. Closing the
  inspector restores it.

## Toolbar and Pack lifecycle

The toolbar action order is:

1. A management Button Group containing `编辑 Pack` and `发布`.
2. A separate primary `＋ 添加文件` action.

`编辑 Pack` opens an edit dialog based on the Create Pack dialog. It edits
name, primary category, dimension, styles, game types, and adds a cover upload
field. It saves one Pack update request and reports errors inline.

`删除 Pack` lives in the edit dialog’s danger zone. It requires a typed Pack
name confirmation. On success it removes Pack metadata, elements, folders,
cover, and all Storage objects below the Pack prefix, then returns to the Pack
list. The delete endpoint is administrator-only and is idempotent when the
Pack is already absent.

The cover endpoint accepts image and video formats used by the existing Pack
cover contract (`jpg`, `jpeg`, `png`, `webp`, `gif`, `mp4`, `webm`). It stores
the object below the Pack prefix, updates `cover_path`, and removes the prior
cover object once its replacement is committed.

## Element preview matrix

All previews load from a short-lived signed resource URL issued by the resource
service. A loading state and a clear unsupported/error state are required.

| Resource | Formats | Preview |
| --- | --- | --- |
| Image | png, jpg, jpeg, webp, gif, svg | Contained image with intrinsic size. |
| Audio | mp3, wav, ogg, m4a, aac | Native audio player with duration. |
| Video | mp4, webm | Native video player with controls and duration. |
| 3D model | glb, gltf, obj, fbx | Three.js orbit preview with loading/error state; statistics are read from parsed geometry. |
| Font | ttf, otf, woff, woff2 | `FontFace` preview showing family/style and sample text. |
| Document | pdf, txt, md, json, csv | Embedded PDF or safe text/structured view. Other document binaries show a supported document card with metadata and download/open action until a server conversion preview is available. |

No preview renderer executes arbitrary file content. Documents render as text or
PDF; no untrusted HTML is injected.

## Element information model

The stage overlay is read-only and intentionally compact. The inspector is the
editing surface and has an explicit `保存更改` action.

Universal inspector fields:

- name, extension, MIME type, byte size, relative path, upload/processing
  status, resource type, element category;
- optional style and dimension override, content tags, dependency references;
- Pack inheritance summary (style, dimension, primary category).

Type-specific read-only fields are populated only when discovered; missing
values render `—`, never guessed:

| Type | Fields |
| --- | --- |
| Image | width, height, alpha, color profile if discovered |
| 3D | triangles, vertices, material count, texture dependencies, LOD count, bounds, skeleton/animation references, UV channels if discovered |
| Audio | duration, sample rate, channels, codec/bit rate if discovered |
| Video | duration, width, height, frame rate, codec, audio track metadata if discovered |
| Font | family, style, weight, format, glyph coverage if discovered |
| Document | page count, text encoding, MIME type |

The resource service keeps raw technical metadata in `specs`. The preview may
calculate model geometry metrics locally for display, then persist confirmed
serializable metrics through the existing element-update path.

## Service/API changes

- Extend Pack updates to accept the editable metadata fields only; map frontend
  camelCase to database columns rather than forwarding arbitrary request keys.
- Add `POST /api/resource-packs/:id/cover` for multipart cover upload.
- Add `DELETE /api/resource-packs/:id` for Pack deletion and Storage-prefix
  cleanup.
- Add a signed element-resource URL to element read responses. The URL is
  derived server-side and never exposes a service-role key.
- During element upload, persist universal file `specs` (`size`, `mimeType`,
  extension) and infer kind/category conservatively from MIME/extension.
- Add deletion and cover functions to the frontend API client.

## Tests

- Service: cover replacement, Pack deletion (metadata and storage cleanup),
  signed resource URL authorization, and element upload specs.
- Frontend: folder clicks do not select assets; file clicks do; empty state;
  Info toggle and explicit save; toolbar grouping; edit dialog payload; delete
  confirmation; preview renderer selection and safe fallback per file type.
- Layout: the workspace root is viewport-bound, only explorer scrolls, and the
  stage does not include the removed breadcrumb/view-mode controls.
