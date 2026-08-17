# Foundation Review v3 Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the provider-incompatible Foundation Review v2 synthesis contract with one strict clean-slate v3 contract and prove it through automated and Reviewer-only Chrome acceptance.

**Architecture:** The canonical Zod schema remains the single source of truth for persisted review JSON and the Draft 7 `StructuredOutput` schema sent to the native Reviewer. Version 3 deletes all verification-era root fields; prompts and fixtures consume that same five-field contract without adapters, migrations, or fallback parsing.

**Tech Stack:** TypeScript, Zod 4 JSON Schema generation, Bun test, BGS delivery workflow, React Dashboard, Chrome acceptance.

## Global Constraints

- Do not modify the native core or provider protocol.
- Do not add v2 migration, compatibility parsing, fallback fields, or dual-track execution.
- Do not modify document authoring or remediation behavior.
- Do not modify retry, watchdog, model, or cancellation behavior in this change.
- Reviewer-only Chrome acceptance must stop before remediation and preserve all eight source-document hashes.
- Follow strict red-green-refactor: no production change before the relevant failing test is observed.

---

### Task 1: Publish the strict Foundation Review v3 schema

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts`

**Interfaces:**
- Produces: `FOUNDATION_REVIEW_VERSION === 3` and `foundationReviewSchema` with exactly `version`, `scope`, `revision`, `verdict`, and `conflicts`.
- Preserves: `FoundationReview`, `foundationReviewAffectedPaths()`, `acceptFoundationReview()`, and persisted `review.json` behavior.

- [ ] **Step 1: Write the failing schema-boundary test**

Add a test that converts the real schema and asserts literal boundary behavior:

```ts
import { z } from 'zod'
import {
  FOUNDATION_REVIEW_VERSION,
  foundationReviewSchema,
} from './foundation-review'

test('publishes one strict v3 schema without verification-era fields', () => {
  const jsonSchema = z.toJSONSchema(foundationReviewSchema, {
    target: 'draft-7',
  }) as { properties?: Record<string, unknown> }
  expect(FOUNDATION_REVIEW_VERSION).toBe(3)
  expect(Object.keys(jsonSchema.properties ?? {})).toEqual([
    'version',
    'scope',
    'revision',
    'verdict',
    'conflicts',
  ])
  expect(JSON.stringify(jsonSchema)).not.toContain('priorConflictStatus')
  expect(JSON.stringify(jsonSchema)).not.toContain('priorReviewDigest')
  expect(JSON.stringify(jsonSchema)).not.toContain('"not"')
})
```

Change the local `review()` fixture to version `3` and remove
`priorConflictStatus`. Replace the old prior-status test with literal checks
that a valid v3 report parses and version `2` or either legacy field is rejected.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts
```

Expected: FAIL because the production schema still requires version `2` and
emits `priorConflictStatus` with `items: { "not": {} }`.

- [ ] **Step 3: Implement the minimal v3 schema**

In `foundation-review.ts`:

```ts
export const FOUNDATION_REVIEW_VERSION = 3

export const foundationReviewSchema = z
  .object({
    version: z.literal(FOUNDATION_REVIEW_VERSION),
    scope: z.literal('foundation'),
    revision: digestSchema,
    verdict: z.enum(['READY', 'NEEDS_REVISION']),
    conflicts: z.array(conflictSchema).max(64),
  })
  .strict()
```

Remove `priorConflictStatus` from the contract example and instruction. Keep
the existing verdict/conflict, unique-ID, evidence, affected-path, staging,
revision, and atomic-commit validation unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 1 command again. Expected: all tests in the file PASS.

- [ ] **Step 5: Commit the v3 canonical contract**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts
git commit -m "fix: replace foundation review with v3 contract"
```

---

### Task 2: Remove legacy fields from the final Reviewer boundary

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`

**Interfaces:**
- Consumes: the Task 1 `foundationReviewSchema` and `FOUNDATION_REVIEW_VERSION`.
- Produces: a final Reviewer prompt and `workflowJsonSchema` that expose only the five v3 root fields.

- [ ] **Step 1: Write failing prompt and native-boundary tests**

Update the synthesis prompt assertions to require version `3` and reject both
legacy field names:

```ts
expect(finalReviewerPrompt).toContain('version must be the integer 3')
expect(finalReviewerPrompt).not.toContain('priorConflictStatus')
expect(finalReviewerPrompt).not.toContain('priorReviewDigest')
expect(finalReviewerPrompt).toContain('sole canonical version 3 review.json')
```

Extend the existing native document test that captures `workflowJsonSchema`:

```ts
const schemaText = JSON.stringify(startInput?.workflowJsonSchema)
expect(schemaText).not.toContain('priorConflictStatus')
expect(schemaText).not.toContain('priorReviewDigest')
expect(schemaText).not.toContain('"not"')
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
```

