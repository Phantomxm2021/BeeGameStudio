# Asset Plan Authoring Reliability Design

**Status:** Approved for implementation  
**Date:** 2026-09-03  
**Scope:** Stage 2 `docs/ASSET_PLAN.md` authoring and native Markdown transport only

## 1. Outcome

Keep Asset Plan as the sole owner of resource-production facts, improve its planning fidelity, and make a structurally repairable author response complete without duplicating content or creating a second authoring track.

The change must not modify Reviewer, Revision, Checklist, Game IR, workflow staging, UI, or any durable state schema. Foundation documents remain raw Markdown. There is one author task, one native session, one dispatch, one in-memory candidate, and at most one canonical commit.

## 2. Why Asset Plan remains required

The seven upstream design documents describe gameplay, space, balance, runtime, presentation, interaction, and audio intent. None owns the production facts needed to acquire, author, license, integrate, replace, schedule, and accept the concrete resources that realize that intent.

Asset Plan therefore remains necessary and owns five distinct materials keyed by inventory ID:

1. `asset-inventory-table`: delivery-unit identity and upstream semantic-requirement mapping.
2. `responsibility-matrix`: creator, approver, consumer, and handoff.
3. `dependency-integration-diagram`: dependency and integration relationships.
4. `license-register`: source and licensing evidence.
5. `milestone-maturity-table`: planned milestone, target maturity, and evidence-backed current status.

Removing the document would either lose these facts or force Art, Audio, Technical, or UI to become competing resource authorities. Both outcomes violate the single-owner model.

## 3. Observed failure and root cause

The Chrome acceptance project `lighthouse-night-watch--e3e07ee6d416` completed seven Foundation documents and failed only Asset Plan with:

```text
foundation_transport_needs_action: Markdown continuation made no progress
```

The first Asset response was substantive and contained every required Asset section and all five required material headings, but placed the material H3 headings inside related H2 sections and omitted the `## Production Materials` container. The transport treated every incomplete structure as suffix truncation and requested append-only continuation. The model then appended a correct Production Materials block, leaving the five earlier material blocks in place. Append-only continuation could never delete the duplicates, so later continuation attempts could not make structural progress.

This is a classifier defect, not an inherent Asset Plan size problem:

- first response: 27,447 characters;
- appended material block: 15,165 characters;
- invalid combined candidate: 42,612 characters;
- duplicated first material blocks: approximately 14,908 characters;
- normalized useful content: approximately 27,704 characters, comparable with the accepted GDD.

The failed dispatch consumed 61,928 input tokens, 445,309 cache-read tokens, and 36,281 completion tokens. The dominant waste came from repeatedly carrying an unrecoverable-by-append candidate, not from the required Asset content.

## 4. Content contract

### 4.1 Inventory granularity

One inventory ID represents one independently acquireable, authorable, licensable, replaceable, and acceptable delivery unit. A delivery unit may project to multiple files or encoding variants; those files remain children of the same inventory ID rather than becoming unrelated inventory authorities.

Category bundles are invalid when their members can differ in source, license, responsibility, maturity, replacement, or acceptance. For example, independently produced audio cues and UI icons require separate inventory IDs.

### 4.2 Repeated metadata and section ownership

The five materials remain keyed by inventory ID. Repeated responsibility, license-policy, dependency, or milestone values remain ordinary values in their one owner material; this change does not add profile IDs, override semantics, or another schema.

Asset H2 sections provide policy, context, rationale, and references to the five owner materials. They must not duplicate per-inventory rows, mappings, quantities, evidence, current status, or milestone facts owned by those materials. `Validation and Quality Status` defines validation policy and lifecycle semantics only; current per-inventory status remains in `milestone-maturity-table`.

### 4.3 Planned state versus observed evidence

Planned intent and observed state are different facts:

- planned fields include source strategy, required license policy, target maturity, placeholder policy, milestone, and intended delivery files;
- observed fields include selected source, availability evidence, verified license, current maturity, and delivery receipt.

Before Resource realization, the author must express observed state as not yet observed. It must not claim `verified`, `available`, or a current placeholder/delivery state without concrete evidence in its admitted inputs.

### 4.4 Quantities and unresolved decisions

When upstream authority determines a delivery-unit count, Asset Plan records the exact unit mapping. When the count genuinely cannot be derived, it records an explicit stable `unresolvedRef` to the owning missing decision. Vague bundle quantities such as “by tier” or “as a set” are not substitutes for known scope.

