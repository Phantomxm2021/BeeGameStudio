# SDD ledger — plan: docs/superpowers/plans/2026-08-22-document-audit-incremental-revision.md

## Preflight

| Task | Shared interfaces | Depends on | Status |
| --- | --- | --- | --- |
| 1 | `CoverageManifest`, `DerivedDocumentManifest`, `LocalAuditResult` | existing document contracts and Markdown validator | in progress |
| 2 | `AuditContextPacket`, Markdown results, `IssueRegistry` | Task 1 manifest/check identities | pending |
| 3 | `DocumentAuditState`, dispatch/accept/reconcile | Tasks 1–2 | pending |
| 4 | revision tasks/receipts/publication | Tasks 2–3 | pending |
| 5 | `VerificationAuthority`, verification packets/results | Tasks 1–4 | pending |
| 6 | Reviewer/Writer assignment and terminal helpers | Tasks 2, 4–5 | pending |
| 7 | schema/controller/dispatch/recovery/gate single cutover | Tasks 1–6 | pending |
| 8 | ordinary server/frontend task projection | Task 7 | pending |
| 9 | static/full/Chrome acceptance and whole-branch review | Tasks 1–8 | pending |

### Cross-task invariants

- Canonical Markdown is the only semantic authority; BGS performs deterministic mechanics only.
- Stable `checkId` and finding fingerprint definitions established in Tasks 1–2 are immutable consumers for Tasks 3–8.
- Tasks 1–6 do not introduce a second production execution path; Task 7 performs the sole schema/runtime cutover and deletes the old path in the same commit.
- Reviewer packets are immutable and bounded; Writer edits only project-local staging Markdown; verification uses a frozen finding set.
- Every behavior implementation begins with a failing test. A failure after implementation returns to direction/root-cause audit before any repair.
