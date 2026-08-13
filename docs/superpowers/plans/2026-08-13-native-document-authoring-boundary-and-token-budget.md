# Native Document Authoring Boundary and Token Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore one native, Agent-controlled authoring path for all eight foundation documents and prove through controlled Chrome that a complete GDD uses no more than 600,000 raw processed tokens and the complete eight-document authoring phase uses no more than 4,000,000.

**Architecture:** Bee Game Studio selects one document, creates a compact authority index once, starts one fresh native session, and observes the resulting file and normal terminal event. The native Agent owns every read/write/edit decision. Bee Game Studio applies only project-path permission policy, validates the completed on-disk Markdown after normal end-turn, records usage without enforcing it at runtime, and schedules existing review/remediation nodes.

**Tech Stack:** TypeScript, Bun test, BeeGameSessionManager, delivery worker port, native file tools, Web React, controlled Chrome, fixed Bee Game Studio service ports.

---

## File Structure

- Delete `packages/agent-workflow-server/src/beegame/foundation-document-draft.ts` and its test: remove service-owned cursor groups, byte limits, and checkpoint prompts.
- Delete `packages/agent-workflow-server/src/beegame/foundation-document-mutation.ts` and its test: remove content-aware authorization of native file operations.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts` and its test: describe the final document responsibility and leave native file strategy to the Agent.
- Modify `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts` and its test: project all declared upstream ranges for one assigned document in one compact index.
- Modify `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts` and adjacent tests: persist the authority index once, submit one compact prompt, and validate the final on-disk document after normal completion.
- Modify `packages/agent-workflow-server/src/beegame/session-manager.ts` and `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`: remove the foundation draft permission branch while retaining project-root permission decisions and passive progress telemetry.
- Create `packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.ts` and its test: calculate authoring-only budget verdicts without terminating work.
- Create two controlled-Chrome evidence reports only after their corresponding real runs.

## Task 1: Lock the native authoring boundary in tests

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`

- [ ] **Step 1: Replace checkpoint expectations with final-result expectations**

Require the assignment and final contract while excluding every execution-control phrase:

```ts
expect(prompt).toContain('Author exactly docs/GDD.md')
expect(prompt).toContain('complete human development discipline')
expect(prompt).toContain('end the turn normally')
expect(prompt).toContain('native file tools')
expect(prompt).not.toContain('checkpoint')
expect(prompt).not.toContain('beegame-draft-cursor')
expect(prompt).not.toContain('targetNativeReplacementBytes')
expect(prompt).not.toContain('maxNativeReplacementBytes')
expect(prompt).not.toContain('first native Write')
expect(prompt).not.toContain('every Edit must')
expect(prompt).not.toContain('CommitCanonicalDocument')
```

- [ ] **Step 2: Require an authority block that navigates but does not command**

```ts
expect(block).toContain('.beegame/workflow/document-projections/dispatch-ui-authority.json')
expect(block).toContain('navigation index')
expect(block).toContain('native reads remain your decision')
expect(block).not.toContain('remaining bounded checkpoint sequence')
expect(block).not.toContain('do not perform a separate target read')
expect(block).not.toContain('Follow that sequence')
expect(block).not.toContain('STALE TARGET BODY')
expect(block).not.toContain('Authority content for')
```

- [ ] **Step 3: Add a permission regression for a multi-section native mutation**

Exercise the existing permission path with an initial document-author session, an assigned target inside the project, and a `Write` body containing two section markers:

```ts
expect(decision).toMatchObject({ behavior: 'allow' })
expect(permissionEvent.payload).not.toMatchObject({
  reason: 'foundation_document_draft_checkpoint',
})
```

Keep the outside-project mutation test and assert it remains denied.

- [ ] **Step 4: Run RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts
```

Expected: failures expose the checkpoint prompt and content-aware authorization behavior.

- [ ] **Step 5: Commit the failing tests**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts
git commit -m "test: require native document authoring autonomy"
```

## Task 2: Remove Bee Game Studio file-operation control

**Files:**
- Delete: `packages/agent-workflow-server/src/beegame/foundation-document-draft.ts`
- Delete: `packages/agent-workflow-server/src/beegame/foundation-document-draft.test.ts`
- Delete: `packages/agent-workflow-server/src/beegame/foundation-document-mutation.ts`
- Delete: `packages/agent-workflow-server/src/beegame/foundation-document-mutation.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`

- [ ] **Step 1: Remove the content-aware permission branch**

