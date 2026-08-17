# Foundation Reviewer Markdown Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four Foundation Reviewer `StructuredOutput` turns with one strict Markdown-receipt path whose compact synthesis selection is deterministically assembled into the sole canonical `review.json`.

**Architecture:** Three read-only Reviewer lanes return complete issue records as native streamed Markdown. A fourth read-only Reviewer returns only keep/duplicate/reject references. Bee Game Studio parses Markdown syntax, validates identity and authority, copies selected records without semantic transformation, validates the existing canonical review schema, and atomically persists `review.json`.

**Tech Stack:** TypeScript, Bun test, Zod, `mdast-util-from-markdown`, `mdast-util-to-string`, existing Bee Game Studio delivery workflow and native CLI adapter.

## Global Constraints

- Keep exactly four Reviewer tasks: `core-design`, `technical-assets`, `presentation`, and `synthesis`.
- Each of the eight canonical documents is fully owned by exactly one lane.
- Reviewer workers expose only native `Read`, `Grep`, and `Glob`; they receive no mutation, shell, Agent-launch, `StructuredOutput`, or `--json-schema` capability.
- Markdown headings and lists are the only Reviewer output grammar; Markdown tables are rejected.
- A lane candidate contains problem, evidence, required outcome, changes, and acceptance before synthesis starts.
- Synthesis only classifies stable candidate references; it never merges or rewrites candidate content.
- Bee Game Studio performs syntax parsing, authority validation, deterministic copying, ordering, ID assignment, verdict derivation, schema validation, and atomic persistence only.
- `review.json` is the sole final workflow authority. Markdown receipts are immutable input evidence, not a second final report.
- Do not retain a JSON lane packet, Markdown/JSON fallback, legacy Reviewer dispatch, automatic API retry, or active-snapshot migration path.
- Do not modify the native runtime core.
- Do not dispatch remediation or verification after `NEEDS_REVISION`.

---

### Task 1: Parse complete lane Markdown receipts

**Files:**
- Modify: `packages/agent-workflow-server/package.json`
- Modify: `bun.lock`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts`

**Interfaces:**
- Consumes: `FoundationDocumentLaneId`, canonical Foundation document paths, and the existing final conflict field constraints.
- Produces: `parseFoundationReviewLaneMarkdown(markdown, expected): FoundationReviewLaneReceipt`, `foundationReviewLaneMarkdownInstruction(expected): string`, and exported reusable `foundationReviewConflictContentSchema`.

- [ ] **Step 1: Add the direct Markdown parser dependency**

Add `"mdast-util-from-markdown": "^2.0.3"` and
`"mdast-util-to-string": "^4.0.0"` to
`@bee-game-studio/agent-workflow-server` dependencies and run:

```bash
bun install
```

Expected: `package.json` and `bun.lock` record a direct parser dependency; no network-dependent runtime parser is introduced.

- [ ] **Step 2: Write failing lane-receipt tests**

Create fixtures containing Chinese prose, inline code, literal `|` characters, and multiline evidence. Cover:

```ts
const receipt = parseFoundationReviewLaneMarkdown(markdown, {
  revision: 'a'.repeat(64),
  lane: 'core-design',
  projectionDigest: 'b'.repeat(64),
})

expect(receipt.candidates[0]).toEqual({
  reference: 'core-design:C1',
  title: '胜利条件冲突',
  problem: 'GDD 与关卡文档要求不同的唯一胜利状态。',
  evidence: [
    {
      path: 'docs/GDD.md',
      location: '## 胜利条件',
      observed: '必须同时满足 `A | B`，但关卡文档只要求 A。',
    },
  ],
  requiredOutcome: '所有消费者使用同一个胜利状态。',
  changes: [
    { path: 'docs/GDD.md', action: '保留唯一权威条件。' },
  ],
  acceptance: ['GDD 与关卡文档枚举完全一致。'],
})
```

Also assert exact failures for a Markdown table, wrong revision, wrong lane, wrong projection digest, more than eight candidates, duplicate references, missing headings, empty required lists, absolute/out-of-lane evidence paths, and duplicate change paths.

- [ ] **Step 3: Run the parser test and confirm RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.test.ts
```

