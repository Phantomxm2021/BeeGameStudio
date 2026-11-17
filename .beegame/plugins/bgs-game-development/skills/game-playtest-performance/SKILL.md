---
name: game-playtest-performance
description: "Verify delivered gameplay, input, state transitions and player-facing results; diagnose concrete runtime-performance problems or conduct requested playtests and experience studies."
---

# Game Playtest and Performance

Choose the method for the assigned runtime verification, performance or player-experience question. Verification checks required player outcomes and adopted presentation; broader playthroughs and experience studies follow their requested scope.

## Runtime verification

Follow the delivered controls through the main action, its result and the relevant failure or recovery in one passage. When an input is acknowledged but has no clear game response, locate the control in the rendered scene or inspect the relevant game state before trying again. Reuse observations for unchanged source and conditions; after a fix, retest the affected result.

Check input focus, HUD obstruction and the affected scene cues in the rendered game. Compare composition, proportions and the visible or audible sequence with the adopted design during the event. Retain the rendered view for a visual finding. A final frame establishes only the end state, so observe transient feedback while it happens. Existing readable state can answer behavior questions without screenshots at every step. Distinguish product defects from driver/environment artifacts; if automation is unreliable, use available direct observation or report the outcome unverified. Engine-internals investigation and repair do not automatically belong to every verification task.

Report the conditions actually exercised, observed outcomes, reproduction steps and existing evidence paths. A configured viewport or route stays unverified if execution stopped before the observation. Separate observed unmet requirements, unconfirmed experience hypotheses and aesthetic alternatives. A scripted route establishes that path, not player understanding/enjoyment, especially when it uses the game's own solver. Optional research gaps stay outside the delivery conditions.

## Performance and recordings

Record relevant hardware/browser, viewport, build, scene, baseline and frame/load measurements. Locate CPU/GPU/memory/network/decode/main-thread cost before optimizing; a profiler can itself affect timing. Inspect interactive load, repeated transitions or input latency when they affect the assigned issue. Reducing unnecessary work is preferable to hiding it with loading UI.

[Comparable runtime measurements](../../references/runtime-cost-tradeoffs.md#observe-the-same-meaningful-situation) distinguish conditions, tails and measurement limits. rAF intervals, recordings and headless samples alone do not establish GPU time or input latency. Thresholds come from the target platform/product, not a universal FPS, memory budget or campaign.

[Player-path observation](../../references/play-capture.md) covers recording clocks, transient visuals and selected-audio versus complete output. Retain the relevant input/state context and whether media shows a concept, isolated preview or actual gameplay. Reuse original evidence; record again only when it cannot answer the changed question.

## Understanding and experience

For requested experience work, distinguish rule correctness, understanding and intended experience. Investigate a concrete audience/design question such as discoverability, feedback or rhythm rather than invent retention goals or a satisfaction survey.

Use [player observation](../../references/player-observation.md) when authorized human research is needed. Agent play, synthetic personas and bots cannot establish real-player comprehension/enjoyment. Report the hypothesis and missing human evidence without fabricating reactions or adding a gate.

For an authorized experience-driven change, [experience validation](../../references/experience-validation.md) connects one falsifiable question to actual controls, layered evidence, its source correction and a same-situation retest. It reuses existing evidence rather than impose a default study, score or automatic repair loop.
