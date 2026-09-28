---
name: evidence-before-completion
description: Verification before completion of a game task, bug fix, or delivery using current evidence. 中文：完成前验证、验收证据、构建测试、运行检查。
---

# Evidence Before Completion

Use immediately before saying a requested fix, feature, or game delivery is complete. Match evidence to the actual claim; do not treat a green command or an Agent summary as proof of something it did not exercise.

## Claim-to-evidence check

1. Write down the claim you are about to make: “the parser handles atlas frames,” “the UI is responsive,” or “the game is playable.” Each requires different evidence.
2. Choose the smallest current check that could falsify it. A parser needs representative authored input and exact expected output; a layout needs a running view at relevant sizes; gameplay needs the requested player path. A build proves compilation, not scene parity or completion.
3. Run the check after the final relevant change. Read its output, exit status, and observed runtime behavior. Verify that it exercises the changed code or data, rather than a stale build or unrelated test.
4. Compare the observation with the source requirement. If it fails, say what failed and return to diagnosis. If a check cannot run, state why and narrow the completion claim accordingly.

## Proportionate evidence by scope

| Claim | Useful evidence | Not sufficient alone |
| --- | --- | --- |
| Local bug fixed | Original reproduction now passes; nearby regression checked | Code diff or Agent's assertion |
| Feature implemented | Focused test plus representative interaction or rendered state | Typecheck or build only |
| Authored Scene/UI consumed correctly | Real project document and resource render in the player with expected IDs, transforms, atlas frames, text, and layout | Editor screenshot alone |
| Game delivery ready | Build, core playable path, required content and target-device checks; unresolved failures listed | One successful task or one bot run |

Inspect delegated work and generated artifacts instead of accepting a subagent's “done” message as evidence. Separate project-code, authored-content, editor, preview, service, and environment failures. Report passed checks, failed checks, untested scope, and blockers in plain language. Publishing remains a distinct user action.

For detailed gameplay or performance measurement, use `game-playtest-performance`. This Skill is an Agent-side quality habit, not a BeeGameStudio phase or a demand to run the full test suite for every small edit.
