# Inline numeric reference live acceptance

Result: **not passed**. No draft or final report was produced.

- User authorized a real-model run without an additional credit limit; existing program limits remained unchanged.
- Project: review-copy--2624ce80-9b21-4d01-a276-d7d86125dfda
- Reviewer handle: 9214fa77-c497-469c-a488-bb58b46b2790
- Started: 2026-09-09T20:20:36.607Z
- Stopped: 2026-09-09T20:23:22.705Z (about 2m46s)
- Settled charge: 13.7752 credits.
- Observed usage: 236451 tokens (77464 prompt, 149928 cache read, 9059 completion).

The first structured action successfully requested twelve calculations. All successful host results contained the new inline reportReference. The native turn summary reports three model messages, two structured-output failures and one success. The retained summary does not identify the exact schema-validation errors; do not infer their causes.

The next-turn preflight stopped with audit_budget_insufficient_for_next_turn. It estimated 231488 tokens from the whole prior round's input plus a 4096 output reserve, against 163549 remaining. This aggregates multiple messages and is overly conservative as a forecast for one next request. It does not establish that the next request would actually exceed the budget.

This run therefore verifies that inline references reach host feedback, but does not verify model use of those references, draft admission, partial correction or final confirmation.

All eight document contents and confirmed requirements matched the previous test inputs. All eight root documents remained byte-identical to the frozen inputs after the run. The UI is needs_action at DOCUMENT_REVIEW. No report was published, and no revision, Checklist, Game IR, implementation or publication phase was entered. No automatic paid retry was started.

Next engineering work: estimate the next request from per-message context usage rather than the aggregate turn total, and investigate the two native structured-output failures. Preserve actual cumulative usage accounting and fail-closed report validation.