Expected: FAIL because the Markdown parser module does not exist.

- [ ] **Step 4: Export the reusable final conflict content contract**

Refactor `foundation-review.ts` so the final report and Markdown parser share one semantic field schema:

```ts
export const foundationReviewConflictContentSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    problem: z.string().trim().min(1).max(2_000),
    evidence: z.array(evidenceSchema).min(1).max(32),
    requiredOutcome: z.string().trim().min(1).max(1_200),
    changes: z.array(changeSchema).min(1).max(8),
    acceptance: z.array(z.string().trim().min(1).max(600)).min(1).max(24),
  })
  .strict()

const conflictSchema = foundationReviewConflictContentSchema.safeExtend({
  id: conflictIdSchema,
})
```

Permit multiple distinct change actions for the same canonical document path;
preserve entries verbatim and in order while downstream affected-path
projection remains deduplicated.

- [ ] **Step 5: Implement AST-based strict parsing**

Use `fromMarkdown(markdown)` and walk top-level nodes in order. Define these exact types:

```ts
export type FoundationReviewCandidate = z.infer<
  typeof foundationReviewConflictContentSchema
> & { reference: `${FoundationDocumentLaneId}:C${number}` }

export type FoundationReviewLaneReceipt = {
  revision: string
  lane: FoundationDocumentLaneId
  projectionDigest: string
  candidates: FoundationReviewCandidate[]
}

export function parseFoundationReviewLaneMarkdown(
  markdown: string,
  expected: {
    revision: string
    lane: FoundationDocumentLaneId
    projectionDigest: string
  },
): FoundationReviewLaneReceipt
```

Reject any `table` node. Require exactly one H1 `Foundation Review Packet`, the three identity paragraphs, and candidate H2 blocks whose H3 headings occur exactly once in this order: `Problem`, `Evidence`, `Required outcome`, `Changes`, `Acceptance`. Convert phrasing nodes to their literal text through `mdast-util-to-string`; do not parse the document with regular expressions. Validate the resulting object through Zod and lane path authority.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts
bun run typecheck
git diff --check
```

Expected: all commands pass.

Commit:

```bash
git add packages/agent-workflow-server/package.json bun.lock packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.test.ts
git commit -m "feat: parse foundation review markdown receipts"
```

### Task 2: Parse compact synthesis selections and assemble canonical JSON

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.test.ts`

**Interfaces:**
- Consumes: three validated `FoundationReviewLaneReceipt` values and one synthesis Markdown string.
- Produces: `parseFoundationReviewSelectionMarkdown()`, `assembleFoundationReview()`, and byte-stable `FoundationReview` output.

- [ ] **Step 1: Write failing selection and assembly tests**

Use three lane receipts containing four total candidates. Assert:

```ts
const review = assembleFoundationReview({
  revision: 'a'.repeat(64),
  laneReceipts,
  selection: parseFoundationReviewSelectionMarkdown(selectionMarkdown, {
    revision: 'a'.repeat(64),
    candidateReferences: [
      'core-design:C1',
      'core-design:C2',
      'technical-assets:C1',
      'presentation:C1',
    ],
  }),
})

expect(review.verdict).toBe('NEEDS_REVISION')
expect(review.conflicts.map(conflict => conflict.id)).toEqual(['B1', 'B2'])
expect(review.conflicts.map(conflict => conflict.title)).toEqual([
  laneReceipts[0].candidates[0].title,
  laneReceipts[2].candidates[0].title,
])
```

Test reversed lane and list ordering and expect byte-identical JSON. Reject unknown references, duplicate accounting, omitted candidates, duplicate targets not in `Keep`, self-duplicates, and one reference appearing in two sections. Assert an empty candidate set plus empty sections produces `READY`.

- [ ] **Step 2: Run the assembly test and confirm RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.test.ts
```

Expected: FAIL because the assembly module and selection parser do not exist.

- [ ] **Step 3: Implement the compact selection parser**

Add these exact contracts:

```ts
export type FoundationReviewSelection = {
  revision: string
  keep: string[]
  duplicate: Array<{ source: string; target: string }>
  reject: string[]
}

