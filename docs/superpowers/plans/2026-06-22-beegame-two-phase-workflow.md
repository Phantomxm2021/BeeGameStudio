# BeeGame Two-Phase Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix BeeGame dashboard workflow so design/spec generation, user-visible workflow state, real permission requests, and implementation are separate, predictable phases.

**Architecture:** Replace the current coarse tool gate with an explicit two-phase session: planning generates a Playable Spec as structured assistant output and server-managed artifacts; building starts only after the spec is ready and then uses normal BeeGame tool permission flow. Workflow blocks are emitted as workflow events, not permission events, so the UI does not confuse automatic guard decisions with user Approval/Deny.

**Tech Stack:** Bun, Hono server, BeeGame QueryEngine adapter, Vite/React/Tailwind frontend, Vitest/Bun tests.

---

## Problem Summary

Current transcript `beegame_06cd0b00767349088c231ab395ceb125.jsonl` shows:

- `Bash mkdir` and `Write SPEC.md` were not sent to the user for approval.
- The server auto-denied them through the Playable Spec gate and emitted `permission.resolved`.
- The frontend therefore had no `permission.requested` event to display.
- The gate is too coarse: it blocks implementation tools before `PLAYABLE_SPEC_READY: yes`, but also blocks writing design artifacts.
- The turn ended after producing the marker in chat, so no build phase started.

The fix is not to show a fake approval. The fix is to model this as workflow state.

---

## File Structure

- Modify `packages/agent-workflow-server/src/beegame/session-manager.ts`
  - Add explicit workflow phase state.
  - Emit workflow events for planning/build transitions and guard blocks.
  - Stop representing workflow guard blocks as user permission resolutions.
  - Add server-triggered second turn entry point after planning is complete.

- Modify `packages/agent-workflow-server/src/app.ts`
  - Add API endpoint to continue/start build phase when needed.
  - Keep existing `/api/beegame-sessions/*` API stable.

- Modify `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`
  - Cover planning phase, build phase, workflow guard event semantics, normal permission request semantics.

- Modify `apps/frontend/src/services/beeGameAdapter.ts`
  - Map workflow events to system/status messages.
  - Keep permission events only for actual user approval.
  - Trigger or expose build continuation after planning readiness.

- Modify `apps/frontend/src/services/beeGameAdapter.test.ts`
  - Cover chat/status rendering for workflow events.
  - Cover no fake approval card for workflow guards.
  - Cover normal permission card after build starts.

- Optional modify `apps/frontend/src/components/Demiurge/Sidebar/ChatComponents.tsx`
  - Only if existing message types cannot render workflow status cleanly.

---

## Task 1: Introduce Workflow Event Semantics

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Test: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [ ] **Step 1: Write failing server test for workflow guard event**

Add a test that starts a fake runner mode which attempts `Bash` before planning is ready. Expected behavior:

```ts
expect(events).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      type: 'workflow.blocked',
      text: expect.stringContaining('Playable Spec is not ready'),
      payload: expect.objectContaining({
        phase: 'planning',
        blockedToolName: 'Bash',
      }),
    }),
  ]),
)
expect(events.some((event: { type: string }) => event.type === 'permission.requested')).toBe(false)
expect(events.some((event: { type: string }) => event.type === 'permission.resolved')).toBe(false)
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
```

Expected: FAIL because `workflow.blocked` does not exist and current code emits `permission.resolved`.

- [ ] **Step 3: Add workflow event type**

In `BeeGameEventType`, add:

```ts
| 'workflow.phase'
| 'workflow.blocked'
```

Add payload convention:

```ts
type WorkflowPhase = 'planning' | 'building' | 'completed'
```

- [ ] **Step 4: Change planning guard emission**

Replace the gameplay gate auto-deny append with:

```ts
this.append(record, 'workflow.blocked', gameplayGateViolation, {
  type: 'workflow.blocked',
  phase: record.workflowPhase,
  blockedToolName: request.toolName,
  toolUseID: request.toolUseID,
  reason: gameplayGateViolation,
  input: request.input,
})
```

Still return `{ behavior: 'deny', message: gameplayGateViolation }` to the runtime so the tool does not execute, but do not emit `permission.resolved` for this workflow guard.

