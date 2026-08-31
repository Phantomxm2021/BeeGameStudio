# SDD ledger — plan: docs/superpowers/plans/2026-08-31-game-ir-gameplay-balance.md

Baseline: f5e15519; linked worktree `codex/game-ir-stage-isolation`; Game IR 81/81 pass.

## Preflight scan

| Scope | Producer / tests | Consumer / implementation | Finding |
| --- | --- | --- | --- |
| Task 1 | exports one shared single-module Core admission path | complete candidate admission and Tasks 5–6 assemblers reuse it | Clean: one parser boundary; global closure remains complete-candidate-only. |
| Task 2 | emits exact source envelopes, producer identities, disjoint target accounting | Tasks 5–6 semantic packet/result admission and assemblers | Clean: identities derive from source; empty mechanical ownership is valid but never a fallback. |
| Task 3 | exports closed Gameplay schema and role manifest | Task 5 semantic admission and assembler; Task 7 cross-domain gate | Clean: Task 5 consumes the manifest rather than defining a second role table. |
| Task 4 | exports closed Balance schema, role manifest, and unit/formula validation | Task 6 semantic admission and assembler; Task 7 cross-domain gate | Clean: derived formula dependencies remain validator-owned, not producer summaries. |
| Task 5 | emits one Gameplay module projection | Task 6 optional same-revision cross-domain targets; Task 7 integration | Clean: projection is not a partial candidate and is never published. |
| Task 6 | emits one Balance module projection | Task 7 integration | Clean: semantic variable records are mechanically reverified; no header heuristic or second writer. |
| Tasks 1 and 7 | Task 1 modifies `model.test.ts`; Task 7 only consumes its API through integration | no shared modified file | Clean: Task 7 does not reopen Core admission. |
| Tasks 2, 5, and 6 | Task 2 owns shared domain contracts | Tasks 5–6 only create domain-specific files | Clean: no later task mutates shared ownership semantics. |
| Tasks 3, 5, and 7 | Task 3 owns Gameplay validation | Tasks 5/7 exercise it without modifying `gameplay-schema.ts` | Clean: one Gameplay authority. |
| Tasks 4, 6, and 7 | Task 4 owns Balance validation | Tasks 6/7 exercise it without modifying `balance-schema.ts` | Clean: one Balance authority. |
| Task 7 shared tests/docs | modifies `stage-boundary.test.ts`, `foundation-parity.test.ts`, spec, and redesign status | consumes final Phase 4 APIs | Clean: changes are isolation evidence/status only; production and protected files remain untouched. |
| Task 1 internal | RED tests demand exported parser; implementation extracts/reuses existing parser; listed files match commit | same task | Clean. |
| Task 2 internal | RED closure/identity/overlap tests match exact source and receipt primitives; listed files match commit | same task | Clean. |
| Task 3 internal | complete graph fixture and mutations match strict parsers/role/reachability code; listed files match commit | same task | Clean. |
| Task 4 internal | unit/formula/economy mutations match inference/closure implementation; listed files match commit | same task | Clean. |
| Task 5 internal | authority and assembler tests match semantic admission and one assembler; listed files match commit | same task | Clean. |
| Task 6 internal | semantic ownership/literal recheck and assembler tests match implementation; listed files match commit | same task | Clean. |
| Task 7 internal | integration/isolation tests match status-only doc changes and verification commands | same task | Clean. |

Preflight correction applied before execution: the approved spec's stale phrases “variable-table mechanical extraction” and “unknown/duplicate columns” contradicted its binding semantic-ownership ruling. They were replaced by semantic record admission plus exact literal mechanical reverification in f5e15519. No execution ruling remains open.

Task 1: evidence check — reviewer did not rerun reported commands by design; report contains exact RED failure, GREEN 20/20, full Game IR 84/84, typecheck, and diff-check results, so the non-diff verification item is resolved.
Task 1: complete (commits f5e1551..1d09766, review clean)

Task 2: Ruling: the envelope must retain both the complete receipt-bound authority Section Index and the fixed domain-selected Section Index; keep `sectionIndex` as the selected closure for source bytes and add a distinct full authority index committed by `sourceDigest`, which Core admission consumes — this resolves the approved spec's internal mismatch between a domain subset and Core's full `sectionIndexDigest` without weakening either boundary — if wrong, the public Phase 4 envelope gains one field that later tasks and the written spec must carry.
Task 2: Ruling: mechanical `ownedTargets` is not caller authority; it must equal canonical service-derived ownership for the admitted mechanical nodes, and nested node admission must reuse the Core module parser rather than maintain a shallower node parser — this follows the spec's complete-accounting and single-parser requirements — if wrong, mechanically emitted cross-domain references may need a later dedicated admission surface.
Task 2: fix round 1/5 (5 addressed, 1 open — regression tests can pass through target-accounting errors and authority narrowing does not mutate authoritySectionIndex; commits 0816186..8b22f4b)
Task 2: fix round 2/5 (1 addressed, 0 open — targeted regressions now isolate Core nested admission and full authority narrowing; commits 8b22f4b..0532970)
Task 2: complete (commits 1d09766..0532970, review clean)

