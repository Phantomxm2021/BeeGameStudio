---
name: game-playtest-performance
description: "Observe actual gameplay, controls and audiovisual feedback, or measure a concrete runtime/performance problem. Broader player-experience studies apply when requested. 中文：实际游玩观察、控制与视听表现验证、性能测量。"
---

# Game Playtest and Performance

Use focused checks for basic runtime correctness or a concrete reported failure. Experience playtesting belongs to the user by default. Broader playthroughs, experience studies and full-game automated navigation are scoped work when explicitly requested, not ordinary implementation prerequisites.

For basic runtime checks and automated browser verification, use the shared [runtime verification method](../gameplay-programmer/SKILL.md#runtime-verification). The sections below cover performance and requested experience investigations.

- For performance, record target hardware/browser, viewport, build mode, representative scene, baseline, and frame time or load milestones. Find the bottleneck (CPU, GPU, memory, network, asset decode, or main-thread work) before choosing an optimization. A profiler or diagnostic overlay can itself affect timing.
- For a performance comparison, use the applicable [runtime cost and measurement distinctions](../game-technical-artist/references/runtime-cost-tradeoffs.md#observe-the-same-meaningful-situation). Retain sample/condition scope and tail behavior; recorded media, rAF intervals or headless measurements do not by themselves establish device GPU time or input latency.
- Check first interactive frame, on-demand loading, memory peaks, repeated transitions, and obvious input latency when these affect the task. Prefer reducing unnecessary data transfer or work over adding loading UI to conceal it.
- Compare affected behavior with the confirmed requirement or selected design.

For an affected visual/action/audio passage, use [visual comparison](references/play-capture.md#visual-comparison) to compare the delivered result with the requirement or selected design at gameplay scale and speed.

For generated PCM diagnostics or isolated/overlap listening, the audio Skill's [optional helpers and listening limits](../game-audio-designer/references/audio-tools.md) reuse original files. Muted playback and encoded-audio diagnostics do not establish Web Audio behavior, short one-shots or the audible final mix. Reach the relevant start/action/overlap/pause/retry through ordinary game controls in an available player or authorized recording path. A resource audition is supplementary, not that integrated observation.

For a concrete motion or audio question, [player-path observation](references/play-capture.md) explains how to interpret recordings and distinguish selected audio signals from the complete player output. Choose available tools suited to the target runtime.

Keep sample checks scoped to the representative path and intended display/input. Identify whether media shows a concept, isolated preview or actual gameplay. Reuse valid original recordings and focused checks; a new recording is useful only when existing evidence cannot answer the changed question.

## Understanding and experience

For requested experience work, distinguish rule correctness, player understanding and the intended experience. A game may execute correctly while leaving a new player unsure of the goal, available action or failure reason. Choose a question from the actual audience and design: discoverability, feedback, understandable challenge or intended rhythm and agency. Do not turn every check into a satisfaction survey or invent retention goals.

When authorized real-player observation is needed, read [Player observation](references/player-observation.md). An Agent can inspect affordances, reproduce confusing states and identify experience risks, but its own play, a bot completing a route, or a synthetic persona is not evidence that real players understand or enjoy the game. If player evidence is unavailable, state the design hypothesis and the observation still needed; do not fabricate reactions or impose a new mandatory research gate. Keep human-research needs distinct from runtime checks the Agent can perform.

For an authorized experience-driven change, use [experience validation](references/experience-validation.md) to connect one falsifiable design question to actual controls, layered evidence, an authorized source correction and same-situation retest. It reuses existing evidence, routes a concrete issue to its specialist and retains honest not-run/human-observation gaps. It does not add a default study, score, repeated review or automatic repair loop.

Do not prescribe a universal FPS, memory budget, test-bot route, player-study sample size or full campaign for every project. Choose acceptance thresholds from the target platform and product requirements; when none exist, retain measurements without inventing a pass mark.
