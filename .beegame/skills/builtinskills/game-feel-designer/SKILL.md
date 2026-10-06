---
name: game-feel-designer
description: Design or tune game control response, action rhythm, gameplay feedback and impact through coordinated animation, effects, camera, sound and supported haptics. Use for game feel, hit feedback and moment-to-moment responsiveness, not UI-only navigation or page transitions. 中文：操作手感、动作节奏、游玩反馈、打击感与冲击力。
---

# Game Feel Designer

Make an action's response and consequence perceptible, satisfying and consistent with the game. Start with the actual player actions, gameplay rules, pacing, art/audio direction and target input devices. A quiet puzzle, precision platformer and heavy combat game need different responses; spectacle is not a substitute for readable control.

## Response and rhythm

Separate acknowledgment of an input from execution of an action, confirmed contact and its consequence where those distinctions matter. Feedback must follow the real gameplay fact: an attempted action is not a hit, and a cosmetic effect is not proof of damage or success. Identify the event, affected subject and outcome information each consequential cue needs from gameplay.

For relevant actions, explain the desired sensation and how response, anticipation, contact emphasis and recovery produce it. Choose only phases that serve that action. Preserve prompt acknowledgment; do not hide input latency behind animation. Consider acceleration, stopping, turning, repeated actions and interruption when they shape control. Distinguish visual follow-through from a rule that locks input or delays another action. Changes to movement, action windows, collision results or the simulation clock must be reconciled with the gameplay and balance owners, not introduced as cosmetic tuning.

## Compose feedback across channels

Choose animation, deformation, trails, flashes, particles, camera response, sound or supported haptics by the information and sensation they add. Establish a readable primary cue, then reinforce it without every channel demanding attention. Specify their relationship to the same gameplay event and meaningful relative timing. Strong and weak events should differ for a reason; more particles, louder sound or larger shake is not automatically more convincing impact. Preserve target readability, aim and essential HUD information.

Hit stop, slow motion, shake and haptics are optional techniques, not a checklist. If used, distinguish presentation-only pauses from changes to gameplay time, input handling or audio playback, and resolve those consequences with their owners. Do not assume a device capability or change physics to make an effect look stronger.

Account for the game's actual event rate: repeated or simultaneous cues may need merging, replacement, limits or priority so small events do not mask major ones. Choose the applicable behavior rather than building a general effects scheduler. Resolve cancellation, pause, restart and exit so transient animation, camera offsets, sound and haptics do not survive into an unrelated state. Retain essential feedback when motion, audio or haptics are unavailable or reduced.

## Deliver and tune within scope

Trace coordinated cues to the same gameplay event, timing and lifecycle requirements. Reference the existing decision sources instead of redefining a rule in multiple places. Identify unresolved event or parameter dependencies; do not invent contact facts or timings before their source exists.

During planning, explain the intended effect and tuning uncertainties without claiming it feels good in an unbuilt game. When implementation or tuning is requested, observe representative play with the intended input: check response, misses versus confirmed outcomes, dense events and relevant interruption/recovery. Evaluate perceived control and readability, not just whether effect code runs. Compare changes against the player's intended experience and actual rules; keep only adjustments that serve that purpose.
