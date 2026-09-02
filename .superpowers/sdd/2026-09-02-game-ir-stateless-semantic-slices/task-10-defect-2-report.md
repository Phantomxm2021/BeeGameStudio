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
