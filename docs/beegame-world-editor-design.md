# BeeGame World Editor design

## Status and purpose

This document defines the product and architectural direction for a BeeGame
World Editor. Its purpose is to let a person and Claude Code progressively
shape a playable game's world after the initial build, without reducing world
authoring to a one-time Agent output or turning BeeGame into a second game
engine.

The editor is a project workspace. It supports spatial 2D and 3D worlds,
grids, boards, graph-shaped progression spaces, and screen-based worlds using
one coherent interaction model. It does not require a genre name to choose a
tool and must not hard-code a game, project, Pack, engine, or runtime.

This design uses the resource and content contract:

- [Resource and content contract](beegame-resource-content-contract.md)
- [Resource Pack workspace design](superpowers/specs/2026-07-10-resource-pack-workspace-design.md)

## Product outcome

After a project exists, a user can:

1. Open its world alongside the existing preview and collaboration workspace.
2. Inspect the hierarchy, layers, objects, rules, and resource provenance that
   make up the current world.
3. Place, edit, group, lock, remove, and duplicate world content directly.
4. Bring curated Pack elements into the world as project resources referenced
   by JSON definitions and YAML scenes.
5. Ask Claude Code to create or revise a bounded part of the world, inspect the
   proposed change, and accept or reject it.
6. Preserve those edits across preview, build, deployment, project updates,
   Pack version changes, and target-runtime changes.

Claude Code remains the project author: it writes documents, source code,
native scene data, tests, and acceptance evidence. BeeGame presents and records
world edits; it does not claim a separate game-delivery state machine or decide
how a world must be assembled.

## Design principles

### Use engine concepts, not engine complexity

Traditional engines have enduring ideas that make worlds editable: scenes,
hierarchies, reusable authored objects, layers, inspectors, palettes, grids,
selection, undo, and data-driven rules. BeeGame adopts those ideas while
avoiding an all-purpose DCC or engine shell.

The first editor should not expose a universal material graph, shader editor,
animation graph, terrain sculptor, visual scripting language, or every native
engine setting. When a project needs those native capabilities, Claude Code or
the target-native toolchain owns them.

### One workspace, several world topologies

The editor chooses its canvas and tools from explicit world topology metadata,
not from title words or genre heuristics. A project may contain more than one
topology and may change over time.

| Topology | Canvas | Primary authoring units |
| --- | --- | --- |
| `spatial` | Orthographic 2D or perspective 3D viewport | areas, transforms, layers, volumes, entities |
| `grid` | Discrete cell canvas | cells, tiles, tile layers, occupancy, rules |
| `graph` | Node and edge canvas | nodes, links, regions, routes, states |
| `flow` | Screen and transition canvas | screens, components, transitions, state bindings |

The same project can use a spatial level for play, a grid for a tactical or
logic subsystem, a graph for progression, and a flow surface for UI. This is
not a platform distinction and is not a request to force all content into one
scene representation.

### A world is authored data plus native realization

BeeGame owns a portable, reviewable description of intent and traceability. The
project owns target-native realization. The portable document never pretends to
be a replacement for a target runtime's scene file, prefab, tile-layer asset,
level data, or source implementation.

```text
World design and user edits
        │
        ├── World manifest (portable intent, topology, provenance, locks)
        │
        └── Project-native recipe and files (Claude Code / target runtime)
                 │
                 └── Preview, build, test and native acceptance
```

The adapter that connects the two belongs to the project target. It may be a
scene serializer, a map compiler, a data loader, or a source-level adapter. No
universal transform, scale, coordinate convention, material setting, physics
setting, or rendering convention is inferred by BeeGame.

### Packs remain curated sources, not scene boundaries

A Pack records curation, provenance, license, visual evidence, and version. A
world can use several Packs when its author documents a coherent art direction.
BeeGame must never automatically mix Packs or score one element as the required
answer. Claude Code and the user may deliberately compose elements from several
compatible Packs, while the world records why that visual combination is coherent.

