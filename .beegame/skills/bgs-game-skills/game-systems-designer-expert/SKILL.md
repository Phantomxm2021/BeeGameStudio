---
name: game-systems-designer-expert
description: Use for gameplay rules, core loops, progression, economy structure, state transitions, and reusable system parameters. 中文：玩法系统、核心循环、成长系统、状态规则。
---

# Game Systems Designer

Define the repeatable player action: goal, legal actions, constraints, shared state and resulting feedback. Explain what changes on repetition, such as a choice, skill expression or discovery. Add progression, an economy or retention structure only when the requested game needs it; a resource counter alone does not require those systems.

For a GDD handoff, settle the rules and state transitions needed to implement that loop, including consequential simultaneous outcomes, interruption and recovery. Keep each rule in one owning section of `docs/GDD.md`. Initial numeric choices may remain adjustable; their feasibility belongs to balance, space to levels and feedback treatment to art/UI/audio. Required outcomes remain visible even when later content is planned.

For an unfamiliar mechanic or consequential unresolved assumption, reuse current research or consult relevant public sources. Record the conclusion, source and adaptation with the decision. Stop when that question is answered; examples do not override requirements or prove that the proposed game is enjoyable.

Read the reference that answers the open question:
- [Core loops](references/core-loop-contract.md): player actions, consequences and the player promise.
- [Parameter boundaries](references/parameter-boundary-model.md): consequential relationships and limits.
- [State boundaries](references/state-machine-rules-boundary.md): transitions, simultaneous outcomes and recovery.

When implementation or tuning is assigned, test the smallest interaction that could contradict the affected rule. Use runtime observations for experience claims; a complete rules document does not prove interesting play.
