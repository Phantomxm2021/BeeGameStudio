# BeeGame Intake Wizard Design

## Goal

Replace the current "idea -> immediately enter dashboard" behavior with a gated intake flow:

1. User enters an idea on the landing page.
2. BeeGame generates 2-4 selectable game direction options.
3. User selects one option.
4. User configures key production details in a wizard.
5. User confirms the final brief.
6. Only then BeeGame creates the build session, opens the dashboard, and starts GDD, technical design, art direction, asset slots, levels, implementation, build, test, and preview work.

The dashboard becomes the execution workspace, not the idea-intake surface.

## Non-Goals

- Do not build a full visual workflow editor in this change.
- Do not redesign the existing Demiurge/Tailwind dashboard layout.
- Do not start writing files or running implementation commands during idea intake.
- Do not place generated games inside dashboard source folders such as `apps/frontend`, `apps/dashboard`, `packages`, or `src`.

## User Flow

### 1. Landing Idea Submit

The user submits a free-form game idea. The app stays on the landing page and shows a preparing state.

The frontend calls a new intake method instead of `bootstrapProjectFromIdea`.

### 2. Option Generation

BeeGame returns 2-4 option cards. Each card contains:

- `id`
- `title`
- `pitch`
- `gameplay`
- `recommendedPlatform`
- `recommendedDimension`
- `recommendedGenre`
- `recommendedStyle`
- `recommendedInputs`
- `scope`

Cards describe product/game directions only. They must not mention repository implementation paths.

### 3. Detail Wizard

After selecting a card, the user configures:

- Platform: Web, Unity, Godot, Native, XR, or Other.
- Visual style: Pixel, Cartoon, Hand-drawn, Low-poly, Realistic, Cyberpunk, Minimal, or Other.
- Dimension: 2D, 3D, Mixed.
- Game type: Arcade, Puzzle, Action, Roguelike, Strategy, Simulation, Party, Casual, or Other.
- Inputs: Keyboard/mouse, Gamepad, Touch, Voice, Hand tracking XR, Body tracking, or Other.
- Scope: Prototype, Playable demo, Vertical slice, Small complete game.
- Optional notes.

The selected option pre-fills recommended values, but the user can change them.

### 4. Final Brief Confirmation

Before entering the dashboard, the UI shows a concise final brief:

- Idea
- Selected direction
- Platform
- Style
- Dimension
- Genre
- Inputs
- Scope
- Notes

The user clicks "Start Build" to create the BeeGame session.

### 5. Dashboard Execution

Only after confirmation does the frontend call the existing session creation path.

The prompt sent to BeeGame must include the final brief and explicit workspace rules:

- Create game files only inside the active BeeGame workspace.
- Prefer a new project directory such as `./snake-game` or `./games/snake`.
- Do not create, edit, or suggest using dashboard implementation paths such as `apps/frontend`, `apps/dashboard`, `packages`, or `src`.
- Start by producing GDD, technical architecture, art direction, asset slots, level plan, then implementation.

## Architecture

### Frontend State

Add an intake state machine around the landing page:

- `idle`
- `generating_options`
- `options_ready`
- `configuring_details`
- `confirming_brief`
- `starting_build`
- `failed`

This state is local to the landing/intake UI. It should not be represented as a dashboard run.

### Services

Add BeeGame adapter methods:

- `generateIntakeOptions({ idea })`
- `bootstrapProjectFromBrief({ idea, option, settings })`

`bootstrapProjectFromBrief` can reuse the existing `startBeeGameSession` and `sendBeeGameInput` internals, but it must build a final execution prompt instead of the current idea-intake prompt.

### Data Model

Use explicit frontend types:

- `BeeGameIntakeOption`
- `BeeGameIntakeSettings`
- `BeeGameBuildBrief`

These should live in the frontend BeeGame adapter boundary or nearby type file until a backend API becomes necessary.

## Error Handling

- If option generation fails, keep the user on the landing page and show a retry action.
- If option generation returns malformed data, show a safe local fallback of 3 generic options:
  - Classic focused version
  - Enhanced progression version
  - Experimental input/platform version
- If build start fails, keep the final brief visible so the user can retry without losing choices.

## Testing

Add focused frontend tests:

- Submitting an idea does not navigate to dashboard before options are ready.
- Option cards render after intake generation.
- Selecting an option opens the detail wizard.
- Confirming the brief calls build/bootstrap and then enters dashboard.
- Final build prompt rejects dashboard source paths and asks for a new workspace-local game directory.

Add adapter tests:

- `generateIntakeOptions` parses valid JSON/structured responses.
- malformed intake output falls back safely.
- `bootstrapProjectFromBrief` sends the final brief, not the raw idea-intake prompt.

## Implementation Order

1. Add intake types and adapter methods.
2. Refactor landing submit to call intake first.
3. Add option cards.
4. Add detail wizard.
5. Add final brief confirmation.
6. Change dashboard entry to happen only after confirmed build start.
7. Add prompt guardrails for workspace-local project paths.
8. Verify tests and TypeScript.
