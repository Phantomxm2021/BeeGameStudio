# Markdown live acceptance — 2026-09-09

- User explicitly approved one paid real acceptance after local restoration and service activation.
- Started once through Chrome's Retry button on the existing failed project; no additional retry is authorized.
- Project: project_1788933115958_cuvmur (fixed-budget-tower-defense--561662e1fd6a).
- Run: a1e928e5-0cf9-4753-bd78-f74632697429.
- Author handle: 966b8509-5a9f-482e-8664-c3f4631b547f.
- New GDD dispatch: 8f2e12e6-726c-482b-a95e-78b45fe52dbb.
- New dispatch has no authorBodyVersion JSON flag. Pending output begins with a Markdown H1 and Executive Summary.
- Prior failed JSON dispatch usage was 14,491 tokens; report new-run usage separately.

Status: terminal needs_action at DOCUMENT_REVIEW, 2026-09-09T06:49:29.833Z. Scope is Foundation Author → Reviewer → Revision and final review, not game implementation or publishing. No source changes or manual project-document repairs during acceptance.

## Observed result

- All eight Markdown documents committed and published successfully. Each document used one new Author dispatch; no quality-triggered Author retries.
- Author result: 5758afbccb11f0facf8a7de8f918c6b290acfd9ed51947e430a4b7a869dbea2d.
- New Author usage: 177,282 tokens (49,380 prompt, 57,854 completion, 70,048 cache-read). This excludes the prior failed JSON dispatch's 14,491 tokens; token counts are not currency charges.
- Reviewer completed deterministic format review and published an issues_found result, protocolVersion 2, with two invalid-reference issues: ASSET_PLAN references docs/Loudness; AUDIO_DESIGN references docs/UI_UX_SIGN.md. No semantic model review or Revision was started.
- Reviewer result: f54bc979c7d0aac16e2380085531571d7e1ed5d34a01c5500a19040ee4c5d5be.
- Delivery workflow recorded observationError before accepting the completed Reviewer result. The UI labels this as audit failure.

## Read-only root-cause confirmation

Reviewer getResult returns completed / issues_found / billing settled without calling model or billing services.
Passing that persisted result to foundationResultBinding reproduces: Foundation public result owner or project mismatch.
The function in delivery-workflow/foundation-public-handoff.ts only accepts protocolVersion 1, whereas the Reviewer result is version 2. Matching owner/project IDs do not resolve that version rejection.

The internal result-envelope version mismatch is separate from Markdown body transport. Author restoration passed this live run; the full review/revision acceptance did not pass. Existing documents remain intact. No retry was clicked after this failure.

## Authorized compatibility repair

- Delivery result bindings now accept Reviewer result versions 1 and 2. Revision results remain version 1 only; unknown producers/versions, foreign identity and digest changes remain rejected.
- Replaying the real persisted Reviewer result locally now successfully creates an initial Revision request, without executing a model or writing the project.
- Added v1/v2 issue handoff and final-pass publication tests plus negative version/identity/digest tests.
- Link suite: 16 passed, zero failures.
- The additional full Author integration initially timed out because its offline section child read the retired sections prompt field. Updated that test-only child to read writeTargets; no Revision production behavior was changed.
- After the fixture update, the full public Author → Reviewer → Revision → Reviewer integration passed (44 assertions, 55.67 seconds). Workflow server typecheck and whitespace checks also passed.
- No real project continuation or paid call has been started by this repair.
- Runtime restarted and health verified. The first replacement could not bind the port while the idle old process was stuck in shutdown cleanup; terminating that verified idle child released the port. The project remains needs_action at DOCUMENT_REVIEW with its eight completed documents unchanged.
