# Workflow Stage Card Deck Design

## Goal

Replace the single workflow progress card with a deck of independent stage cards. The deck contains every reached delivery stage from the first stage through the current stage and never renders unreached future stages. Users can browse the deck by dragging, clicking arrow controls, or using the keyboard.

Each completed stage must preserve the full display state it had when the workflow advanced: tasks, stage status, duration, execution detail, message, and relevant failure information. The current stage remains live.

## Existing Context

The frontend currently renders one `WorkflowCardPayload` through `WorkflowCard.tsx`. The payload describes only the live workflow state. The server already owns the ordered 11-stage delivery progress projection through `DELIVERY_PROGRESS_STAGES` and emits `phaseIndex` and `phaseCount`, but it does not expose durable per-stage display snapshots.

Historical cards therefore cannot be reconstructed reliably in the browser. Frontend-only caching would also lose history after refresh, reconnect, or workflow recovery. The server must own the stage snapshot history.

## Data Ownership and Contract

The durable workflow state stores an ordered collection of display-stage snapshots. The workflow display payload exposes that collection as `stageSnapshots`.

Each snapshot has a stable stage identity and the data needed to render one stage card:

- `stageId`: the server-owned progress-stage identifier.
- `phaseIndex`: the one-based position in the server-owned delivery stage order.
- Stage presentation fields already used by the card, including `currentPhase`, `documentStep`, `substage`, `convergencePass`, `reviewMode`, and `reviewTarget`.
- Stage activity fields, including `worker`, `thinking`, `executionStatus`, and `currentItemId`.
- The task list and task totals.
- Stage status, timestamps, accumulated elapsed time, and relevant block details.

Run-scoped data remains on the top-level workflow payload. This includes `runId`, workflow recovery state, usage totals, and the actionable `nextAction`. Historical stage snapshots never own executable workflow actions.

The server emits only reached snapshots, ordered from the first stage through the current stage. It does not emit placeholder entries for future stages. The frontend does not infer missing history from titles, labels, keywords, or regular expressions.

### Snapshot lifecycle

1. When a workflow first reaches a display stage, the server creates its snapshot as the current mutable snapshot.
2. Updates within that display stage update the same snapshot. Substages, convergence passes, repairs, retries, pauses, and resumptions do not create duplicate cards.
3. When the server confirms movement to the next display stage, it atomically freezes the previous snapshot and appends the new current snapshot.
4. Completed snapshots are immutable during normal forward execution.
5. Rehydrating a workflow after refresh, reconnect, or process recovery returns the same ordered snapshots.

Snapshot identity is based on the server-owned `stageId` and `phaseIndex`, not localized presentation text. Replayed or duplicate events must be idempotent.

## Frontend Architecture

The current component is divided into two responsibilities:

### `WorkflowCardDeck`

The deck owns:

- The selected snapshot index.
- Pointer drag state and snap animation.
- Previous and next arrow controls.
- Keyboard navigation.
- The horizontal stepped stack layout.
- Auto-follow behavior when a new current stage arrives.
- Selection reconciliation when payloads refresh or recover.

### `WorkflowStageCard`

The stage card renders one snapshot and retains the existing card presentation: status icon, title, message Markdown, execution detail, tasks, elapsed time, failure detail, and status styling.

Only the newest stage card may render the top-level workflow recovery or retry action. Historical cards are read-only even if their frozen data records a past failure.

For backward compatibility, a payload without `stageSnapshots` is adapted into a single current stage card using the existing top-level fields. The fallback does not invent historical cards.

## Layout and Visual Behavior

The selected card is the front card. Cards behind it use a horizontal stepped stack: each visible back layer is offset slightly right and down. At most two back-card edges are visually exposed so the deck has a stable footprint even when all 11 stages have been reached.

The card keeps the existing dark translucent surface, rounded border, typography, status colors, scroll regions, and content hierarchy. The stack adds depth without changing the established visual language.

The header counter describes the browseable range, not the full unreached workflow plan. It displays:

`selected stage position / reached stage count`

For example, if the workflow has reached stage 6 and the user is viewing stage 3, the counter displays `3 / 6`.

## Navigation and Gesture Behavior

- The left arrow selects the preceding, older snapshot.
- The right arrow selects the following, newer snapshot.
- Dragging the selected card to the right navigates to the older snapshot.
- Dragging it to the left navigates to the newer snapshot.
- A switch occurs after either a deliberate horizontal distance threshold or a horizontal velocity threshold. Otherwise, the card returns to its selected position.
- Navigation stops at both ends and provides restrained resistance rather than wrapping.
- Left and right arrow keys provide the same navigation when the deck has focus.
- Controls expose accessible labels that identify the destination and disabled boundary state.

Pointer handling must distinguish horizontal navigation intent from vertical content scrolling. Task-list scrolling, Markdown links, text selection, failure-copy controls, and workflow action buttons remain usable and must not accidentally change cards. Pointer capture begins only after horizontal intent is established.

With `prefers-reduced-motion`, spring, rotation, and large transforms are removed. Navigation uses a short reduced transition while preserving the same state changes.

## Live Update and Auto-Follow Rules

The deck tracks whether the selected snapshot was the newest snapshot before an update:

- If the user was viewing the newest card and a stage is appended, selection follows the new current card.
- If the user was viewing a historical card, selection remains on that stable `stageId`; the right-side navigation range expands without interrupting the user.
- Live updates within the current stage do not change selection.
- Refresh and recovery reconcile selection by stable stage identity when possible, then clamp safely to the available range.

## Failure and Recovery Behavior

- A blocked, paused, failed, or recoverable workflow displays that state on the newest card.
- Resuming or retrying continues to update the existing current snapshot until the workflow truly reaches another display stage.
- Frozen historical cards do not inherit later failures or recovery messages.
- Malformed, duplicated, or out-of-order snapshots are rejected or normalized at the server projection boundary using semantic stage identity and server-owned ordering.
- If the frontend receives no usable snapshot collection, it renders the existing single-card fallback.

## Testing Strategy

### Server tests

- The first reached stage produces exactly one current snapshot.
- Updates within the stage update that snapshot without appending another.
- A stage transition freezes the old snapshot and atomically appends the new current snapshot.
- The collection contains only the first stage through the current stage.
- Frozen tasks, messages, execution details, durations, and statuses do not change after later updates.
- Retry, pause, failure, resume, and recovery preserve snapshot identity and history.
- Durable rehydration preserves snapshot content and ordering.
- Duplicate and replayed transition events are idempotent.

### Frontend contract and rendering tests

- The display mapper accepts the new snapshot collection and safely maps its nested tasks and state.
- The deck renders reached snapshots only and uses the selected-position/reached-count counter.
- Historical cards render their frozen full content.
- Only the newest card exposes a workflow action.
- A payload without snapshots renders the current single-card fallback.

### Interaction tests

- Arrow controls and keyboard navigation move one card at a time and stop at boundaries.
- Pointer distance and velocity thresholds switch cards; sub-threshold drags snap back.
- Vertical scrolling, links, text selection, copy controls, and action buttons do not trigger navigation.
- A newly appended stage auto-follows only when the user was already on the newest card.
- Historical selection remains anchored by stable stage identity across live payload updates.
- Reduced-motion and narrow-layout behavior remain functional.

## Scope Boundaries

This change does not alter the workflow's delivery phase order, agent responsibilities, transition decisions, retry policy, or platform-specific implementation behavior. It changes durable display history and the workflow card presentation only. It introduces no keyword-based stage inference and no binding to a particular game or runtime platform.
