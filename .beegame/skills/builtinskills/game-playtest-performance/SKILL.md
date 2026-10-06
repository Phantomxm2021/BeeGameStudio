---
name: game-playtest-performance
description: Playtest player understanding and experience; verify playable behavior and profile loading, frame time, memory, rendering and input on target devices. 中文：玩家试玩、体验验证、游玩验收、游戏启动慢、掉帧、性能分析。
---

# Game Playtest and Performance

Judge the result from a player's path and measured target runtime, not from a green build or an Agent's final message alone. Keep the check proportional to the requested change.

- Derive a few observable scenarios from the game's mechanics: start, perform the core action, encounter success/failure, recover, and reach the intended end condition. Include platform-specific input and XR comfort/safety only when relevant.
- Separate content defects from import, editor, preview, service, and game-runtime defects. Reproduce the failure and identify the owning boundary before proposing a fix; do not alter valid authored content to mask a platform bug.
- Treat an automated player's route as a test driver, not as the game itself. If it fails, determine whether the game failed, the browser/environment failed, or the driver could not navigate; record the observed evidence and any unverified requirement. A repeatedly successful bot run is not a universal release criterion when focused checks establish the same behavior.
- For performance, record target hardware/browser, viewport, build mode, representative scene, baseline, and frame time or load milestones. Find the bottleneck (CPU, GPU, memory, network, asset decode, or main-thread work) before choosing an optimization. A profiler or diagnostic overlay can itself affect timing.
- Check first interactive frame, on-demand loading, memory peaks, repeated transitions, and obvious input latency when these affect the task. Prefer reducing unnecessary data transfer or work over adding loading UI to conceal it.
- Verify the same scenario after a change and state what remains untested. A local fix does not certify the whole game or authorize publishing.

## Understanding and experience

Distinguish rule correctness, player understanding and the intended experience. A game may execute correctly while leaving a new player unsure of the goal, the available action or the reason for failure. Choose an experience question from the actual audience and design: whether the first action is discoverable, feedback explains an outcome, challenge is understandable, or the intended rhythm and agency are present. Do not turn every check into a satisfaction survey or invent retention goals.

When authorized access to players exists, observe a representative task without explaining the solution first. Separate prior familiarity from what the game teaches. Record relevant behavior such as hesitation, repeated failed attempts, recovery and misunderstood cues; ask neutral follow-up questions to distinguish an observation from its possible cause. Avoid leading prompts and treat sample limitations explicitly. Preserve privacy and do not recruit, contact people or collect personal data without authorization.

An Agent can inspect affordances, reproduce confusing states and identify experience risks. Its own play, a bot completing a route, or a synthetic persona is not evidence that real players understand or enjoy the game. When player evidence is unavailable, state the design hypothesis and the observation still needed; do not fabricate reactions or impose a new mandatory research gate. Keep human-research needs distinct from runtime checks the Agent can perform, and apply completion criteria from the agreed scope.

For experience-driven changes, identify the observed problem and affected design before proposing the smallest relevant correction. Preserve required scope and authoritative decisions, and compare the same situation afterward. Do not cure confusion automatically by adding tutorial text, cure low engagement by adding progression, or rewrite reviewed design without authorization. Report whether the evidence supports the intended effect, not merely whether the revised code runs.

Do not prescribe a universal FPS, memory budget, test-bot route, player-study sample size or full campaign for every project. Choose acceptance thresholds from the target platform and product requirements; when none exist, report measurements rather than inventing a pass mark.
