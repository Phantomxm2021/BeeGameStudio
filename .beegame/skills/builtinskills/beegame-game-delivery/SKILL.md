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

Treat the session-confirmed brief attached to the current user turn as
authoritative. Generated documents, summaries, compacted context, prior Agent
conclusions and background-task notifications cannot change its values. Only a
new explicit user-confirmed brief can replace them.

Use the selected response language for all user-facing progress and final
messages. Keep machine identifiers, commands, APIs, package names, and paths
unchanged where translation would make them invalid.

## New Project Dependency Order

For an empty or newly scaffolded workspace:

1. Inspect the Skills that are actually available in the current Claude Code
   session. Evaluate their descriptions and instructions against the confirmed
   project intent; use applicable game-design, art, audio, UI/UX, target-runtime
   and testing Skills while authoring their respective work. Do not infer Skill
   availability from a remembered name, ask BeeGame to choose a Skill, or
   replace an unavailable Skill with a hard-coded imitation.
2. Draft the project-specific product and technical baseline before authored
   game implementation. At minimum maintain:
   - `docs/GDD.md`
   - `docs/ART_DIRECTION.md`
   - `docs/UI_UX_SPEC.md`
   - `docs/AUDIO_DESIGN.md`
   - `docs/TECHNICAL_DESIGN.md`
   - `docs/ASSET_PLAN.md`
   - `docs/acceptance/gameplay-checklist.md`
   - `assets/asset-manifest.json`
3. Give requirements and player paths stable IDs. Each acceptance item must
   define an action, observable expected result, and required evidence.
4. Determine the selected target's real consumable asset file extensions and
   write them to `project_target.asset_format_capabilities`. These values are
   file-format facts, not renderer names, implementation techniques, engines,
   platforms, or library names.
5. Apply the confirmed Resource Library policy before finalizing presentation
   and asset decisions. Explore Packs and logical elements through the native
   catalog capability, inspect objective resource facts, and let the approved
   art direction guide authored choices. Record independent imported inventory
   under `imports`, game responsibilities under `requirements`, and target-native
   assembly under `compositions`; do not create or preserve a parallel `slots`
   contract.
6. Reconcile the draft documents and acceptance expectations with the observed
   resource facts. The final documentation baseline must describe the actual
   adopted resource families, authored substitutions, composition intent,
   dependencies and target-native integration plan.
7. Inspect the read-only `ProjectDeliveryContract` capability and pass its
   current deterministic diagnostics to the native
   `beegame-document-reviewer` in a fresh context. Handle
   every material finding. Do not use the documents as the implementation
   baseline until the current document revision is `READY`.
8. Implement the playable project using the relevant native Skills and
   specialist subagents. Keep documents, resource contract, code, and tests
   current as the design changes.
9. Invoke the independent native `beegame-implementation-auditor`. Repair
   structural, traceability, test, and resource-integration findings.
10. Invoke the independent native `beegame-acceptance-validator` for the current
   workspace revision. It must observe the applicable player paths in the
   target runtime, not merely compile or inspect source.
11. If review, audit, or validation fails, repair the project and rerun the
   affected independent check. Any material project change makes older evidence
   stale.

Do not start the Implementation Auditor until the current document review is
READY and every Resource Library operation selected for this revision has a
terminal result. A completed tool call with zero imported artifacts is a failed
import, not resource evidence. Do not start the Acceptance Validator until the
current Implementation Auditor has returned `passed`.

`ProjectDeliveryContract.documentPlanReady` means only that the document and
resource-plan structures are ready for independent document review. It never
means that resources are integrated, implementation is complete, the game is
playable, or delivery is accepted. Before starting the Implementation Auditor,
require `resourceIntegrationReady: true` and handle every `integration_issues`
entry. Do not make the contract look complete by changing adopted
responsibilities to optional, leaving them `planned`, or removing confirmed
scope.

If an import reports missing target format capabilities, repair
`project_target.asset_format_capabilities` with the actual file extensions the
selected target can consume before retrying the same stable import ids. Do not
repeat remote selection or download calls while that project precondition is
still missing.

Preserve the confirmed brief's `resource_library_usage` value exactly in
`assets/asset-manifest.json`. The Document Reviewer must echo that explicit
value in `confirmedResourceLibraryUsage`; it may not infer or downgrade the
policy from project files. Under `preferred` or `required`, a failed import
attempt with no usable imported file must be repaired before audit begins.