- [ ] **Step 5: Run test and verify it passes**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
```

Expected: PASS for the new workflow event test.

---

## Task 2: Split Planning And Building Turns

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Test: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [ ] **Step 1: Write failing test for automatic build continuation**

Add fake runner mode:

```ts
planning_then_build
```

The fake runtime should:

1. First submit emits `assistant.message` containing a Playable Spec and exact `PLAYABLE_SPEC_READY: yes`.
2. It must not request `Bash` or `Write` in planning.
3. Server should start a second submit with a build prompt.
4. Second submit requests `Write` or `Bash`, which should become `permission.requested`.

Expected assertions:

```ts
expect(fake.runtimes[0].submitPrompts).toHaveLength(2)
expect(fake.runtimes[0].submitPrompts[0]).toContain('First produce a Playable Spec')
expect(fake.runtimes[0].submitPrompts[1]).toContain('Now implement the approved playable spec')
expect(events).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ type: 'workflow.phase', text: 'planning' }),
    expect.objectContaining({ type: 'workflow.phase', text: 'building' }),
    expect.objectContaining({
      type: 'permission.requested',
      payload: expect.objectContaining({ toolName: 'Write' }),
    }),
  ]),
)
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
```

Expected: FAIL because server currently runs only one turn.

- [ ] **Step 3: Add workflow phase to session record**

Add to `SessionRecord`:

```ts
workflowPhase: 'planning' | 'building' | 'completed'
planningPrompt?: string
buildPrompt?: string
```

Initialize new sessions with:

```ts
workflowPhase: 'planning'
```

- [ ] **Step 4: Add phase transition helper**

Add helper:

```ts
private setWorkflowPhase(record: SessionRecord, phase: WorkflowPhase): void {
  record.workflowPhase = phase
  this.append(record, 'workflow.phase', phase, {
    type: 'workflow.phase',
    phase,
  })
}
```

- [ ] **Step 5: Detect planning readiness**

Use existing exact marker detection:

```ts
hasPlayableSpecReadyMarker(record)
```

When a submit finishes and the marker exists while `workflowPhase === 'planning'`, transition to `building`.

- [ ] **Step 6: Start the second turn**

After planning submit completes, call the same session submit path with:

```ts
[
  'Now implement the approved playable spec inside the active BeeGame workspace.',
  'Create files only under a workspace-local game directory such as ./snake-game.',
  'Write the design artifacts into the project directory before code if they are useful.',
  'Then implement the playable MVP, run build checks, and self-review against the Playability Acceptance Checklist.',
].join('\n')
```

Do not use file-name or keyword matching to decide whether a tool is a doc write. Phase state decides.

- [ ] **Step 7: Run tests**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
```

Expected: PASS.

---

## Task 3: Keep Real User Permissions Real

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Test: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [ ] **Step 1: Write failing test for build-phase permission**

In build phase, `Write` and `Bash` should emit `permission.requested`, not `workflow.blocked`.

Expected:

```ts
expect(events).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      type: 'permission.requested',
      payload: expect.objectContaining({
        toolName: 'Write',
      }),
    }),
  ]),
)
expect(events.some((event: { type: string }) => event.type === 'workflow.blocked')).toBe(false)
```

- [ ] **Step 2: Ensure guard only applies in planning**

Update guard:

```ts
if (record.workflowPhase === 'planning') {
  const gameplayGateViolation = getGameplayGateViolation(record, request)
  ...
}
```

- [ ] **Step 3: Preserve workspace security guard**

Workspace boundary violations must still auto-deny before user approval:

```ts
const workspaceViolation = getWorkspaceViolation(record.session.cwd, request)
```

This remains security behavior, not user permission.

- [ ] **Step 4: Run tests**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
```

Expected: PASS.

---

## Task 4: Frontend Event Mapping

**Files:**
- Modify: `apps/frontend/src/services/beeGameAdapter.ts`
- Test: `apps/frontend/src/services/beeGameAdapter.test.ts`

- [ ] **Step 1: Write failing adapter test**

Add fixture events:

```ts
workflowPhaseEvent(60, 'beegame_flow', 'planning')
workflowBlockedEvent(61, 'beegame_flow', 'Bash', 'Playable Spec is not ready.')
permissionRequestedEvent(62, 'beegame_flow', 'Write')
```

Expected:

```ts
expect(polled.messages).toEqual(expect.arrayContaining([
  expect.objectContaining({
    sender: 'system',
    content: expect.stringContaining('Designing Playable Spec'),
  }),
  expect.objectContaining({
    sender: 'system',
    content: expect.stringContaining('BeeGame paused build'),
  }),
  expect.objectContaining({
    type: 'human_gate',
  }),
]))
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd apps/frontend
/Users/nswell/.bun/bin/bun run test:run src/services/beeGameAdapter.test.ts
```

Expected: FAIL because workflow events are not mapped yet.

- [ ] **Step 3: Map workflow events**

In `eventToWebSocketMessages`, add:

```ts
case 'workflow.phase':
  return [baseMessage('agent_message', {
    ...event,
    text: describeWorkflowPhase(event),
  }, projectId, 'system')]
case 'workflow.blocked':
  return [baseMessage('agent_message', {
    ...event,
    text: describeWorkflowBlocked(event),
  }, projectId, 'system')]
```

Add descriptions:

```ts
function describeWorkflowPhase(event: BeeGameEvent): string {
  const phase = getPayloadString(event, 'phase') || event.text;
  if (phase === 'planning') return 'Designing Playable Spec';
  if (phase === 'building') return 'Building the game';
  if (phase === 'completed') return 'BeeGame workflow completed';
  return event.text;
}

