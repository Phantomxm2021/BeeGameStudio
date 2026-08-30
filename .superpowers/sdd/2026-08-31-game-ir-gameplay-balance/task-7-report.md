# Task 7 report: Phase 4 cross-domain and isolation completion gate

Status: implementation complete; committed with subject
`test: prove isolated Game IR gameplay and balance`.

## Exact verification commands and results

- `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts` — **179 pass, 0 fail** across 14 files.
- Foundation regression command from `task-7-brief.md` — **263 pass, 0 fail** across 21 files.
- `bun run typecheck` — passed (`tsc --noEmit`).
- `(cd packages/agent-workflow-server && bun run typecheck)` — passed (`tsc --noEmit`).
- `git diff --check` — passed.
- `bun test .../gameplay-balance.integration.test.ts .../stage-boundary.test.ts .../foundation-parity.test.ts` — **10 pass, 0 fail**.
- Full-server Stage 5 unreachable scan — passed through `stage-boundary.test.ts`; production source violations were empty.
- Protected parity — passed for all 21 files against baseline `70df2e2c`; manifest uniqueness/count is asserted.
- Biome targeted stdin formatting checks for new/modified tests — passed. The required directory Biome command still reports two pre-existing formatting failures in `domain-projection.test.ts` and `domain-projection.ts`; neither file is part of Task 7 and neither was modified.

## Evidence

`gameplay-balance.integration.test.ts` builds Gameplay and Balance source envelopes from one READY receipt and the same complete canonical authority index. It proves selected exact source closures, shared canonical ordering, deterministic source/projection digests, Gameplay-to-Balance typed condition/effect references, Balance reward/cost binding to a Gameplay action, stale task rejection, wrong-kind rejection, and rejection of an unimplemented `world-scene` kind. It also reassembles against the actual opposite module projection and compares digests.

`stage-boundary.test.ts` adds an AST detector for forbidden candidate/publication APIs, controller/store/DeliveryRun/Foundation Issue paths, provider dispatch, and all five remaining canonical placeholder module IDs. Synthetic fixtures prove each detector fires; comments and strings do not trigger it. Task 7 introduces no production files.

`foundation-parity.test.ts` asserts the complete 21-file protected manifest in addition to the existing byte-for-byte baseline and real Foundation READY parity flow.

## Documentation status

Both design documents now describe `authoritySectionIndex` plus selected
`sectionIndex`, digest-authenticated set/content, the shared Game IR
canonicalizer, Balance exact `/bytes/<start>/<end>` evidence, semantic-only
current Balance mechanical policy, bidirectional typed validation, and the
Phase 4 completion boundary. Phase 5–9 remain unstarted. Complete candidate
publication, production routing, and Chrome acceptance remain unavailable.

## Self-review

- No Foundation, Reviewer, Revision, types/schema, controller, transition, or recovery production file was modified.
- No routing, persistence, provider dispatch, partial candidate, fallback, migration, dual write, fixed cap, or placeholder production path was added.
- The only implementation changes are completion-gate tests, parity evidence, and honest documentation updates.

## Concerns

The repository-wide required Biome command remains non-zero because of the two
existing `domain-projection` formatting findings listed above. The Task 7
files are formatted and typechecked; fixing those unrelated baseline findings
would expand the requested file scope.