Task 3: Ruling: “duplicate actions/transitions” means duplicate explicit Core identity or an explicitly modeled structural identity, never duplicate display labels; because V1 defines no separate action signature, remove label-based rejection and rely on Core IDs plus closed relationship roles — this follows the spec statement that labels are display identities and the ban on inferred semantics — if wrong, V1 will need a future explicit action-signature field rather than a name heuristic.
Task 3: minor (deferred): exported singleton-role alias has drifted from the primary manifest; later producer tasks must consume the primary manifest, and final review must decide whether to derive or remove the alias.
Task 3: minor (deferred): fixture does not yet cover every closed condition/effect AST branch; final review should triage coverage after the Core-admitted fixture fix.
Task 3: fix round 1/5 (2 addressed, 0 open — removed label identity inference and Core-admitted the fully bound fixture; commits 19447b9..c830848)
Task 3: complete (commits 0532970..c830848, review clean; 2 deferred minors recorded above)

Task 4: minor (deferred): `BALANCE_SINGLETON_ROLES` duplicates the primary role manifest and can drift; final review must decide whether to derive it or remove it before a consumer exists.
Task 4: fix round 1/5 (4 addressed, 1 open — unused-variable wrong-unit production guard is fixed but its regression is masked by formula reachability; commits 14e1359..922b9c3)
Task 4: minor (deferred): pre-existing negative-test matrices omit the required external Gameplay target and may fail before their intended mutation; final review must triage isolation coverage.
Task 4: fix round 2/5 (1 addressed, 0 open — unused wrong-unit regression now isolates the eager Balance guard; commits 922b9c3..d114ec0)
Task 4: complete (commits c830848..d114ec0, review clean; 2 deferred minors recorded above)

Task 5: review finding — production authority/assembly is compliant, but real eight-document dual-source determinism and the required trust-boundary mutation matrix are missing; test-only fix required.
Task 5: fix round 1/5 (0 fully addressed, 2 open plus 1 new Important — fixture signs a reduced one-section-per-document authority, mutation tests are partly masked, and signed-receipt reordering is incorrectly normalized before digest verification; commits 59d61d9..0df466c)
Task 5: Ruling: a duplicate node ID across producers necessarily duplicates the canonical `/id` ownership target, so the earliest valid rejection is ownership overlap during semantic admission/revalidation; the assembler test must invoke the assembler with a forged cross-receipt duplicate and prove rejection, but must not add a second raw-node authority or bypass receipt validation merely to reach a later duplicate-ID branch — if wrong, the plan's requested assembler-specific error remains unobservable by design.
Task 5: fix round 2/5 (5 addressed, 0 scoped open — complete closure/bytes/accounting/duplicate/canonical receipt tests pass and signed reorder is rejected; commits 0df466c..82ffda6)
Task 5: Ruling: Foundation's receipt-bound Section Index array order is the single ordering authority; Game IR must validate its exact digest and unique section identity, then preserve that authenticated order when selecting a domain closure, rather than re-author it with either `localeCompare` or code-unit sorting — this removes the production-reachable dual ordering exposed by unpadded line numbers while keeping protected Foundation bytes untouched — if wrong, callers that relied on Game IR imposing a second order will now retain Foundation order instead.
Task 5: load-bearing correction required before Task 6 — remove Game IR's duplicate Section Index ordering authorities and delete fixture-only line padding that masked the mismatch.
Task 5: correction review rejected c7b0f980 — Foundation digest canonicalizes before hashing and therefore authenticates the Section Index set/content, not caller array order; preserving input order admits multiple downstream orders. Generic semantic closure also retained an implicit Map-insertion order authority.
Task 5: Ruling (supersedes the prior order-preservation ruling): Foundation receipt digest is the immutable authority for the Section Index set/content; Game IR derives one unique code-unit order through one shared canonicalizer used by Core, domain-source, and generic semantic admission — this matches the approved Task 2 plan, eliminates locale/code-unit and Map-order dual tracks, and never treats caller permutation as authority — if wrong, Game IR canonical bytes will use code-unit order rather than Foundation's permutation-insensitive digest implementation order.
Task 5: section-order correction fix round 1/5 (3 addressed, 0 open — one shared canonicalizer now serves Core/domain/semantic/publication; commits c7b0f98..ccf46e0)
Task 5: complete (commits d114ec0..ccf46e0, review clean)

