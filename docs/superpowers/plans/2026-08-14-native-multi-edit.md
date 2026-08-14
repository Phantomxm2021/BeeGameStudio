# Native MultiEdit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an atomic native `MultiEdit` tool so the Agent can apply several exact replacements to one file in one call, then prove through controlled Chrome that it reduces repeated GDD authoring turns without moving authorship into Bee Game Studio.

**Architecture:** Introduce a pure ordered-edit resolver and one shared native edit pipeline used by existing `Edit` and new `MultiEdit`. `MultiEdit` has a strict array schema but inherits the same read-before-edit, staleness, permission, settings, secret, encoding, history, hook, LSP, analytics, and atomic-write behavior. Bee Game Studio remains a passive observer and never creates edit arrays.

**Tech Stack:** TypeScript, Zod v4, Bun test, React/Ink permission UI, native tool runtime, Chrome Web React, JSONL usage evidence.

---

## Release gates

- Existing `Write` and `Edit` contracts remain unchanged.
- A failed `MultiEdit` writes zero bytes; a success makes one backup and one atomic write.
- `MultiEdit` has exactly the same native file authority as `Edit`.
- BGS contains no edit grouping, replacement generation, retry, checkpoint, or document chunking.
- A fresh Chrome GDD is complete and valid at no more than 280,000 raw processed tokens.
- The eight-document run starts only after the GDD gate passes and must remain at no more than 2.4 million initial-authoring raw tokens.
- Fixed ports: frontend `62173`, runtime `62174`, billing `62175`, skills `62176`, resources `62177`.

## Planned file boundaries

Create native tool files under `packages/builtin-tools/src/tools/MultiEditTool/`: `constants.ts`, `types.ts`, `prompt.ts`, `UI.tsx`, `MultiEditTool.ts`, and `__tests__/MultiEditTool.test.ts`.

Create `packages/builtin-tools/src/tools/FileEditTool/fileEditPipeline.ts` for shared validation and one-write execution. Modify the existing file-edit types/utilities/tool only to delegate through that shared pipeline while preserving the public `Edit` shape.

Register the primitive in `packages/builtin-tools/src/index.ts`, `src/tools.ts`, `src/constants/tools.ts`, REPL primitive lists, API normalization, permission UI dispatch, and compact-history classification. BGS product code is not changed except for a boundary regression test proving passive observation.

### Task 1: Resolve ordered edits before any write

**Files:**
- Modify: `packages/builtin-tools/src/tools/FileEditTool/types.ts`
- Modify: `packages/builtin-tools/src/tools/FileEditTool/utils.ts`
- Test: `packages/builtin-tools/src/tools/FileEditTool/__tests__/utils.test.ts`

- [ ] **Step 1: Write failing ordered-resolution tests**

Add:

```ts
import { resolveFileEdits } from '../utils.js'

test('resolves independent edits in declared order', () => {
  const result = resolveFileEdits({
    filePath: '/project/GDD.md',
    fileContents: '# GDD\n\n<!-- vision -->\n\n<!-- systems -->\n',
    edits: [
      { old_string: '<!-- vision -->', new_string: '## Vision\nBody', replace_all: false },
      { old_string: '<!-- systems -->', new_string: '## Systems\nBody', replace_all: false },
    ],
  })
  expect(result.updatedFile).toContain('## Vision')
  expect(result.updatedFile).toContain('## Systems')
  expect(result.resolvedEdits).toHaveLength(2)
})

test('rejects an ambiguous later edit', () => {
  expect(() => resolveFileEdits({
    filePath: '/project/GDD.md',
    fileContents: 'A\nTARGET\nTARGET\nB\n',
    edits: [
      { old_string: 'A', new_string: 'AA', replace_all: false },
      { old_string: 'TARGET', new_string: 'done', replace_all: false },
    ],
  })).toThrow('Found 2 matches')
})
```

Also add explicit tests for empty arrays, identical values, missing matches, `replace_all`, and targeting text introduced by an earlier edit.

- [ ] **Step 2: Run RED**

Run `bun test packages/builtin-tools/src/tools/FileEditTool/__tests__/utils.test.ts`.

Expected: FAIL because `resolveFileEdits` is missing.

- [ ] **Step 3: Add shared types and resolver**

Add types:

```ts
export type FileEditsRequest = { file_path: string; edits: FileEdit[] }
export type ResolvedFileEdits = {
  resolvedEdits: FileEdit[]
  updatedFile: string
  patch: z.infer<ReturnType<typeof hunkSchema>>[]
}
```

