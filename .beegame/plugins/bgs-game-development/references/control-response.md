# Control response and player intent

Use when choosing or tuning movement/action response, not for an isolated particle or sound binding. Separate what the player intends, what input is received, what legal action executes and how that result is presented. The following diagnoses are candidates to distinguish, not a word-to-parameter lookup that establishes the cause.

## Build a first response

Start from the existing action and intended sensation before choosing decorative effects. For a hypothetical game whose rules already allow pushing a heavy block into a slot, suppose the goal is controllable weight:

| Relationship | Construction using the existing rules/runtime | Observe in the action passage |
| --- | --- | --- |
| The action responds promptly but has mass | Acknowledge accepted input immediately; relate legal acceleration/stopping response to the actual slot and approach space. With working movement rules, a visual child's lean/settle can express mass without input lag: choose accepted input for a pose expressing effort, or executed displacement/velocity in the relevant space for a pose expressing actual movement | Small corrections remain usable, and release does not cause an unintended placement |
| Contact feels consequential | Bind a local settling movement and any damped contact cue to the existing confirmed-placement event, not the initial press. Audio/visual methods construct the chosen treatment | Motion, sound and success information agree about whether and where contact occurred |
| The player can act again naturally | Clear or interrupt presentation offsets through the existing lifecycle; choose repetition emphasis without extending a rule's action lock | A quick next action is neither blocked by visual recovery nor overwhelmed by stacked cues |

This illustrates translating sensation into control and event presentation, not a heavy-object preset or mandatory effect sequence. A light abstract subject may need a different response and little embellishment. Keep collision, eligibility and balance definitions authoritative; reconcile a real rule change with their owner rather than introducing it as visual tuning. Use the existing artifact, not a new tuning framework.

## Diagnose an existing response

| Complaint or goal | Relationships to inspect | A comparison that can change the decision |
| --- | --- | --- |
| Movement feels sluggish | Input handling, time to useful speed, animation acknowledgment and camera lag | Does simulation start promptly but build speed slowly, or does the accepted action itself arrive late? |
| Stopping feels imprecise | Release response, stopping distance, air/ground control and target spacing | Compare the traveled distance after release against the actual landing/placement region; do not merely increase damping |
| Turning feels twitchy or heavy | Input strength/dead zone, heading response, speed and camera basis | Compare small corrections with reversal at normal speed; normalizing every small stick input may erase intended sensitivity |
| A jump fails despite apparently correct intent | Eligibility, input buffer/grace policy, collider edges and visible landing information | Observe just-before-landing, just-after-edge and an actually unreachable jump separately; they do not share one fix |

## Choose an appropriate response

A direct position/velocity response may suit a precise grid or abstract controller. Gradual acceleration and carry-through may communicate a heavy vehicle, but can make narrow stopping tasks harder. Relate speed to traversable distance, character scale and camera framing: the same numeric speed can feel different in a different space. Do not improve a cosmetic feeling by silently changing collision or the intended execution demand.

For an original hypothetical precision platformer, first establish that the intended gap is reachable and visible. If the issue is a jump press shortly before landing being discarded, an input buffer can retain that intent until the existing legal landing boundary. Consume it on execution and expire it by the designed policy; it must not become a stored jump that unexpectedly fires much later. If late takeoff intent is the issue, a short post-edge grace policy answers a different question. Do not automatically add both. Neither fixes excessive gap width, missing destination information or a collision defect.

Choose any tolerance from the intended challenge, actual action cadence and observed input cases, not copied frames or milliseconds. Wider tolerance can make intent easier to express but can also admit actions outside the intended challenge. Preserve deliberate commitments and failure rules. Coordinate simulation/window changes with gameplay and balance, then reevaluate the affected geometry and feedback; an effect that acknowledges an attempted action must remain distinct from execution.

## Tune the owning relationship

Use the existing controller values and a reproducible player path. Change a consequential relationship and compare small corrections, sustained action, release/reversal and the relevant failed attempt. Recheck coupled values such as speed/stopping distance or jump/gravity/landing space instead of treating every parameter independently. Retain settings that already serve the agreed experience; a new tuning harness is not mandatory.

When existing input/state samples can answer a quantitative question, a small project-owned calculation can show time to speed, release distance or legal execution relative to input. Preserve units, clock and whether the sample describes input receipt, simulation or displayed motion. A state log is not physical input-to-display latency; recording timestamps alone do not establish it either. Actual control quality and player understanding remain separate judgments.

[Celeste's author](https://www.mattmakesgames.com/articles/celeste_and_forgiveness/index.html) explains how buffering and spatial/timing allowances support intention. Its mechanics and tolerance values are not defaults. The public [game-feel Skill](https://github.com/ronniebasak/game-feel-skill/blob/main/skills/game-feel/SKILL.md) distinguishes input, response, context and representation; use that causal distinction, not its universal latency floors, fixed diagnostic sequence or requirement to externalize every parameter.