A logical resource root remains atomic for selection and import. Embedded mesh,
skin, skeleton, animation, material, atlas region, tile, or scene node is an
embedded component, not a separately selected asset slot. External dependency
closures continue to be copied exactly as defined in the resource contract.

### Human intent wins over automation

The user may lock a world, layer, object, property, or template. A locked
part is visible to Claude Code as a constraint. An Agent must not silently
modify, replace, delete, or normalize it. Agent-originated world changes are
reviewable changesets, never invisible mutations.

## Core world model

The following model is deliberately small. It describes authoring intent and
traceability; it does not prescribe a runtime scene graph.

```ts
type WorldDocument = {
  version: 1
  worlds: WorldDefinition[]
}

type WorldDefinition = {
  id: string
  name: string
  topology: 'spatial' | 'grid' | 'graph' | 'flow'
  dimension?: '2d' | '3d' | 'mixed'
  layers: WorldLayer[]
  objects: WorldObject[]
  templates: WorldTemplate[]
  locks: WorldLock[]
  native: NativeWorldRecipeReference[]
}
```

### Layers

Layers solve both editing clarity and runtime traceability. They are semantic
containers rather than an arbitrary collection of folders. A layer declares its
role and can contain other layers when a target requires it.

Core roles:

- `environment`: background, terrain, sky, lighting, ambience.
- `layout`: tiles, paths, rooms, zones, geometry, navigable areas.
- `gameplay`: collision, spawn points, triggers, goals, rules, navigation.
- `entities`: actors, props, interactables, collectibles, structures.
- `presentation`: effects, audio cues, camera anchors, overlays, UI anchors.

Projects can define additional roles with documented meaning. The editor must
not infer a role from a filename or a label.

### Objects and reusable definitions

`WorldObject` is an instance with stable identity, parent relationship, layer,
visible bounds, editable properties, and resource or template references.
Reusable templates are ordinary JSON definitions; scene hierarchy and placement
are ordinary YAML. Neither receives a second asset identity or an
engine-specific meaning.

An object references stable resource and template ids, not inferred file paths.
Resource provenance remains in the project Manifest, while scene YAML records
placement and hierarchy. This lets one imported resource be reused by many
objects without copying it again.

### Topology-specific data

The portable document permits topology-specific payloads, but each payload must
be explicitly typed and validated:

- spatial: transform, bounds, parent relation, optional volume or anchor facts;
- grid: cell coordinate system, layer occupancy, tile or cell descriptors;
- graph: stable nodes, edges, conditions, and layout-only coordinates;
- flow: stable screens, transitions, interaction bindings, and layout facts.

Runtime behavior remains in the project. For example, a cell definition does
not silently create movement rules, and a spatial volume does not silently
create collision or navigation behavior.

### Locks and changesets

Locks are declarative constraints:

```ts
type WorldLock = {
  target: { kind: 'world' | 'layer' | 'object' | 'property' | 'template'; id: string }
  mode: 'preserve' | 'require-review'
  createdBy: 'user' | 'project'
  reason?: string
}
```

A changeset records base revision, operations, resource imports required,
native files likely to change, validation scope, origin, and a human-readable
summary. It supports preview, review, undo, redo, and audit without requiring
BeeGame to understand a particular game engine.

## Workspace UX

### Entry point

The existing large project preview card becomes a compact mode switch:

```text
预览  |  世界
```

`预览` retains play, refresh, external-open, and deployment-adjacent behavior.
`世界` replaces only the preview canvas with the selected world topology's
editor. The existing collaboration, deliverable, and resource information
panels retain their current responsibility; world editing is not hidden in a
chat tab or moved to the administrator Resource Library.

The Resource Library additionally provides a contextual action, `添加到当前世界`,
when a project world is active. It is an import-and-place proposal, not a
silent direct write.

### Shared shell

Every topology uses the same calm workspace structure:

```text
Project header
└─ Main workspace
   ├─ Scene outline          selected world, layers and object hierarchy
   ├─ Primary canvas         spatial, grid, graph or flow surface
   ├─ Context inspector      only when an item is selected
   └─ Resource shelf         current Pack/available project resources/change proposals

Existing right project panel
└─ Collaboration, deliverables, resource evidence and review state
```

