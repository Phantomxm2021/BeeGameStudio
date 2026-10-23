# Reviewer evidence-reference rejection and retry feedback

## Observed blocker

The fresh run completed initial review (nine issues) and Revision, then started full candidate review under handle `3a8e8217-1ebe-4de6-bfcc-3ac6b3cdf906`. Five fact tasks and nine semantic tasks completed. `semantic-9` (`SEM.completion_recovery_coherence`) failed both allowed attempts at 09:46:18 and 09:48:16 UTC. Both native completion observations contain the same allowlisted admission rule:

`semantic repair target is missing conflicting evidence`

The workflow reached `needs_action`, `resumable: false`, with billing settled at `2026-09-09T09:48:55.519Z`. This is not the prior idle-exit race: the second native attempt was actually dispatched. Billing is outside this repair's scope.

## Meaning and limits of the evidence

Admission requires every `remediation.sectionKeys` entry to be cited in that **same Issue's** `sourceSectionKey` or `supportingSectionKeys`. Being present somewhere in the packet, prose, assumptions, or another Issue is insufficient. This prevents a repair from modifying a block without admitting its conflicting evidence.

The diagnostic proves that at least one proposed repair target lacked that same-Issue citation. Rejected model payloads are deliberately not retained, so the exact omitted target and original wording cannot be reconstructed from these observations. No claim is made that an offline synthetic test is a recovered copy of either live output.

## Code-level causes addressed

1. The native worker already produced and persisted a bounded diagnostic, but `semantic-controller.ts` discarded it when appending the semantic failure. Retry received the original prompt with no explanation of the previous rejection.
2. Existing prose described supporting references as additional read-only evidence; the prompt needed a more explicit distinction between evidence membership and repair authority, plus a per-Issue submission check.
3. Initial/full-format lifecycle status exposed a generic operator-action message even when a task exhausted attempts for a specific output-contract failure.

## Changes

- Add an optional, strictly validated diagnostic to semantic failure events and task state. It is accepted only for native `invalid_output`; historical events without it remain valid. Successful acceptance removes stale retry diagnostics.
- Pass the previous task's safe diagnostic into its next automatic attempt. Packet identity, document revision, output schema, admission checks, and retry limits remain unchanged. Source feedback is not inherited by an independent strong confirmation.
- Explicitly require each Issue's repair keys to be a subset of that Issue's owner/additional evidence keys. Explain that supporting evidence may also identify the incorrect block to repair. Never invent a citation just to satisfy validation; genuinely ungrounded decisions remain UNDECIDABLE.
- Surface the failed task, attempt count, validation stage and allowlisted rule through initial/full review lifecycle status, without exposing raw model text or arbitrary exceptions.

## Verification and recovery boundary

An offline native fixture reproduces the missing-target-reference rejection on the last semantic task. It repairs the citation only when its second invocation receives the actual diagnostic, then passes the unchanged admission checks. The other nine tasks run once; the failing task runs exactly twice; accepted state replays from the journal. Separate tests cover diagnostic redaction/validation, unchanged packet identity and schema, and exhausted-attempt blocking.

Final verification: **54 tests passed, zero failures, 279 assertions across six files**; TypeScript (`tsc --noEmit`) and `git diff --check` also passed. The native retry regression uses eleven total fixture invocations and preserves the nine completed siblings. Logs: `/private/tmp/reviewer-evidence-feedback-final-tests.log` and `/private/tmp/reviewer-evidence-feedback-final-typecheck.log`.

No live attempt counter, journal, document, accepted result or runtime service was modified. No paid invocation was made. The currently exhausted live request cannot be revived merely by deploying this fix. A separately authorized reset/new acceptance run is required; the established recoverable Author-complete reset is available if the user chooses it.
