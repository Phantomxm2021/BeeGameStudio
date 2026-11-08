---
name: game-design-check
description: Review saved design for requirement omissions, source-backed rule contradictions or incomplete player flows within the assigned scope. 中文：受托设计审查，核对需求保留、规则相容与玩家流程闭合。
---

# Game Design Check

Review the saved design against the confirmed requirements and current assignment. The review resolves product decisions needed for the current handoff; implementation tuning and asset construction remain downstream work.

## Review questions

- **Requirements:** Does the design preserve the user's required scope and constraints, distinguishing author suggestions and provisional choices from requirements?
- **Rule compatibility:** Do source clauses governing the same situation permit incompatible actions, states or outcomes? Read their conditions, exceptions and numerical meanings together before concluding that they conflict.
- **Player-flow closure:** Can the player enter play, perform the required action, receive its outcome and reach the applicable continuation, recovery or ending? Report a missing design decision only when the required flow cannot be determined from the saved sources.

For a concrete uncertainty, use the relevant [targeted design questions](references/document-checks.md). Read related clauses together and reuse guidance already in context.

## Findings and repair

Report each issue once with source locations, the missing or conflicting decision and its concrete player or handoff consequence. Equally valid preferences and downstream implementation choices are not design defects. Preserve real contradictions even when they do not block artwork production.

Read-only review does not edit. For authorized repair, correct the affected definitions and verify the finding's source clauses and consumers, preserving unrelated confirmed decisions and unresolved findings. Use the current task's finding and repair contract.

