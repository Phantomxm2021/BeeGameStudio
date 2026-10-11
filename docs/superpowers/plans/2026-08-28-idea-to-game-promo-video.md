# Idea to Game Promo Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic Remotion MVP that uses BeeGame Studio's real frontend visual language to show an Idea becoming a game through smooth connected transitions.

**Architecture:** Add an `apps/promo-video` workspace with a small Remotion entrypoint, fixed demo data, four focused scenes, and Remotion-only transition overlays. Reuse frontend assets, tokens, icons, and presentational patterns without booting the authenticated application or making network requests.

**Tech Stack:** Remotion 4, React 19, TypeScript, Bun, existing Tailwind/CSS visual language, existing frontend media assets.

**Spec:** `docs/superpowers/specs/2026-08-28-idea-to-game-promo-video-design.md`

## Global Constraints

- First deliverable is a 16:9 horizontal MVP and a 15-second transition proof.
- Demo rendering must be deterministic and must not depend on login, Supabase, API, Store, or network state.
- Reuse current Landing, Dashboard, Workflow, Resource Library, and Live Preview visual language.
- Use Remotion `Sequence`, `interpolate`, and `spring` for timing and transitions.
- Do not refactor unrelated frontend business components.

---

### Task 1: Create the Remotion workspace and deterministic composition shell

**Files:**
- Create: `apps/promo-video/package.json`
- Create: `apps/promo-video/tsconfig.json`
- Create: `apps/promo-video/src/index.ts`
- Create: `apps/promo-video/src/Root.tsx`
- Create: `apps/promo-video/src/compositions/IdeaToGame.tsx`
- Create: `apps/promo-video/src/demo-data/storyboard.ts`
- Modify: `package.json`
- Modify: `bun.lock`

**Interfaces:**
- Produces composition `IdeaToGame` at 1920×1080, 30 fps, 450 frames.
- Exposes `storyboard` as the only scene timing/data source for the MVP.

- [ ] **Step 1: Add the workspace manifest and scripts**

Create a private package with `dev`, `studio`, `render`, and `typecheck` scripts. Use the existing root Remotion dependency and add only the Remotion CLI package if the commands require it.

- [ ] **Step 2: Add the root workspace entry**

Add `apps/promo-video` to the existing workspace glob only if the current `apps/*` glob does not already include it; keep the root dependency list otherwise unchanged.

- [ ] **Step 3: Define fixed storyboard data**

Export typed data for the Idea sentence, four Agent labels, three workflow states, and three resource cards. Use strings that support the existing Chinese-first product UI.

- [ ] **Step 4: Register the composition**

Create a Remotion `Root` with one `Composition` named `IdeaToGame`, and make `IdeaToGame` render a neutral dark canvas when no scene is active.

- [ ] **Step 5: Run the typecheck**

Run `bun run --cwd apps/promo-video typecheck`.

Expected: the new workspace typechecks without importing the authenticated frontend app.

### Task 2: Implement the four product-facing scenes and connected transitions

**Files:**
- Create: `apps/promo-video/src/scenes/IdeaInputScene.tsx`
- Create: `apps/promo-video/src/scenes/WorkflowScene.tsx`
- Create: `apps/promo-video/src/scenes/ResourceScene.tsx`
- Create: `apps/promo-video/src/scenes/BuildResultScene.tsx`
- Create: `apps/promo-video/src/overlays/ConnectionLine.tsx`
- Create: `apps/promo-video/src/overlays/Spotlight.tsx`
- Create: `apps/promo-video/src/overlays/Caption.tsx`
- Create: `apps/promo-video/src/components/MockWindow.tsx`
- Create: `apps/promo-video/src/components/IdeaPrompt.tsx`
- Create: `apps/promo-video/src/components/WorkflowCard.tsx`
- Create: `apps/promo-video/src/components/ResourcePack.tsx`
- Modify: `apps/promo-video/src/compositions/IdeaToGame.tsx`

**Interfaces:**
- Each scene accepts `frame: number` and the relevant typed demo data.
- `ConnectionLine` accepts `from`, `to`, `progress`, and `color` and draws a deterministic SVG line.
- `Spotlight` accepts `x`, `y`, `width`, `height`, and `opacity`.

- [ ] **Step 1: Add the product-style window and typography primitives**

Match the frontend's dark zinc glass panels, rounded corners, subtle borders, and muted text. Keep these primitives video-specific so frontend business code is untouched.

- [ ] **Step 2: Build the Idea scene**

Show the Idea Prompt in the Landing style. Animate the cursor/text reveal, then lift the prompt card toward the next scene as a shared visual object.

- [ ] **Step 3: Build the Workflow scene**

Render Dashboard-style Agent cards and workflow stages. Activate cards in sequence using `spring`; connect them with `ConnectionLine` and hand the final completed node into the Resource scene.

- [ ] **Step 4: Build the Resource scene**

Render Resource Library-style search/filter state, three resource cards, and one assembled Pack. Animate cards from candidates into the Pack and use `Spotlight` to explain semantic matching.

- [ ] **Step 5: Build the result scene**

Render a Live Preview-style frame and transition the Pack cover into the game preview using scale, crop, and opacity interpolation. Use an existing local video asset only when it renders consistently in Remotion.

- [ ] **Step 6: Compose the 15-second proof**

Use `Sequence` ranges for Idea → Workflow → Resource → Result and overlap scene exits/entries by at least 10 frames so there are no hard cuts between the three key transitions.

### Task 3: Add preview/render verification

**Files:**
- Create: `apps/promo-video/src/compositions/IdeaToGame.test.tsx`
- Create: `apps/promo-video/remotion.config.ts`
- Modify: `apps/promo-video/package.json`

**Interfaces:**
- Provides a `bun run --cwd apps/promo-video render` command for MP4 output.
- Provides a lightweight render smoke test that mounts the composition with fixed input data.

- [ ] **Step 1: Add the Remotion config**

Set the output directory inside `apps/promo-video/out` and keep rendering local-only.

- [ ] **Step 2: Add the smoke test**

Assert that the composition renders at frame 0, at each scene boundary, and at the final frame without throwing.

- [ ] **Step 3: Run the test and typecheck**

Run `bun test apps/promo-video/src/compositions/IdeaToGame.test.tsx` and `bun run --cwd apps/promo-video typecheck`.

Expected: PASS.

- [ ] **Step 4: Render the proof clip**

Run the workspace render command for the 15-second composition and inspect the generated MP4 for visible blank frames, hard cuts, and broken local media.

- [ ] **Step 5: Keep the first reviewable artifact**

Retain the proof clip in the local output directory for review; do not commit generated media unless explicitly requested.

