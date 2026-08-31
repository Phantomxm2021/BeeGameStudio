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

`b5bbe154 feat: replay Phase 5 semantic receipts`

## Concerns

Phase 5 domain-specific schema manifests, semantic producers, fidelity
validators, and closure assembly remain intentionally out of scope for Task 2.
