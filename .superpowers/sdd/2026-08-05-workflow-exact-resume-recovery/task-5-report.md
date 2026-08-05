# Task 5 Report: Workflow recovery card action

## Status

Implemented the recovery presentation through the existing Workflow card and existing `resume` action only.

## RED / GREEN

- RED: `WorkflowCard` failed because it rendered the normal blocked view, exposed injected diagnostic text, and did not show the recovery heading or proven-unit summary.
- GREEN: `/Users/nswell/.bun/bin/bun run --cwd apps/frontend test:run src/components/Demiurge/WorkflowCard.test.tsx src/services/beeGameAdapter.test.ts src/viewModels/displayModels.test.ts` passed: 3 files, 110 tests.
- Verification: `bun run --cwd packages/agent-workflow-server typecheck` and `bun run --cwd apps/frontend build` both passed.

## Files

- `packages/agent-workflow-server/src/app.ts`
- `apps/frontend/src/types/message.ts`
- `apps/frontend/src/viewModels/displayModels.ts`
- `apps/frontend/src/viewModels/displayModels.test.ts`
- `apps/frontend/src/components/Demiurge/WorkflowCard.tsx`
- `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`
- `apps/frontend/src/services/beeGameAdapter.test.ts`

## Commit

`feat: expose exact workflow recovery action`

## Self-review

- Reused only `resume` and `retry`; recoverable invalid state selects `resume`.
- GET only reads the snapshot and journal; it does not invoke recovery or dispatch work.
- The displayed summary comes from the latest accepted journal unit whose unit phase matches the event phase.
- Recovery card content suppresses diagnostic JSON and unknown unit IDs while retaining the existing top-right error popover interaction.
- Card width, dark background, timer start/terminal-stop behavior, and token-free presentation are unchanged.

## Concerns

None. The frontend test runner continues to emit its existing Vite `esbuild` deprecation warnings.

## Fix round 1

### Status

Extended recovery display projection to the full current accepted-unit discriminant and added real server/read plus Dashboard-to-HTTP action coverage.

### RED

- `/Users/nswell/.bun/bin/bun run --cwd apps/frontend test:run src/components/Demiurge/WorkflowCard.test.tsx src/components/Demiurge/DashboardView.test.tsx` failed with 10 missing canonical recovery titles.
- `/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts` failed because the real obsolete-snapshot GET projection lacked `lastProvenUnitKind` and `lastProvenItemId`.
- `/Users/nswell/.bun/bin/bun run --cwd apps/frontend test:run src/viewModels/displayModels.test.ts` failed because the display model did not carry the structured recovery kind/item fields.

### GREEN

- Server parses the last accepted journal event with `workflowUnitAcceptedEventSchema` before projecting its phase, ID, kind and document/review item ID.
- The card maps only the discriminated current kind to fixed safe titles; document/review item IDs use the existing known-title map, and dynamic implementation task IDs remain hidden.
- The Dashboard test renders the card from the real display model and routes Continue through the real adapter to one intercepted resume POST.

### Files

- `packages/agent-workflow-server/src/app.ts`
- `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`
- `apps/frontend/src/types/message.ts`
- `apps/frontend/src/viewModels/displayModels.ts`
- `apps/frontend/src/viewModels/displayModels.test.ts`
- `apps/frontend/src/components/Demiurge/WorkflowCard.tsx`
- `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`
- `apps/frontend/src/components/Demiurge/DashboardView.test.tsx`

### Concerns

The existing Vitest/Vite `esbuild` deprecation warnings remain; the server recovery test intentionally logs its obsolete snapshot diagnostic.
