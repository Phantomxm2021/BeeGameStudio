---
name: game-feel-designer
description: "Tune perceived control response, anticipation, rhythm and coordinated feedback. Use for the intended sensation; code implementation follows that choice. 中文：操作响应、节奏与动作反馈调校。"
---

# Game Feel Designer

Make an action's response and consequence perceptible, satisfying and consistent with the game. Start with the actual player actions, gameplay rules, pacing, art/audio direction and target input devices. A quiet puzzle, precision platformer and heavy combat game need different responses; spectacle is not a substitute for readable control.

For a new feel direction or a player-facing action that works but feels generic, use the optional [comparative feel studies](references/comparative-feel-studies.md) to examine a relevant external example and a captured moment from the actual game. Choose a useful relationship, state what does not transfer, and judge the resulting motion and sound in play. Do not load the studies for a narrow timing or event-binding fix.

## Response and rhythm

For a control-response or feedback design question, describe the player-perceived difference the decision needs to resolve. Production and integration resolve effect construction, overlap and cleanup against those decisions. Read [control response and intent](references/control-response.md) to resolve a concrete control-feasibility or behavioral uncertainty, or when implementing or tuning response, stopping/turning or action tolerances. Distinguish input, simulation, spatial context and representation before choosing parameters; an isolated feedback-effect change does not need controller retuning.

Separate acknowledgment of an input from execution of an action, confirmed contact and its consequence where those distinctions matter. Feedback must follow the real gameplay fact: an attempted action is not a hit, and a cosmetic effect is not proof of damage or success. Identify the event, affected subject and outcome information each consequential cue needs from gameplay.

For relevant actions, explain the desired sensation. During production or tuning, choose how response, anticipation, contact emphasis and recovery produce it. Choose only phases that serve that action. Preserve prompt acknowledgment; do not hide input latency behind animation. Consider acceleration, stopping, turning, repeated actions and interruption when they shape control. Distinguish visual follow-through from a rule that locks input or delays another action. Changes to movement, action windows, collision results or the simulation clock must be reconciled with the gameplay and balance owners, not introduced as cosmetic tuning.

## Compose feedback across channels

During feedback production, choose animation, deformation, trails, flashes, particles, camera response, sound or supported haptics by the information and sensation they add. Establish a readable primary cue, then reinforce it without every channel demanding attention. Specify their relationship to the same gameplay event and meaningful relative timing. Strong and weak events should differ for a reason; more particles, louder sound or larger shake is not automatically more convincing impact. Preserve target readability, aim and essential HUD information.

Hit stop, slow motion, shake and haptics are optional techniques, not a checklist. If used, distinguish presentation-only pauses from changes to gameplay time, input handling or audio playback, and resolve those consequences with their owners. Do not assume a device capability or change physics to make an effect look stronger.

During feedback production and integration, account for the game's actual event rate: repeated or simultaneous cues may need merging, replacement, limits or priority so small events do not mask major ones. Choose the applicable behavior rather than building a general effects scheduler. Resolve cancellation, pause, restart and exit so transient animation, camera offsets, sound and haptics do not survive into an unrelated state. Retain essential feedback when motion, audio or haptics are unavailable or reduced.

## Deliver and tune within scope

Trace coordinated cues to the same gameplay event, timing and lifecycle requirements. Reference the existing decision sources instead of redefining a rule in multiple places. Identify unresolved event or parameter dependencies; do not invent contact facts or timings before their source exists.

When a planning decision concerns feel, explain the intended effect and tuning uncertainties without claiming it feels good in an unbuilt game. When implementation or tuning is requested, observe representative play with the intended input: check response, misses versus confirmed outcomes, dense events and relevant interruption/recovery. Evaluate perceived control and readability, not just whether effect code runs. Compare changes against the player's intended experience and actual rules; keep only adjustments that serve that purpose.

When stills cannot answer a continuity/cadence question, use the relevant live passage or recording. The [player-path observation reference](../game-playtest-performance/references/play-capture.md) explains recording-clock and selected-audio limits; choose tools available for the actual runtime.
