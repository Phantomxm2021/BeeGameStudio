# Task 2 report — owner-only Foundation author prompts

## Status

Implemented and committed as a focused prompt-layer change.

## Implementation

- Replaced the shared Foundation author authority instruction used by both `initial` and `parallel-draft` with one owner-only rule covering all eight responsibility boundaries.
- Required one complete raw Markdown body and one canonical representation per fact/material.
- Added the two ID classes: lower-case ASCII dotted cross-document semantic IDs and byte-for-byte owner-local keys, with explicit rejection of alternate spellings, placeholders, CJK IDs, and undefined owners.
- Added the Audio/Art semantic-requirement boundary and one-way Asset Plan mapping to its own inventory IDs.
- Bound upstream authoring to the contract-declared committed projection/symbol table and left unprovable semantic wording to Reviewer input.
- Removed the parallel author’s upstream-availability branch and stopped serializing dynamic `availableUpstreamPaths` in the model-facing Foundation contract.
- Removed the old reference-only/authority-mode/derived-view wording and stale Balance-specific material prompt prose. Reviewer, revision, packet-worker, Stage 3/4, and UI branches were not changed.

## TDD evidence

RED:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
16 pass, 5 fail
Failures: owner-only material wording, legacy vocabulary absence, committed projection instruction, and canonical ID/resource mapping were not satisfied by the old prompt.
```

GREEN:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
21 pass, 0 fail, 1229 assertions
```

## Verification

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/complete-game-document.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts
45 pass, 0 fail, 1306 assertions

bun run typecheck
passed (tsc --noEmit)

git diff --check
passed
```

## Files

- `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

## Self-review

- Both Foundation author modes reference the same `FOUNDATION_AUTHOR_AUTHORITY_INSTRUCTION` constant.
- Each serialized production material retains one `authorityRule`; no second prompt-side material authority serialization was added.
- Raw Markdown output, adaptive density, closed headings, contract validation, and service-owned protocol behavior remain intact.
- No fixed token/word/time/heading/table/row/diagram/business-count limit was added.

## Concerns

- The serialized document contract still contains legitimate domain terms such as compatibility/fallback in section purposes; these are contract content, not author compatibility/fallback branches. The obsolete prompt-layer branches and reference-only vocabulary are removed.
- The complete committed upstream content remains injected by the existing authority-projection block owned by the session port; this task intentionally did not alter that transport or its tests.