Implement `resolveFileEdits` to validate each edit against the current in-memory result, enforce uniqueness unless `replace_all`, preserve order, enforce the existing unsafe-overlap rule, and call `getPatchForEdits` only after every edit has validated. It returns `{resolvedEdits, updatedFile, patch}` and performs no filesystem I/O.

- [ ] **Step 4: Run GREEN and commit**

Run the focused test, `bun run typecheck`, and `git diff --check`. Commit:

```bash
git add packages/builtin-tools/src/tools/FileEditTool/types.ts packages/builtin-tools/src/tools/FileEditTool/utils.ts packages/builtin-tools/src/tools/FileEditTool/__tests__/utils.test.ts
git commit -m "refactor: resolve ordered native file edits"
```

### Task 2: Share one atomic native edit pipeline

**Files:**
- Create: `packages/builtin-tools/src/tools/FileEditTool/fileEditPipeline.ts`
- Modify: `packages/builtin-tools/src/tools/FileEditTool/FileEditTool.ts`
- Create: `packages/builtin-tools/src/tools/MultiEditTool/__tests__/MultiEditTool.test.ts`

- [ ] **Step 1: Write a failing disk-atomicity test**

Use a temporary target and real read-state cache. First apply two valid edits and expect the exact result. Then read that result, submit one valid plus one missing replacement, expect rejection, and assert the file is byte-for-byte unchanged:

```ts
expect(await Bun.file(target).text()).toBe('alpha\nONE\nTWO\nomega\n')
await expect(executeFileEdits(invalidRequest, context, parentMessage)).rejects.toThrow('String to replace not found')
expect(await Bun.file(target).text()).toBe(committed)
```

- [ ] **Step 2: Run RED**

Run `bun test packages/builtin-tools/src/tools/MultiEditTool/__tests__/MultiEditTool.test.ts`.

Expected: missing `fileEditPipeline` or `executeFileEdits` failure.

- [ ] **Step 3: Extract shared validation and execution**

Expose:

```ts
export type SharedFileEditOutput = {
  filePath: string
  edits: FileEdit[]
  originalFile: string
  structuredPatch: StructuredPatchHunk[]
  userModified: boolean
  gitDiff?: ToolUseDiff
}

export async function validateFileEdits(
  request: FileEditsRequest,
  toolUseContext: ToolUseContext,
): Promise<ValidationResult>

export async function executeFileEdits(
  request: FileEditsRequest,
  executionContext: ToolUseContext,
  parentMessage: AssistantMessage,
): Promise<SharedFileEditOutput>
```

Move, rather than fork, the existing path, directory, 1 GiB, read-before-edit, staleness, settings, secret, encoding, line-ending, history, hook, diagnostic, LSP, editor, analytics, and git-diff behavior. `validateFileEdits` computes the complete final content before approving. `executeFileEdits` performs no `await` between the final read/staleness check and `writeTextContent`, and writes once.

- [ ] **Step 4: Keep single Edit compatible**

Adapt the existing input to:

```ts
const request = {
  file_path: input.file_path,
  edits: [{
    old_string: input.old_string,
    new_string: input.new_string,
    replace_all: input.replace_all ?? false,
  }],
}
```

Map the first resolved edit back to the existing `oldString`, `newString`, and `replaceAll` output. Do not alter `FileEditTool.inputSchema`, its tool name, result prose, or permission identity.

- [ ] **Step 5: Run GREEN and commit**

Run both edit utility and atomicity tests, typecheck, and diff-check. Commit:

```bash
git add packages/builtin-tools/src/tools/FileEditTool packages/builtin-tools/src/tools/MultiEditTool/__tests__/MultiEditTool.test.ts
git commit -m "refactor: share atomic native edit pipeline"
```

### Task 3: Add the native MultiEdit contract

**Files:**
- Create: `packages/builtin-tools/src/tools/MultiEditTool/constants.ts`
- Create: `packages/builtin-tools/src/tools/MultiEditTool/types.ts`
- Create: `packages/builtin-tools/src/tools/MultiEditTool/prompt.ts`
- Create: `packages/builtin-tools/src/tools/MultiEditTool/UI.tsx`
- Create: `packages/builtin-tools/src/tools/MultiEditTool/MultiEditTool.ts`
- Modify: `packages/builtin-tools/src/tools/MultiEditTool/__tests__/MultiEditTool.test.ts`
- Modify: `packages/builtin-tools/src/index.ts`