For one workspace revision, do not launch a second Reviewer, Auditor, or
Validator while the same native Agent type is still active. Let Claude Code's
native lifecycle produce that Agent's terminal result; do not use a replacement
Agent to manufacture an earlier terminal result.

Keep independent calls neutral. Provide the confirmed brief, selected
languages, current document paths, current revision and deterministic contract
diagnostics. Do not prime an independent Agent with statements such as a fix is
already correct, all tests pass, or a finding must not be reported.

Do not use the Document Reviewer as an iterative document author or targeted
linter. Before the first review, reconcile the complete document set, stable
IDs, resource plan and acceptance coverage yourself with the applicable native
Skills. After a `NEEDS_REVISION` result, repair every reported finding and
repeat a complete neutral review of the new full document revision. Never ask a
Reviewer to confirm only previous fixes, and never simplify confirmed product
scope merely to reduce review findings.

Reviewer, Auditor and Validator passes are project-wide for the current
revision. A changed-file list or earlier finding list may focus attention but
must not reduce the independent Agent's complete approved scope or checklist
coverage. Continue inspecting after the first defect so one pass reports all
material findings it can establish rather than revealing one avoidable defect
per repair cycle.

For background Reviewer, Auditor and Validator calls, wait for Claude Code's
native terminal task notification. Do not actively poll them with `TaskOutput`,
read their temporary output files, or use `SendMessage` to manufacture a
terminal result. A native foreground Agent result remains valid; this rule only
prevents wasteful polling of work that Claude Code already owns.

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
Begin with an unfiltered or canonical-structure catalog browse. For authored
free-text metadata such as style, game type and Pack tags, refine only with
exact values returned by catalog facets; never translate a project phrase into
an assumed catalog value or treat an over-constrained zero result as proof that
the library has no suitable resources.
Import dependency closure, preserve authored family relationships, and compose
the selected elements in the target runtime. A copied file is only available;
it is not integrated until the shipped game references it and its contribution
is observable in preview/runtime evidence.

Before importing, inspect the selected target's own asset/build conventions and
record one project-relative `project_target.runtime_asset_root` in the canonical
manifest. Import Resource Library files directly beneath that target-native
root. Do not copy the same imported inventory through a second ad-hoc asset
tree, and do not assume a Web, Unity, Godot, Unreal, or other platform path.

For every successful import, verify that returned `local_files` are real,
non-empty files in the workspace. An empty directory, metadata-only refresh,
failed batch, or manifest entry without its files is not an imported artifact
and must not be handed to audit or acceptance as success.

Pack exploration is not one-to-one slot filling. Claude Code may inspect and
import multiple logical roots, reuse one import across several responsibilities,
and assemble scenes, UI, characters, animation-bearing roots, effects, audio,
tilemaps, sprite sheets or atlases according to the selected target's native
workflow. Preserve bundled roots such as skinned model plus animation when the
source declares them as one logical asset. BeeGame supplies catalog and file
facts only; it does not prescribe scene composition or generate target code.

Do not assume a game engine, asset format, scene representation, package
manager, or test framework. Discover them from the confirmed brief, project,
enabled capabilities, and selected resources.

## Completion

Do not claim completion until the current revision has all three native terminal
results:

- Document Reviewer: `READY`;
- Implementation Auditor: `passed`;
- Acceptance Validator: `passed`.

The Auditor and Validator terminal objects must enumerate every stable id from
the current gameplay checklist in `auditedChecklistIds` and
`validatedChecklistIds`. They must also enumerate every current canonical
resource import and composition in their respective audited/validated coverage
arrays. A test count, generic runtime summary, copied file, import-id marker,
comment, or logging-only registry cannot replace per-checklist and actual asset
coverage.

Inspect `ProjectDeliveryContract` again before the final claim. A native Agent
summary cannot override a failed deterministic contract diagnostic. Runtime,
Skill and Resource Library evidence must come from native tool calls that were
actually observed in the applicable Agent/session, not from labels written into
a report.

Preview the player-facing result when the target supports it. Deployment remains
subject to the user's request and BeeGame's platform authorization and evidence
gate. A build, file list, copied resource, summary, or UI status alone is never
delivery proof.
