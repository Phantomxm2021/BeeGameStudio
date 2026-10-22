# @beegame/scene-editor

Independent Three.js scene authoring module with React / React Three Fiber / Drei. The public entry is `src/public.ts`, re-exported by `src/index.ts`.

`SceneEditor({ initialDocument?, storageKey?, onSave? })` provides the hierarchy, viewport, Inspector, assets, local draft storage and import/export shell. A host can pass `onSave(document)` to persist the current Game Content Package scene through its project API; without it, Save uses the editor's local draft storage. `SceneHistory`, `applyPatch`, `patchFor`, and scene package readers/writers are also exported for hosts. The module owns its document, transactions, history and asset lifecycle.

Game IR is not a scene document. The editor opens the accepted Game Content Package scene, which remains the single editable scene authority. Collider/trigger descriptions are visual guides and do not execute physics. See [installation and contracts](../../docs/editors/README.md) and [verification](../../docs/editors/verification.md).

Development uses the repository Bun workspace and root `bun.lock`. From the repository root, run `bun install --frozen-lockfile`, then `cd packages/scene-editor` and run `bun run build` or `bun run test`. The obsolete package-local npm lockfile is no longer maintained.