Delete the import and invocation of `authorizeFoundationDocumentDraftMutation`, delete `authorizeFoundationDraftFileMutation`, and remove the `foundation_document_draft_checkpoint` event path. The request flow must go directly from platform-owned custom mutation checks to existing project permission:

```ts
if (authorizeProjectWorkspaceFileMutation(record, request)) {
  // existing project-scope allow event and decision
}
```

Do not add a replacement content parser, byte counter, tool-count check, or initial-author special case.

- [ ] **Step 2: Delete checkpoint modules and confirm only known delivery references remain**

```bash
rg -n "foundation-document-draft|foundation-document-mutation|beegame-draft-cursor|foundation_document_draft_checkpoint" packages/agent-workflow-server/src/beegame
```

At this step, only delivery-port references scheduled for Task 4 may remain.

- [ ] **Step 3: Run GREEN for permissions**

```bash
bun test packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A packages/agent-workflow-server/src/beegame
git commit -m "fix: remove document file-operation control"
```

## Task 3: Replace checkpoint prose with one compact document assignment

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

- [ ] **Step 1: Replace only the initial-author execution paragraphs**

Keep document ownership, exact contract sections, production materials, non-duplication, and quality requirements. Use this boundary:

```ts
[
  `Author exactly ${path} and no other project file. The assigned Markdown must be complete and production-usable when the turn ends.`,
  'Use Bee Game Studio native file tools normally. You own the read, write, edit, verification, and durable-save strategy; choose the operation count, size, and order yourself.',
  'Save meaningful progress during long authoring work, but do not wait to hold the entire document in one custom payload. End the turn normally after the final on-disk document is complete.',
]
```

Do not mention a preferred number of writes, maximum bytes, chapter grouping, cursor, or per-tool continuation.

- [ ] **Step 2: Remove duplicated mechanical rules**

Keep exactly one occurrence of each category: scope, authority ownership, final structure, production quality, and native autonomy. The complete contract already carries section and artifact identifiers.

- [ ] **Step 3: Run GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git add packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git commit -m "fix: assign complete documents without tool choreography"
```

## Task 4: Persist one document-scoped authority index and validate only the final file

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.segmented-documents.test.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`

- [ ] **Step 1: Test projection of all required authority**

Call `projectFoundationAuthority` without `targetSectionIds`:

```ts
expect(projection.targetSectionIds).toEqual(
  getGameDocumentContract(targetPath).sections.map(section => section.sectionId),
)
expect(projection.sources.map(source => source.path)).toEqual(expectedUpstreamPaths)
expect(serialized).not.toContain('Authority content for')
expect(serialized.length).toBeLessThan(8_192)
```

The 8 KiB assertion constrains BGS metadata only. It is not a native tool restriction.

- [ ] **Step 2: Replace active-section projection with one-time projection**

```ts
async function persistFoundationAuthorityIndex(
  request: WorkerDispatchRequest,
): Promise<string> {
  const projection = projectFoundationAuthority({ targetPath, documents })
  const relativePath = foundationProjectionRelativePath(request.dispatchId!)
  await durableWriteProjection(
    resolve(request.workspacePath, relativePath),
    canonicalFoundationAuthorityProjectionBytes(projection),
  )
  return relativePath
}
```

It runs once before the native turn and includes all contract-declared source ranges without embedding bodies in the prompt.

- [ ] **Step 3: Replace the checkpoint supplement with a compact authority note**

```ts
return [
  `Write the complete assigned document at ${targetPath} and end the turn normally.`,
  upstreamPaths.length
    ? `A compact navigation index is available at ${projectionPath}. It lists approved upstream ranges and digests without copying their bodies; native reads remain your decision.`
    : 'This document has no upstream document dependency.',
  targetExists
    ? `An existing ${targetPath} is present. Inspect and replace or revise it as needed under current authority.`
    : `The target ${targetPath} does not exist and must be created.`,
].join('\n\n')
```

Do not forbid target reads or prescribe when the index is read.

- [ ] **Step 4: Validate after normal end-turn**

Remove draft inspection and cursor recovery. Before creating the deterministic terminal:

```ts
if (isInitialFoundationDocumentAuthor(request)) {
  validateCompleteGameDocumentMarkdown(
    request.contract.foundationDocumentPath as FoundationDocumentPath,
    body,
  )
}
```

On failure, surface the validator error and leave bytes untouched for existing remediation.

- [ ] **Step 5: Replace segmented tests with native-path tests**