### 4.5 Direction of authority

Art and Audio own semantic requirements and constraints before Asset exists. Asset maps those upstream requirement IDs to its inventory IDs. Upstream documents never predeclare or depend on future inventory IDs. Asset never copies upstream presentation or runtime facts as new authorities. `inventory ID` is the Stage 2 planning identity; a later Resource realization stage may map it to runtime resource IDs, but those terms are not aliases and Asset authoring does not invent the later IDs.

The delivery-unit, unresolved-reference, and evidence-truthfulness requirements are authoring and later semantic-acceptance rules, not new Stage 2 row schemas. This change deliberately does not invent a locale-sensitive prose parser or a second structured representation. Prompt contract tests prove the worker receives these rules; real-output audit proves whether the authored Markdown follows them.

## 5. Exact Markdown shape

The author prompt must include the literal ordered skeleton for the assigned document:

```markdown
# <document title>

## Executive Summary

## <contract section 1>
...
## <contract section N>

## Production Materials

### <material 1>
...
### <material N>
```

The closed heading rules are:

- every canonical H2 appears exactly once and in contract order;
- `## Production Materials` follows all canonical sections;
- every canonical material H3 appears exactly once, in contract order, and only beneath `## Production Materials`;
- those material H3 headings are forbidden anywhere earlier in the document;
- section prose may reference a material but must not embed a second copy of it;
- no additional H2 is allowed.

Every non-empty candidate must also have exactly one authored H1 as its first non-blank line; a missing, displaced, or repeated H1 cannot be repaired by appending and is structurally invalid. Beyond that title rule, classification applies only to canonical H2 titles and canonical material H3 titles. Ordinary section-local H3/H4 headings remain legal. Headings inside fenced blocks remain ignored.

This strengthens prompt clarity without changing the strict validator or introducing a structured JSON/YAML document output.

## 6. Transport recovery classification

The existing complete-document structural validator remains the final admission authority. A small structural classifier decides only which recovery operation is possible:

### 6.1 Complete

The candidate has the exact H2/H3 structure and closed Markdown fences. Forward it to normal admission.

### 6.2 Suffix-incomplete

The candidate is a valid prefix of the canonical heading sequence: no duplicate, misplaced, unexpected, or reordered canonical heading exists, and the missing structure can be added strictly after the current end. Continue from the exact tail in the same session and append the delta to the same candidate.

An empty first result may still request a from-beginning response.

### 6.3 Structurally invalid but replaceable

The candidate contains a duplicate, misplaced, unexpected, or reordered structural heading. Appending cannot make it valid. The transport must request one complete replacement in the same native session and dispatch. During that replacement response it collects bytes into a fresh buffer and swaps the in-memory uncommitted candidate only after the response ends.

The replacement prompt must state the exact defect class and exact skeleton, require a complete raw Markdown body from the title, and forbid commentary. Stream deltas may continue to populate the existing diagnostic pending file while the native turn is open. Once a structurally complete candidate exists, the runner normalizes the single final result to that complete candidate; the existing sink records that `terminalBody` and overwrites the same pending file with it before the one canonical commit. Complete initial, append, and replacement success paths all normalize the final result to the full accepted candidate; the sink must never treat a provider's append-only terminal delta as the whole document. A non-empty bounded `terminalBody` is itself a complete terminal payload, so the sink requires closed/non-empty streamed blocks only when `terminalBody` is absent. No reset event, second sink, second path, or second protocol is needed. The invalid bytes remain transient diagnostic evidence only; they are not an authority, fallback, alternate candidate, or second task.

If the replacement is empty, identical, restarts an append continuation, or still fails structural admission, the dispatch fails closed with a specific `foundation_transport_needs_action` reason. There is no second replacement cycle.

### 6.4 Irrecoverable

Infrastructure payload protection, a missing contract, or a replacement that makes no progress fails the same canonical task. It must not create a fresh author dispatch or reset the document to pending.

## 7. Minimal implementation shape

Reuse the existing heading scanner and canonical contract. Add one exported structural classification function beside `isCompleteGameDocumentMarkdownStructure`; do not add a parser dependency, recovery framework, feature flag, compatibility reader, or durable schema.

Extend the native turn state with only the transient distinction needed to capture a replacement response. Reuse the existing native session, observability, prompt writer, Markdown sink, pending path, and final result path. Normalize the successful terminal result to the complete accepted candidate, and let the sink's existing pre-commit overwrite publish that terminal body. The final committed body contains only the accepted replacement candidate.

