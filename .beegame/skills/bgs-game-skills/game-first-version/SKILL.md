---
name: game-first-version
description: Build the first complete version of a new BGS game from its confirmed brief, or resume that unfinished production. Do not use for ordinary follow-up edits to an existing game. 中文：新游戏首版制作、首版中断续作；后续局部修改无需重走。
---

# Game First Version

Carry the confirmed first-version scope from design through a runnable game and an evidence-based handoff. Codex plans and performs the work; BGS supplies the assignment, tools and runtime. These steps do not require separate model turns or user approval after every document.

## Start or resume

Read the confirmed brief, applicable project guide and existing project work. Preserve the chosen engine, resource policy and current user authorization. Before production, record the current work, needed source sections and remaining dependencies in the existing task file, or `docs/TASKS.md`. Update it at meaningful transitions; implementation planning later refines the same record.

On continuation, inspect that record and actual documents, resources, code and evidence. Resume unfinished work without recreating completed parts. A later user request for a local change takes precedence: handle its affected work without restarting this workflow.

Choose the current document or production task before selecting professional Skills from their catalog descriptions. Read a Skill when its decisions are needed, reusing guidance still in context. The names below are routing choices, not an instruction to preload every Skill.

## 1. Establish the game design

Use `game-creative-director-expert` and `game-systems-designer-expert` to develop `docs/GDD.md` from the brief: the intended player experience, core loop, actions, rules and states. Existing agreed decisions remain authoritative. Resolve consequential engine/platform feasibility questions before making dependent design commitments, using `gameplay-programmer` when needed; technical constraints can be recorded before the full technical plan.

## 2. Develop the dependent designs

Work from the actual upstream sources, not only the preceding response's summary. For each document, establish the needed inputs and the decisions it must provide to its consumers, then use the corresponding professional method:

| Document | Inputs needed for its decisions | Skill |
|---|---|---|
| `LEVEL_SCENE_DESIGN.md` | GDD actions, loop, spatial interactions and challenge | `game-level-designer-expert` |
| `BALANCE_DESIGN.md` | GDD rules and relevant encounter/level conditions | `game-balance-designer-expert` |
| `ART_DIRECTION.md` | GDD experience, subjects and scene readability needs | `game-art-director-expert` |
| `UI_UX_SPEC.md` | Player actions/states, scene information needs and art direction | `game-ui-ux-designer` |
| `AUDIO_DESIGN.md` | Gameplay events, scene rhythm and interface feedback | `game-audio-designer` |
| `ASSET_PLAN.md` | Required actions/states, scene needs and selected visual/audio designs | `game-content-pipeline-engineer` |

Keep these records under `docs/`. Order related work by its actual dependencies; this table is not a strict document-by-document chain. Use additional professional methods for a concrete need, such as game feel or XR interaction. Create and inspect the visual designs required by the project guide before dependent resource choices. Resolve conflicting upstream decisions in their owning sources, updating only affected downstream work. Missing decisions remain explicit rather than being invented by their consumers.

## 3. Plan the implementation

Use `game-implementation-planning` to complete `TECHNICAL_DESIGN.md` and refine the task record from the professional designs. The eight design records now supply the agreed scope, interfaces and expected behavior; unavailable resource files remain planned rather than receiving invented paths. Carry their required outcomes into implementation tasks and checks with source pointers, without copying all design prose into the plan.

## 4. Produce and implement

Use `game-content-pipeline-engineer` to acquire and inspect the required resources, selecting production Skills when their work is due. Follow `game-plan-execution` for implementation: resolve real inputs before their consumers, implement and observe a coherent player situation, then expand to the remaining confirmed scope. Resource production and implementation can interleave where dependencies allow; the first situation is not a reduced final deliverable.

## 5. Verify and hand off

Finish the execution Skill's runtime checks against the original design, including required controls, state transitions and visual/audio behavior. Use existing Preview or target-runtime tools and `evidence-before-completion` for the final claim. Report the runnable result, observed behavior and unresolved items. Missing implementation remains unfinished; unobserved behavior remains unverified. User judgments of enjoyment and feel are separate from technical completion.

After delivery, ordinary conversation edits only the requested scope and affected sources. Use planning again when a later change needs it, without replaying the complete first-version workflow.
