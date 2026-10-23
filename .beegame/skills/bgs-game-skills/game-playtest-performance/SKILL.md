---
name: game-playtest-performance
description: Playtest player understanding and experience; verify playable behavior and profile loading, frame time, memory, rendering and input on target devices. 中文：玩家试玩、体验验证、游玩验收、游戏启动慢、掉帧、性能分析。
---

# Game Playtest and Performance

Judge the result from a player's path and measured target runtime, not from a green build or an Agent's final message alone. Keep the check proportional to the requested change.

- Derive a few observable scenarios from the game's mechanics: start, perform the core action, encounter success/failure, recover, and reach the intended end condition. Include platform-specific input and XR comfort/safety only when relevant. Use the normal delivered input path for integration checks; test hooks can isolate rules but do not establish that player controls and state transitions work together.
- Give each scenario a source-based expected result and an assertion that fails the test when the result is wrong. A button click, no exception, or an immediate reset counter is not a recovery check. Observe the recovered activity after relevant delayed effects settle and through a subsequent action; include interruption or repeated transitions when the mechanic has asynchronous work. Choose timing from the actual implementation, not a universal sleep or loop count. Keep behavioral failures/unverified requirements separate from missing aesthetic or player-study evidence.
- Separate content defects from import, editor, preview, service, and game-runtime defects. Reproduce the failure and identify the owning boundary before proposing a fix; do not alter valid authored content to mask a platform bug.
- Treat an automated player's route as a test driver, not as the game itself. If it fails, determine whether the game failed, the browser/environment failed, or the driver could not navigate; record the observed evidence and any unverified requirement. A repeatedly successful bot run is not a universal release criterion when focused checks establish the same behavior.
- For performance, record target hardware/browser, viewport, build mode, representative scene, baseline, and frame time or load milestones. Find the bottleneck (CPU, GPU, memory, network, asset decode, or main-thread work) before choosing an optimization. A profiler or diagnostic overlay can itself affect timing.
- For a performance comparison, use the applicable [runtime cost and measurement distinctions](../game-technical-artist/references/runtime-cost-tradeoffs.md#observe-the-same-meaningful-situation). Retain sample/condition scope and tail behavior; recorded media, rAF intervals or headless measurements do not by themselves establish device GPU time or input latency.
- Check first interactive frame, on-demand loading, memory peaks, repeated transitions, and obvious input latency when these affect the task. Prefer reducing unnecessary data transfer or work over adding loading UI to conceal it.
- Verify the same scenario after a change and state what remains untested. A local fix does not certify the whole game or authorize publishing.

For an integrated sample or release, distinguish three conclusions: observed functional behavior, agreement with the source requirements, and experience quality. Inspect the actual composition/typography and input/state feedback together; listen to required audio during the same path, including meaningful overlap and interruption. Layout calculations, successful clicks, decoded sound files and a recorded screenshot establish different properties. None alone establishes a coherent experience. If real viewing, listening or player observation is unavailable, name that limitation without replacing it with an author rating.

For generated PCM diagnostics or isolated/overlap listening, the audio Skill's [optional helpers and listening limits](../game-audio-designer/references/audio-tools.md) reuse original files. The managed headless Preview browser is muted; encoded HTML-audio probes do not establish Web Audio behavior, short one-shots or the audible final mix. Reach the relevant start/action/overlap/pause/retry through ordinary game controls in an available player or authorized recording path. A resource audition is supplementary, not that integrated observation.

For a motion sequence or an accessible Web Audio bus, use the optional [player-path capture helper](references/play-capture.md) with the current Preview capability. It retains video, selected stills and explicitly selected-node audio while the project test supplies real inputs/assertions. Its audio tap is not automatic whole-game/device capture. That reference also explains how to read existing native Skill-load facts without treating a load as proof of adoption or quality.

Keep sample checks scoped to the representative path and intended display/input; final release checks still cover the agreed screens, states and targets. Reuse valid recordings and focused tests. A report or evidence hash binds recorded bytes, not the truth of a gameplay or aesthetic verdict.

## Understanding and experience

Distinguish rule correctness, player understanding and the intended experience. A game may execute correctly while leaving a new player unsure of the goal, the available action or the reason for failure. Choose an experience question from the actual audience and design: whether the first action is discoverable, feedback explains an outcome, challenge is understandable, or the intended rhythm and agency are present. Do not turn every check into a satisfaction survey or invent retention goals.

When authorized real-player observation is needed, read [Player observation](references/player-observation.md). An Agent can inspect affordances, reproduce confusing states and identify experience risks, but its own play, a bot completing a route, or a synthetic persona is not evidence that real players understand or enjoy the game. If player evidence is unavailable, state the design hypothesis and the observation still needed; do not fabricate reactions or impose a new mandatory research gate. Keep human-research needs distinct from runtime checks the Agent can perform.

For experience-driven changes, identify the observed problem and affected design before proposing the smallest relevant correction. Preserve required scope and authoritative decisions, and compare the same situation afterward. Do not cure confusion automatically by adding tutorial text, cure low engagement by adding progression, or rewrite reviewed design without authorization. Assess whether the evidence supports the intended effect, not merely whether the revised code runs.

Do not prescribe a universal FPS, memory budget, test-bot route, player-study sample size or full campaign for every project. Choose acceptance thresholds from the target platform and product requirements; when none exist, retain measurements without inventing a pass mark.