- [ ] **Step 1: Write failing schema and prompt tests**

Assert a nonempty array parses with `replace_all: false`; an empty array and extra keys reject. Assert the prompt contains “same file,” “declared order,” and “atomic,” but excludes `GDD`, `Markdown`, `checkpoint`, fixed counts, and BGS business instructions.

- [ ] **Step 2: Run RED**

Run the focused test. Expected: missing `MultiEditTool` modules.

- [ ] **Step 3: Implement strict input/output schemas**

Use:

```ts
z.strictObject({
  file_path: z.string().describe('The absolute path to the file to modify'),
  edits: z.array(z.strictObject({
    old_string: z.string(),
    new_string: z.string(),
    replace_all: semanticBoolean(z.boolean().default(false).optional()),
  })).min(1),
})
```

Output contains `filePath`, resolved `edits`, `originalFile`, one `structuredPatch`, `userModified`, and optional `gitDiff`. It does not repeat the complete updated file.

- [ ] **Step 4: Implement the tool definition**

Delegate validation and execution to the shared pipeline. Use `checkWritePermissionForTool(MultiEditTool, ...)`, `areFileEditsInputsEquivalent`, and concise result prose: `The file <path> has been updated successfully with <n> atomic edits.` Classifier input contains only path and edit count, never replacement bodies.

- [ ] **Step 5: Run GREEN and commit**

Run focused tests, typecheck, and diff-check. Commit:

```bash
git add packages/builtin-tools/src/tools/MultiEditTool packages/builtin-tools/src/index.ts
git commit -m "feat: add native multi edit tool"
```

### Task 4: Register permissions and native availability

**Files:**
- Modify: `src/tools.ts`
- Modify: `src/constants/tools.ts`
- Modify: `packages/builtin-tools/src/tools/REPLTool/primitiveTools.ts`
- Modify: `packages/builtin-tools/src/tools/REPLTool/constants.ts`
- Modify: `src/utils/api.ts`
- Create: `src/components/permissions/MultiEditPermissionRequest/MultiEditPermissionRequest.tsx`
- Modify: `src/components/permissions/PermissionRequest.tsx`
- Test: `src/__tests__/tools.test.ts`
- Test: `src/constants/__tests__/tools.test.ts`

- [ ] **Step 1: Write failing inventory tests**

Assert `getAllBaseTools()` includes `MultiEdit`, simple mode contains `Read/Edit/MultiEdit`, and `ASYNC_AGENT_ALLOWED_TOOLS` treats `MultiEdit` exactly like `Edit`.

- [ ] **Step 2: Run RED**

Run `bun test src/__tests__/tools.test.ts src/constants/__tests__/tools.test.ts` and expect missing registration.

- [ ] **Step 3: Register with Edit parity**

Place `MultiEditTool` immediately after `FileEditTool` in base/simple/REPL primitive arrays. Add its constant only to the same native agent allowlist as `Edit`. In `src/utils/api.ts`, parse the strict schema and pass the ordered array through `normalizeFileEditInput`; never sort or combine it.

- [ ] **Step 4: Add one combined permission diff**

Parse with `MultiEditTool.inputSchema` and render:

```tsx
<FileEditToolDiff file_path={file_path} edits={edits} />
```

Use one path, one permission decision, `completionType="str_replace_multi"`, and preserve the full ordered array if the IDE modifies the proposed diff.

- [ ] **Step 5: Run GREEN and commit**

Run inventory and permission tests, typecheck, and diff-check. Commit:

```bash
git add src/tools.ts src/constants/tools.ts src/utils/api.ts src/components/permissions packages/builtin-tools/src/tools/REPLTool
git commit -m "feat: register native multi edit permissions"
```

### Task 5: Compact old successful MultiEdit payloads without changing evidence

**Files:**
- Modify: `src/services/compact/microCompact.ts`
- Modify: `src/services/compact/apiMicrocompact.ts`
- Modify: `src/services/compact/__tests__/durableToolInputProjection.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`

- [ ] **Step 1: Write failing projection tests**

Create an older successful `MultiEdit` followed by a latest successful mutation. Expect every older edit body to become the existing cleared markers while preserving path, array order, length, and `replace_all`. Assert the original message object remains unchanged and failed/latest calls remain intact.

- [ ] **Step 2: Run RED**

