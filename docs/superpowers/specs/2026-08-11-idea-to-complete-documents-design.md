# Idea to Complete Game Documents Design

## Goal

Turn one confirmed game idea into the complete existing BeeGame Foundation document set. Every emitted document must contain the production information normally owned by a human game-development discipline and must be usable by downstream implementation without waiting for a reviewer to invent missing design authority.

## Scope

The production path remains one linear flow:

`confirmed idea -> sequential document authors -> eight committed Foundation documents`

This change does not add workflow stages, reviewer behavior, platform-specific rules, sample-game branches, or keyword classification. It keeps the existing canonical paths and assigns complete human-team responsibilities to them:

| Document | Complete responsibility |
| --- | --- |
| `GDD.md` | product vision, audience, experience pillars, complete player loop, mechanics, rules, states, progression, content scope, failure/recovery, narrative boundary, accessibility, success metrics and design risks |
| `LEVEL_SCENE_DESIGN.md` | world/scene topology, level sequence, pacing, objectives, routes, encounters, spawn/checkpoint rules, camera constraints, scene states, replay and content-production requirements |
| `BALANCE_DESIGN.md` | variables and units, formulas, sources/sinks, progression curves, challenge model, entity parameters, rewards/costs, bounds, tuning method and anti-exploit constraints |
| `TECHNICAL_DESIGN.md` | architecture, runtime state, data ownership, save/load, content loading, input boundary, performance budgets, networking applicability, security/privacy, diagnostics, build/release and failure recovery |
| `ART_DIRECTION.md` | visual pillars, composition/readability, characters, environments, animation, VFX, lighting, camera relationship, palette/material rules, accessibility, asset constraints and acceptance bar |
| `UI_UX_SPEC.md` | information architecture, player journeys, screen/state inventory, HUD, input/interaction, feedback/error/recovery, onboarding, accessibility, localization and usability acceptance |
| `AUDIO_DESIGN.md` | audio pillars, event taxonomy, SFX, music states, ambience, UI cues, voice applicability, mix/bus rules, dynamic behavior, accessibility, asset/recording requirements and technical budgets |
| `ASSET_PLAN.md` | complete asset/content BOM, stable IDs, ownership, dependencies, source/licensing, formats, budgets, production milestones, validation status, replacement strategy and delivery acceptance |

## Document contract

Initial document authoring uses a structured submission instead of an unconstrained Markdown body. Each document contract declares an ordered set of stable section IDs. Every submitted section contains:

- a human-readable title and substantive body;
- explicit authoritative decisions;
- production details usable by downstream disciplines;
- stable references to upstream documents when required;
- risks and unresolved decisions, represented explicitly rather than omitted.

The service validates the exact section set and order, rejects empty or duplicate sections, rejects references outside the projected upstream authority, and renders the Markdown itself. Existing repair and checklist commits retain their current body-based contract.

## Production flow

1. `/api/projects/bootstrap` freezes the confirmed idea and starts the delivery workflow as it does today.
2. The workflow dispatches the eight canonical documents in dependency order.
3. Each initial author receives the confirmed brief, complete document contract and already committed upstream documents.
4. The author submits one structured complete document.
5. The service validates and renders it, then commits it atomically with canonical metadata.
6. The workflow advances only after the committed file satisfies its document contract.
7. After the eighth document, the workspace contains the full Foundation set. Reviewer stages are outside this change and are not relied upon for document completeness.

## Acceptance

- No game idea or genre is hardcoded in production logic or fixtures.
- All eight files are created from one confirmed idea run.
- Every file contains every contract section in canonical order with decisions and production details.
- No document delegates missing content to a later reviewer.
- Empty, partial, duplicate, out-of-order or unauthorized-reference submissions fail before file mutation.
- The existing readiness audit passes on the generated set.
- Existing repair, checklist, recovery and atomic commit behavior remains compatible.

