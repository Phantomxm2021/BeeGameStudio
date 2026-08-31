# Task 5 Report: Service-Owned Fidelity Packet and Result Admission

## Status

DONE (fix round 1/5)

## Scope

Task5 remains limited to `phase5-admission.ts` and its focused test. The
required report is the only additional artifact. No producer, closure, route,
store, provider, Reviewer, Revision, or Phase6 code was added.

## RED / GREEN

The first implementation round's initial RED was only missing-export/API
wiring (the focused assertion received `undefined`); that was not counted as
behavioral RED.

This fix round added behavioral regression assertions for the Core boundary:
canonical multi-reference/multi-edge modules, descending reference order,
reserved `reference` edge type, invalid structural binding targets, and
derived-binding cycles/closure. The previous local packet normalizer had its
reference/edge ordering comparator inverted and could accept Core-invalid
module forms. After removing that duplicate validator, the same assertions
GREEN through Core `parseGameIrModuleCandidate`.

Additional focused assertions cover both discriminated packet branches,
complete external projection fields, stale projection identity, exact check
and target coverage, stale packet digests, AMBIGUOUS/missing evidence, and
owner-binding versus section-evidence namespace separation.

## Implementation

- Removed the Task5-local module/reference/edge/binding/order/derived-closure
  validator and its competing canonicalization authority.
- Replayed packet `moduleBytes` through the Core parser with packet-derived
  parse context; Core now owns module shape, ordering, reserved-edge, binding,
  and derived-closure rules.
- Replayed every external projection module through the same Core parser and
  bound projection source/mechanical/semantic identities to the packet.
- Kept Task5-specific logic limited to packet identity, full external
  projections, manifest-derived check/target metadata, exact coverage, and
  evidence namespace rules.
- Preserved Task2's single receipt replay/binding path for packet construction.

## Verification

- Focused Task5: `20 pass, 0 fail` (82 assertions).
- Focused Task5 + Task2 regression: `29 pass, 0 fail` (129 assertions).
- Full Game IR suite: `256 pass, 0 fail` (2 snapshots, 1313 assertions).
- Server typecheck: `tsc --noEmit` passed.
- Biome check passed for both Task5 files.
- `git diff --check` passed.

## Commit

Pending fix-round commit (reported with the final hash).

## Self-review

No known concerns. The worktree is kept clean after commit and Task6 was not
started.