Assert one session, one submitted assignment, no checkpoint protocol, normal completion for a valid GDD, and preserved incomplete bytes plus a final-contract error for an invalid GDD.

```ts
expect(createdSessions).toHaveLength(1)
expect(submittedPrompts).toHaveLength(1)
expect(submittedPrompts[0]).not.toContain('checkpoint')
expect(submittedPrompts[0]).not.toContain('beegame-draft-cursor')
expect(result).toMatchObject({
  workerType: 'document-author',
  status: 'completed',
  writtenPaths: ['docs/GDD.md'],
})
```

- [ ] **Step 6: Run focused tests**

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
```

- [ ] **Step 7: Prove checkpoint production code is gone**

```bash
rg -n "foundation-document-draft|foundation-document-mutation|beegame-draft-cursor|bounded checkpoint|targetNativeReplacementBytes|maxNativeReplacementBytes|foundation_document_draft_checkpoint" packages/agent-workflow-server/src/beegame
```

Expected: no matches outside historical documentation.

- [ ] **Step 8: Commit**

```bash
git add -A packages/agent-workflow-server/src/beegame
git commit -m "fix: run one native document authoring assignment"
```

## Task 5: Prove one fresh native session per document

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`
- Modify only if the test fails: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`

- [ ] **Step 1: Add a two-document isolation test**

Register and submit two sequential authoring dispatches:

```ts
expect(new Set(sessionIds).size).toBe(2)
expect(secondPrompt).not.toContain(firstDocumentAssistantMessage)
expect(secondPrompt).not.toContain(firstDocumentToolPayload)
expect(secondPrompt).toContain(secondProjectionPath)
```

The second document may reference the first through its authority index. It must not inherit the first native transcript.

- [ ] **Step 2: Run and change production only if the regression fails**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
```

If it already passes, keep the test and do not refactor. Otherwise ensure `register()` creates a new session for each dispatch.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts
git commit -m "test: isolate document authoring histories"
```

## Task 6: Add non-enforcing authoring budget evidence

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.ts`
- Create: `packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.test.ts`

- [ ] **Step 1: Write failing metric tests**

```ts
const report = summarizeDocumentAuthoringAcceptance({
  documents: [{
    path: 'docs/GDD.md',
    dispatchId: 'gdd',
    usage: {
      input_tokens: 40_000,
      cache_read_tokens: 500_000,
      cache_creation_tokens: 0,
      completion_tokens: 30_000,
      total_tokens: 570_000,
    },
    modelStops: 7,
    toolCalls: { Write: 1, Edit: 5 },
    elapsedMs: 480_000,
    bytes: 60_000,
    lines: 800,
    accepted: true,
  }],
})
expect(report.documents[0]?.withinBudget).toBe(true)
expect(report.total.rawTokens).toBe(570_000)
expect(report.withinAuthoringBudget).toBe(true)
```

Also prove `600_001` fails only the release verdict, unknown paths and duplicate dispatch IDs are rejected, next-document usage is not attributed to GDD, all eight paths are required for the full verdict, and `4_000_001` fails the total gate.

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.test.ts
```

- [ ] **Step 3: Implement a pure reporter**

```ts
export const GDD_AUTHORING_RAW_TOKEN_CEILING = 600_000
export const EIGHT_DOCUMENT_AUTHORING_RAW_TOKEN_CEILING = 4_000_000

export function summarizeDocumentAuthoringAcceptance(
  input: DocumentAuthoringEvidence,
): DocumentAuthoringAcceptanceReport
```

The module must not import the session manager, terminate a worker, reject a tool, alter a prompt, or retry a dispatch.

- [ ] **Step 4: Run GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.test.ts
git add packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.ts packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.test.ts
git commit -m "feat: report document authoring token acceptance"
```

## Task 7: Automated boundary verification

**Files:**
- No production files unless a test exposes a defect.

