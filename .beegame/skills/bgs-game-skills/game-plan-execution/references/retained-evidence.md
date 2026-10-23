# Retained BGS Evidence

Read this reference when a task needs to inspect saved BGS verification or Preview results, or source/resource details, before implementation or a rerun. The entry skill keeps the routing and evidence constraints; this file holds the concrete BGS tool parameters and source-specific procedures.

## Saved verification and resource records

In BGS, `ReadVerificationResults {}` reads the newest saved host result, including failed or unfinished records; `{"measurementId":"actual-id"}` selects one record. `{"previewReceipt":".beegame/tmp/preview-test-.../execution.json"}` reads an existing preview receipt. Optional `details:true` expands retained details. Use `CheckResourcesAndBindings {}` for current saved resource/file/member/frame checks, with `detailsFor` to inspect a UI/Scene binding source.

## Preview receipts

For BGS Preview, resolve the current supplied entry and its help. `--run` retains an `execution.json`, `stdoutPath` and `stderrPath`; `--inspect <execution.json>` reads that receipt and current boundary identity without running the test. Read the relevant saved output for assertion meaning: exit zero and unchanged identity do not prove correct coverage. Changed inputs or a host freshness rejection still require the appropriate new check; do not relabel old evidence. Expired access needs current authorized capability, not a copied URL or relaxed permissions.

## Authored UI and Scene sources

For raw fields in saved BGS UI JSON, prefer BGS file-reading tools, including authored actions and bindings. For targeted parsing, the CLI alternative is `bun <supplied-check-content-entry> --inspect-draft content/ui/<actual-source>.json --node <actual-id>` (repeat `--node` for related nodes). For geometry, use `CheckUiLayouts {}`; `{"detailsFor":"content/ui/<actual-source>.json"}` also returns that source's authored nodes, container constraints and coordinates alongside the layout checks. Use BGS file-editing tools for layout relationships, then recheck; edit the owning container for flow-controlled positions, and inspect variant selection when an override has no effect. Overlap candidates require design interpretation.

For saved BGS Scenes, use `CheckSceneLayouts {}` or `{"detailsFor":"content/scenes/<actual-source>.json"}` for structure/static 2D reference framing and coordinate context. Adjust source transforms/cells/Camera with BGS file-editing tools, then recheck. `CheckUiLayouts` remains authoritative for linked UI game-view allocation; missing geometry, 3D/XR space and traversal stay unverified. Use existing measurement inspection for runtime evidence. Saving request roundtrips is useful, but not a reason to skip necessary source reading or observations.
