# SDD ledger — plan: docs/superpowers/plans/2026-09-01-game-ir-production-cutover.md

## Preflight

Spec reachable: `docs/superpowers/specs/2026-09-01-game-ir-production-cutover-design.md`.

### Task self-consistency

| Task | Tests against implementation/files | Finding |
|---|---|---|
| 1 | v46 schema, transitions, recovery | Complete at `996ea0dfc`; actual recovery work also required `recovery-projector.ts`, `controller.ts`, and canonical schema export. |
| 2 | checkpoint writer/loader, replay, recovery | Consistent; integration files may be unnecessary until Task 3 and must not be edited speculatively. |
| 3 | committed reader plus production route | Consistent; route work depends on Task 2 checkpoint authority. |
| 4 | Checklist bridge plus durable admission | Consistent; raw Markdown remains content authority. |
| 5 | digest closure/invalidation | Consistent; must reuse existing controller/restart paths. |
| 6 | resource projection and multi-artifact joins | Consistent; old flattened receipt is deleted, not adapted. |
| 7 | remove two Atomic Planner caps | Consistent and isolated. |
| 8 | execution read isolation | Consistent; prompt edits are guidance, mechanical gate is authority. |
| 9 | Resource Planner atomic cutover | Consistent after Tasks 3–6/8. |
| 10 | Resource Curator atomic cutover | Consistent after Tasks 3–6/8. |
| 11 | Content atomic cutover | Consistent after Tasks 3–6/8. |
| 12 | Atomic Planner atomic cutover | Consistent after Tasks 3–8. |
| 13 | Implementation Worker atomic cutover | Consistent after Tasks 3–8/12. |
| 14 | Implementation Auditor atomic cutover | Consistent after Tasks 3–8/12–13. |
| 15 | Acceptance atomic cutover | Consistent after Tasks 3–8/12–14. |
| 16 | static and full acceptance matrix | Consistent; no Chrome belongs in Phase 8. |

### Shared-file/interface scan

| Tasks | Producer → consumer/shared surface | Finding |
|---|---|---|
| 1→2 | v46 `GameIrState` → checkpoint pointer/recovery | Clean. |
| 1→3 | phase/state route → compilation reader/route | Clean. |
| 1→4 | bridge state/transition → bridge admission | Clean. |
| 1→5 | v46 state → closure/invalidation | Clean. |
| 1→6 | resource receipt schema → strict multi-artifact shape | Task 6 intentionally replaces the Task 1-preserved resource shape. |
| 1→8 | dispatch/run schema → execution scope | Clean. |
| 2→3 | checkpoint replay → committed reader | Clean. |
| 2→5 | checkpoint identity → invalidation closure | Clean. |
| 2→16 | durable replay → matrix/static gate | Clean. |
| 3→4 | committed reader → bridge validator | Clean. |
| 3→5 | ready receipt digest → closure | Clean. |
| 3→8 | compilation dispatch → scoped session | Clean. |
| 3→9 | committed reader → Resource Planner | Clean. |
| 3→10 | committed reader → Resource Curator | Clean. |
| 3→11 | committed reader → Content | Clean. |
| 3→12 | committed reader → Atomic Planner | Clean. |
| 3→13 | committed reader → Implementation Worker | Clean. |
| 3→14 | committed reader → Implementation Auditor | Clean. |
| 3→15 | committed reader → Acceptance | Clean. |
| 3→16 | single reader/route → static gate | Clean. |
| 4→5 | bridge receipt digest → closure | Clean. |
| 4→9 | bridge digest → Resource Planner packet | Clean. |
| 4→10 | bridge digest → Curator packet | Clean. |
| 4→12 | bridge receipt → Atomic Planner | Clean. |
| 4→15 | bridge traceability → Acceptance | Clean. |
| 4→16 | durable bridge → matrix/static gate | Clean. |
| 5→6 | closure fields → resource receipt/join | Clean. |
| 5→9 | closure → Planner cutover | Clean. |
| 5→10 | closure → Curator cutover | Clean. |
| 5→11 | closure → Content cutover | Clean. |
| 5→12 | closure → Atomic Planner cutover | Clean. |
| 5→13 | closure → Implementation Worker | Clean. |
| 5→14 | closure → Auditor | Clean. |
| 5→15 | closure → Acceptance | Clean. |
| 5→16 | invalidation matrix → final matrix | Clean. |
| 6→9 | resource projection → Planner | Clean. |
| 6→10 | multi-artifact join → Curator | Clean. |
| 6→11 | inventory/delivery join → Content | Clean. |
| 6→12 | actual resource join → Atomic Planner | Clean. |
| 6→13 | actual resource join → Implementation Worker | Clean. |
| 6→14 | actual resource join → Auditor | Clean. |
| 6→15 | actual evidence join → Acceptance | Clean. |
| 6→16 | resource cardinality cases → final matrix | Clean. |
| 7→12 | uncapped structural planner → IR cutover | Clean. |
| 7→16 | no-cap behavior → final matrix diagnostics | Clean. |
| 8→9 | empty/scoped project reads → Planner | Clean. |
| 8→10 | empty/scoped project reads → Curator | Clean. |
| 8→11 | explicit read/repair paths → Content | Clean. |
| 8→12 | no raw-doc reads → Atomic Planner | Clean. |
| 8→13 | execution scope → Implementation Worker | Clean. |
| 8→14 | execution scope → Auditor | Clean. |
| 8→15 | Checklist-only projection scope → Acceptance | Clean. |
| 8→16 | mechanical deny gate → static matrix | Clean. |
| 9↔10 | shared `resource-stage`/controller/contracts/prompts | Sequential atomic cuts; each deletes only its own old route. |
| 9↔11 | shared `resource-stage`/controller/contracts/prompts | Sequential atomic cuts; no intermediate dual reader per consumer. |
| 10↔11 | shared resource inventory/content surfaces | Curator receipt authority precedes Content closure. |
| 9→16 | Planner cutover → static gate | Clean. |
| 10→16 | Curator cutover → static gate | Clean. |
| 11→16 | Content cutover → static gate | Clean. |
| 12↔13 | shared controller/contracts/prompts | Atomic plan authority precedes worker scope. |
| 12↔14 | shared controller/contracts/prompts | Planner outputs feed audit closure. |
| 12↔15 | shared controller/contracts/prompts | Plan closure feeds acceptance. |
| 13↔14 | shared controller/session/contracts/prompts | Worker output precedes auditor; no shared raw-doc route retained. |
| 13↔15 | shared controller/session/contracts/prompts | Implementation evidence feeds acceptance through closure. |
| 14↔15 | shared validation/controller/session/contracts/prompts | Auditor evidence precedes acceptance; distinct consumers, one reader. |
| 12→16 | Atomic Planner cutover → static gate | Clean. |
| 13→16 | Implementation Worker cutover → static gate | Clean. |
| 14→16 | Auditor cutover → static gate | Clean. |
| 15→16 | Acceptance cutover → static gate | Clean. |

