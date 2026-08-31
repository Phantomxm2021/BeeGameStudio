# Task 5 Report: Service-Owned Fidelity Packet and Result Admission

## Status

DONE (fix round 3/5)

## Scope

Task5 remains limited to `phase5-admission.ts` and its focused test. This round
also updates the Phase 5 design/spec and implementation plan, as required by
the audited packet contract. The required report is the only additional
artifact. No producer, closure, route, store, provider, Reviewer, Revision,
or Phase6 code was added.

## RED / GREEN

The first implementation round's initial RED was only missing-export/API
wiring (the focused assertion received `undefined`); that was not counted as
behavioral RED.

Fix round 1 added behavioral regression assertions for the Core boundary:
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

Fix round 2 first added an assertion-level RED for the missing packet
`authoritySectionIndex` (19 pass, 1 fail; the packet value was `undefined`).
The contract audit then added RED coverage for missing/extra/duplicate/
reordered/malformed/member-mutated authority indexes, selected-closure
membership, and recomputed-digest Core-invalid external projections. GREEN
now exercises real independent Gameplay and World source/receipt identities;
external projection digests remain self-authenticating fields and are not
compared with consumer packet identities. The round-2 evidence overstated the
multi-edge and selected-closure guarantees: its legal graph had only one edge
and closure checking was membership-only. Round 3 records the behavioral
correction below rather than counting that overclaim as evidence.

Round 3 added an assertion-level RED where a valid same-document extra
selected section was removed, its evidence removed, and the packet digest
recomputed; the old admission accepted it. The focused test then turned GREEN
after exact manifest-derived closure reconstruction. It also adds a true legal
two-reference/two-edge baseline, independent reference and edge reorder
guards, builder caller-field guards, inner-digest/relabel coverage, distinct
extra-authority stale-digest coverage, and recursive freeze/determinism
assertions. No claim is made that an unkeyed digest prevents an actor with
authority to recompute the complete packet from making a self-consistent
detached packet; that remains outside this service-owned boundary.

## Implementation

- Removed the Task5-local module/reference/edge/binding/order/derived-closure
  validator and its competing canonicalization authority.
- Replayed packet `moduleBytes` through the Core parser with packet-derived
  parse context; Core now owns module shape, ordering, reserved-edge, binding,
  and derived-closure rules.
- Replayed every external projection module through the same Core parser and
  full authority index.
- Added the complete deep-frozen eight-document authority index to the packet;
  result admission strictly normalizes it, recomputes its
  `digestGameIrValue` digest, filters it through the Core validator manifest's
  canonical document paths, and requires packet selected refs to equal that
  derived closure exactly in count, order, and every field. Synthetic Core
  parse requests use `digestSectionIndex` for the full index.
- Kept external projection source/receipt/validation digests format-checked
  and independently replayed, without comparing them to consumer identities.
- Kept Task5-specific logic limited to packet identity, full external
  projections, manifest-derived check/target metadata, exact coverage, and
  evidence namespace rules.
- Preserved Task2's single receipt replay/binding path for packet construction.

## Verification

- Focused Task5: `26 pass, 0 fail` (150 assertions).
- Focused Task5 + Task2 regression (`semantic-admission.test.ts`): `45 pass, 0 fail` (266 assertions).
- Full Game IR suite: `262 pass, 0 fail` (2 snapshots, 1381 assertions).
- Server typecheck: `tsc --noEmit` passed.
- Biome check passed for both Task5 files.
- `git diff --check` passed.

## Commit

Round-3 commits are split into documentation, implementation/tests, and this
report evidence; final hashes are reported after fresh full verification.

## Self-review

No known concerns. The worktree will be kept clean after the final commits;
Task6 was not started.