Task 6: review rejected initial implementation — `sourcePointer` is syntax-only and verification uses global substring search; complete profiles and mandatory negative matrix are missing; Gameplay projection taskId is not bound.
Task 6: Ruling: semantic source evidence uses canonical `/bytes/<start>/<end>` UTF-8 byte ranges relative to the exact admitted section; the service resolves that one slice, requires it to equal `literal`, and reparses the literal against the target's actual JSON leaf type (including empty containers) — this adds no table schema or second writer and removes ambiguous substring search — if wrong, future Foundation formats may need a richer cell-coordinate pointer version.
Task 6: Ruling: current Phase 4 Balance source contracts declare no unambiguous mechanical field roles, so Balance mechanical nodes and verified claims must both be empty; nonempty mechanical output is unauthorized, not a fallback candidate. Future explicitly canonical formats require a new approved contract rather than implicit cross-section substring search — if wrong, a currently machine-authoritative Balance field will remain semantic-owned in Phase 4.
Task 6: fix round 1/5 (2 production findings addressed, 3 test/profile findings open — exact slices and Gameplay identity fixed, but formula-dense profile is metadata-only and negative matrix remains masked; commits 3dcf90d..acb4a72)
Task 6: Ruling: an exact byte range identifies the chosen occurrence; when two different ranges contain the same literal, semantic authorship determines which occurrence supports the field because the current Foundation contract declares no machine-readable cell roles. Tests must prove explicit ranges select distinct occurrences without first-match search, not invent a heuristic that rejects equal literals — if wrong, the future source contract must add authoritative cell-role coordinates.
Task 6: fix round 2/5 (profile and most guards addressed, 3 open — forged Gameplay projection is only Core-valid, mechanical-node and actual UTF-8 split cases absent; commits acb4a72..eb44d90)
Task 6: Ruling: an optional Gameplay projection consumed by Balance must be revalidated by both Core and `parseGameplayModule`; for bidirectional references, Gameplay typed validation receives the current Core-admitted Balance node map before Balance's own typed validation receives the Gameplay map — this closes both domains without trusting a digest-only forged projection — if wrong, cross-domain validation order may need a future pair-level validator, but Core-only acceptance is not allowed.
Task 6: fix round 3/5 (all 6 remaining findings addressed — typed Gameplay boundary, valid profile, mechanical node, UTF-8 split, boolean/null coverage; commits eb44d90..1312e11)
Task 6: complete (commits ccf46e0..1312e11, review clean)

Task 7: initial review rejected completion gate — production isolation scan was vacuous (empty file list and path strings parsed as source), and the required Biome directory command failed on Phase 4-owned Task 2 files.
Task 7: fix round 1/5 (2 addressed, 1 documentation status contradiction open — real six-file AST gate and Biome pass; stale line still says Gameplay/Balance unimplemented; commits f587330..3bbb546)
Task 7: fix round 2/5 (stale producer paragraph addressed, 1 wording issue open — domain modules are Phase 5–7, not Phase 5–9; commits 3bbb546..48c2b04)
Task 7: fix round 3/5 (roadmap wording addressed, 0 open — independent Task 7 re-review clean; commits 48c2b04..55eedcc)
Task 7: fix round 4/5 (accepted status accurately recorded, 0 open; commits 55eedcc..48f10a2)
Task 7: complete (commits 1312e11..48f10a2, review clean)

Final root-cause correction: implementation fixed; automated verification
complete; independent final re-review pending. Scope remained limited to the
recorded Phase 4 findings; no Phase 5+ or production
routing/publication/persistence work was added.

Final correction dispositions:

- Critical mechanical authority: Gameplay and Balance now both require empty
  mechanical nodes and verified claims; every non-empty receipt is rejected.
- Critical final assembly authority: standalone Gameplay and Balance final
  assemblers were removed. One pair assembler re-admits both source/receipt
  triples, Core-admits both complete maps, enforces one task/revision/READY
  identity, validates both typed maps, and only then signs both projections.
- Important diagnostics: strict projected/missing/ambiguous result union added
  with packet/source identity, canonical node subjects, existing reason codes,
  evidence pointers, and no Foundation-state route.
- Important manifest authority: producers derive source scope from the
  validated selected Section Index and kinds/value fields/roles from the single
  manifest for each domain; local document and role/value-field copies removed.
- Important test isolation: both 17-case Balance matrices receive legal
  Gameplay targets and mutations reach their named guards. Gameplay condition,
  scalar-side, and effect branch matrices are complete.
- Minor boundary/API items: property/namespace calls and computed provider
  dispatch have positive/negative AST fixtures; shared projection APIs are
  object-input only.

Final correction evidence: focused Phase 4 files 101/101 pass with 380
assertions after the paired identity additions; full Game IR 192/192 with 900
assertions across 14 files;
exact Foundation 21-file suite 263/263 with 1439 assertions; protected parity
plus full-server unreachable scan 10/10 with 131 assertions; root and server
typechecks pass. Final Biome and diff checks are recorded in the Task 7 report.
