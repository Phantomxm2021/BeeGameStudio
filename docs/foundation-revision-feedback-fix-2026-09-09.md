# Foundation Revision feedback repair — 2026-09-09

## Scope

Repair the diagnosis/retry loop exposed by the stopped Chrome case `corridor-tower-defense--1dfb4e0eec9f`. No generated project documents, Reviewer policy, acceptance gates, retry limit, billing formula or running service was changed. No paid model execution was resumed.

## Findings

- Authoring intentionally delegates format audit to Reviewer. Its marker injection is all-or-nothing when canonical headings are missing, duplicate or reordered.
- The real Audio source lacks `Ambience and World Audio`; all 16 protocol markers are absent. Level duplicates `Pacing Beat Table`; all 15 markers are absent.
- The initial format issues exposed only the first failing marker/reference. Balance has two non-canonical references, not just the first one reported.
- Retry dispatch formerly forwarded only `output_invalid`, dropping even the durable diagnostic category. Failed native Markdown was discarded.
- The model-facing first-line title rule was ambiguous with required source YAML front matter.

## Implementation

- Model-facing whole-document repair feedback now enumerates canonical marker/heading counts, order violations and non-canonical Foundation references. Fenced examples do not satisfy canonical headings/markers. This is read-only mechanical evidence, not semantic review or a replacement acceptance gate.
- The model-facing contract explicitly places the title after YAML and requires preserving source metadata; version/time advancement remains service-owned.
- Retryable output-validation settlements optionally retain rejected Markdown (UTF-8 bounded to 2 MiB) as private evidence. It is never an accepted output, candidate or publication source. Other failure classes cannot carry this field.
- Retry prompts receive the durable diagnostic category and recomputed structural defects for document-scoped outputs. Section-scoped outputs do not receive whole-document marker repair authority. Raw failure prose, tool transcripts and environment values are not forwarded.
- Frozen repair packet construction and digests are unchanged. Existing journals remain readable; old attempts cannot retroactively recover discarded output.

## Verification

- New offline regression tests cover the Audio missing-title/16-marker case, duplicate Level heading, invalid references, fenced examples, metadata prompt boundary, rejected-output byte limit and legacy settlement compatibility.
- Owned-child integration test verifies the second native invocation receives concrete feedback while its assigned file remains the original source, not rejected output.
- Read-only replay of all 165 real execution events succeeded: stopped=true, published=false, 14 billing acknowledgements, completed workers=Level/Balance/Art.
- Read-only projection of the real frozen request reports all 16 Audio markers and its missing heading; all 15 Level markers and duplicate heading; both Balance reference errors; and Art's reference error.
- TypeScript check and diff whitespace check passed; focused feedback/owned-attempt/worker-input suite: 18 passed; public host/read bridge suite: 7 passed.
- Full Revision/Reviewer suite: 585 tests, initial run 577 passed / 8 failed. Five failures were macOS process-identity reads blocked by the sandbox; the entire identity suite passed (6/6) with read permission. One whole-set stop/resume test exceeded its internal polling deadline in the full run and passed unchanged in isolation (1/1); timing sensitivity remains noted, not hidden by a timeout change.
- The other two failures were positional Issue-selection assumptions: one selected an already-PASS GDD issue absent from the unresolved list; the other assumed hash-sorted issues were GDD-first. Tests now select the relevant document/Issue identity and retain their original tamper-rejection assertions. Both affected suites passed (11/11).
- Every initial failure has a passing focused rerun; the entire 585-test command was not repeated after these test-only fixes. No claim of a single all-green full-suite run is made.

## Remaining boundary

This fixes offline-verifiable feedback defects, not a guarantee that a model will converge. The real run is still stopped. A fresh service restart and explicit Chrome resume/reacceptance are needed to verify real model behavior and the later semantic review. Existing gameplay, UI and audio content conflicts have not been manually repaired.