Expected: `worker-prompts.test.ts` FAILS because the hard-coded synthesis
instruction still names version 2 and `priorConflictStatus`. The native schema
test may already pass after Task 1; that confirms it is an integration guard,
not a duplicate production patch.

- [ ] **Step 3: Implement the minimal prompt change**

Change the synthesis instruction in `worker-prompts.ts` from:

```text
version, scope, revision, verdict, priorConflictStatus and conflicts
```

to:

```text
version, scope, revision, verdict and conflicts
```

Use `FOUNDATION_REVIEW_VERSION` through the existing canonical contract
instruction; do not add a compatibility branch.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Task 2 command again. Expected: both files PASS.

- [ ] **Step 5: Commit the Reviewer boundary cleanup**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
git commit -m "fix: publish reviewer v3 structured output"
```

---

### Task 3: Update v3 fixtures without adding compatibility

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts`

**Interfaces:**
- Consumes: strict v3 `FoundationReview` fixtures.
- Produces: focused acceptance, recovery, route, and lane-packet coverage with no legacy report shape.

- [ ] **Step 1: Run the affected suites and capture fixture failures**

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts
```

Expected: FAIL only where fixtures still provide version `2`,
`priorConflictStatus`, or `priorReviewDigest`.

- [ ] **Step 2: Update only canonical review fixtures**

For every current Foundation Review fixture, use:

```ts
{
  version: 3,
  scope: 'foundation',
  revision,
  verdict,
  conflicts,
}
```

Delete legacy fields rather than ignoring, stripping, or transforming them.
Do not alter specialist lane packet versioning or unrelated version-2 domain
fixtures.

- [ ] **Step 3: Run affected suites and verify GREEN**

Run the Task 3 command again. Expected: all affected suites PASS.

- [ ] **Step 4: Prove no executable legacy field remains**

```bash
rg -n "priorConflictStatus|priorReviewDigest" packages/agent-workflow-server/src --glob '*.ts'
```

Expected: no production or test matches related to Foundation Review. If a
match belongs to a deliberate negative assertion, keep only that assertion and
verify it cannot enter runtime data.

- [ ] **Step 5: Commit fixture closure**

```bash
git add packages/agent-workflow-server/src
git commit -m "test: close foundation review v3 fixtures"
```

---

### Task 4: Automated regression verification

**Files:**
- Modify only if a test exposes a requirement already defined in the design.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: fresh evidence that Reviewer schema, dispatch, acceptance, recovery, routes, UI projection, and type contracts remain valid.

- [ ] **Step 1: Run the complete focused Reviewer backend suite**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
```

Expected: zero failures.

- [ ] **Step 2: Run Dashboard regression tests**

```bash
bun test apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
```

Expected: zero failures; Reviewer tasks and stopped state remain display-only
projections of backend truth.

- [ ] **Step 3: Run type and diff checks**

```bash
bun run typecheck
git diff --check
```

Expected: both commands exit `0`.

- [ ] **Step 4: Commit any test-only correction required by the approved design**

Do not broaden scope. If no correction was required, do not create an empty
commit.

---

### Task 5: Reviewer-only Chrome acceptance

**Files:**
- Modify: `docs/superpowers/reviews/2026-08-17-remediation-clean-slate-chrome-acceptance.md`

**Interfaces:**
- Consumes: the fixed-port BGS stack, the existing configured model route, and an unchanged copy of the accepted eight-document project.
- Produces: browser-visible and filesystem-verifiable evidence for one full Reviewer run only.

- [ ] **Step 1: Record pre-run authority**

Record the project ID, run ID, document revision, fixed service ports, selected
model binding, and SHA-256 hashes of all eight canonical Markdown files.

- [ ] **Step 2: Start the fixed-port stack and use Chrome**

Start only the required BGS services with the existing test environment. In
the real Web/React UI, open the copied project and start Reviewer. Do not invoke
remediation, document writing, or any later workflow stage.

- [ ] **Step 3: Observe the complete Reviewer lifecycle**

Require all three specialist tasks and final synthesis to reach completed
state. Capture exact task statuses, elapsed time, token usage, final verdict,
and any API error shown by the UI or server logs.

- [ ] **Step 4: Verify durable outputs and no document mutation**

Verify the accepted v3 `review.json`, report digest/revision binding, and UI
projection. Recompute the eight Markdown hashes and require exact equality to
the pre-run hashes. Confirm no remediation dispatch was created.

- [ ] **Step 5: Update and commit the acceptance report**

Document commands, evidence paths, result, and any remaining independently
scoped issue. Commit only the report:

```bash
git add docs/superpowers/reviews/2026-08-17-remediation-clean-slate-chrome-acceptance.md
git commit -m "docs: record reviewer v3 chrome acceptance"
```

