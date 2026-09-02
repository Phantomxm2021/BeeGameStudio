# Game IR Slice Packet-Once Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse one live worker session across all slices of one projection operation while sending the immutable packet only on the first turn.

**Architecture:** The dispatcher keeps the projection operation transport alive after an admitted non-final slice and hands its session identity to the next dispatch. The session port tracks the packet-bearing operation binding, rebinding the live workflow session to the new dispatch and rendering later prompts with only packet digest, current slice, and admitted progress. A new/recovered session has no binding and receives the packet normally.

**Tech Stack:** TypeScript, Bun tests, BeeGame delivery dispatcher/session manager.

**Spec:** `docs/superpowers/specs/2026-09-02-game-ir-semantic-slice-stream-design.md`

## Global Constraints

- Keep strict per-slice StructuredOutput schema and service identity validation.
- Keep validation behavior unchanged.
- No recovery implementation, compatibility fallback, fixed caps, or producer/assembler changes.

### Task 1: Prove packet-once lifecycle

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch-recovery.test.ts`

- [ ] Add tests showing two slices use one session, first prompt includes packet, second prompt includes only digest/slice/progress, and a fresh session resends packet.
- [ ] Run focused tests and confirm RED.

### Task 2: Implement transport rebinding

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts` only if the audited API is insufficient.

- [ ] Keep the session mapping alive only for a live projection operation.
- [ ] Rebind it to the next dispatch and render packet-free context after the first turn.
- [ ] Close the preserved session at operation completion or abandonment.

### Task 3: Verify and report

**Files:**
- Create: `.superpowers/sdd/2026-09-02-game-ir-semantic-slice-stream/task-3B2-report.md`

- [ ] Run focused worker/session/dispatch tests, Task1–3A regressions, typecheck, and diff-check.
- [ ] Record interface/rulings, packet counts, fresh-session behavior, and skipped recovery scope.