The primary canvas owns the largest area. The scene outline and inspector are
collapsible. The resource shelf is contextual and compact: it does not
become a second full asset browser. It shows project resources and Pack elements
the user intentionally opened, plus their provenance and compatibility facts.

### Spatial canvas

Spatial mode offers selection, pan, zoom, framing, transform handles, optional
grid/snapping, layer visibility, and target-provided navigation aids. The
viewport may be orthographic or perspective according to explicit world data.
Lighting, camera, collision, navigation and post-processing appear as authored
objects or layer properties only when the project supports them.

### Grid canvas

Grid mode offers cell selection, brush, fill, erase, stamp, rectangular
selection, grid settings, layer visibility, and rule inspection. A tile or
sprite asset is placed as a reference to an imported logical root plus an
explicit component descriptor; BeeGame never guesses slicing, collision, or
animation frames from a texture alone.

### Graph and flow canvases

Graph mode separates logical structure from visual layout. Node/edge edits must
show their consequence on the project's documented rules before application.
Flow mode edits screen relationships and safe layout metadata; complex native
widgets remain target-owned. Neither surface is a replacement for source code
or a visual-scripting engine.

### Inspector

The Inspector is selection-driven and uses progressive disclosure:

1. identity, layer, resource/template references, Pack provenance, and lock state;
2. topology-appropriate layout data;
3. target-supported project properties;
4. read-only runtime and validation evidence.

Destructive actions require explicit confirmation. The Inspector never makes a
resource appear integrated merely because a file was copied; integration state
requires the project-native recipe and runtime evidence.

### Agent collaboration

Agent calls from the editor are bounded by a user-selected scope such as the
current selection, layer, or world. A request describes intent, constraints,
available project resources, Pack evidence, and locks. Claude Code chooses
its own planning and native implementation strategy.

Before applying a proposal, the editor shows:

- affected world objects and layers;
- resources or templates to add, reuse, or remove;
- target-native files to be changed;
- lock conflicts and unresolved dependencies;
- preview and validation actions required afterwards.

The user can apply all, apply a subset, revise the prompt, or reject. BeeGame
does not manufacture an “Agent complete” state from this UI; Claude Code's
native result, project files, and validator evidence remain authoritative.

## Resource Library collaboration

World authoring must use the existing Resource Library as a fact source:

1. The user or Claude Code browses published Pack facts and element previews.
2. Claude Code selects logical roots deliberately and calls exact import.
3. The import service copies the root plus dependency closure, pins provenance,
   and returns project inventory.
4. JSON templates and YAML scenes reference those project resources.
5. A target-native adapter realizes the content descriptions in the world.
6. Preview and native validation establish that the runtime loaded and used it.

This works for complete authored assets and construction kits. A world may be
assembled from several selected elements, but that assembly belongs to the
project's content files, not to an automatic slot matcher.

The editor can surface catalog facts such as dimensions, bounds, embedded
components, dependency readiness, license, style evidence, Pack version, and
analysis state. It must not invent gameplay labels from filenames, material
names, node names, or arbitrary textual keywords.

## Agent and platform boundaries

### BeeGame responsibilities

- present the world workspace and collect direct user edits;
- persist portable world intent, changesets, locks, provenance, and undo data;
- expose Resource Library facts and exact import operations;
- request Claude Code work and display its native result;
- protect project ownership, permissions, and revision consistency.

### Claude Code responsibilities

- read or update approved project documents before substantive implementation;
- choose art direction, resources, and content structure using resource evidence;
- author or update project-native world files, source code, tests, and docs;
- use installed skills and native tools as appropriate;
- run or request target-native preview, build, test, and acceptance;
- report blocked conditions rather than pretending world changes are integrated.

### Explicit non-responsibilities for BeeGame

- no parallel build, review, repair, or acceptance state machine;
- no hidden resource choice, silent Pack mixing, or replacement selection;
- no engine-independent physics, navigation, animation, material, input, or
  rendering conversion;