export function parseFoundationReviewSelectionMarkdown(
  markdown: string,
  expected: { revision: string; candidateReferences: string[] },
): FoundationReviewSelection
```

Allow only an optional contiguous sequence of ordinary top-level paragraphs before the unique H1 `Foundation Review Selection`; preserve those bytes but ignore their semantics. Reject every other prefix block and all trailing content. After the H1, require one revision paragraph and exactly three H2 sections in `Keep`, `Duplicate`, `Reject` order. Lists may be empty but must exist. Parse inline-code references from list nodes, reject tables and any other content outside the receipt subtree, and validate exact one-time accounting against `candidateReferences`.

- [ ] **Step 4: Implement deterministic no-merge assembly**

Implement:

```ts
export function assembleFoundationReview(input: {
  revision: string
  laneReceipts: FoundationReviewLaneReceipt[]
  selection: FoundationReviewSelection
}): FoundationReview
```

Build a unique reference map, bytewise-sort only `selection.keep`, copy each selected candidate with object/array cloning, assign `B${index + 1}`, derive the verdict from the retained count, and return `foundationReviewSchema.parse(value)`. Never concatenate fields from duplicate source and target records.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.test.ts
bun run typecheck
git diff --check
```

Expected: all commands pass.

Commit:

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.test.ts
git commit -m "feat: assemble reviewer selections deterministically"
```

### Task 3: Route all Reviewer terminals through native Markdown text

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts`

**Interfaces:**
- Consumes: native success result `payload.result: string` and the role-specific Markdown contract instruction.
- Produces: a durable staging `.md` receipt and the existing deterministic Reviewer terminal envelope.

- [ ] **Step 1: Write failing native-path tests**

Assert a Reviewer session start has:

```ts
expect(startInput?.workflowJsonSchema).toBeUndefined()
expect(nativeArgs).toContain('--tools')
expect(nativeArgs).toContain('Read,Grep,Glob')
expect(nativeArgs.some(arg => arg === '--json-schema')).toBe(false)
```

Feed a native `result` event with `payload.result` equal to valid lane Markdown and assert the staging path contains those exact UTF-8 bytes plus one terminal newline. Repeat for synthesis selection Markdown. Assert missing, empty, malformed, or oversized result text fails before a completed terminal is returned.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
```

Expected: existing tests prove `workflowJsonSchema` and StructuredOutput are still active.

- [ ] **Step 3: Remove Reviewer schema injection and update prompts**

Delete Reviewer construction of `workflowJsonSchema` from `createBeeGameDeliveryWorkerPort.start()`. Replace the terminal instruction with:

```ts
case 'document-reviewer':
  return 'Return exactly one contracted Markdown receipt as the visible final response. Do not call StructuredOutput, Write, Edit, shell, or Agent.'
```

For lane roles append `foundationReviewLaneMarkdownInstruction(expected)`. For synthesis append the exact selection grammar and candidate reference list derived from the three accepted receipts. Remove every instruction to create a complete final JSON object.

- [ ] **Step 4: Persist native visible text, not structured output**

Change `createDeterministicDocumentReviewTerminal()` to extract:

```ts
const markdown =
  payload && typeof payload === 'object' && typeof payload.result === 'string'
    ? payload.result.trim()
    : ''
if (!markdown)
  throw new Error('Foundation Reviewer returned no visible Markdown receipt')
await durableWriteProjection(stagingPath, `${markdown}\n`)
```

Do not add a new core stream sink, watchdog, retry, or tool. The native result is the sole terminal source.

- [ ] **Step 5: Keep the generic CLI schema feature but prove Reviewers cannot select it**

Do not remove generic `--json-schema` support used by unrelated worker types. Add a native runner regression proving `workflowWorkerType: 'document-reviewer'` with no `workflowJsonSchema` receives only `Read,Grep,Glob` and no schema argument.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
bun run typecheck
git diff --check
```

Expected: all commands pass and no Reviewer test fixture uses `structured_output`.

Commit:

```bash
git add packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
git commit -m "fix: stream reviewer markdown terminals"
```

