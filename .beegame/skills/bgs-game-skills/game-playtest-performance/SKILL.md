---
name: game-playtest-performance
description: Verify basic gameplay behavior, diagnose interaction or performance failures, and support explicitly requested playtests. 中文：基础运行验证、交互故障定位、性能分析、明确请求的试玩研究。
---

# Game Playtest and Performance

Use focused checks for basic runtime correctness or a concrete reported failure. Experience playtesting belongs to the user by default. Broader playthroughs, experience studies and full-game automated navigation are scoped work when explicitly requested, not ordinary implementation prerequisites.

- Derive focused checks from the confirmed brief/design for affected rules, controls, state transitions and technical feedback. Include relevant failure/recovery and platform-specific input or XR safety. Use ordinary delivered inputs for integration checks; hooks can isolate rules but do not verify that control path.
- Determine expected results independently of the implementation or tests. Assert deterministic outcomes. A button click, no exception or an immediate reset counter is not a recovery check: observe recovered activity after relevant delayed effects settle and through a subsequent action. Include interruptions when affected asynchronous behavior needs them. Choose diagnostic timing from the implementation. Precision/timing investigations can sample ordinary input variation; searching for a perfect sequence is not a default check. Keep technical failures and unverified behavior separate from pending user experience feedback.
- Separate content defects from import, editor, preview, service, and game-runtime defects. Reproduce the failure and identify the owning boundary before proposing a fix; do not alter valid authored content to mask a platform bug.
- When an automated driver is in scope, separate game, browser/environment and driver failures. A successful route establishes only the tested reachability, not experience quality or a release verdict.
- For performance, record target hardware/browser, viewport, build mode, representative scene, baseline, and frame time or load milestones. Find the bottleneck (CPU, GPU, memory, network, asset decode, or main-thread work) before choosing an optimization. A profiler or diagnostic overlay can itself affect timing.
- For a performance comparison, use the applicable [runtime cost and measurement distinctions](../game-technical-artist/references/runtime-cost-tradeoffs.md#observe-the-same-meaningful-situation). Retain sample/condition scope and tail behavior; recorded media, rAF intervals or headless measurements do not by themselves establish device GPU time or input latency.
- Check first interactive frame, on-demand loading, memory peaks, repeated transitions, and obvious input latency when these affect the task. Prefer reducing unnecessary data transfer or work over adding loading UI to conceal it.
- Verify the same scenario after a change and state what remains untested. A local fix does not certify the whole game or authorize publishing.

For explicitly requested integrated playtesting, distinguish observed function, agreement with source requirements and experience quality. Inspect composition, input/state feedback and required audio together, including relevant overlap or interruption. Layout calculations, clicks, decoded sound and screenshots establish different properties. If viewing, listening or player observation is unavailable, state that limitation instead of an author rating.

For generated PCM diagnostics or isolated/overlap listening, the audio Skill's [optional helpers and listening limits](../game-audio-designer/references/audio-tools.md) reuse original files. The managed headless Preview browser is muted; encoded HTML-audio probes do not establish Web Audio behavior, short one-shots or the audible final mix. Reach the relevant start/action/overlap/pause/retry through ordinary game controls in an available player or authorized recording path. A resource audition is supplementary, not that integrated observation.

For a motion sequence or an accessible Web Audio bus, use the optional [player-path capture helper](references/play-capture.md) with the current Preview capability. It retains video, selected stills and explicitly selected-node audio while the project test supplies real inputs/assertions. Its audio tap is not automatic whole-game/device capture. That reference also explains how to read existing native Skill-load facts without treating a load as proof of adoption or quality.

Keep sample checks scoped to the representative path and intended display/input; final release checks still cover the agreed screens, states and targets. Reuse valid recordings and focused tests. A report or evidence hash binds recorded bytes, not the truth of a gameplay or aesthetic verdict.

## Understanding and experience

For requested experience work, distinguish rule correctness, player understanding and the intended experience. A game may execute correctly while leaving a new player unsure of the goal, available action or failure reason. Choose a question from the actual audience and design: discoverability, feedback, understandable challenge or intended rhythm and agency. Do not turn every check into a satisfaction survey or invent retention goals.

When authorized real-player observation is needed, read [Player observation](references/player-observation.md). An Agent can inspect affordances, reproduce confusing states and identify experience risks, but its own play, a bot completing a route, or a synthetic persona is not evidence that real players understand or enjoy the game. If player evidence is unavailable, state the design hypothesis and the observation still needed; do not fabricate reactions or impose a new mandatory research gate. Keep human-research needs distinct from runtime checks the Agent can perform.

For experience-driven changes, identify the observed problem and affected design before proposing the smallest relevant correction. Preserve required scope and authoritative decisions, and compare the same situation afterward. Do not cure confusion automatically by adding tutorial text, cure low engagement by adding progression, or rewrite reviewed design without authorization. Assess whether the evidence supports the intended effect, not merely whether the revised code runs.

Do not prescribe a universal FPS, memory budget, test-bot route, player-study sample size or full campaign for every project. Choose acceptance thresholds from the target platform and product requirements; when none exist, retain measurements without inventing a pass mark.
