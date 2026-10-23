---
name: game-implementation-planning
description: Write technical design and useful implementation guidance from agreed requirements and available design/content sources. 中文：技术设计、模块接口与实现任务规划。
---

# Game Implementation Planning

Plan multi-step implementation from relevant requirements/designs. A local fix can go directly to investigation and implementation; this Skill adds no delivery phase.

## Sources and scope

Establish TECHNICAL_DESIGN.md among the eight design records with confirmed constraints, module responsibilities and unresolved dependencies. For a new game, choose the first coherent implementation unit from the confirmed brief and design intent: the player's judgment or action, the rule constraints or challenge, and the perceivable consequences. Resolve its resource-dependent interfaces from selected designs and actual resources in the same document before affected implementation; unrelated inputs may remain planned, without invented paths/IDs/evidence. No early layout JSON or second plan.

Derive outcomes from confirmed requirements and owning professional records, selected pictures and actual content/code/tests when available. Indexes alone can omit work. Preserve the chosen engine/framework and content authority; do not duplicate layouts or invent another data layer. Do not add template filler or silently defer/drop/simplify confirmed outcomes.

Resolve consequential rule/interface/resource conflicts in their owning sources before dependent work. Correct pictures contradicting requirements and reconcile affected UI/art/Scene records and production choices within authorization. If authored data contradicts design, correct data; if runtime contradicts valid data, inspect consumption/rendering. Preserve unrelated work/IDs and identify decisions needing authorization. Geometry/binding PASS is not visual agreement.

## Useful implementation guidance

Keep guidance in TECHNICAL_DESIGN.md. Define shared interfaces once—producer/consumer, names, inputs/outputs and consequential types/units—and reference them. No machine index, general event framework or function-by-function implementation is required.

Organize gameplay implementation around coherent player situations, carrying actions and consequences from the owning design into implementation and observation before reproducing uncertain treatments. Group coupled rules, input and presentation; fold scaffolding into consumers and order foundations by actual needed outputs. Derive expected results from the confirmed brief/design, independently of current implementation or tests. Module completion alone does not establish the player-visible behavior. Use explicit tasks only when useful: outcome, owning sources/files/interfaces, required behavior, conditions/actions and expected check results, and dependencies. Mark unavailable inputs as planned; reference numeric/appearance definitions rather than copy them. Names alone do not define tasks, and foundations need not launch a complete game independently.

Plan focused rule/interface checks and the ordinary-input checks needed for affected controls, state transitions and technical feedback. Runtime views or recordings can verify concrete UI/Scene/resource behavior; seeded states and hooks isolate rules but do not verify the delivered input path. Reuse valid evidence across tasks. Broader experience judgments belong to user playtesting unless that investigation is explicitly requested. No build/browser/screenshot per task, separate approval stage or reduced implementation scope.

Check that guidance covers required outcomes and that dependencies provide the agreed interfaces and inputs. Describe relevant edge cases/results and unresolved or untested outcomes in the same plan; exclusions need authorization. Keep product rules, numeric values and appearance definitions in their owning records rather than expanding technical guidance into another set of design documents.

## BGS handoff

ReadDesignHandoff locates current documents/sections. ReadImplementationTask returns an existing index when present, otherwise technical source; native reads cover other sources/pictures. Plain documents require no machine index, output mapping or finalize.

Update affected guidance from actual inputs before dependent implementation, preserving valid work/task IDs and explicit planned dependencies within current authorization. Keep delivered resource facts in the existing Manifest and concise progress/result paths in the conversation or existing task list. Verification applies to the input version actually checked; revalidate affected evidence after relevant changes. A Todo tick is not delivery.
