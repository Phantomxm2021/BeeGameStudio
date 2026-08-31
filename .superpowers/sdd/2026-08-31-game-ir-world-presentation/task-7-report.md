# Task 7 report — Presentation producer wrapper

## Status

DONE (fix round 2/5). Task 7 is limited to the Presentation producer wrapper,
its focused assertion-level tests, and this report. Task 8 was not started. No schema,
closure assembler, route, store, provider, Reviewer, Revision, publication,
or future-stage code was changed.

## RED / GREEN

The first focused run preceded the producer module and failed at module
resolution:

```text
bun test .../presentation-producer.test.ts
→ Cannot find module './presentation-producer'
```

After API-only wiring with a throwing stub, the real behavioral assertions
failed because the wrapper was not implemented:

```text
→ 10 fail, 0 pass; error: not implemented
```

The minimal wrapper then turned the focused tests GREEN:

```text
bun test .../presentation-producer.test.ts
→ 10 pass, 0 fail, 61 expect() calls
```

The tests include an independent accessor packet case proving that shared
Phase 5 admission rejects raw packet access before Presentation narrowing.
They also exercise stale digest rejection, recomputed relabel rejection, and
same-module widened kind/relationship manifests after shared admission.

Fix round 1 adds a complete 256-node UI fixture (one screen, 127 reachable
states, and 128 transitions with a multi-state cycle), and runs it through
admission, exact source-bound replay, and `parsePresentationModule`. It also
adds stable insertion checks for multiple logical requirements and trigger
claims, an independent stored-result relabel case, omitted-claim coverage,
the isolated nonempty-mechanical policy guard, and an artifact-field matrix.
The first post-change run exposed only a test-harness matcher typo
(`toHaveSize` is unavailable in Bun); correcting that test-only typo produced
the GREEN run below. No production defect was exposed, so the wrapper was not
changed in this fix round.

## Implementation

- `buildPresentationSemanticPacket` requires the Presentation source module,
  derives node kinds and relationship roles from
  `PRESENTATION_DOMAIN_MANIFEST`, and delegates packet construction to
  `buildGameIrDomainSemanticPacket`.
- `admitPresentationSemanticResult` calls `admitPhase5SemanticResult` as its
  first packet/result operation, then performs exact manifest-derived
  post-admission identity narrowing for packet arrays, node kinds, and edge
  roles.
- Tests cover the exact GDD/Art/UI/Audio selected closure, empty mechanical
  ownership, every Presentation kind and all manifest roles, diagnostics and
  binding-evidence crossover, a 256-node admission/replay, logical
  requirements without artifact inference, UI action/feedback/audio values,
  references, edges, complete owner bindings, and shared UTF-8/edge-role
  tamper rejection. Fix-round tests additionally prove all large-graph nodes
  are reachable with a real cycle, preserve existing requirement/trigger
  identities across unrelated insertion, reject each artifact-shaped field,
  reject independently relabeled stored results and omitted claims, and
  exercise the shared replay's isolated empty-mechanical policy. Fix round 2
  also extracts both VFX trigger claims (value trigger and `on` edge) from
  baseline and append-inserted receipts and compares their complete claim
  identities, including exact byte ranges. Because the
  service contract makes Phase 5 mechanical ownership unconditionally empty,
  a synthetic mechanical/semantic overlap cannot reach disjointness; the test
  proves the earlier policy guard on the shared replay path instead.
- No claim parser, UTF-8 decoder, binding loop, receipt digest algorithm,
  module merge, preparation/parser/binder, projection writer, fallback, or
  Resource Realization node was added.

## Verification

```text
bun test .../presentation-producer.test.ts .../phase5-admission.test.ts
→ 41 pass, 0 fail, 231 expect() calls
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir
→ 289 pass, 0 fail, 2 snapshots, 1552 expect() calls
(cd packages/agent-workflow-server && bun run typecheck)
→ tsc --noEmit passed
Biome check on both Task 7 TypeScript files
→ passed
git diff --check
→ passed
```

## Boundary/self-review

Only the two Task 7 TypeScript files and this report are new. The wrapper has
no production or future-stage reachability and does not infer artifacts from
filename-like labels; requirements remain ordinary semantic value leaves.