The author prompt derives its literal skeleton from the existing contract object. Asset-specific quality rules belong in the Asset contract/prompt data already used by the single document-author path; do not introduce an Asset-only author worker.

## 8. Tests and acceptance

### 8.1 Characterization and unit tests

- A compact fixture reproduces the Chrome defect: all five Asset material H3 headings appear before a missing Production Materials H2.
- The classifier reports this as structurally invalid, not suffix-incomplete.
- A valid prefix ending before Production Materials remains suffix-incomplete.
- Duplicate, misplaced, reordered, and unexpected headings request replacement rather than append.
- The replacement response produces one result with each Asset material H3 exactly once.
- Empty or still-invalid replacement fails closed and does not start another replacement.
- Prompt tests prove the exact skeleton and Asset quality rules are present.
- Prompt-contract tests prove that per-delivery-unit granularity, one inventory ID mapping to multiple files, explicit unresolved references, and evidence-safe observed state reach the author. These semantic qualities are audited on real output rather than falsely presented as mechanically validated prose.
- A legal ordinary section H3 remains accepted even when canonical material-title H3 detection is strict.
- A candidate with a canonical material H3 before Production Materials and another complete material set after it remains structurally invalid.
- A non-empty candidate with a missing, displaced, or repeated authored H1 is structurally invalid; an empty candidate remains restartable.

### 8.2 Scope gates

The implementation diff may touch only:

- `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`;
- this design and its implementation plan;
- `packages/agent-workflow-server/src/beegame/complete-game-document.ts` and its test;
- `packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts` and its test;
- `packages/agent-workflow-server/src/beegame/fixtures/native-runtime-fixture.ts` as test-only native process support;
- `packages/agent-workflow-server/src/beegame/foundation-markdown-stream.ts` and its test;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts` and prompt tests;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.ts` and contract tests, only if the Asset quality rules cannot be expressed in existing fields.
- `scripts/game-ir-isolation-boundary.ts`, its test, and `docs/superpowers/evidence/2026-09-03-game-ir-protected-baseline.json` only after implementation, to admit the exact reviewed Stage 2 blob set while continuing to reject every other protected change.
- `docs/superpowers/evidence/2026-09-03-asset-plan-authoring-reliability.md` for final command and Chrome evidence.

Reviewer, Revision, Checklist, Game IR, controller, durable schema, recovery, UI, and unrelated document contracts are forbidden.

The isolation checker remains red during Tasks 1–4 only for the exact plan-allowed changed paths. Task 5 must extend its immutable manifest with a separate ordered `admittedStage2Corrections` list containing each approved path's baseline blob, final reviewed blob, reason, design commit, and evidence path. The checker must validate that list literally and then return green; it must not weaken the protected roots, reuse the existing test-only correction list, admit directories/globs, or accept working-tree-derived values dynamically.

### 8.3 Runtime acceptance order

1. Focused unit and integration tests, typecheck, diff check, and isolation boundary check.
2. Resume only the failed Asset Plan task from the accepted seven-document project if the current recovery interface can safely preserve the same canonical task. If it cannot, leave that failed run untouched and use a fresh project solely as a separate end-to-end acceptance run; this is not a replacement/retry track for the failed dispatch, and no repair endpoint may be invented.
3. Audit the accepted Asset Plan for unique material placement, delivery-unit granularity, mappings, normalized repetition, explicit unresolved decisions, and truthful observed state.
4. Run a fresh Idea-to-eight-documents Chrome acceptance.
5. Only after all eight documents pass, run the already-restored Reviewer, Revision, and Checklist without changing them.
6. Game IR work remains paused until this stable workflow is accepted.

Token, duration, and document size are measured and compared with the failed run. They are evidence, not fixed business acceptance limits.

## 9. Rejected approaches

- **Delete Asset Plan:** loses the only resource-production authority.
- **Reduce required content until the response fits:** mistakes duplication for necessary scope and reduces planning quality.
- **Always append:** cannot repair non-tail structural defects.
- **Create a second author/retry task inside the failed run:** creates a dual track and breaks canonical task identity. A separate fresh acceptance project is test evidence, not recovery state for that run.
- **Switch document output to JSON or YAML:** reintroduces large structured-output fragility and changes the human document authority.
- **Relax strict admission:** permits ambiguous or duplicated canonical structure.
- **Patch Reviewer or Revision:** unrelated to the Stage 2 authoring failure and violates the frozen boundary.
