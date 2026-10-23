# Reviewer complete-audit policy

## Authorized change

Record ordinary format findings, complete the existing fact, deterministic and semantic audit, then publish one combined issue set for Revision. Do not return immediately merely because a reference or table-format error exists.

The structural exception remains explicit: if immutable section boundaries cannot be established, the preparation result reports that content audit is incomplete and requires structure repair. No guessed boundaries or fabricated evidence are admitted.

## Implementation

- New Reviewer journals bind complete-indexable.v1 policy in their immutable headers.
- Superseded on explicit user request: legacy execution replay has been removed. Every execution uses complete-indexable.v1; legacy journal headers are rejected rather than silently replayed or rewritten.
- Indexable documents proceed through existing fact and semantic tasks despite format findings. Summary publication still requires every semantic/confirmation receipt.
- Format findings are combined with deterministic and semantic issues only at final publication. Original document bytes remain unchanged.
- Public handoff can still verify an already-published result's historical digest as Revision input, but this does not select a historical execution strategy. Exact format issue authority remains validated; document-scoped format issues do not receive fabricated fact evidence.
- Invalid or ambiguous mechanical candidates remain uncertain and are delegated to the existing fact audit. They are neither accepted as valid nor silently converted to absent. Missing documents/owner sections remain errors, and model-result validation stays strict.
- No Author or Revision production strategy was changed.

## Local evidence

- New focused regressions: 18 passed, zero failures across five files.
- Mixed format/contract/semantic findings survive one summary; mixed scopes enter one Revision request.
- Legacy empty journal rejection is read-only and cannot select the removed strategy.
- Read-only preparation of the real project: original documents retain 2 format findings and produce 5 fact packets; the repaired candidate has 0 format findings and produces 5 fact packets. Neither exits at the format gate.
- Full Reviewer/Revision run: 618 tests across 117 files, 616 passed and 2 failed. Both failures were test assumptions exposed by the strategy change (a cross-module test import and an incomplete review fixture); both were corrected and passed in the subsequent 18-test focused run. The complete 618-test suite was not rerun after those corrections.
- Public lifecycle regression passed: nonblocking format errors wait for all semantic workers before publication; completed result replay remains read-only.
- Agent workflow server TypeScript check passed after correcting the new handoff test to compare the entire unknown-typed source result without unsafe property access.

No paid model invocation, project resume, document rewrite or service activation was performed during this policy change.

## Subsequent local activation

On the user's subsequent instruction to continue, the local runtime was gracefully restarted with its existing configuration. Port 62174 returned `{"status":"ok"}` after startup. New Reviewer journals now use the updated policy; historical journals retain their bound strategy. No paid review or project resume was triggered during activation.

## Single-policy live test

The first authorized resume exposed an empty pre-change candidate journal bound to the obsolete strategy. The user explicitly requested removal of that strategy and a new-policy test. Its exact zero-event journal was moved out of active state to `/private/tmp/beegame-retired-review-AuavLC/unexecuted-journal`, retaining recovery without touching documents or completed Revision results. Legacy execution selection was removed, the service was restarted, and the UI retry recreated this journal with `auditPolicy: complete-indexable.v1`. The actual workflow entered DOCUMENT_REVIEW/running and began accepting paid fact receipts.

TypeScript passed. The 50-test focused run had 49 passes and one test assertion expecting the wrong error class; after correcting the assertion to the actual binding error, all 17 journal tests passed. Additional offline public/targeted lifecycle regressions: 11 passed, zero failures.

Live outcome at 2026-09-09T07:47:15.265Z: needs_action in DOCUMENT_REVIEW. All five fact tasks completed. Nine of ten semantic tasks completed; semantic-1 failed both permitted attempts with `review native worker: invalid_output`. Semantic-2 also failed once, then completed on its permitted retry. No final review summary or new Revision request was produced. Recorded dispatch usage totals 307,199 tokens (including cache reads and failed attempts). The native admission path collapses missing structured output and admission exceptions into the same error code without retaining field-level diagnostics, so the exact rejected field cannot be determined from the persisted receipt. No manual extra retry or validation bypass was performed.

## Admission diagnostics follow-up

Added optional bounded diagnostics to native failure observations and their durable completion schema. Missing structured output is distinct from payload-schema failures and packet admission failures. Schema diagnostics include only allowlisted field names, bounded array indices and validation codes. Admission rules are exact code-owned literals; unknown messages are classified as unclassified. No model output, arbitrary exception message, credential or stderr is retained. Diagnostics do not change acceptance, retry budgets or public issue evidence.

TypeScript and 27 offline tests across four files passed, including persistence, legacy observation compatibility, redaction and native failure handling. Existing failed observations are unchanged and cannot recover the missing field details retroactively. This follow-up did not activate the service or perform another paid invocation; a separately authorized diagnostic invocation is needed to identify the real rejected output.

