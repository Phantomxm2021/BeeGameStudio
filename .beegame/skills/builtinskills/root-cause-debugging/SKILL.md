---
name: root-cause-debugging
description: Systematic debugging and root-cause diagnosis for bugs, failed checks, or performance issues. 中文：故障排查、根因定位、测试失败、性能问题。
---

# Root-Cause Debugging

Use for a failed test, broken feature, performance regression, or unexpected behavior. The purpose is to find where the result first diverges from the intended behavior before choosing a fix. Scale the investigation to the defect; do not turn a local bug request into a whole-project audit.

## 1. Establish the failure

- Capture exact symptoms, inputs, environment, and expected versus actual results. Read the full relevant error, stack, test output, transcript, or profiler evidence. Reproduce when feasible; if intermittent, record the conditions instead of pretending it is deterministic.
- Inspect the recent change or working example that could explain the difference. Do not assume that temporal proximity proves causation.
- In a multi-component path, follow the same input through each boundary. For a game this may be asset file → manifest → scene/UI document → loader → renderer → preview/browser. Find the first boundary where correct data becomes wrong. Log only facts needed to locate that boundary; do not expose credentials or scan unrelated host code.

## 2. Test one explanation

State a falsifiable hypothesis: “X causes Y because evidence Z; if true, check Q will differ.” Use the smallest useful comparison, trace, test, or measurement. If the result contradicts the hypothesis, update it. Do not stack speculative fixes or change valid authored content to hide an editor, service, or runtime defect.

If several attempts fail or fixes create new symptoms, revisit the architecture and ownership boundary rather than adding another retry, exception, or compatibility track. When external state or timing prevents a conclusion, report the missing evidence explicitly.

## 3. Fix and verify at the owner

- Change the source responsible for the failure, preserving unrelated behavior. Add a focused regression check where it can prevent recurrence; a visual or interaction defect may need a running-game observation instead of a unit test.
- Rerun the original reproduction and a proportionate neighboring check. For performance, compare before and after in the same build, device, viewport, and scene.
- Explain the verified cause, the change, the check result, and what remains uncertain. Do not call a symptom workaround a root-cause fix.

The Agent chooses investigation tools and depth. This Skill does not grant broader file or external-system authority than the user request.
