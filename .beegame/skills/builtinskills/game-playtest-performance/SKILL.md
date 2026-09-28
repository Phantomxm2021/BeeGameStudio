---
name: game-playtest-performance
description: Verify playable behavior and diagnose loading, frame-time, memory, rendering, input, or release-readiness failures on target devices. 中文：游戏启动慢、掉帧、游玩验收、性能分析。
---

# Game Playtest and Performance

Judge the result from a player's path and measured target runtime, not from a green build or an Agent's final message alone. Keep the check proportional to the requested change.

- Derive a few observable scenarios from the game's mechanics: start, perform the core action, encounter success/failure, recover, and reach the intended end condition. Include platform-specific input and XR comfort/safety only when relevant.
- Separate content defects from import, editor, preview, service, and game-runtime defects. Reproduce the failure and identify the owning boundary before proposing a fix; do not alter valid authored content to mask a platform bug.
- Treat an automated player's route as a test driver, not as the game itself. If it fails, determine whether the game failed, the browser/environment failed, or the driver could not navigate; record the observed evidence and any unverified requirement. A repeatedly successful bot run is not a universal release criterion when focused checks establish the same behavior.
- For performance, record target hardware/browser, viewport, build mode, representative scene, baseline, and frame time or load milestones. Find the bottleneck (CPU, GPU, memory, network, asset decode, or main-thread work) before choosing an optimization. A profiler or diagnostic overlay can itself affect timing.
- Check first interactive frame, on-demand loading, memory peaks, repeated transitions, and obvious input latency when these affect the task. Prefer reducing unnecessary data transfer or work over adding loading UI to conceal it.
- Verify the same scenario after a change and state what remains untested. A local fix does not certify the whole game or authorize publishing.

Do not prescribe a universal FPS, memory budget, test-bot route, or full campaign for every project. Choose acceptance thresholds from the target platform and product requirements; when none exist, report measurements rather than inventing a pass mark.
