# @beegame/scene-editor

Independent Three.js scene authoring module with React / React Three Fiber / Drei. The public entry is `src/public.ts`, re-exported by `src/index.ts`.

`SceneEditor({ initialDocument?, storageKey? })` provides the hierarchy, viewport, Inspector, assets, local draft storage and import/export shell. `SceneHistory`, `applyPatch`, `patchFor`, `importPublishedScene`, and scene package readers/writers are also exported for hosts. The module owns its document, transactions, history, asset lifecycle and storage namespace.

Published Game IR is read-only. Only explicit scene content or the labeled local fixture enables authoring. Collider/trigger descriptions are visual guides and do not execute physics. See [installation and contracts](../../docs/editors/README.md) and [verification](../../docs/editors/verification.md).
