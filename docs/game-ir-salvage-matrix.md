# Game IR salvage matrix

This ledger is the Phase 1 boundary for the Game IR work. It records the
previous dirty-tree Game IR attempt and the small set of ideas that are safe
to carry into the isolated Stage 5 core. Every entry has exactly one outcome;
no dirty worktree state, generated artifact, or uncommitted run is migrated.

The stable Foundation baseline is `70df2e2c`. The protected Stage 3/4 files
(`types.ts`, `schema.ts`, `controller.ts`, `transition.ts`, and `recovery.ts`)
remain byte-identical to that baseline. The parity test also runs the stable
deterministic, semantic, revision-batch, and targeted-recheck helpers twice.

## Ledger

| Old path or symbol | Category | Why | Dependencies and later consumer |
| --- | --- | --- | --- |
| `game-ir.ts` dirty-tree compiler and its generated output | DISCARD | It combined typed-owner compilation with Foundation routing and was never a Phase 1 authority. Dirty-tree state is not a source artifact. | None; reconstruct from the receipt-bound Stage 5 contracts in the Gameplay + Balance plan. |
| `GameIrState` / `gameIrState` | DISCARD | A mutable workflow state and second writer would create a second Stage 5 authority. | None; `GameIrReadyReceipt` and the immutable publication are the only future handoff. |
| `GAME_IR_COMPILATION` controller/schema/transition/recovery branches | DISCARD | They make incomplete Stage 5 reachable from Stage 3/4 and alter persisted Foundation routing. | None; a later consumer-cutover plan may add a route only after all Stage 5 modules are complete. |
| typed-owner parser used as the Stage 3 Reviewer | DISCARD | It was a Stage 3 replacement that removed or competed with the Foundation Fact Store. Stage 3 remains the stable deterministic/semantic Reviewer. | None; the isolated Stage 5 model has its own strict source-binding parser. |
| Game IR parser admission invoked by Stage 4 Revision | DISCARD | Stage 4 legality is determined by its Issue Registry, Patch, and Targeted Recheck; Stage 5 diagnostics cannot become Foundation issues. | None; Stage 5 admission stays downstream of a READY receipt. |
| Foundation Fact/Contract/Rule deletion or weakening from the dirty attempt | DISCARD | These are Stage 3 authority changes, not portable Game IR work, and would invalidate the stable baseline. | None; any future Foundation defect is independently reproduced and separately audited. |
| one-off test keywords, paths, formats, or project-specific defaults | DISCARD | Test-only accommodations are not product authority and cannot justify a migration or compatibility branch. | None; future fixtures construct only receipt-bound canonical inputs. |
| direct writes to `foundationAuditState` or the Issue Registry | DISCARD | Stage 5 is read-only with respect to Foundation authority. | None; only the outer adapter may translate a future `FoundationDefectReport`. |
| legacy reader, migration reader, fallback, compatibility alias, or hot migration | DISCARD | They would create multiple readers or allow stale/old schemas to become reachable. | None; future cutover deletes the old reader in the same commit as each consumer switch. |
| legacy `latest`, candidate alias, or mutable current pointer | DISCARD | Publication is revision-bound and has one complete-directory visibility boundary. | None; `COMMITTED.json` and `GameIrReadyReceipt` are sufficient. |
| per-file final-directory copy and self-signed recovery | DISCARD | Recovery must rebuild expected bytes from external authority; partial final trees must never look READY. | None; atomic directory publication/recovery already covers the cut points. |
| canonical JSON and SHA-256 encoding | KEEP | It provides byte-stable identity for receipts, candidates, packets, and artifacts. | Current contracts/model/publication; every future Stage 5 module. |
| `SourceBinding` identity and exact source-pointer namespace | KEEP | Unique owner/derived evidence is required for candidate admission and validator coverage. | Current model and semantic admission; all seven canonical modules. |
| canonical ID/reference and dependency-graph closure checks | KEEP | They are domain-independent integrity checks, not old product decisions. | Current model/publication; Gameplay, Balance, World, and later consumers. |
| staging/journal/atomic-directory publication and `COMMITTED` marker | KEEP | The crash-safe publication boundary is valid when driven by external authority. | Current publication/recovery; future Resource and Implementation consumers. |
| stale authority rejection and recovery cut-point coverage | KEEP | Foundation revision/digest binding prevents detached or stale output. | Current contracts/publication; every Stage 5 cutover. |
| one-to-many logical-resource realization projection | KEEP | A logical requirement may legitimately have variants and multiple delivery artifacts. | Resource Realization plan and downstream Resource Planner/Curator. |
| resource authority binding from the dirty implementation | ADAPT | Preserve the authority relationship, but derive it from the strict READY receipt and new resource module rather than old manifest fields. | Resource Realization plan; Resource Planner and Content consumer. |
| current nine-module typed schema | ADAPT | Its module inventory and identity ideas are inputs only; the Stage 5 schema must cover the seven canonical modules and the full product definition. | Gameplay + Balance, World + Presentation, Resource, and Implementation plans. |
| typed-record compiler | REWRITE | The old compiler encoded shallow records and mixed responsibilities. Producers must have disjoint mechanical/semantic/derived fields and strict source coverage. | Gameplay + Balance producer plan, then the remaining module plans. |
| Checklist ID binding | ADAPT | Stable IDs can provide traceability, but Checklist content remains the raw Markdown Foundation projection. | Acceptance Checklist cutover after Stage 5 publication. |
| Manifest authority binding | ADAPT | Keep a manifest as a derived publication artifact, not a caller-supplied or mutable authority. | Current publication; all downstream readers after consumer cutover. |
| Foundation Reviewer changes made during Game IR development | REPROVE | Those deltas have no migration credit. A change is eligible only after an independent test reproduces it on the stable baseline. | Foundation defect plans; any accepted fix is a separate audited commit. |
| Foundation Revision changes made during Game IR development | REPROVE | Revision behavior, Patch validation, and Targeted Recheck must be demonstrated independently before any reuse. | Foundation Revision maintenance plan; no Stage 5 dependency. |
| dirty Reviewer/Revision fixture data, run state, and generated receipts | DISCARD | Persisted dirty-tree evidence is not canonical authority and cannot be replayed into the new strict contracts. | None; create fresh fixtures from a READY Foundation receipt. |
| resource/consumer routing changes from the dirty attempt | DISCARD | No Stage 5 consumer is cut over in Phase 1; retaining a partial route would create a fallback or dual reader. | None; each consumer is migrated once in the later single-track cutover. |

## Boundary result

The Phase 1 core now integrates and tests `core`, `gameplay`, `balance`,
`world-scene`, `presentation`, `resource-realization`, and
`implementation-verification` candidates, but no production controller,
transition, schema, or recovery route constructs a compile request. Foundation
Reviewer/Revision files import no Game IR symbols, and there is no legacy,
fallback, compatibility, dual-write, or fixed node/module/artifact cap.

The next plan may add Gameplay and Balance schemas and producers only through
`FoundationReadyReceipt`. It must preserve this ledger rule: an ambiguous or
unresolved Stage 5 projection is not a Foundation Issue unless an outer
adapter emits a separately validated defect report.
