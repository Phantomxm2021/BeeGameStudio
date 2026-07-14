# Game Production Document-First Implementation Plan

**Goal:** Make every confirmed BeeGame build instruct Claude Code to create and
cross-review a complete, platform-neutral production document bundle, persist a
native `writing-plans` implementation plan, then implement and independently
validate against those sources.

**Architecture:** Keep Claude Code as the sole execution state machine. Add a
BeeGame-specific prompt contract, fresh-context native reviewer/validator agents,
and fail-closed invariants at the existing session/tool boundary. Do not add
host-side planning phases, natural-language parsing, or platform adapters.

### Task 1: Define the production planning prompt contract

- Add `packages/agent-workflow-server/src/beegame/production-planning-contract.ts`.
- Export canonical artifact paths and a formatter for the confirmed-build prompt.
- Describe minimum document responsibilities, consistency gate, native
  `writing-plans` invocation, persisted plan requirements and implementation
  granularity.
- Keep the contract free of platform and project-specific vocabulary.

Verification:

- Unit-test the canonical document paths.
- Assert the prompt requires every artifact, native Skill invocation, plan
  persistence, read-back, small verifiable tasks and acceptance repair loop.
- Assert the prompt explicitly preserves Claude Code as the sole state machine.

### Task 2: Compose the contract only for confirmed builds

- Import the formatter in `session-manager.ts`.
- Compose it with confirmed brief, asset integration and delivery contracts.
- Do not apply it to initial idea, ordinary continuation or asset-only turns.
- Remove the vague duplicate document instruction from the shorter confirmed
  brief block.

Verification:

- Update route/session tests to assert confirmed builds receive the planning
  contract.
- Assert idea intake does not receive it and does not create artifacts.

### Task 3: Preserve native execution and acceptance boundaries

- Confirm no new BeeGame events, task phases, repair queues or Web UI controls are
  introduced.
- Keep `docs/delivery-contract.json` as the machine-readable requirements contract.
- Add `beegame-production-reviewer` and keep
  `beegame-acceptance-validator` as read-only native sub-agents.
- Canonicalize managed sub-agent inputs so the implementation agent cannot pass
  self-authored feature or completion claims into independent review.
- Keep asset integration rules conditional on `assets/asset-manifest.json`.

Verification:

- Existing native acceptance-agent regression remains green.
- Existing delivery-contract audit tests remain green.

### Task 4: Block implementation before the production bundle is ready

- Add a platform-neutral readiness audit for canonical documents, delivery
  contract, asset manifest and exactly one persisted implementation plan.
- Apply it only to sessions that have received a structured `confirmed_brief`.
- Allow planning document writes while blocking implementation mutations and Bash
  until readiness passes.
- Persist this requirement across ordinary continuation turns and backend resume
  using structured event metadata, never transcript keywords.

Verification:

- Unit-test missing, malformed and complete bundles.
- Assert non-production sessions are unaffected.
- Assert confirmed-build continuation and backend resume retain the contract.

### Task 5: Fail closed on delivery completion

- Register a native in-memory Stop function hook for confirmed production turns.
- Parse only results tied to an actual `beegame-acceptance-validator` Agent tool
  invocation.
- Require strict passed JSON, complete MVP requirement/evidence coverage, runtime
  evidence from covering declared player paths, verified required capabilities and
  a non-empty derived validation report.
- Treat absent, empty, truncated and unrelated JSON as incomplete delivery.

Verification:

- Unit-test valid and invalid validator message histories.
- Assert ordinary sessions are not subject to the production completion gate.

### Task 6: Make review and validation bounded and usable

- Give the acceptance validator enough turns to read contracts, invoke applicable
  skills/tools, run native checks and emit terminal JSON.
- Instruct it to audit contracts first, avoid repeated discovery, reject caller
  claims and report blocked when runtime proof is unavailable.
- Keep all tools and evidence platform-neutral.

Verification:

- Assert managed definitions remain native Claude Code agents and preserve
  unrelated project agents.
- Assert mutation tools remain unavailable to reviewer and validator agents.

### Task 7: Run focused and package verification

- Run the new unit test.
- Run the confirmed-build route tests.
- Run delivery-contract and acceptance-agent tests.
- Run `@bee-game-studio/agent-workflow-server` typecheck.

Completion condition:

- All focused tests and typecheck pass without changing Claude Code, frontend
  workflow control, shared agent runtime, or platform-specific logic. Any unrelated
  full-suite fixture failure is reported separately rather than hidden or repaired
  by weakening the production contract.
