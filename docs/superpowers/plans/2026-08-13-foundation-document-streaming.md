# Foundation Document Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace two-part section authoring with one bounded native checkpoint per semantic group and remove cross-section heading false positives without adding another document path.

**Architecture:** Keep the current delivery worker, native session, durable cursor, mutation authority, and final validator. Simplify normal groups to one cursor transition, validate the complete bounded section as that transition, and scope authored-heading uniqueness to each section. Production materials remain individually checkpointed because each is an independent contract artifact.

**Tech Stack:** TypeScript, Bun test, the existing delivery worker, and Chrome Web React.

---

### Task 1: One checkpoint per semantic section

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/foundation-document-draft.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-document-draft.ts`

- [ ] **Step 1: Write the failing draft test**

Change the first-group fixture to contain one complete section and the next-group cursor, with no `beegame-part` markers. Assert the normal group part count is one and the prompt contains exactly one section `Edit`.

```ts
expect(foundationDocumentDraftPartCount(groups[0]!)).toBe(1)
expect(firstPrompt).toContain('one complete bounded section')
expect(firstPrompt).not.toContain('beegame-part')
expect(firstPrompt).not.toContain('Checkpoint 3')
```

- [ ] **Step 2: Run the test and verify RED**

Run `bun test packages/agent-workflow-server/src/beegame/foundation-document-draft.test.ts`.

Expected: failure because normal groups still require two part markers and two checkpoints.

- [ ] **Step 3: Implement the single checkpoint**

Remove `SECTION_PART_COUNT` and all `beegame-part` parsing. A completed normal group contains its canonical section marker, heading, bounded body, and next-group cursor.

```ts
export function foundationDocumentDraftPartCount(
  group: FoundationDocumentDraftGroup,
): number {
  return group.productionMaterials.length || 1
}
```

Build one instruction for a normal group:

```ts
`native Edit: replace ${currentCursor} with <!-- beegame-section:${section.sectionId} -->, ## ${section.title}, one complete bounded section body, then <!-- beegame-draft-cursor:${group.groupIndex + 1}:0 -->.`
```

- [ ] **Step 4: Run the draft test and verify GREEN**

Run the Task 1 command. Expected: all tests pass.

### Task 2: Preserve exact mutation authority

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/foundation-document-mutation.test.ts`
- Modify only if required: `packages/agent-workflow-server/src/beegame/foundation-document-mutation.ts`

- [ ] **Step 1: Write the failing mutation test**

Make the allowed mutation replace cursor `0:0` with one complete section and cursor `1:0`. Assert attempts to add two sections, exceed 3,600 bytes, or rewrite completed text are denied.

```ts
expect(authorize({
  currentMarkdown: preamble(),
  toolName: 'Edit',
  mutation: {
    old_string: '<!-- beegame-draft-cursor:0:0 -->',
    new_string: completeSection,
  },
})).toEqual({ behavior: 'allow' })
```

- [ ] **Step 2: Run the mutation test and verify RED**

Run `bun test packages/agent-workflow-server/src/beegame/foundation-document-mutation.test.ts`.

Expected: failure because current authority expects an intermediate part cursor.

- [ ] **Step 3: Make the minimal authority adjustment**

Keep the existing “advance exactly one checkpoint” algorithm. Only adjust it if the simplified draft progress makes an existing branch invalid; do not add another mutation mode.

- [ ] **Step 4: Run the mutation test and verify GREEN**

Run the Task 2 command. Expected: all tests pass.

### Task 3: Scope heading uniqueness correctly

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`

- [ ] **Step 1: Write the failing validator tests**

Create one complete document where two different sections contain `### Acceptance Criteria` and assert it passes. Create another where a single section contains that heading twice and assert it fails.

```ts
expect(validateCompleteGameDocumentMarkdown(path, crossSectionRepeat)).toBe(
  crossSectionRepeat,
)
expect(() => validateCompleteGameDocumentMarkdown(path, sameSectionRepeat)).toThrow(
  /heading is duplicated/i,
)
```

- [ ] **Step 2: Run the validator test and verify RED**

Run `bun test packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`.

Expected: the cross-section repeated heading fails under the global set.

- [ ] **Step 3: Scope the set per section**

Move `const seen = new Set<string>()` inside the section loop. Keep heading level and skipped-level validation unchanged.

- [ ] **Step 4: Run the validator test and verify GREEN**

Run the Task 3 command. Expected: all tests pass.

### Task 4: Prove the existing delivery worker uses the simplified path

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.segmented-documents.test.ts`

- [ ] **Step 1: Rewrite the integration fixture and verify RED**

Advance each normal group once with a complete section and next-group cursor. Assert 13 native turns for the GDD, no part markers, and final completion through the existing port.

```ts
expect(prompts).toHaveLength(foundationDocumentDraftGroups(path).length)
expect(prompts.slice(0, -1).every(prompt => !prompt.includes('beegame-part'))).toBe(true)
```

Run `bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.segmented-documents.test.ts`.

Expected before fixture and implementation align: failure on the old two-part protocol.

- [ ] **Step 2: Complete the fixture alignment and verify GREEN**

Run `bun test packages/agent-workflow-server/src/beegame/foundation-document-draft.test.ts packages/agent-workflow-server/src/beegame/foundation-document-mutation.test.ts packages/agent-workflow-server/src/beegame/complete-game-document.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.segmented-documents.test.ts`.

Expected: all focused tests pass.

### Task 5: Verify and commit the code change

**Files:**
- Modify: `docs/reports/beegame-direct-browser-delivery-ledger.md` only if it already tracks this path, using exact evidence.

- [ ] **Step 1: Run proportional regression checks**

Run the focused command from Task 4 plus `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`, then run `bun run typecheck` and `git diff --check`.

Expected: tests pass, typecheck exits zero, and diff check emits no output.

- [ ] **Step 2: Commit only the implementation and exact evidence**

```bash
git add packages/agent-workflow-server/src/beegame/foundation-document-draft.ts packages/agent-workflow-server/src/beegame/foundation-document-draft.test.ts packages/agent-workflow-server/src/beegame/foundation-document-mutation.ts packages/agent-workflow-server/src/beegame/foundation-document-mutation.test.ts packages/agent-workflow-server/src/beegame/complete-game-document.ts packages/agent-workflow-server/src/beegame/complete-game-document.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.segmented-documents.test.ts
git commit -m "fix: stream one bounded document section"
```

### Task 6: Chrome Web React GDD acceptance

**Files:**
- No example/test-project code changes.
- Runtime output only under the canonical `Projects/users/...` root.

- [ ] **Step 1: Start the fixed services**

Use frontend `62173`, runtime `62174`, billing `62175`, skills `62176`, and resources `62177`. Confirm each listener before opening Chrome.

- [ ] **Step 2: Generate a fresh non-tower-defense project through Chrome**

Use the Web React flow and configured model. Allow the GDD to complete, then stop before the second document authors content.

- [ ] **Step 3: Audit file and logs**

Verify the full document validator, section/material coverage, human readability, implementation usefulness, no target-file Bash mutation, no completed-prefix rewrite, maximum response gap below 45 seconds, elapsed time, per-turn usage, and raw GDD total tokens at or below 1.8 million.

- [ ] **Step 4: Stop on failure**

If any threshold fails, stop services and diagnose captured group/tool/native logs before modifying code or rerunning. Do not continue to the other seven documents.