Ruling: Task 1 may include `recovery-projector.ts`, `controller.ts`, and `game-ir/contracts.ts` beyond the original file list because strict v46 downstream state made those canonical paths load-bearing; production Foundation behavior remains unchanged. Cost if wrong: Task 1 must be split/reverted and downstream recovery reworked.

Task 1: complete (commit `996ea0dfc`, main audit clean; 126 tests, 394 assertions, typecheck, lint, diff-check pass).

Task 2: fix round 1/5 (4 addressed, 4 open — atomic existing-final validation/cross-process durability; monotonic recovery under lease/CAS winner; complete durability matrix; component-safe workspace-anchored paths; commits `143285cf4..8a3d0f69e`).

Task 2: fix round 2/5 (1 addressed, 3 open plus 2 new — no-replace/stale caller/nested lock; missing exact identity/previous/conflict/concurrency matrix cases; loader workspace anchoring/secure reads; commits `8a3d0f69e..3293260bf`).

Task 2: Ruling: the public writer signature remains the plan-specified `{ workspacePath, deliveryRun, step, authority }`; the writer owns exactly one run-store mutation lease, verifies the durable run under that lease, and must fail fast on a nested same-process lease rather than accepting an optional second locking route. Cost if wrong: Task 3 may need an API change to pass a lease explicitly and all writer call sites/tests must be revised.

Task 2: fix round 3/5 (1 addressed, 3 open — stale-path lease leak and cross-process failFast misclassification; exact record/identity/predecessor/tree/CAS/conflicting-winner tests incomplete; in-scope no-replace review remains tied to lock correctness; commits `3293260bf..2f83e4088`).

Task 2: fix round 4/5 (production lease/failFast and recovery CAS addressed; test-evidence gaps open — deterministic cross-process handshake, digest-resealed envelope/predecessor mutations, missing committed record, conflicting service-valid concurrent winner; commits `2f83e4088..868ab05ce`).

Task 2: fix round 5/5 (4 addressed, 1 open — cross-process waiter test has IPC-held lease but does not expose an internal "writer reached lock contention" barrier; commits `868ab05ce..573f35731`).

