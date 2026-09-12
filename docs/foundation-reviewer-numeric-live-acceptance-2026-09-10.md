# Numeric evidence live acceptance — 2026-09-10

## Outcome

Guardrail worked; end-to-end acceptance failed. No final review was admitted or published, no revision started, and all eight source documents remain byte-identical to the frozen input. No automatic paid retry was initiated.

Project: `review-copy--2d35f0ea-f640-4255-a9fb-c64b6e776348`. Reviewer handle: `a0df5d88-24fb-4c26-a6aa-1e8f4f55a49a`.

The restarted runtime loaded numericBindings in the actual CLI schema. Input documents and requirements matched the previous acceptance run exactly. Review began at 2026-09-09 19:29:34.228 UTC (September 10, 03:29 local) and the last receipt settled at 19:36:14.454 UTC: about 6 minutes 40 seconds. One persistent native child, PID 33156, handled the run and was confirmed absent after stopping.

## Observed rounds

| Round | Result | Observed tokens | Credits |
| --- | --- | ---: | ---: |
| One | Twelve successful calculations; native schema generation needed two messages | 160146 | 13.1534 |
| Two | Eight-finding draft rejected: numeric_evidence_invalid; native schema generation needed two messages | 171034 | 9.1286 |
| Three | Correction began, then budget_exhausted before a corrected draft | 84761 | 1.7669 |
| Total | No admitted report | 415941 | 24.0489 |

The budget includes cache-read tokens. Before the correction round, observed usage was 331180. The next message's input/cache snapshot added 84761 and crossed the 400000 threshold. Thus the observed total can exceed the cap by a newly reported message snapshot; this is not a preflight exact-cost reservation.

## Draft inspection

- Correct calculation bindings referenced results 60 (build-point distance), 10 (audible cue count), and 1.3726971700492272 (coverage window).
- The draft did not repeat the previous erroneous 23 px coverage-difference claim. It also did not calculate that specific difference; this run therefore does not demonstrate live generation of 14.69 px.
- The binding `cues_rows` claimed literal 12 came from AUDIO_DESIGN line 154, but that line contains no 12. A derived row count was incorrectly represented as an exact source literal. This is an actual provenance violation.
- Six repair instructions also contained unbound line-number literals. Those are locations rather than arithmetic quantities, but the current all-prose numeric contract rejects them too.
- The correction feedback supplied a generic numeric error and empty mismatches array, not a field-specific explanation. Together with full-draft regeneration and repeated native schema attempts, this remains a convergence/cost limitation.

## Interpretation

The host prevented an invalid report from reaching Revision. This validates rejection safety, not successful autonomous correction or complete review quality. Next engineering work should distinguish verified locations from quantitative claims, report exact binding/field failures, and improve bounded correction efficiency. No implementation changes were made during this live test, and no budget increase was applied.
