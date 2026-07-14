# BeeGame Document-First Game Production Design

## Goal

BeeGame must hand a confirmed game brief to Claude Code and receive a playable,
document-conformant project. Claude Code remains the only task state machine.
BeeGame supplies a production contract, native acceptance sub-agent, identity,
credits, workspace isolation, and deployment boundaries; it does not orchestrate
parallel planning or implementation phases in the Web UI.

## Root Cause

The current confirmed-brief prompt says to materialize project documents but does
not define the document set, minimum contents, consistency review, freeze point,
or implementation-plan artifact. A model can therefore write a short GDD,
technical note, and acceptance list, invoke `writing-plans` without saving a plan,
then begin a large implementation task. Build success is later mistaken for
playability.

## Native Production Sequence

Claude Code must complete this sequence in one native task:

1. Read the confirmed brief and any supplied documents or references.
2. Invoke applicable game design skills.
3. Create the production document bundle.
4. Cross-review the bundle for contradictions and unresolved decisions.
5. Create and validate `docs/delivery-contract.json` from normative statements.
6. Invoke the runtime `writing-plans` skill and save its detailed plan.
7. Read the saved plan back and implement it in small verifiable tasks.
8. Build, test, and validate project-native player paths.
9. Invoke the native `beegame-acceptance-validator` sub-agent.
10. Repair failed findings and revalidate until passed or materially blocked.

No BeeGame host-side phase machine is introduced. Tool calls, skills, sub-agents,
resume and compaction remain native Claude Code behavior. BeeGame does enforce two
project-business invariants at its existing Claude Code boundary: implementation
mutation cannot begin before the document/plan bundle is structurally ready, and
a confirmed production session cannot stop as successfully delivered before
independent acceptance evidence is complete. These are fail-closed contract gates,
not a parallel scheduler or an interpretation of model prose.

## Production Document Bundle

The canonical project documents are:

- `docs/specs/GDD.md`
  - product vision, player fantasy, audience, scope and non-goals;
  - first-minute experience and complete core loop;
  - rules, controls, state transitions, progression, win/loss and restart;
  - gameplay systems, content boundaries and balancing assumptions.
- `docs/specs/TECHNICAL_DESIGN.md`
  - target-neutral architecture and project-native technology choices;
  - module ownership, data flow, state lifecycle and persistence;
  - input, simulation, rendering, asset loading and error handling;
  - performance budgets, build/run/test commands and risks.
- `docs/specs/ART_DIRECTION.md`
  - visual pillars, composition, shape language, palette, lighting and camera;
  - characters, environment, props, VFX, animation and readability;
  - reference intent without silently importing copyrighted content.
- `docs/specs/UI_UX_SPEC.md`
  - player journeys, navigation, HUD, menus, feedback and interaction states;
  - input-device behavior, accessibility, responsive/spatial constraints;
  - loading, empty, failure, pause, completion and restart states.
- `docs/specs/AUDIO_DESIGN.md`
  - music, ambience, SFX, feedback priority, mixing and fallback behavior;
  - event-to-audio mapping and asset requirements.
- `docs/specs/LEVEL_CONTENT_DESIGN.md`
  - level/world structure, encounter flow, pacing, spawn/checkpoint logic;
  - spatial metrics and content list; if the game has no levels, document the
    equivalent screen/session/content progression rather than omitting the file.
- `docs/specs/ASSET_PLAN.md`
  - required asset families, purpose, style and format constraints;
  - ownership/source/license expectations, dependencies and fallback policy;
  - mapping to machine-readable slots in `assets/asset-manifest.json`.
- `docs/specs/ACCEPTANCE_CRITERIA.md`
  - observable acceptance criteria derived from the preceding documents;
  - full player paths covering entry, core action, state change, completion and
    recovery/restart;
  - build, test, runtime, asset and quality requirements without pre-checked pass
    states.
- `assets/asset-manifest.json`
  - platform-neutral resource requirements and actual bindings;
  - target capabilities come from the selected project configuration;
  - copied assets remain `uploaded` until code reference and runtime validation.
- `docs/delivery-contract.json`
  - machine-readable normative requirements, exact source references, evidence
    requirements, required skill capabilities and structured player paths.

A section may state `Not applicable` only with a project-specific rationale and
the substitute behavior or constraint. Empty placeholder documents are invalid.

## Consistency And Freeze Gate

Before planning, Claude Code must verify:

- GDD rules agree with technical state transitions and acceptance paths.
- UI, audio and art feedback cover every player-visible gameplay state.
- level/content design can execute the GDD core loop.
- every required asset has a manifest slot or an explicit procedural/manual
  strategy.
- every normative MVP statement maps into the delivery contract.
- every runtime MVP requirement belongs to at least one complete player path.
- target/runtime capability and file-format constraints do not come from asset
  names or a hardcoded platform.

The cross-review is performed by the read-only
`beegame-production-reviewer` native sub-agent in a fresh context. Its input is
canonicalized to the workspace and contract paths so builder-authored completion
claims cannot contaminate the review. Empty, truncated or non-JSON output is not
treated as a pass.

Once the implementation plan is written, source documents are frozen for that
implementation pass. A material contradiction is reported instead of silently
rewriting the requirement to fit existing code.

## Implementation Plan Contract

Claude Code must invoke `writing-plans` through the native Skill tool and save one
plan under `docs/superpowers/plans/` before implementation. If the skill is not
available, the task is blocked rather than pretending the capability ran.

The saved plan must:

- cite source requirement ids and document sections;
- use project-relative exact paths without assuming Web, Unity, Godot, UE, or any
  other platform;
- split work into cohesive tasks that can be implemented and verified in one
  bounded iteration;
- state expected behavior, implementation surface, asset dependencies, test or
  runtime proof, and completion condition for every task;
- establish the smallest playable vertical slice first;
- include integration, failure/recovery, packaging and full player-path checks;
- avoid vague tasks such as “implement the game” or “finish all gameplay”.

## Acceptance

- A confirmed brief prompt names the complete production sequence and canonical
  artifacts.
- The prompt requires native `writing-plans` invocation and a persisted plan.
- The prompt remains platform-neutral and contains no game-specific fixtures.
- Idea intake remains unchanged and does not create production artifacts.
- BeeGame does not add a second phase state machine or infer phases from model
  prose. Its only enforcement is based on structured turn metadata, canonical
  filesystem artifacts, native tool names and strict validator JSON.
- Existing delivery-contract and native acceptance-validator contracts remain the
  authoritative machine and evidence boundaries.
- The confirmed-build contract survives continuation and backend resume by
  recovering structured `confirmed_brief` events, not by matching transcript text.
- Implementation mutation is denied until every canonical document is non-empty,
  delivery and asset contracts pass schema audits, and exactly one persisted plan
  exists.
- Stop is denied until the latest actual native validator tool result is complete,
  passed, covers every MVP evidence requirement and declared player path, verifies
  required capabilities, and has a non-empty derived validation report.