- no arbitrary native-file rewrite outside an accepted changeset;
- no claim that copying an asset means the scene or game is playable.

## Documents, revisions and existing projects

World edits are product changes. When a user asks for a feature or world change
that affects approved requirements, behavior, art direction, player paths, or
acceptance criteria, Claude Code updates the relevant project documents first,
then changes native implementation, then validates the new revision.

Pure placement or property changes that remain inside an approved world design
may be recorded as a world changeset and reviewed against the current revision.
The editor must surface when an edit exceeds approved scope and requires a
document revision; it must not guess that every visual tweak requires a new
design phase.

Existing projects gain a world document through explicit discovery and review:

1. inspect target-native world artifacts and project documents;
2. produce a proposed portable world representation with evidence;
3. let the user review it;
4. retain source-native files as authority until a supported adapter is
   established;
5. mark unsupported regions as read-only or manually managed, never discard
   them.

## Delivery plan

### Phase 0 — Contract and safe read path

- Define and validate the portable world document, changeset, lock, and native
  recipe reference schemas.
- Add revision/provenance links to project resources and content files.
- Implement read-only world outline and evidence panels for existing projects.
- Add target adapter capability declarations; unsupported regions remain
  inspectable rather than being approximated.
- Build deterministic unit tests for document validation, lock enforcement,
  provenance, revision invalidation, and undo command serialization.

### Phase 1 — Direct authoring foundation

- Add the `预览 | 世界` workspace switch in the existing project canvas.
- Implement selection, scene outline, Inspector, collapsible panels, undo/redo,
  and changeset review.
- Implement one generic spatial viewport and one generic grid canvas; choose
  them solely from explicit topology data.
- Add controlled project import-and-place from Resource Library inventory.
- Persist direct user edits as commands and generate target-native operations
  only through a target adapter.

### Phase 2 — Reusable content and Agent proposals

- Add reusable JSON templates, YAML instances, Pack provenance, dependency readiness,
  and import reuse.
- Let Claude Code consume a bounded world request and return a reviewable
  changeset plus its native-file changes.
- Display target-native preview evidence and lock conflicts before apply.
- Add graph and flow canvases where target adapters declare support.

### Phase 3 — Validation and lifecycle

- Add world-aware static checks: dangling references, deleted imports, invalid
  parent relationships, invalid topology data, lock violations, and dependency
  closure failures.
- Require target-native preview/runtime evidence before representing world
  content as integrated.
- Support Pack version-impact inspection, resource-reference update proposals, and
  archival warnings without silent updates.
- Add multi-user edit conflict handling based on revision and command history.

## Acceptance criteria

The feature is ready for broad use only when all of the following are true:

1. A project can open an existing world in the workspace without changing its
   runtime behavior.
2. A user can make, undo, redo, and persist a direct edit with stable identity.
3. Locked content is never modified by an Agent proposal without explicit
   review.
4. A project can reuse one exact imported logical root in several world objects
   without duplicate copying.
5. Content referencing several imported roots preserves Pack/version/dependency
   provenance and target-native realization evidence.
6. Unsupported target-native content remains visible and safe; it is never
   silently converted or deleted.
7. A resource file is not called integrated until a target-native reference and
   runtime observation succeed.
8. A document-affecting world request updates documents, implementation, and
   validation in that order through Claude Code's native workflow.
9. The editor works for every declared topology without relying on a game title,
   a fixed genre list, filenames, or platform-specific logic.
10. Preview, build, deployment, and acceptance remain owned by the project and
    Claude Code; BeeGame only presents their evidence.

## Decisions intentionally deferred

- Which target adapters are first-class at launch.
- The exact on-disk location of target-native recipe references.
- Collaborative real-time conflict resolution protocol and offline support.
- Advanced native-tool integrations such as terrain sculpting, material graphs,
  animation state editors, and visual scripting.
- Automatic thumbnail/layout generation for every topology.

These decisions must be made from target capability evidence and user workflow
needs, not by adding platform-specific assumptions to the core document.
