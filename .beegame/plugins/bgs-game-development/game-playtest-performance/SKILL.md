---
name: game-playtest-performance
description: "Verify delivered gameplay, input, state transitions and player-facing results; diagnose concrete runtime-performance problems or conduct requested playtests and experience studies. 中文：游戏功能与交付验证、具体性能排障及受托试玩／体验研究。"
---

# Game Playtest and Performance

Use the method for the current runtime-verification, performance or playtest question. Runtime verification checks the delivered player outcomes and their adopted presentation and feedback; broader playthroughs and player-experience studies follow their explicitly requested scope.

## Runtime verification

Choose related checks from the required player actions, state transitions and known affected behavior. Reuse existing observations or scripts when their source and conditions still apply. Run a related scenario continuously through the available script or automation capability: establish its current starting state, apply inputs, wait for relevant conditions and collect outcomes before interpreting them. A shared prerequisite failure can block dependent checks; other independent checks can still return together for repair.

Start with delivered controls and player-visible results. In the same passage, inspect the adopted composition, subject proportions and motion or sound cues relevant to that outcome. Presence alone does not establish realization: distinguish a missing or distorted adopted cue from an alternative aesthetic preference. Use existing readable state where it answers a concrete question. Capture transient visuals within that passage and inspect them afterward; state/event results answer behavior questions without a screenshot at every step. If a result is ambiguous, make the focused observation needed to distinguish a product defect from a driver or environment artifact, then report the reproducible behavior. General engine-internals investigation and defect repair belong to their corresponding assignment, rather than every verification question becoming a new diagnostic project.

Retain the conditions, outcomes, reproduction steps and any existing reusable script/result paths in the current handoff. Separate an observed unmet required outcome, an unconfirmed design/experience hypothesis and an alternative aesthetic preference. A successful scripted route establishes that performed path, not new-player understanding or enjoyment, particularly when it reuses the game's own solver or navigation. Missing required observations remain unverified; optional research gaps do not become additional delivery conditions.

## Runtime performance

- For performance, record target hardware/browser, viewport, build mode, representative scene, baseline, and frame time or load milestones. Find the bottleneck (CPU, GPU, memory, network, asset decode, or main-thread work) before choosing an optimization. A profiler or diagnostic overlay can itself affect timing.
- For a performance comparison, use the applicable [runtime cost and measurement distinctions](../game-technical-artist/references/runtime-cost-tradeoffs.md#observe-the-same-meaningful-situation). Retain sample/condition scope and tail behavior; recorded media, rAF intervals or headless measurements do not by themselves establish device GPU time or input latency.
- Check first interactive frame, on-demand loading, memory peaks, repeated transitions, and obvious input latency when these affect the task. Prefer reducing unnecessary data transfer or work over adding loading UI to conceal it.

For a concrete motion or audio question, [player-path observation](references/play-capture.md) explains how to interpret recordings and distinguish selected audio signals from the complete player output. Choose available tools suited to the target runtime.

Keep sample checks scoped to the representative path and intended display/input. Identify whether media shows a concept, isolated preview or actual gameplay. Reuse valid original recordings and focused checks; a new recording is useful only when existing evidence cannot answer the changed question.

## Understanding and experience

For requested experience work, distinguish rule correctness, player understanding and the intended experience. A game may execute correctly while leaving a new player unsure of the goal, available action or failure reason. Choose a question from the actual audience and design: discoverability, feedback, understandable challenge or intended rhythm and agency. Do not turn every check into a satisfaction survey or invent retention goals.

When authorized real-player observation is needed, read [Player observation](references/player-observation.md). An Agent can inspect affordances, reproduce confusing states and identify experience risks, but its own play, a bot completing a route, or a synthetic persona is not evidence that real players understand or enjoy the game. If player evidence is unavailable, state the design hypothesis and the observation still needed; do not fabricate reactions or impose a new mandatory research gate. Keep human-research needs distinct from runtime checks the Agent can perform.

For an authorized experience-driven change, use [experience validation](references/experience-validation.md) to connect one falsifiable design question to actual controls, layered evidence, an authorized source correction and same-situation retest. It reuses existing evidence, routes a concrete issue to its specialist and retains honest not-run/human-observation gaps. It does not add a default study, score, repeated review or automatic repair loop.

Do not prescribe a universal FPS, memory budget, test-bot route, player-study sample size or full campaign for every project. Choose acceptance thresholds from the target platform and product requirements; when none exist, retain measurements without inventing a pass mark.