## Authorized one-shot diagnostic

The user authorized one additional isolated paid call. `/private/tmp/reviewer-one-shot-diagnostic.ts` reconstructed the original semantic-1 task from the read-only journal and verified packet digest `2da85489d10c1127a319b2b258faac5bb85bc3711836e08cf71dcc2c8abc1018`, original balanced tier, and two exhausted official attempts. An exclusive local guard prevents a second dispatch. It used the current signed-in owner's runtime configuration, existing native executable and the same production admission chain, without a controller resume or journal writes.

Outcome: accepted by the output schema and packet admission checks. The earlier invalid_output was not reproduced, so its exact cause remains unproven. This diagnostic acceptance is not an overall document PASS and was not imported as an official task result. Usage: 19,128 prompt tokens + 3,084 completion tokens = 22,212 total, no cache tokens; submitted through the normal billing adapter under diagnostic event `review-diagnostic-20260909-progression-balance-1:terminal`. A full workflow-file digest matched before and after. No automatic retry occurred; the formal workflow remains blocked at its original attempt limit. Safe log: `/private/tmp/reviewer-one-shot-diagnostic.log`.

## Chrome acceptance after Author checkpoint reset

The user requested reset to eight-document Author completion and then continuation of acceptance. Original Author artifact hashes were verified; the old Reviewer/Revision state was moved to `/private/tmp/beegame-author-complete-reset-9QVkE5` with a full workflow backup. The Author result remained unchanged. Chrome showed all eight documents complete and awaiting review.

Acceptance exposed a hidden Continue action for a stopped completed-Author checkpoint. The display rule now exposes resume only for that stopped state (the ordinary pending handoff remains actionless). Six public Author route tests and TypeScript passed. After service restart, Chrome displayed Continue; clicking it started the actual initial Reviewer on the original documents with complete-indexable.v1.

All five fact and ten semantic tasks completed. Semantic-5 and semantic-9 each failed their first admission with `semantic repair target is missing conflicting evidence`, then passed their allowed retry. The complete published Reviewer result is `6ee0cc490f35c56f6383fc72818c0b857c45014f692069e764396f461d40273a`: eight issues, comprising two document-format findings, one applicability-contract finding, and five semantic findings. Thus nonblocking format findings were retained through the full audit and published together.

Chrome then displayed Foundation Revision / needs action. Read-only preparation of the exact dispatched request reproduced `revision document and section scopes cannot be mixed: docs/ASSET_PLAN.md` in Revision planning. No Revision handle or native invocation was created. Overall end-to-end acceptance is not passed: Revision must support coexisting whole-document format repair and section-level content repair for the same document without discarding issues or weakening evidence. No manual retry or scope bypass was performed.

## Mixed-scope Revision repair and authorized continuation

Revision now groups a document-format finding and section findings for the same document into one whole-document batch, preserving every issue ID. Section targets are still validated against the base index; evidence remains read-only. Complete-document output acceptance and Reviewer candidate byte/scope verification now support this same combination. Any candidate containing a whole-document format repair uses the existing full-review route, not a targeted impact audit.

Offline verification: 245 tests across 55 files passed. A test-only readonly-array TypeScript mismatch was corrected and TypeScript passed. The final focused worker-input run passed all eight tests, including an actual prepared mixed candidate selecting `full_format`; TypeScript passed again.

The live Revision handle `d8672fac-7f6b-4704-b93a-87ab0b52331a` completed GDD, UI and AUDIO, but ASSET outputs were rejected by the old complete-document acceptance gate. Two previously rejected outputs passed read-only verification with the repaired gate; a later output without required frontmatter remained correctly rejected. None was imported into official state.

With explicit user authorization, Chrome Stop paused the workflow, the runtime was restarted with the repaired gates, and Chrome Retry resumed the same handle. Journal sequence 87 records resume; sequence 88 starts only ASSET attempt `d112426e-91a3-4f62-90dd-f136b497f6b3`. The three completed document results were preserved. At this checkpoint ASSET is still running; no candidate publication or full Reviewer PASS is claimed.

The first resumed output was correctly rejected for frontmatter validation (the response wrapped the document in a Markdown code fence). The automatic next attempt `37810cf2-9599-4b54-ae49-4a55cd5ab916` completed at journal sequence 110. Revision published candidate `578700a252f2cd7c8de564a76360f8473e822d15c45bdacaaccc1f92e05b70c3`, round 1, retaining all eight issue IDs across GDD/UI section changes and AUDIO/ASSET whole-document changes. Both ASSET findings are present on the same document operation. The workflow automatically started Reviewer handle `1b256e4c-e7d7-4a04-a2ee-dd28c7c3c2d7` at 08:47:45 UTC. Mixed-scope Revision publication and Reviewer handoff now succeed live; the new review is still running, so overall PASS remains unverified.
