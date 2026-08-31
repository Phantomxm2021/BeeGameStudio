# Task 2 report — shared Phase 5 admission and exact receipt replay

## RED evidence

API-wiring RED before the new module existed:

```text
$ bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts
error: Cannot find module './phase5-admission'
0 pass, 1 fail, 1 error
```

After the API stub was wired, the assertion-level RED showed the requested
behavior was absent:

```text
$ bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts
error: Phase 5 semantic admission is not implemented
0 pass, 4 fail
```

## GREEN evidence

Focused boundary tests:

```text
$ bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts
12 pass
0 fail
40 expect() calls
```

Full Game IR suite:

```text
$ bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir
206 pass
0 fail
2 snapshots
988 expect() calls
```

```text
$ (cd packages/agent-workflow-server && bun run typecheck)
$ ./node_modules/.bin/biome check [the four task files]
exit 0
```

## Files

- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts`

## Implementation

- Extended the single mechanical receipt admission policy to all four
  isolated domain IDs while preserving the exact empty Phase 4 policy.
- Added the one shared Phase 5 semantic DTO admission boundary. It validates
  strict shapes, injects packet identity and semantic producer mode, enforces
  canonical node/claim target coverage and disjointness, and derives the
  receipt digest.
- Added the one source/mechanical/packet-bound replay helper. It rebuilds the
  packet and receipt, checks exact UTF-8 byte ranges and code-point
  boundaries, verifies typed literals (including canonical typed reference
  and edge literals), creates Core owner bindings, and calls the existing Core
  module parser.

## Self-review

- No second Core parser, canonicalizer, source authority, digest algorithm,
  or production route was added.
- Worker-supplied identity, producer mode, bindings, receipt identity, and
  digest fields are not trusted.
- Mechanical/semantic targets are checked for exact ownership and overlap;
  output containers are frozen.
- `git diff --check` passed.

## Commit

`d21c3cd5 feat: replay Phase 5 semantic receipts`
`9f3ce636 fix: enforce Phase 5 packet node policy`

## Concerns

Phase 5 domain-specific schema manifests, semantic producers, fidelity
validators, and closure assembly remain intentionally out of scope for Task 2.

## Reviewer fix round 1

### Changes

- Made empty semantic packet allow-lists mean allow-none; empty node/edge
  projections remain valid, while any node or edge is rejected when its kind
  or relationship is not explicitly listed.
- Reworked the edge-role mutation test to use a self-targeting Core-admitted
  edge and two allowed roles, proving the untampered receipt replays before
  changing only the role and asserting the exact typed-literal mismatch.
- Added baseline-first table coverage for non-empty/unsorted/duplicate
  mechanical ownership, hidden/accessor DTOs, duplicate/omitted/unsorted
  claims, canonical node ordering, all malformed range classes (including
  split UTF-8 code points), primitive and ID literal mismatches, reference
  target tampering, and recomputed packet relabeling.

### Verification

```text
$ bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts
21 pass
0 fail
83 expect() calls

$ bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir
215 pass
0 fail
2 snapshots
1031 expect() calls

$ (cd packages/agent-workflow-server && bun run typecheck)
$ ./node_modules/.bin/biome check [the four task files]
$ git diff --check
exit 0
```

Fix commit: `bbb74fb1 test: close Phase 5 review round two`.

### Fix commits

- `9f3ce636 fix: enforce Phase 5 packet node policy`
- `69580cd6 docs: update Phase 5 admission commit`
- `b53b5323 fix: close Phase 5 admission review gaps`

## Reviewer fix round 2

- Added an independent valid-baseline-first string literal mismatch test. It
  reissues the receipt digest while preserving the exact byte range and all
  other fields, then hits the semantic string-literal guard.
- Split worker DTO coverage into two independent mutations: one adds only
  `producerMode`, and one adds only `bindings`; both are rejected by strict
  exact-key validation.

```text
$ bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts
13 pass
0 fail
39 expect() calls

$ (cd packages/agent-workflow-server && bun run typecheck)
$ ./node_modules/.bin/biome check [the four task files]
$ git diff --check
exit 0
```
