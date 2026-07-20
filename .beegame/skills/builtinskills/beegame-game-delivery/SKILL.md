---
name: beegame-game-delivery
description: Use for creating or materially changing a game project from a confirmed BeeGame brief so documentation, native review, resource exploration, implementation, independent audit, runtime validation, and delivery remain consistent.
---

# Native Game Delivery

Use this Skill for a confirmed new-game build or for a change that affects a
game's intended behavior, presentation, resources, architecture, or acceptance
expectations.

BeeGame is the dashboard shell. You own the plan, tools, Skills, subagents,
implementation, verification, repair decisions, and truthful final result. Do
not wait for BeeGame to advance a phase, and do not treat a UI status as proof.

## Confirmed Requirements

Before planning, read the confirmed brief and preserve these as separate
requirements:

- document language;
- player-visible game language;
- response language;
- target/runtime constraints;
- Resource Library usage policy: `optional`, `preferred`, or `required`.

Use the selected response language for all user-facing progress and final
messages. Keep machine identifiers, commands, APIs, package names, and paths
unchanged where translation would make them invalid.

## New Project Dependency Order

For an empty or newly scaffolded workspace:

1. Establish the project-specific documentation baseline before authored game
   implementation. At minimum maintain:
   - `docs/GDD.md`
   - `docs/ART_DIRECTION.md`
   - `docs/UI_UX_SPEC.md`
   - `docs/AUDIO_DESIGN.md`
   - `docs/TECHNICAL_DESIGN.md`
   - `docs/ASSET_PLAN.md`
   - `docs/acceptance/gameplay-checklist.md`
   - `assets/asset-manifest.json`
2. Give requirements and player paths stable IDs. Each acceptance item must
   define an action, observable expected result, and required evidence.
3. Inspect the read-only `ProjectDeliveryContract` capability and pass its
   current deterministic diagnostics to the native
   `beegame-document-reviewer` in a fresh context. Handle
   every material finding. Do not use the documents as the implementation
   baseline until the current document revision is `READY`.
4. Apply the confirmed Resource Library policy and establish the art/resource
   plan before implementing presentation that depends on it.
5. Implement the playable project using the relevant native Skills and
   specialist subagents. Keep documents, resource contract, code, and tests
   current as the design changes.
6. Invoke the independent native `beegame-implementation-auditor`. Repair
   structural, traceability, test, and resource-integration findings.
7. Invoke the independent native `beegame-acceptance-validator` for the current
   workspace revision. It must observe the applicable player paths in the
   target runtime, not merely compile or inspect source.
8. If review, audit, or validation fails, repair the project and rerun the
   affected independent check. Any material project change makes older evidence
   stale.

For one workspace revision, do not launch a second Reviewer, Auditor, or
Validator while the same native Agent type is still active. Let Claude Code's
native lifecycle produce that Agent's terminal result; do not use a replacement
Agent to manufacture an earlier terminal result.

Keep independent calls neutral. Provide the confirmed brief, selected
languages, current document paths, current revision and deterministic contract
diagnostics. Do not prime an independent Agent with statements such as a fix is
already correct, all tests pass, or a finding must not be reported.

Scaffolding that is mechanically required to host documentation is allowed,
but do not begin authored gameplay implementation before the documentation
baseline is reviewed and `READY`.

If the project-native scaffolder requires an empty destination, establish only
the minimal toolchain shell before the documentation baseline or scaffold into
a temporary location and transfer that shell. Do not repeatedly rerun an
incompatible generator in the documented project root, and do not treat
toolchain scaffolding as authored gameplay implementation.

## Existing Project Changes

Read current documents, implementation, tests, and asset contract first.

- If the request changes intended behavior or presentation, update the affected
  documents and acceptance expectations, obtain a current document review, and
  then implement.
- If the documents are correct and the implementation is defective, keep the
  product contract stable, repair the implementation, and collect new audit and
  runtime evidence.
- For an audit-only request, do not modify the project.

## Resource Library

Treat resource exploration as an Agent capability, not slot filling performed
by BeeGame.

- `optional`: resources may be used when they improve the result.
- `preferred`: explore suitable published Packs before authoring substitutes;
  if no library resource is adopted, report the observed reason. A prose claim
  that the library was explored is not evidence; invoke the native
  ResourceLibrary catalog capability.
- `required`: the delivered runtime must genuinely integrate compatible
  Resource Library assets or validation cannot pass.

Work Pack-first. Select a primary Pack that fits the approved art direction,
then explore its logical assets and modular families. Cross-Pack use is allowed
only when style, scale, technical compatibility, and licensing remain coherent.
Import dependency closure, preserve authored family relationships, and compose
the selected elements in the target runtime. A copied file is only available;
it is not integrated until the shipped game references it and its contribution
is observable in preview/runtime evidence.

Do not assume a game engine, asset format, scene representation, package
manager, or test framework. Discover them from the confirmed brief, project,
enabled capabilities, and selected resources.

## Completion

Do not claim completion until the current revision has all three native terminal
results:

- Document Reviewer: `READY`;
- Implementation Auditor: `passed`;
- Acceptance Validator: `passed`.

Inspect `ProjectDeliveryContract` again before the final claim. A native Agent
summary cannot override a failed deterministic contract diagnostic. Runtime,
Skill and Resource Library evidence must come from native tool calls that were
actually observed in the applicable Agent/session, not from labels written into
a report.

Preview the player-facing result when the target supports it. Deployment remains
subject to the user's request and BeeGame's platform authorization and evidence
gate. A build, file list, copied resource, summary, or UI status alone is never
delivery proof.
