---
name: game-feel-designer
description: "Design or tune perceived control response, action rhythm and coordination of visual/audio/haptic feedback. Use for sluggish, unclear or unsatisfying actions and conflicting cue timing; specialist methods realize the affected assets and effects. 中文：操作响应、动作节奏与跨通道反馈协调。"
---

# Game Feel Designer

Make an action's response and consequence perceptible, satisfying and consistent with the game. Start with the actual player actions, gameplay rules, pacing, art/audio direction and target input devices. A quiet puzzle, precision platformer and heavy combat game need different responses; spectacle is not a substitute for readable control.

For a new feel direction or a player-facing action that works but feels generic, use the optional [comparative feel studies](references/comparative-feel-studies.md) to examine a relevant external example and a captured moment from the actual game. For a question about input versus outcome, try the shared [playable relay study](../references/relay-crossing.html): a switch responds immediately, the pulse commits at the fork, and the receiver answers at contact. Compare those moments with the action in the actual game; a narrow timing fix can use its existing passage.

## Response and rhythm

For a control-response or feedback design question, describe the player-perceived difference the decision needs to resolve. Production and integration resolve effect construction, overlap and cleanup against those decisions. Read [control response and intent](references/control-response.md) to resolve a concrete control-feasibility or behavioral uncertainty, or when implementing or tuning response, stopping/turning or action tolerances. Distinguish input, simulation, spatial context and representation before choosing parameters; an isolated feedback-effect change does not need controller retuning.

Separate acknowledgment of an input from execution of an action, confirmed contact and its consequence where those distinctions matter. Feedback must follow the real gameplay fact: an attempted action is not a hit, and a cosmetic effect is not proof of damage or success. During feedback production and integration, identify the event, affected subject and outcome information supplied by gameplay.

For relevant actions, explain the desired sensation. During production or tuning, choose how response, anticipation, contact emphasis and recovery produce it. Choose only phases that serve that action. Preserve prompt acknowledgment; do not hide input latency behind animation. Consider acceleration, stopping, turning, repeated actions and interruption when they shape control. Distinguish visual follow-through from a rule that locks input or delays another action. Changes to movement, action windows, collision results or the simulation clock must be reconciled with the gameplay and balance owners, not introduced as cosmetic tuning.

## Compose feedback across channels

For the current feedback question, define the information and sensation contributed by the primary cue and any reinforcement, with their relative timing against the same gameplay event. Choose channels only when they serve that purpose; strong and weak events should differ for a reason. Use the existing visual, audio or UI methods to construct the affected result, rather than redefining their production technique here. For sheet-based feedback, the [shared production method](../game-technical-artist/references/spritesheet-production.md) preserves its entries and playback meaning. Preserve target readability, aim and essential HUD information.

Hit stop, slow motion, shake and haptics are optional techniques, not a checklist. If used, distinguish presentation-only pauses from changes to gameplay time, input handling or audio playback, and resolve those consequences with their owners. Do not assume a device capability or change physics to make an effect look stronger.

For repeated or simultaneous events, resolve which information takes priority and what the player should perceive when cues overlap, are replaced or are interrupted. Channel-specific implementation follows that decision through the existing animation, audio or UI lifecycle. Retain essential feedback when motion, audio or haptics are unavailable or reduced; no general effects scheduler is implied.

## Deliver and tune within scope

During feedback production and integration, trace coordinated cues to the existing gameplay event, timing and lifecycle definitions, identifying unresolved event or parameter dependencies. Do not invent contact facts or timings before their source exists.

When a planning decision concerns feel, explain the intended effect and tuning uncertainties without claiming it feels good in an unbuilt game. During implementation or tuning, use a representative passage to resolve a concrete construction or feel question. Where implementation and verification are separate assignments, the verification work observes response, misses versus confirmed outcomes, dense events and relevant interruption/recovery; implementation hands over the intended effects and remaining questions. Evaluate perceived control and readability against the assigned question. Compare changes against the player's intended experience and actual rules; keep only adjustments that serve that purpose.

When stills cannot answer a continuity/cadence question, use the relevant live passage or recording. The [player-path observation reference](../game-playtest-performance/references/play-capture.md) explains recording-clock and selected-audio limits; choose tools available for the actual runtime.
