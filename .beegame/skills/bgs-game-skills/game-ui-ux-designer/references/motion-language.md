# Choose an interface motion language

Read the state section for transition/state-feedback work; read the material/curve examples when choosing a treatment or repairing interchangeable motion. These are presentation and interaction methods, not another navigation state machine.

## State meaning, interruption and accessibility

| Situation | Meaning to communicate | Preserve in the response |
| --- | --- | --- |
| Hover, focus, selection | Pointer presence, current input destination and retained choice are different facts | Distinguish coexisting cues. Touch must not require hover to discover or perform an action |
| Press, release, cancelled activation | The input is acknowledged, not necessarily executed or successful | Follow activation/cancellation rules and clear cancelled press feedback |
| Pending, success, failure | A request was accepted versus a confirmed result | Acknowledge input or show pending for asynchronous work; success follows outcome, and failure explains an available next action |
| HUD value or availability change | What changed and what is true now | Keep decision-critical state readable during trailing bars/count tweens; animation completion is not readiness |

For consequential transitions, identify the trigger, resulting state, changed subject/properties and duration, easing and sequence. Choose from the game's pace and revealed information, not a universal duration. Preserve useful spatial continuity and stable HUD information; selective emphasis/stagger must not delay the primary action or let repeated small cues mask urgent ones. Use specific priority/repetition choices, not a general effects scheduler.

Distinguish visual completion from when the action takes effect. Follow each destination branch to its actual focus/input availability and the old elements that stop receiving events; a shared trigger does not imply shared focus. Reconcile completion cues with state-entry cleanup so they are not immediately cancelled or carried into another screen. Resolve rapid activation, back/cancel, reversal and pause/retry/exit: invisible controls must not remain active, one activation must not execute twice, and transient cues must not leak across states.

For Web UI, honor the applicable [reduced-motion preference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion). Retain feedback meaning in a static/gentler alternative; reduce nonessential large displacement rather than just accelerate it. Preserve essential information without flashing, color or displacement alone. The alternative must produce the same functional result without depending on a disabled animation-end event. Coordinate sound/supported haptics with the same fact without giving every channel equal prominence; interface motion cannot change collision outcomes or simulation timing.

Observe the affected control/transition at normal usage rate, including relevant cancellation/repetition. Check meaning, action count, focus/state and whether moving targets or effects obstruct input or necessary play information. Reuse the existing preview/capture path. A clip establishes its observed sequence, not universal correctness or perceived quality; unavailable checks remain unverified.

## Let meaning and material choose the motion

| Situation | Plausible treatment | Why / cost to examine |
| --- | --- | --- |
| A panel extends an existing workspace | Move from its spatial origin or preserve a selected object's identity through the change | Helps orientation; a long journey on every inventory visit becomes waiting, and a moving control can be difficult to target |
| A rigid industrial control seats into place | A bounded translation with a decisive stop; a local light or surface change acknowledges activation | Can express mechanical precision; elastic deformation may contradict the chosen material, but rigidity is not required by every industrial theme |
| A playful soft object responds | Restrained compression and recovery on the visual child may express softness | Can give character without moving the hit target; overshoot on every repeated input can become tiring |
| A high-frequency tactical overlay opens | A quick reveal or emphasis change may be enough while retaining world orientation | Preserves pace; an elaborate entrance can cover useful information or imply a new scene when none occurred |

These are original hypotheses, not finished animations or genre presets. Pick from the actual subject and action. Masks/cropping can reveal content; relative movement can express continuity; bounded light/blur can establish focus or depth. Use a supported technique only when that relationship matters. Fading and translating everything by default is not a material choice, but a deliberate fade can be right.

## Express a curve, not only a duration

Decide where emphasis belongs: immediate response, travel, arrival or recovery. For a panel moving to a stable destination, deceleration can make its endpoint readable; constant-speed motion can express deliberate mechanical travel; overshoot may suit elastic material. None is the universally natural curve. Distance, frequency and the amount of information revealed affect timing, and a longer visual recovery need not lock the player's next action.

In a hypothetical rigid drawer, opening and closing should keep the same origin/axis if spatial continuity is the intent. Reversing halfway should start from the displayed position, not jump to an endpoint and replay. A glow can acknowledge the press immediately while the drawer moves; it must not claim a successful asynchronous action before that result exists. Use the existing tween/animation facilities and activation semantics, not a second clock or event protocol.

Compose a meaningful moment with quieter support. A result may emphasize the affected game object before presenting the next action; whether that sequence is appropriate depends on the required pace. Repeated focus changes generally need legible acknowledgment, not the full completion treatment. Coordinate sound with the same fact without requiring every channel to peak together.

Inspect the complete transition at normal usage rate and during reversal/repetition. A normal-speed clip answers questions a duration table cannot. Reduced motion should preserve meaning with a suitable static or gentler treatment; choose that alternative with the original treatment. Record the selected property, trajectory/curve and emphasis in the existing UI/art source, not a separate animation specification for every control.

Impeccable's [animate reference](https://github.com/pbakaus/impeccable/blob/main/skill/reference/animate.md) distinguishes continuity, reveal, material and feedback. Borrow this selection method, not its default durations, web-only APIs or a blanket ban on spring motion. Actual runtime support and observation still govern implementation and acceptance.
