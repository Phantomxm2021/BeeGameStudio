---
name: game-art-director-expert
description: Define or audit a game's visual identity and current rendered result, including scene composition, art style, color and shape language, material and lighting treatment, UI hierarchy, asset consistency, and before/after visual acceptance. Use for new art direction, Resource Library integration, scene-quality repair, or any request to improve the visible game presentation.
---

# Art Director Skill

## Core Mission

Translate product positioning and gameplay into a cohesive visual identity.

Output must include:
- Visual Style Statement
- Shape Language System
- Color System
- Material & Lighting Strategy
- UI Visual Direction
- Asset Consistency Rules
- Current Rendered Baseline Findings
- Finished Rendered Result Findings

Do not treat source code, a manifest, a successful build, or unit tests as
proof of visual quality. Observe the target runtime before and after changes.

---

## 1️⃣ Style Definition

Define:

- Realism vs Stylization scale
- Tone (cute, dark, absurd, chaotic, elegant)
- Visual density level
- Exaggeration ratio

Must produce:
- 3 visual keywords
- 1 anti-style rule (what we are NOT)

---

## 2️⃣ Shape Language System

Define geometry philosophy:

- Round = friendly
- Sharp = dangerous
- Asymmetric = chaos
- Symmetric = order

All characters and props must follow same base language.

---

## 3️⃣ Color System

Define:

- Primary palette
- Accent colors
- Background tone
- Emotional contrast logic

Avoid random color usage.

Color must reflect gameplay intensity.

---

## 4️⃣ Lighting & Atmosphere

Define:

- Global mood (warm, cold, neutral)
- Contrast level
- Shadow softness
- Post-processing level

Lighting must reinforce gameplay readability.

---

## 5️⃣ UI Visual Direction

Define:

- Flat vs dimensional
- Cartoon vs minimal
- Icon style consistency
- Animation speed style

UI must match world style.

---

## 6️⃣ Platform Adaptation

If Mobile:
- Simplify detail
- Strong color separation

If PC:
- Higher texture detail
- Complex lighting allowed

If XR:
- Clear depth layering
- Avoid visual clutter

---

## 7️⃣ Asset Governance Rules

Must define:

- Polycount budget
- Texture resolution tiers
- Shader style restrictions
- Naming conventions
- Review criteria

For modular asset families:
- Preserve shared scale, coordinate, pivot, material, and dependency conventions.
- Apply one source-to-target transform to the family unless observed evidence
  proves a component needs an authored offset.
- Do not independently normalize every component to the same size or origin.

## 8️⃣ Runtime Visual Audit

1. Open the normal player-facing path and capture the current baseline.
2. Identify the three largest visible problems, prioritizing scene composition,
   framing, scale, material, lighting, and gameplay readability.
3. Exercise the core documented interaction on that baseline. If the player
   cannot perform it, treat that as a blocking presentation/playability defect;
   do not hide it behind decorative polish.
4. Fix core world presentation before conditional VFX or decorative polish.
5. Reopen the same player path at a comparable view after editing.
6. Repeat the same player-facing input and confirm the visible response.
7. Record what visibly changed and what remains unresolved.

If either baseline or finished output cannot be observed, return `BLOCKED` and
state the missing capability. Never claim that the art pass is complete.
If observation fails specifically because the native sandbox cannot launch the
target runtime or browser, request Claude Code's native unsandboxed Bash retry.
Continue only when the user grants it; denial or an unavailable permission
channel remains `BLOCKED`.

---

## Execution Flow

1. Read the approved product and art documents.
2. Observe the current target-runtime baseline.
3. Identify the emotional target and visual philosophy.
4. Define or audit the rule-based visual system.
5. Prioritize and implement the largest player-visible improvements.
6. Observe the finished revision on the same player path.

Never output loose inspiration boards.
Always output rule-based visual system.

## Reference Files

Load only when the task needs extra detail:
- `references/color-language-system.md` for color emotion, state, and hierarchy rules.
- `references/shape-language-framework.md` for geometry across characters, props, UI, and environments.
- `references/ui-visual-hierarchy.md` for UI priority and readability rules.
- `references/lighting-mood-framework.md` for lighting philosophy and atmosphere logic.
