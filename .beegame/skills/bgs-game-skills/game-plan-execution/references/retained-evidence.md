# Retained BGS Evidence

Read this reference when a task needs to inspect saved BGS verification or Preview results, or source/resource details, before implementation or a rerun. The entry skill keeps the routing and evidence constraints; this file holds the concrete BGS tool parameters and source-specific procedures.

## Saved verification and resource records

In BGS, `ReadVerificationResults {}` reads the newest saved host result, including failed or unfinished records; `{"measurementId":"actual-id"}` selects one record. `{"previewReceipt":".beegame/tmp/preview-test-.../execution.json"}` reads an existing preview receipt. Optional `details:true` expands retained details. Use `CheckResourcesAndBindings {}` for current saved resource/file/member/frame checks, with `detailsFor` to inspect a UI/Scene binding source.

## Preview receipts

For BGS Preview, resolve the current supplied entry and its help. `--run` retains an `execution.json`, `stdoutPath` and `stderrPath`; `--inspect <execution.json>` reads that receipt and current boundary identity without running the test. When source and inputs are unchanged, reuse the existing stable request key (`--request`), retained receipt or measurement ID to read the result rather than executing another check. Read the relevant saved output for assertion meaning: exit zero and unchanged identity do not prove correct coverage. Changed inputs or a host freshness rejection still require the appropriate new check; do not relabel old evidence. If a check fails, inspect its saved cause and change the relevant condition before rerunning; do not repeat the same failed command merely to refresh output. Expired access needs current authorized capability, not a copied URL or relaxed permissions.

## Runtime sources

Read the actual project source with file tools and inspect behavior in its chosen runtime. For existing BGS JSON only, use [saved UI diagnostics](../../game-ui-ux-designer/references/layout-calculation.md) or [saved Scene diagnostics](../../game-level-designer-expert/references/saved-scene-layouts.md) when those tools are exposed. Static geometry does not establish interaction or visual quality.