- [ ] **Step 1: Run focused tests**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/complete-game-document.test.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.test.ts
```

- [ ] **Step 2: Run typecheck**

```bash
bun --cwd packages/agent-workflow-server run typecheck
```

- [ ] **Step 3: Audit forbidden mechanisms**

```bash
rg -n "beegame-draft-cursor|foundation_document_draft_checkpoint|targetNativeReplacementBytes|maxNativeReplacementBytes|CommitCanonicalDocument" packages/agent-workflow-server/src/beegame apps/frontend/src
```

Expected: no initial foundation-author path uses these mechanisms. Do not broad-delete unrelated structured tools used by other business workers.

- [ ] **Step 4: Verify formatting and status**

```bash
git diff --check
git status --short
```

## Task 8: Controlled Chrome GDD acceptance

**Files:**
- Create after the run: `docs/superpowers/reviews/2026-08-13-native-gdd-token-acceptance.md`
- Runtime project and logs: do not commit.

- [ ] **Step 1: Start and verify fixed ports**

Use frontend `62273`, runtime `62274`, billing `62275`, skills `62276`, and resources `62277`. Verify every listener and health endpoint before opening Chrome. Keep the user's provider, model, thinking, and `BEEGAME_CONFIG_DIR` unchanged.

- [ ] **Step 2: Create a fresh project through controlled Chrome**

Use the Web React UI and an ordinary new idea chosen at test time. Do not encode its genre, name, platform, engine, or wording into product code or fixtures.

- [ ] **Step 3: Generate the GDD and pause before the next author writes**

Do not intervene in native tool choice. When GDD acceptance completes, use the product Stop control so the next document contributes no tokens or bytes to this gate.

- [ ] **Step 4: Persist exact evidence**

Record project/run/dispatch/request/session/receipt identities; final digest/bytes/lines; fresh/cache/cache-creation/output/raw usage; model stops; tool calls; SSE gaps; terminal reason; failure waste; prompt and projection sizes; absence of cursor/custom commit; and absence of next-document contamination.

- [ ] **Step 5: Audit the actual GDD**

Evaluate complete contract coverage, discipline ownership, production decisions, acceptance criteria, usability by a human team, usability by an implementation Agent, redundancy, and absence of skeletons/placeholders.

- [ ] **Step 6: Apply the hard release gate**

The GDD passes only if accepted and raw authoring usage is at most `600,000`. If it exceeds the budget, diagnose prompt/projection/session evidence. Do not add BGS tool choreography or modify the native runtime.

- [ ] **Step 7: Write and commit evidence**

```bash
git add docs/superpowers/reviews/2026-08-13-native-gdd-token-acceptance.md
git commit -m "docs: record native GDD token acceptance"
```

## Task 9: Controlled Chrome eight-document acceptance

**Files:**
- Create after the run: `docs/superpowers/reviews/2026-08-13-native-eight-document-token-acceptance.md`
- Runtime project and logs: do not commit.

- [ ] **Step 1: Start from a second fresh Chrome project**

Do not reuse the GDD-only project. Allow all eight initial author nodes to complete, then pause before review, resource research, implementation, or QA usage is attributed to authoring.

- [ ] **Step 2: Verify session isolation**

For every dispatch, record a distinct native session and one initial prompt. Confirm it contains no other document transcript/body and uses only the compact authority index for upstream navigation.

- [ ] **Step 3: Validate and inspect all eight documents**

Require the eight canonical paths exactly once and run the complete Markdown validator for each. Inspect discipline completeness, readability, implementation utility, excessive repetition, untrustworthy metadata, and skeleton content.

- [ ] **Step 4: Calculate authoring-only usage**

Feed exactly the eight initial-author dispatch records into `summarizeDocumentAuthoringAcceptance`. Exclude review, remediation, resource, implementation, and unrelated UI usage.

- [ ] **Step 5: Apply the final gate**

Require all documents accepted, each per-document ceiling satisfied, combined raw authoring tokens at most `4,000,000`, no service checkpoint, no inherited transcript, and both human-team and implementation-Agent usability accepted.

- [ ] **Step 6: Write and commit evidence**

```bash
git add docs/superpowers/reviews/2026-08-13-native-eight-document-token-acceptance.md
git commit -m "docs: record native eight-document acceptance"
```

## Task 10: Final branch verification

**Files:**
- No new production files.

- [ ] **Step 1: Re-run Task 7 from a clean process after stopping acceptance services**

- [ ] **Step 2: Verify no generated project, raw model log, local environment, token, or secret is tracked**

```bash
git status --short
git diff --check
git ls-files | rg "Projects/users|agent\.raw\.jsonl|\.env"
```

- [ ] **Step 3: Compare implementation and both Chrome reports with the approved design**

Confirm there is one initial authoring path and no cursor compatibility path. Do not claim completion unless both Chrome budgets and quality gates pass.

- [ ] **Step 4: Record commit range and clean status**

```bash
git log --oneline 574c5bb3..HEAD
git status --short --branch
```
