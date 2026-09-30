---
name: evidence-before-completion
description: Verify game design claims, calculations, assumptions and revisions against original requirements. Use for design review and completion evidence, not for planning the design. 中文：设计评审、原文核查、数值推导、布局复核、修订验证、验收证据。
---

# Evidence Before Completion

Use when assessing a design-review conclusion or claiming that a requested revision, fix or delivery is complete. This Skill checks the basis of a conclusion; it does not plan the project or define its design requirements.

## Evidence and scope

- Match the check to the claim and its source requirement. A build establishes compilation, not correct layout or playable behavior; file existence and a delegate's summary are not proof of their contents.
- Establish the source facts and modeled situation before calculating. For design claims, check that the proposed action or state is allowed by the rules, and that timing, units and spatial relationships follow their definitions. A calculation on an impossible situation is not a valid counterexample.
- Base a revision conclusion on the final source and affected behavior, including claims introduced by the correction; reuse unchanged evidence rather than repeating the whole review. For BGS UI/Scene geometry, use the project's supplied spatial calculator and the same shared space-allocation definitions instead of a second handwritten model.
- State only the supported scope. Distinguish observed results, assumptions, untested behavior and blockers; an unavailable check is not a pass or proof of a game defect.
- Keep the basis traceable through source sections, existing notes or test output. Report consequential findings and remaining gaps concisely, without imposing a separate report format.

Choose methods, tools and delegation proportional to the actual claim. Preserve the requested scope; this Skill does not require extra design decisions, target devices, audit agents or approval stages.

Document authoring does not require a separate self-review record or a dedicated checking subagent. Formal review/revision remains part of the project assignment; this Skill does not add another review pass or prescribe a separation of agents.

## Read only what applies

- For detailed playable-path or runtime-performance measurement, use `game-playtest-performance` if that work is part of the request.