Task 2: parked — cross-process waiter test cannot prove the precise internal contention instant without adding a production test hook — Ruling: production `failFast` explicitly requires the active lease PID to equal `process.pid`, the child holds a distinct PID lease through IPC, and the 22-test matrix plus main rerun is sufficient; defer a lock-acquisition observation hook because it would expand production API solely for testing. Cost if wrong: a future run-store refactor could make the cross-process waiter test pass without exercising contention and miss a regression.

Task 2: complete (commits `996ea0dfc..573f35731`, 1 parked; main verification 138 tests / 416 assertions, typecheck, lint, diff-check pass).

Task 1 follow-up fixture debt: complete (`2096c1009`) — deleted the old dual-track expectation (`activeUnitId=resource:inventory` with Foundation Review run) and now proves v46 recovery fails closed before Game IR/bridge handoff; main verification 127 tests / 396 assertions pass.

Task 3: fix round 1/5 — rejected commit `6ab7f13a0`. Critical: the route trusted a compiler worker's self-reported checkpoint/READY receipt without running the service-owned Phase 4→7 producer/admission, Task 2 writer, or publication commit; its empty read scope also made real compilation impossible, and the run crossed into Checklist before reader validation. Important: the dedicated reader test was only a throw smoke, progress identity/retry semantics were absent, public projections remained weakly typed, and both stage-boundary failures were left red instead of being precisely revised for the production cutover. Returned to the Task 3 implementer for root correction; no Task 4 or Foundation Reviewer/Revision changes are allowed.

Task 3: fix round 1 implementation submitted at `da95a4c4c`; independent re-review pending. The implementer reports service-owned Phase 4–7 admission/checkpoint/publication and 61 Task 3 tests passing, but explicitly leaves both compiler dispatches with empty project scope. This is not accepted as complete: the service must authenticate Foundation READY Section Index/section bytes and pass immutable source packets (or an equivalently narrow service-owned input), never grant broad worker document access and never ask an empty-scope worker to synthesize source authority.

Task 3: fix round 2/5 — `da95a4c4c` rejected. Service now owns writer/publication and validates the reader before persisting Checklist, but the worker still has no source input and self-reports 22 unknown internal authorities cast through `as never`; no domain admission APIs are used. Partial-checkpoint retry restarts Phase 4 and deadlocks against the durable predecessor, progress identity includes random dispatch identity, terminal dispatch/revision are not bound, projections omit payload, tests are primarily source-string assertions, boundary tests were weakened, and the typed durable diagnostic is incomplete. Returned for source-packet/model-DTO cutover, exact admission, durable phase resume, behavioral tamper/route tests, and precise boundaries.

Task 3: fix round 3/5 — commits `5a266f934` and `97af34c77` rejected. Source packets, strict model DTOs, service domain admission, terminal identity, durable diagnostics, and pre-persist reader ordering improved. Critical production blocker remains: the real worker session port has no compiler workflow schema/submission channel/terminal constructor, so a real result cannot reach controller admission. Other open items: secure no-follow source/reader IO; semantic progress normalization; recovered next-phase compiler protocol rather than a stale/full-six request; exact discriminated consumer projections; real checkpoint/publication/controller/tamper fixtures; precise zero-violation boundary allowlist; and correction of the reported 74 tests versus the reviewer's exact-command 64. Returned for the last same-implementer round before fresh implementation takeover.

Task 3: fix round 2 implementation checkpoint — `5a266f934` — service-built immutable source packets are authenticated from READY Section Index/document digests and included in both empty-scope compiler dispatch contracts; compiler DTOs are strict semantic/validation-only models with deterministic empty mechanical service authority; typecheck and focused admission/reader/UI tests pass.

Task 3: fix round 2 completion — pending final commit — dispatcher now binds terminal run/dispatch/task/revision/compile-request/READY identity; loader/recover resumes from the validated committed prefix and retries Phase 7 publication without restarting Phase 4; progress identity excludes transport randomness and distinguishes changed business state from identical/no-transition attention; durable diagnostics and schema-parsed reader payload projections are covered. Verification evidence is recorded in `task-3-report.md`.

Task 3: fix round 3 takeover checkpoint — native real session-port compiler structured-output path now installs the strict workflow schema and service-attaches terminal identity; source and committed-reader reads use shared component-safe O_NOFOLLOW handles; recovered compiler dispatch exposes remaining domain IDs and uses recovered state; progress canonicalizes module order/reason codes; stage route boundary uses an explicit allowlist; committed-reader test contains a real Phase 4–7 checkpoint/publication fixture with marker/manifest/checkpoint tamper cases. Exact Task3 command: 63 passed; checkpoint: 22 passed; worker session: 3 passed; typecheck and diff-check passed. Public reader positive fixture remains blocked by legacy test helper receipt path mismatch with the canonical adapter (documented in report).
