# Partial numeric correction — 2026-09-10

## Implemented

- Verified prose locations use `{{ref:docs/GDD.md:12:12}}`. The host validates frozen-source path and inclusive line bounds and renders `docs/GDD.md:L12`. Bare numeric prose remains rejected; arbitrary file access is not introduced.
- Numeric rejection feedback now enumerates bounded error codes with exact field paths and/or zero-based binding indexes. It reports invalid source bindings, missing calculations, raw numerals, unknown placeholders and invalid locations together. Persisted admission classifications remain unchanged for replay compatibility.
- `correct_draft` binds to the latest draft digest and updates only specified existing prose fields and new/replaced numeric bindings. It retains other findings and citations, prunes removed claim bindings, re-renders templates, and runs ordinary admission again. It cannot skip the final confirmation. Invalid paths, duplicate fields, stale digests and unsupported numeric claims fail closed.
- Prompt explains that counted rows are derived quantities, not source literals from a table's last row, and directs isolated corrections to the partial action.

## Verification

Combined offline suite: 86 passed, zero failed, 598 assertions in 17 files. Coverage includes partial correction through the same-session worker and billing/journal lifecycle, publication compatibility, numeric tamper prevention and location bounds. Root and server TypeScript checks passed. Diff whitespace check passed.

Read-only replay of the actual rejected draft from project `review-copy--2d35f0ea-f640-4255-a9fb-c64b6e776348` identified the invalid cue-row source binding and all six unbound repair-location fields. An offline seven-field patch replaced line literals with verified locations and removed the unnecessary unsupported row total. It was admitted with all eight findings and ten retained bindings. This result was not saved into the live journal or published, and does not certify semantic report quality.

## Runtime state

The previous idle runtime wrapper was stopped to load the fix. Automatic approval rejected starting the new runtime for another potentially paid live acceptance run, citing the earlier no-further-calls constraint. No new runtime or paid model run was started. Explicit user approval is required before continuing that live test. No budget increase or workaround was applied.
