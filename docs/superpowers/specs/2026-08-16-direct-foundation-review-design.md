# Direct Foundation Reviewer Design

## Status and authority

This design supersedes only the Foundation topology in
`2026-08-16-document-reviewer-efficiency-design.md`. It is an
acceptance-driven correction, not a compatibility lane.

## Problem proven by Chrome

Three concurrent specialists consumed 577,391 uncached input and 114,565
output before Final Review. The source matrix read eight unique documents 13
times and then required another consolidation session. The topology failed the
complete-stage budget before its final result existed.

## Production topology

Foundation Review has exactly one role: `final`.

That native Reviewer:

1. receives all eight canonical Foundation paths as read-only verification
   sources;
2. evaluates gameplay, balance, level, technical, art, UI/UX, audio and asset
   production as one connected contract;
3. writes the only `review.md` and `decision.json` under the active revision;
4. returns the existing file-derived terminal;
5. routes through the existing READY or report-driven remediation path.

There are no Foundation specialist reports, no consolidation session, no
hidden fallback, and no feature flag. Incomplete older role sets restart on the
same current revision under this topology. Completed historical reviews remain
immutable.

Checklist and Complete reviews are not changed by this correction.

## Bee Game Studio boundary

Bee Game Studio owns only fixed source/output paths, revision and prerequisite
digest validation, immutable report commitment, raw usage persistence,
recovery, routing and display. It does not:

- interpret or merge findings;
- generate review prose or source-document edits;
- add MCP or a semantic submission packet;
- change native Agent core, context, Write or Edit behavior;
- add retries, watchdogs, truncation or server-generated checkpoints.

## Dashboard

For Foundation scope, the `final` role is displayed as `基础文档审计`. The card
shows its status, exact failure, uncached input, cache input, output, elapsed
time, totals, verdict, affected paths and digest-verified final Markdown.

For Checklist and Complete scopes, existing role labels and final
consolidation semantics remain unchanged.

## Acceptance

Automated gates must prove direct dispatch, all-eight read authority, exact
two-file output, stale-topology reset, retry/recovery, revision invalidation,
raw usage persistence and scope-aware Dashboard labels.

Chrome acceptance must use Web/React and a fresh copy of the accepted source
project. It stops after Foundation Review and records source-byte equality,
report quality, uncached input, cache input, output and wall time. The budgets
remain 500,000 input, 2,500,000 cache input, 110,000 output and 30 minutes.

Failure requires architectural reflection. It must not be answered with a
provider retry, prompt-only patch, reduced document coverage or BGS semantic
processing.