### Task 4: Persist receipts and atomically produce canonical review JSON

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts`

**Interfaces:**
- Consumes: staged lane/selection Markdown, current source revision, projection digests, and accepted lane receipt digests.
- Produces: committed `.md` receipts, synthesis receipt digest, canonical `review.json`, final report digest, and unchanged terminal workflow verdict behavior.

- [ ] **Step 1: Write failing path and acceptance tests**

Assert the exact paths:

```ts
const root = `.beegame/reviews/foundation/${revision}`
expect(state.reports.map(report => report.path)).toEqual([
  `${root}/parts/core-design.md`,
  `${root}/parts/technical-assets.md`,
  `${root}/parts/presentation.md`,
  `${root}/selection.md`,
])
```

After accepting synthesis, assert `finalReportPath === `${root}/review.json`` while the synthesis report path remains `${root}/selection.md`. Tamper any lane receipt, selection receipt, source revision, or projection digest and expect acceptance failure before `review.json` replacement. Assert an existing valid final report is unchanged after a failed replacement.

- [ ] **Step 2: Run stage tests and confirm RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts
```

Expected: FAIL because state and terminal contracts still require lane `.json` and synthesis `review.json` paths.

- [ ] **Step 3: Change state and terminal path authority**

Make `reportPath()` return lane `.md` paths and `selection.md` for synthesis. Make the terminal schema enforce the same paths. Keep `finalReportPath` independently bound to canonical `review.json`; never overload the synthesis receipt path as final authority.

- [ ] **Step 4: Implement durable Markdown acceptance**

Replace JSON lane acceptance with functions that:

```ts
const bytes = await readFile(stagingPath)
const markdown = bytes.toString('utf8')
const receipt = parseFoundationReviewLaneMarkdown(markdown, expected)
await atomicCommitReceipt({ stagingPath, committedPath, bytes })
return { receipt, path: projectRelativePath, digest: sha256(bytes) }
```

For synthesis, parse and commit `selection.md`, reread and digest-check all three committed lane receipts, call `assembleFoundationReview`, serialize canonical JSON with the existing stable formatting, validate it again, fsync the staging file and directory, and rename atomically to `review.json`.

- [ ] **Step 5: Preserve terminal state semantics**

On lane acceptance, store the Markdown receipt digest and keep the review running. On synthesis acceptance, store the selection digest in the synthesis report and the JSON digest in `finalReportDigest`. Continue routing `READY` to checklist and `NEEDS_REVISION` to `needs_action` with no repair dispatch.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.test.ts
bun run typecheck
git diff --check
```

Expected: all commands pass.

Commit:

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts
git commit -m "feat: commit canonical reviews from markdown receipts"
```

### Task 5: Delete the legacy Reviewer JSON route and invalidate old active snapshots

**Files:**
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

**Interfaces:**
- Consumes: schema-26 persisted snapshots and historical completed `review.json` files.
- Produces: schema-27 active state with Markdown receipt paths; old active snapshots fail closed while historical final JSON remains display-readable.

- [ ] **Step 1: Write the failing recovery boundary test**

Construct a schema-26 snapshot whose Foundation Reviewer reports point to `.json` lane packets and assert:

```ts
await expect(recoverDeliveryRun(snapshot)).rejects.toThrow(
  'workflow snapshot schema version 26 is obsolete',
)
```

Also prove a current schema snapshot with `.md` receipts and a valid final `review.json` recovers without changing receipt or final-report digests.

- [ ] **Step 2: Run recovery tests and confirm RED**

Run:

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts
```

Expected: FAIL because schema version 26 and JSON lane paths are still current.

- [ ] **Step 3: Bump the persisted workflow schema to 27**

Change:

```ts
export const DELIVERY_RUN_SCHEMA_VERSION = 27 as const
```

Regenerate the persisted schema fingerprint through the repository's existing schema-evolution test output, register only the exact version-27 fingerprint, and retain the existing fail-closed behavior for older snapshots. Do not add a migration or alias.

- [ ] **Step 4: Remove the executable JSON lane implementation**

Delete `foundation-review-lane-packet.ts` and its dedicated test. Replace all imports with the Markdown receipt module. Remove JSON packet staging names, serializers, normalizers, prompts, and fixtures. Historical final `review.json` reading in project routes remains because it is canonical project data, not an executable legacy Reviewer route.

- [ ] **Step 5: Run the legacy-route scan**

Run:

```bash
rg -n "FoundationReviewLanePacket|foundationReviewLanePacket|parts/.+\\.json|Submit the object once through StructuredOutput|sole canonical version 2 review.json" packages/agent-workflow-server apps/frontend
```

Expected: no production match. Test names may mention rejection of obsolete schema-26 data, but no test may instantiate an executable JSON lane dispatch.

- [ ] **Step 6: Run the complete automated gate and commit**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
bun run typecheck
git diff --check
```

