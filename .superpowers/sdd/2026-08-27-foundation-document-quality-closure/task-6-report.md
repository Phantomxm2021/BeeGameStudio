# Task 6 report — generalized eight-document quality contract

## Result

Extended the existing `GameDocumentContract` purposes with generalized quality requirements inferred from the eight-document audit. The contract now makes each document author responsible for reproducible evidence without adding a new checker, lane, or fixed business limit.

- Balance assigns owner inputs and units to the variables section, formula ordering/rounding/boundaries to formulas, recomputable results/totals to economy/progression/challenge, and the end-to-end validation chain to tuning.
- Level requires one coordinate space, explicit path/grid/slot/trigger/off-screen semantics, mutual exclusion, and computable layout evidence at the relevant ownership and acceptance boundaries.
- UI assigns viewport/safe-area/breakpoint/compression geometry to information architecture, minimum region sizes to HUD, hit/focus evidence to input, and overflow/scroll evidence to prototype acceptance.
- Art consumes Level and UI geometry and cannot invent layout dimensions; inline SVG boards are reserved for unique visual acceptance evidence.
- Audio explicitly maps manual pause, focus loss/restoration, and mute behavior and forbids marking available upstream documents as unavailable.
- Assets distinguish type, instance, and file; validation totals must be recomputed from unique detail.

## TDD evidence

### RED

Added focused contract assertions first and ran:

```text
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts
```

The new assertions failed against the previous contract because the relevant purposes lacked owner-input, coordinate/layout, interface, visual-authority, audio-state, and asset-count requirements.

### GREEN

After updating only existing section/material purposes and keeping the tests responsibility-scoped:

```text
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts
# 7 pass, 0 fail, 193 expect() calls

/Users/nswell/.bun/bin/bun run typecheck
# $ tsc --noEmit; passed

git diff --check
# passed with no diagnostics
```

## Self-review

- No case-specific terms, numeric limits, new document structures, second audit path, or compatibility branch were added.
- The quality vocabulary is distributed by responsibility rather than copied into every section, preventing the contract itself from creating prompt redundancy.
- Existing production-material IDs, section IDs, dependency graph, output policy, and parser behavior are unchanged.
- No protected semantic-audit, worker-prompt, session-port, or projection files were modified.

## Concerns

None identified within Task 6 scope. The broader eight-document quality audit remains a generation-time concern: existing case documents require a fresh run to demonstrate that these contract constraints produce consistent, non-duplicated outputs.
