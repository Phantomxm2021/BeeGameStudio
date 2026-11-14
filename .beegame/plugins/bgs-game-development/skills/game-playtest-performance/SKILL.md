---
name: game-playtest-performance
description: "Verify delivered gameplay, input, state transitions and player-facing results; diagnose concrete runtime-performance problems or conduct requested playtests and experience studies. 中文：游戏功能与交付验证、具体性能排障及受托试玩／体验研究。"
---

# Game Playtest and Performance

Choose the method for the assigned runtime verification, performance or player-experience question. Verification checks required player outcomes and adopted presentation; broader playthroughs and experience studies follow their requested scope.

## Runtime verification

For the outcomes in scope, start at the first actionable state and use delivered controls through the main action, its result and the relevant failure/recovery. Reuse valid observations/scripts with matching source and conditions. Run the passage continuously, waiting for relevant conditions and collecting outcomes before interpreting. A failed shared prerequisite blocks dependent checks; independent checks can still return together for repair.

Check the interface and rendered playfield separately: input/focus ownership, HUD obstruction and the affected scene cues. Inspect the adopted composition, proportions and relevant motion/sound in that passage. Distinguish missing/distorted adopted cues from alternative preferences. DOM/state assertions cannot establish a Canvas/WebGL visual result: inspect and retain the relevant actual picture for a visual finding, and a continuous passage for motion. Existing readable state can answer behavior questions without screenshots at every step. Distinguish product defects from driver/environment artifacts; if automation is unreliable, use available direct observation or report the outcome unverified. Engine-internals investigation and repair do not automatically belong to every verification task.

Retain conditions, outcomes, reproduction steps and existing script/result paths in the handoff. Separate observed unmet requirements, unconfirmed experience hypotheses and aesthetic alternatives. A scripted route establishes that path, not player understanding/enjoyment, especially when it uses the game's own solver. Missing required observations remain unverified; optional research gaps do not become delivery conditions.

## Performance and recordings

Record relevant hardware/browser, viewport, build, scene, baseline and frame/load measurements. Locate CPU/GPU/memory/network/decode/main-thread cost before optimizing; a profiler can itself affect timing. Inspect interactive load, repeated transitions or input latency when they affect the assigned issue. Reducing unnecessary work is preferable to hiding it with loading UI.

[Comparable runtime measurements](../../references/game-art-director-expert/runtime-cost-tradeoffs.md#observe-the-same-meaningful-situation) distinguish conditions, tails and measurement limits. rAF intervals, recordings and headless samples alone do not establish GPU time or input latency. Thresholds come from the target platform/product, not a universal FPS, memory budget or campaign.

[Player-path observation](../../references/game-playtest-performance/play-capture.md) covers recording clocks, transient visuals and selected-audio versus complete output. Retain the relevant input/state context and whether media shows a concept, isolated preview or actual gameplay. Reuse original evidence; record again only when it cannot answer the changed question.

## Understanding and experience

For requested experience work, distinguish rule correctness, understanding and intended experience. Investigate a concrete audience/design question such as discoverability, feedback or rhythm rather than invent retention goals or a satisfaction survey.

Use [player observation](../../references/game-playtest-performance/player-observation.md) when authorized human research is needed. Agent play, synthetic personas and bots cannot establish real-player comprehension/enjoyment. Report the hypothesis and missing human evidence without fabricating reactions or adding a gate.

For an authorized experience-driven change, [experience validation](../../references/game-playtest-performance/experience-validation.md) connects one falsifiable question to actual controls, layered evidence, its source correction and a same-situation retest. It reuses existing evidence rather than impose a default study, score or automatic repair loop.