function describeWorkflowBlocked(event: BeeGameEvent): string {
  const toolName = getPayloadString(event, 'blockedToolName') || 'tool';
  const reason = getPayloadString(event, 'reason') || event.text;
  return `BeeGame paused build before ${toolName}: ${reason}`;
}
```

- [ ] **Step 4: Keep permission UI only for permission.requested**

Do not map `workflow.blocked` to `human_gate`.

- [ ] **Step 5: Run frontend adapter test**

Run:

```bash
cd apps/frontend
/Users/nswell/.bun/bin/bun run test:run src/services/beeGameAdapter.test.ts
```

Expected: PASS.

---

## Task 5: Dashboard Status Model

**Files:**
- Modify: `apps/frontend/src/services/beeGameAdapter.ts`
- Test: `apps/frontend/src/services/beeGameAdapter.test.ts`

- [ ] **Step 1: Write failing status test**

Given latest phase event is `workflow.phase: planning`, status should be:

```ts
expect(status.phase).toBe('running')
expect(status.next_action).toBe('Designing Playable Spec')
expect(status.approval_required).toBe(false)
```

Given latest phase event is `workflow.phase: building`, status should be:

```ts
expect(status.phase).toBe('running')
expect(status.next_action).toBe('Building the game')
```

- [ ] **Step 2: Update runtime action description**

In `describeRuntimeAction`, add:

```ts
if (event.type === 'workflow.phase') return describeWorkflowPhase(event)
if (event.type === 'workflow.blocked') return describeWorkflowBlocked(event)
```

- [ ] **Step 3: Run adapter tests**

Run:

```bash
cd apps/frontend
/Users/nswell/.bun/bin/bun run test:run src/services/beeGameAdapter.test.ts
```

Expected: PASS.

---

## Task 6: Transcript Quality And Regression Checks

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`
- Modify: `apps/frontend/src/services/beeGameAdapter.test.ts`

- [ ] **Step 1: Add transcript semantics assertions**

Assert a normal two-phase run has this order:

```ts
[
  'workflow.phase:planning',
  'assistant.message',
  'workflow.phase:building',
  'permission.requested',
]
```

- [ ] **Step 2: Assert no raw stream events in chat**

Existing rule remains:

```ts
expect(polled.messages.some(message => message.type === 'token')).toBe(false)
```

- [ ] **Step 3: Assert package/path branding safety**

Keep existing assertions:

```ts
expect(prompt).not.toContain('@beegame/')
expect(prompt).toContain('@ant/ink')
expect(prompt).not.toContain('apps/frontend')
```

- [ ] **Step 4: Run full relevant verification**

Run:

```bash
/Users/nswell/.bun/bin/bun run typecheck
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts packages/agent-workflow-server/src/__tests__/routes.test.ts
cd apps/frontend && /Users/nswell/.bun/bin/bun run test:run src/services/beeGameAdapter.test.ts
cd apps/frontend && /Users/nswell/.bun/bin/bun run build
```

Expected:

- Server typecheck passes.
- Server route tests pass.
- Frontend adapter tests pass.
- Frontend build passes.

---

## Task 7: Real Session Acceptance Test

**Files:**
- No code change unless test reveals a bug.
- Inspect: `Projects/.beegame-dashboard/transcripts/*.jsonl`

- [ ] **Step 1: Run a real dashboard session**

Input idea:

```text
贪吃蛇
```

Choose a Web / 2D / Arcade / Pixel option.

- [ ] **Step 2: Verify transcript event semantics**

Expected transcript:

```text
workflow.phase planning
assistant.message with Playable Spec
assistant.message with PLAYABLE_SPEC_READY: yes
workflow.phase building
permission.requested for Write/Bash
tool.started/tool.completed after user approval
turn.completed after implementation
```

- [ ] **Step 3: Verify project files**

Expected:

```text
Projects/snake-game/
Projects/snake-game/package.json
Projects/snake-game/src/...
```

No files should be created outside `Projects`.

- [ ] **Step 4: Verify frontend**

Expected:

- Planning shows as workflow status, not approval.
- Build tool permissions show as actual Approval cards.
- Chat appends assistant messages and tool cards in event order.
- Final state returns input to usable state.

---

## Self-Review

- Covers no user request issue: Task 1 and Task 4 separate workflow block from permission approval.
- Covers gate too coarse issue: Task 2 moves planning to assistant/server-managed phase, no file-name guessing.
- Covers implementation not starting: Task 2 starts second build turn after marker.
- Covers frontend status confusion: Task 4 and Task 5.
- Covers transcript/log quality: Task 6 and Task 7.
- Avoids forbidden keyword/path heuristics for deciding doc vs code writes.
- Preserves workspace security auto-deny before permission approval.
