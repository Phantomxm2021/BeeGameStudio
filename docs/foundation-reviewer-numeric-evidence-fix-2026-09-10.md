# Reviewer numeric evidence fix — 2026-09-10

## Defect and correction

The live report claimed a coverage difference of approximately 23 px. For the cited formula `2 * sqrt(range² - d²)`, range 110 and distances 60 / 70 give a difference of 14.685261661086344 px, rounded to 14.69 px. The model had not calculated this particular claim; unrelated successful calculations did not validate it.

Report prose now uses numeric placeholders bound either to a successful calculation from the same frozen review input or to an exact numeric/identifier token on a cited source line. The host inserts calculation values and applies the declared rounding. Unbound numeric glyphs in all report prose fields are rejected, including final omission checks and repair instructions. Citation text is materialized separately from immutable source bytes.

Private journal evidence retains bindings and templates for replay validation. Failed, requested-only, fabricated, foreign-input calculations and tampered rendered values are rejected. Existing legacy reports remain readable; new submissions must satisfy the numeric contract. Invalid drafts receive bounded correction feedback; repeated failure stops without publishing an accepted review. No additional agent was introduced.

## Prompt and limits

The prompt now asks for parameter sources and units, an explicit expression, a calculation tool result, comparison, and rounding. This is a verifiable workflow rather than merely asking for more reasoning text.

Step-by-step prompting can improve arithmetic benchmark performance, but is not a guarantee for the current model or task: [Chain-of-Thought Prompting](https://arxiv.org/abs/2201.11903). Delegating execution to a computational runtime is also supported by [PAL](https://arxiv.org/abs/2211.10435).

This change verifies numeric provenance and execution, not semantic correctness. A model can still choose the wrong formula, parameters, units, or an irrelevant source token. Spelled-out numbers are not covered by the numeric-glyph detector. These remain review-quality limitations, not solved mathematical guarantees.

## Verification and deployment state

- Regression reproduces the erroneous 23 claim, rejects it, and renders the bound result as 14.69.
- Covers every prose field, final confirmation, replay tampering, exact source-token matching, invalid bindings, failed calculations, bounded correction, billing barriers, and journal reopening.
- Combined offline suite: 82 tests passed, 0 failed, 569 assertions across 17 files.
- Root and server TypeScript checks passed.
- No paid live test, service restart, or source-document revision was performed for this fix. Running services must load the new code before live acceptance testing.
