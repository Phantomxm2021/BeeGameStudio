# Task 10 defect 2 implementation report

## Root cause confirmed

Balance admission enforced an exact relationship/reference-target invariant in
`exactRoleReferences`, but that invariant was not present in the Balance
manifest or in the projection authority rendered to a stateless provider
retry. A fresh retry therefore received a generic failure reason without the
expected reference targets and could reproduce the same semantic fault. The
rejected record body remains non-durable by design.

## Implemented correction

- Added one manifest-owned `referencePolicy` with kind `exact-edge-targets` to
  the five Balance kinds governed by the invariant: economy source, economy
  sink, reward, cost, and reward-cost binding.
- Made Balance admission read that manifest policy instead of maintaining a
  second hard-coded kind list.
- Made the projection contract derive and expose the policy, and made the
  selected Markdown authority render it beside each node kind. Unaffected
  kinds do not expose the policy.
- Bound the existing compiler instruction to apply the declared policy; no
  second prompt or projection route was introduced.
- Made the mismatch diagnostic deterministic and repairable by including
  sorted expected and received target ID lists. No rejected node body is
  persisted or logged.
- Added coverage proving the admitted prefix remains unchanged after a
  rejection and that a corrected replacement with the same record ID is
  accepted. The test compares the non-empty prefix, record digests and
  pending digest before and after the rejection.

## Verification

- RED run before production edits: four new assertions failed for the
  intended missing manifest policy, missing rendered policy, missing compiler
  binding, and missing expected/received IDs.
- Focused projection contract, authority, worker prompt, and journal tests:
  `76 pass, 0 fail` (1,852 assertions).
- `bun run typecheck`: pass.
- `git diff --check`: pass.
- Full Game IR suite: `630 pass, 0 fail`, 2 snapshots, 7,134 assertions across
  45 files in 217.10s.
- The exported reference-policy contract is closed over the only supported
  policy kind (`exact-edge-targets`); unknown policy kinds cannot be silently
  accepted by future callers.

## Scope audit

Only the Balance manifest/validator, projection contract and authority,
compiler instruction, and direct focused tests were changed. Reviewer,
Revision, Checklist, UI, Foundation Stage 3/4, consumer Task 9–15 paths,
retry/session reuse, caps, fallback paths, and rejected-record persistence
were not changed.

## Follow-up: Balance node-local unit reference policy

The real `polar-station` retry exposed a second contract omission in the same
Balance authority: `balance.variable` and `balance.parameter` declared only an
integer `unitReferenceIndex`, while admission additionally required exactly
one `balance.unit` reference at index `0`. The provider therefore received no
machine-readable rule for the failing node-local index. The retry used a new
session and new output, but reproduced the semantic error because the
authority was incomplete; no candidate or session was reused.

The manifest now owns an `exact-single-index-reference` policy containing the
target kind, index field, exact cardinality, and required index. Projection
contract generation, the node JSON Schema, Markdown authority, compiler
instruction, and Balance admission all consume that policy. Direct admission
diagnostics include expected and received index/reference count; schema-level
rejection remains strict, and rejected records never enter the journal. A
same-ID corrected replacement is accepted after an invalid record, with the
admitted prefix and its digests unchanged.

Follow-up verification: focused Balance/contract/authority/journal/prompt
tests `129 pass, 0 fail` (1,990 assertions); typecheck pass; diff-check pass.
The complete Game IR suite produced `633 pass, 1 fail` across 45 files; the
sole failure is the pre-existing repository-root Foundation parity baseline
guard for Stage 3/4 bytes, outside this change's files and scope.
