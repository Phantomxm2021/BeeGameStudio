# Choose an interface motion language

Use for state-change motion in a new playable interface or a focused motion question. The [UI method](../../skills/game-ui-ux-designer/SKILL.md#build-state-change-motion) defines task scope and when a cut serves the transition. The methods below connect player-visible meaning to construction, playback and observation.

## State meaning

| Situation | Meaning to communicate | Preserve in the response |
| --- | --- | --- |
| Hover, focus, selection | Pointer presence, current input destination and retained choice are different facts | Distinguish coexisting cues. Touch must not require hover to discover or perform an action |
| Press, release, cancelled activation | The input is acknowledged, not necessarily executed or successful | Follow activation/cancellation rules and clear cancelled press feedback |
| Pending, success, failure | A request was accepted versus a confirmed result | Acknowledge input or show pending for asynchronous work; success follows outcome, and failure explains an available next action |
| HUD value or availability change | What changed and what is true now | Keep decision-critical state readable during trailing bars/count tweens; animation completion is not readiness |

A timestamped frame sequence or clip can reveal order and stale completion after return; isolated endpoint stills cannot establish continuity. Keep capture timestamps, simulation events and physical input/display latency distinct.

## Let meaning and material choose the motion

| Situation | Plausible treatment | Why / cost to examine |
| --- | --- | --- |
| A panel extends an existing workspace | Move from its spatial origin or preserve a selected object's identity through the change | Helps orientation; a long journey on every inventory visit becomes waiting, and a moving control can be difficult to target |
| A rigid industrial control seats into place | A bounded translation with a decisive stop; a local light or surface change acknowledges activation | Can express mechanical precision; elastic deformation may contradict the chosen material, but rigidity is not required by every industrial theme |
| A playful soft object responds | Restrained compression and recovery on the visual child may express softness | Can give character without moving the hit target; overshoot on every repeated input can become tiring |
| A high-frequency tactical overlay opens | A quick reveal or emphasis change may be enough while retaining world orientation | Preserves pace; an elaborate entrance can cover useful information or imply a new scene when none occurred |

These are original hypotheses, not finished animations or genre presets. Pick from the actual subject and action. Masks/cropping can reveal content; relative movement can express continuity; bounded light/blur can establish focus or depth. Use a supported technique only when that relationship matters. Fading and translating everything by default is not a material choice, but a deliberate fade can be right.

## Transition design

During design, resolve the consequential transition's player-visible start, destination and transfer of attention/control using a relevant observed example or, when unresolved, a simple geometric interaction study. Record that relationship with the existing design decision; duration and curve tuning follow the chosen treatment.

## Production and integration

For motion production or implementation, identify its trigger, resulting state, changed subject/properties and duration, easing and sequence. Choose from the game's pace and revealed information, not a universal duration. Preserve useful spatial continuity and stable HUD information; selective emphasis/stagger must not delay the primary action or let repeated small cues mask urgent ones. Use specific priority/repetition choices, not a general effects scheduler.

### From intent to implementation

In a hypothetical board game, selecting a piece opens its details. Suppose the design intent is to retain the connection between the piece and its information. Translate that intent into the existing interface rather than choosing a generic panel entrance:

| Intended relationship | Concrete implementation choice | What to observe |
| --- | --- | --- |
| The selected piece remains recognizable | Retain its presentation, mapping position/scale from its current board bounds to its detail pose | The player can follow the same subject through the change |
| Attention shifts from board actions to details | Preserve useful board context while revealing the detail information; transfer input/focus through the existing panel lifecycle | Background controls do not activate behind the detail view, and the next action is available at the intended moment |
| Closing reconnects to the board | Return from the displayed pose to the piece's current slot; interrupt/reverse through the existing animation owner | A quick return does not jump to a stale endpoint or leave controls blocked |

This is one possible relationship, not a required shared-object effect or screen template. Actual bounds, pace and available resources determine its construction. Use the selected runtime's animation facility. For a DOM entry, keep the subject laid out and renderable, establish its starting transform/clip/opacity, then animate the chosen properties to the destination. For an animated exit, retain rendering until completion or cancellation before hiding/removing it. Toggling `hidden` alone supplies no intermediate poses. The lifecycle below coordinates that playback with input.

### Express a curve, not only a duration

Decide where emphasis belongs: immediate response, travel, arrival or recovery. For a panel moving to a stable destination, deceleration can make its endpoint readable; constant-speed motion can express deliberate mechanical travel; overshoot may suit elastic material. None is the universally natural curve. Distance, frequency and the amount of information revealed affect timing, and a longer visual recovery need not lock the player's next action.

In a hypothetical rigid drawer, opening and closing should keep the same origin/axis if spatial continuity is the intent. Reversing halfway should start from the displayed position, not jump to an endpoint and replay. A glow can acknowledge the press immediately while the drawer moves; it must not claim a successful asynchronous action before that result exists. Use the existing tween/animation facilities and activation semantics, not a second clock or event protocol.

Compose a meaningful moment with quieter support. A result may emphasize the affected game object before presenting the next action; whether that sequence is appropriate depends on the required pace. Repeated focus changes generally need legible acknowledgment, not the full completion treatment. Coordinate sound with the same fact without requiring every channel to peak together.

### Input and state lifecycle

When implementing or verifying transitions, distinguish visual completion from when the action takes effect. Follow each destination branch to its actual focus/input availability and the old elements that stop receiving events; a shared trigger does not imply shared focus. Reconcile completion cues with state-entry cleanup so they are not immediately cancelled or carried into another screen. Resolve rapid activation, back/cancel, reversal and pause/retry/exit: invisible controls must not remain active, one activation must not execute twice, and transient cues must not leak across states.

For a modal surface, keep focus inside it and make background controls inactive until it closes; initial focus alone does not establish that boundary. For Web dialogs, follow the [modal keyboard behavior](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/#keyboardinteraction), including the return destination on dismissal.

### Accessible alternatives

For Web UI, honor the applicable [reduced-motion preference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion). Retain feedback meaning in a static/gentler alternative; reduce nonessential large displacement rather than just accelerate it. Preserve essential information without flashing, color or displacement alone. The alternative must produce the same functional result without depending on a disabled animation-end event. Coordinate sound/supported haptics with the same fact without giving every channel equal prominence; interface motion cannot change collision outcomes or simulation timing.

## Runtime observation

Observe the affected control/transition through actual inputs at normal usage rate and the relevant quick return/cancellation. Check acknowledgment versus outcome, actions and waiting to regain control, destination focus/state, and obstruction of necessary play information. Reuse the current Preview/capture path. Retain only motion that clarifies the action or serves the intended emotion; a clip cannot prove representative comprehension or pleasure. Unavailable observations remain unverified.

Compare the observed passage with the chosen subjects, property changes and control handoff. A correct final screen or a button pulse cannot establish that the intended transition occurred. Reuse an adequate observation; missing motion is a construction issue to fix in its owning code, not a reason to keep adding unrelated tests. Keep the selected treatment in the existing artifact/source rather than a separate specification for every control.

Impeccable's [animate reference](https://github.com/pbakaus/impeccable/blob/main/skill/reference/animate.md) distinguishes continuity, reveal, material and feedback. Borrow this selection method, not its default durations, web-only APIs or a blanket ban on spring motion. Actual runtime support and observation still govern implementation and acceptance.