Run the durable projection test and expect the older `MultiEdit` to remain unprojected.

- [ ] **Step 3: Add passive classification**

Include `MULTI_EDIT_TOOL_NAME` in compactable file-mutation sets and API tool-use clearing policy. Project array entries without writing the projection to raw JSONL.

- [ ] **Step 4: Prove BGS does not author the batch**

Feed the native-document observer a normal `MultiEdit` event and assert it forwards/records ordinary file activity unchanged. Assert the worker prompt contains neither `MultiEdit`, replacement arrays, chunk counts, nor checkpoint instructions.

- [ ] **Step 5: Run GREEN and commit**

Run the projection and native-document tests, typecheck, and diff-check. Commit:

```bash
git add src/services/compact packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
git commit -m "fix: compact native multi edit history"
```

### Task 6: Verify native regressions and scope

**Files:** No product changes unless a real regression exposes a missing test. Never weaken an existing expectation.

- [ ] **Step 1: Run focused tests**

```bash
bun test packages/builtin-tools/src/tools/FileEditTool/__tests__/utils.test.ts packages/builtin-tools/src/tools/MultiEditTool/__tests__/MultiEditTool.test.ts src/__tests__/tools.test.ts src/constants/__tests__/tools.test.ts src/services/compact/__tests__/durableToolInputProjection.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
```

- [ ] **Step 2: Run broad regressions**

```bash
bun test packages/builtin-tools/src/tools/FileWriteTool packages/builtin-tools/src/tools/FileEditTool src/components/permissions src/services/compact
bun run typecheck
git diff --check
```

- [ ] **Step 3: Audit BGS scope**

Run `git diff fa6fdcb2..HEAD -- packages/agent-workflow-server/src/beegame`. The only allowed BGS change is an observation/boundary test. Any production document batching, replacement construction, retry, watchdog, or checkpoint code fails the scope audit and must be removed.

- [ ] **Step 4: Commit test-only corrections if needed**

If a genuine missing assertion was added, commit it as `test: verify native multi edit integration`. Do not create an empty commit.

### Task 7: Controlled Chrome GDD gate

**Files:** Do not modify product code or the test project during acceptance. Preserve generated documents and raw logs.

- [ ] **Step 1: Start the five fixed-port services**

Use the existing user-configured test environment. Do not edit `.env.direct-claude-test` or model settings.

- [ ] **Step 2: Create a fresh ordinary project in Chrome Web React**

Use controlled Chrome only. Enter a normal game idea through the visible UI. Do not reuse, edit, or hardcode an earlier acceptance example.

- [ ] **Step 3: Stop immediately after GDD completion**

Do not include review, remediation, resources, or the second document in initial-authoring evidence.

- [ ] **Step 4: Measure and inspect**

From `agent.raw.jsonl`, report fresh input, cache read, cache creation, output, raw total, native turns, `Write/Edit/MultiEdit/Read` counts, failed calls, permission prompts, elapsed time, and longest quiet interval. Run the canonical GDD validator and read the actual document for completeness, production usability, readability, redundancy, and placeholders.

- [ ] **Step 5: Enforce the gate**

The GDD must be complete, validator-clean, human/Agent usable, and at most 280,000 raw processed tokens. On failure, stop and diagnose raw evidence; do not launch eight documents or alter the test idea. On success, commit only a passive evidence/ledger update as `test: accept native multi edit GDD authoring`.

### Task 8: Eight-document Chrome acceptance

**Files:** Preserve generated project documents and raw logs. Modify only the evidence ledger if the run passes.

- [ ] **Step 1: Continue the same ordinary Chrome workflow**

Generate all eight assigned documents. BGS selects workflow nodes only; each native Agent chooses its own file operations.

- [ ] **Step 2: Audit every real document**

For each document record validator result, completeness, discipline coverage, production usability, human/Agent readability, redundancy, structure, bytes, elapsed time, native turns, tool calls, and raw processed tokens.

- [ ] **Step 3: Enforce aggregate gates**

Require 8/8 documents, 8/8 validators, zero skeletons/placeholders, no more than 2.4 million aggregate initial-authoring raw tokens, and usability by both human teams and implementation Agents.

- [ ] **Step 4: Record exact evidence and commit**

Record log paths and exact per-document/aggregate results. Do not count review/remediation usage as initial authoring and do not hide failures. Commit as `test: accept eight native-authored game documents` only if every gate passes.