Expected: all commands pass.

Stage only the listed Task 5 files and commit with:

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git add -u packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts
git commit -m "refactor: remove structured reviewer packet path"
```

### Task 6: Chrome acceptance of the sole Reviewer path

**Files:**
- Create: `docs/superpowers/reviews/2026-08-18-foundation-review-markdown-acceptance.md`

**Interfaces:**
- Consumes: a copied project containing the already accepted eight canonical documents and the Web/React workflow UI.
- Produces: runtime evidence that the four Reviewer tasks complete through Markdown receipts and canonical local JSON assembly without entering remediation.

- [ ] **Step 1: Start the fixed-port Web/React stack**

Use the repository's established fixed backend/frontend ports and the configured project model. Do not change model configuration, source documents, native runtime core, or the acceptance project to make the run pass.

- [ ] **Step 2: Run Reviewer-only acceptance through Chrome**

Open the Web/React Dashboard in Chrome, copy the already validated eight-document project, start only Foundation Review, and observe the four ordinary Tasks. Stop after the accepted `READY` or `NEEDS_REVISION` Reviewer terminal; do not execute remediation, checklist, resources, implementation, or acceptance.

- [ ] **Step 3: Verify runtime and persisted evidence**

Record and verify:

```text
three lane tasks started concurrently
three committed parts/*.md receipts exist
one compact selection.md exists
one canonical review.json exists
no Reviewer dispatch contains workflowJsonSchema
no raw log contains a Reviewer StructuredOutput tool_use
review.json revision equals the reviewed source revision
review.json conflicts equal the kept source records without rewritten prose
all eight canonical source SHA-256 values are unchanged
no remediation or verification dispatch exists
```

If the provider stream ends without a terminal, record the exact last native event and fail acceptance; do not add retry or modify the test project.

- [ ] **Step 4: Audit quality and usage**

For every kept conflict, confirm an implementation Agent can identify the problem, evidence location, required document changes, and testable acceptance result without reading a narrative review. Record per-lane and synthesis input/cache/output tokens and duration. The synthesis output must be materially smaller than the combined lane receipts because it contains references only.

- [ ] **Step 5: Write and commit acceptance evidence**

The acceptance document must include project path, run ID, source revision, receipt paths and digests, final report path and digest, four task outcomes, token/duration table, source hash comparison, and any exact failure. Do not paste full source documents, raw credentials, or full Reviewer prose.

Run:

```bash
git diff --check
git status --short
```

Commit:

```bash
git add docs/superpowers/reviews/2026-08-18-foundation-review-markdown-acceptance.md
git commit -m "docs: accept markdown foundation reviewer"
```

## Plan Self-Review

- Every confirmed design requirement maps to a task: complete lane content (Task 1), compact reference-only synthesis and no semantic merge (Task 2), ordinary native text instead of StructuredOutput (Task 3), deterministic canonical JSON and atomic persistence (Task 4), legacy-route deletion and fail-closed recovery (Task 5), and real Chrome evidence (Task 6).
- `review.json` remains the only final authority; lane and selection Markdown are immutable receipts with distinct paths and digests.
- The plan modifies no native runtime core and introduces no retry, watchdog, alternate dispatch, feature flag, or migration.
- The only new dependencies are local Markdown AST parsing utilities already
  present transitively in the workspace lockfile; they are made explicit for
  the server package.
- Interface names and paths are consistent across parsing, assembly, state, terminal, persistence, recovery, and acceptance tasks.
- The implementation cannot silently omit candidates, merge duplicate prose, or make Bee Game Studio decide semantic conflicts.
