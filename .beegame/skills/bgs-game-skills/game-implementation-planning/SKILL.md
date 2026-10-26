---
name: game-implementation-planning
description: Write technical design and useful implementation guidance from agreed requirements and available design/content sources. 中文：技术设计、模块接口与实现任务规划。
---

# Game Implementation Planning

Plan multi-step implementation from relevant requirements/designs. A local fix can go directly to investigation and implementation; this Skill adds no delivery phase.

When BGS assigns the technical-design direction, finish the relevant reasoning and interfaces in the single GDD and hand off that bounded design task. Scene/UI assembly and gameplay implementation belong to the implementation assignment; a design task does not require a native Goal.

## Sources and scope

Establish the technical-design chapter in `docs/GDD.md` with confirmed constraints, module responsibilities and unresolved dependencies. For design work, record the current design question and its owning chapter in the ordinary task record, retaining the full requested outcome and unresolved dependencies. For a new game, choose the first coherent implementation unit from the confirmed brief and design intent: the player's judgment or action, the rule constraints or challenge, and the perceivable consequences. Define its resource-dependent interfaces from selected chapters and available resource facts in the same chapter; unavailable inputs remain planned, without invented paths/IDs/evidence. No early layout JSON or second design plan.

Derive outcomes from confirmed requirements and owning GDD chapters, selected pictures and actual content/code/tests when available. Indexes alone can omit work. Preserve the chosen engine/framework and content authority; do not duplicate layouts or invent another data layer. Do not add template filler or silently defer/drop/simplify confirmed outcomes.

Before relying on uncertain or version-sensitive engine, platform, API or format capabilities, reuse applicable project research or consult current public sources through the available web tools. Prefer official documentation for the selected version. Record the supported conclusion, source link and resulting technical decision in the technical-design chapter of `docs/GDD.md`; distinguish documented support from locally verified behavior. Search only unresolved or outdated facts, and stop once the decision is supported. If a needed source is unavailable, keep the affected assumption unresolved without inventing a citation or blocking unrelated work.

Resolve consequential rule/interface/resource conflicts in their owning GDD chapters before dependent work. Correct pictures contradicting requirements and reconcile affected UI/art/Scene sources and production choices within authorization. If authored data contradicts design, correct data; if runtime contradicts valid data, inspect consumption/rendering. Preserve unrelated work/IDs and identify decisions needing authorization. Geometry/binding PASS is not visual agreement.

## Useful implementation guidance

Keep architecture and shared interfaces in the technical-design chapter of `docs/GDD.md`—producer/consumer, names, inputs/outputs and consequential types/units—and reference them. For multi-step work likely to span a context reset or handoff, save tasks before their implementation in the existing project task file, or docs/TASKS.md if none exists. Keep this ordinary Markdown progress file separate from the GDD design chapters. A local fix needs no task file. No machine index, general event framework or function-by-function implementation is required.

Organize gameplay implementation around coherent player situations, carrying actions and consequences from the owning design into implementation and observation before reproducing uncertain treatments. For a visual/content slice, translate the selected design's key component forms, materials, relative proportions and information layout into the responsible resources, nodes or runtime drawing; complete one representative composition and its relevant states before extending the same treatment to similar screens or families. This orders work within the existing plan and does not add a phase or approval gate. Group coupled rules, input and presentation; fold scaffolding into consumers and order foundations by actual needed outputs. Derive expected results from the confirmed brief/design, independently of current implementation or tests. Module completion alone does not establish the player-visible behavior. Each task identifies its outcome, original source sections, needed inputs/files/interfaces, conditions/actions and expected check results. Keep unavailable inputs and remaining work explicit; reference numeric/appearance definitions rather than copy them. Foundations need not launch a complete game independently. When independent tasks can run concurrently, identify their disjoint write files and the settled interface they share in this same task record. Keep shared design, manifests/indexes, dependency configuration and application wiring with the integrating parent. Do not split unresolved coupled behavior across writers or replace whole-player-situation verification with module completion.

Plan focused rule/interface checks and the ordinary-input checks needed for affected controls, state transitions and technical feedback. Runtime views or recordings can verify concrete UI/Scene/resource behavior; seeded states and hooks isolate rules but do not verify the delivered input path. Reuse valid evidence across tasks. Broader experience judgments belong to user playtesting unless that investigation is explicitly requested. No build/browser/screenshot per task, separate approval stage or reduced implementation scope.

Check that guidance covers required outcomes and that dependencies provide the agreed interfaces and inputs. Describe relevant edge cases/results and unresolved or untested outcomes in the same plan; exclusions need authorization. Keep product rules, numeric values and appearance definitions in their owning GDD chapters rather than expanding technical guidance into additional design files.

## BGS handoff

ReadDesignHandoff locates current GDD chapters/sections. ReadImplementationTask returns optional existing task pointers and GDD section navigation; select relevant chapters with ReadDesignHandoff; native reads cover other sources/pictures. A plain GDD requires no machine index, output mapping or finalize.

Update affected guidance as actual inputs become available, preserving valid work/task IDs and explicit planned dependencies within current authorization. Keep delivered resource facts in the existing Manifest. Update the task record alongside meaningful work with actual results/evidence paths and remaining work; chat status alone is not the record. Verification applies to the input version actually checked; revalidate affected evidence after relevant changes. A Todo tick is not delivery.
