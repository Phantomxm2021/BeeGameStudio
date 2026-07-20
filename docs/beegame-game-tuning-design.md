# BeeGame Game Configuration and Tuning design

## Purpose

This document defines a product and architectural direction for configurable
game values in BeeGame. It prevents gameplay rules, balance values, content
pools, and player-facing options from being scattered as untraceable literals
through generated source code, while avoiding a generic raw-JSON editor or a
second runtime owned by BeeGame.

The desired outcome is simple:

1. Claude Code can turn approved game documents into an explicit, typed default
   configuration.
2. A user can understand and safely adjust supported values from the project
   workspace.
3. Project code and target-native assets consume the current configuration.
4. Preview, tests, build, and native acceptance can use the same revision when
   the user explicitly asks for those actions.
5. Any change has an owner, rationale, scope, validation evidence, and undo
   path.

This is platform-neutral. It applies to any target capable of loading project
configuration; it does not prescribe one runtime format, serialization library,
engine setting, or gameplay architecture.

Related design documents:

- [World Editor design](beegame-world-editor-design.md)
- [Logical asset and composition contract](beegame-resource-composition-contract.md)
- [Native game delivery architecture](beegame-native-game-delivery-architecture.md)

## Problem and boundary

Games need values that are deliberately editable: progression, pacing,
durations, costs, probabilities, limits, content availability, presentation
options, and accessibility options. Putting those values directly in source
code makes ordinary iteration require a code edit, hides the design decision,
and makes it difficult to compare or validate revisions.

Not every literal is a tuning value. Algorithm constants, protocol identifiers,
file-format versions, security limits, rendering internals, and target-native
implementation details are not automatically exposed as game configuration.

The configuration system therefore has a strict boundary:

- **Documents** define player-facing intent, scope, requirements, and
  acceptance criteria.
- **Game configuration** holds reviewed, typed parameters that implement that
  intent.
- **World data** holds spatial, grid, graph, or flow composition and references
  configuration by stable id when required.
- **Project-native code and assets** implement behavior and load the current
  configuration.
- **BeeGame** presents edits, constraints, history, and evidence. It does not
  execute or reinterpret gameplay rules.
- **Claude Code** authors project code, native configuration adapters, tests,
  documentation updates, and validation evidence.

## Design principles

### Typed schemas, not arbitrary JSON

The editable configuration surface is generated from a declared schema. Every
field has a stable id, display name, value type, default, constraints, scope,
description, and an explicit native mapping. Unknown keys are rejected. The UI
does not expose a free-form editor as its primary experience.

### Separate values from behavior

Code may contain the rule "apply the configured cooldown", but should not hide
the game-specific cooldown value in the implementation. A configuration field
must never masquerade as a complete behavior implementation: changing a number
does not create new state transitions, physics systems, navigation behavior, or
rendering features that the project does not implement.

### Schema follows the approved design

A schema must be traceable to an approved document responsibility or an
explicitly documented implementation need. This prevents a large list of
unexplained sliders and protects the product from meaningless "tune anything"
controls.

When a requested change alters requirements, player paths, content scope, or
acceptance conditions, Claude Code updates the relevant documents before it
updates implementation and validation. A normal tuning edit that remains inside
approved constraints can create a configuration revision without reopening the
entire design process.

### Constraints make tuning safe

Every editable field declares appropriate validation:

- numeric units, minimum, maximum, step, and optional soft recommendation;
- enum and multi-select choices from an explicit source;
- probability normalization and distribution rules where applicable;
- list size and uniqueness constraints;
- resource/composition reference compatibility and availability;
- conditional visibility or validity rules expressed as schema facts rather
  than guessed from labels.

Constraints are validation, not gameplay intelligence. A valid configuration
does not by itself prove that a game is balanced or playable.

### Revisions are explicit and reversible

The configuration is versioned separately from transient UI state. A change
records base revision, field operations, author, optional rationale, and
validation status. The user can compare revisions, undo an accepted change, and
restore a reviewed baseline. A project never silently changes values because a
Pack was updated or an Agent proposal changed.

### Agent proposals require review

Claude Code may inspect the approved design and project evidence, then propose
a bounded configuration changeset. It must state affected fields, predicted
intent, tests or preview actions, and any scope conflict. BeeGame presents that
proposal; it does not manufacture balancing decisions, silently apply an Agent
suggestion, or claim a tuned revision passed acceptance without native evidence.

### Saving, applying, and validating are different actions

A normal tuning edit is a direct data edit, not an Agent task. Once local
schema validation passes, BeeGame writes the mapped project configuration data
atomically and records a new configuration revision. Depending on the declared
target capability, the user may then apply that revision to the running preview
through hot reload, explicit reload, or the next preview launch.

Validation is deliberately separate. Saving a value does not run Claude Code,
build the project, run tests, or invoke acceptance. The UI labels these states
independently:

- `已保存`: the project configuration data and revision record were written.
- `已应用到预览`: the active preview loaded this revision.
- `已验证`: explicit project-native preview, test, build, or acceptance evidence
  exists for this revision.
- `需要验证`: a relevant edit made earlier evidence stale; editing and preview
  remain available.

Claude Code participates only when a change needs new schema or native loading
code, exceeds the approved document scope, or the user explicitly asks for
implementation, validation, or a tuning proposal.

## Configuration domains

Domains classify authoring intent. They are not fixed game genres and a project
may define additional reviewed domains.

| Domain | Typical purpose | Appropriate controls |
| --- | --- | --- |
| `core_rules` | player state, timing, limits, outcome conditions | scalar fields, enums, toggles |
| `progression` | stages, pacing, unlock rules, difficulty curves | ordered rows, curves, bounded formulas |
| `economy` | costs, rewards, rates, inventories | tables, currencies, bounded values |
| `content_pools` | eligible content, weighted selection, references | resource/composition picker, weighted lists |
| `encounters` | authored groups, waves, event timing, spawn budgets | lists, timelines, references, constraints |
| `presentation` | camera, feedback, animation timing, audio mix | presets, scalar fields, toggles |
| `accessibility` | input, readability, motion, audio, display options | user-safe toggles, ranges, presets |
| `runtime_options` | documented project startup or environment options | explicit enum/boolean/scalar fields |

Resource choices do not become filenames in a value field. A content-pool entry
uses the exact project import or composition id, including pinned Pack/version
provenance. It can only be selected when the referenced item is available and
compatible with the project-native adapter.

## Portable configuration contract

The portable contract represents authoring intent and revision history. The
target project owns the runtime serialization and loading strategy.

```ts
type GameConfigDocument = {
  version: 1
  schema: GameConfigSchema
  revision: ConfigRevision
  values: Record<string, ConfigValue>
}

type GameConfigSchema = {
  id: string
  sections: ConfigSection[]
  nativeMappings: NativeConfigMapping[]
}

type ConfigField = {
  id: string
  sectionId: string
  type: 'number' | 'integer' | 'boolean' | 'enum' | 'string' |
        'curve' | 'table' | 'weighted_list' | 'resource_reference' |
        'composition_reference'
  default: ConfigValue
  constraints?: ConfigConstraint[]
  unit?: string
  description: string
  designReferences: string[]
  editPolicy: 'direct' | 'requires_review' | 'read_only'
}

type NativeConfigMapping = {
  fieldId: string
  target: string
  representation: string
}
```

`target` and `representation` are declared by the project adapter. They must
not be interpreted as a universal path convention. A native mapping may point
to a generated configuration file, a data asset, a resource table, a source
adapter, or another target-supported representation.

### Reference integrity

Configuration fields that reference assets use project inventory facts:

```text
config field → project import or composition → Pack/element/version → copied dependency closure
```

The system must distinguish:

- available inventory: copied or otherwise available to the project;
- referenced configuration: selected by a current config revision;
- native integration: loaded or referenced by target-native implementation;
- runtime observation: confirmed through preview or acceptance.

No configuration panel may claim that a referenced item is working merely
because it appears in a dropdown.

## Project workspace UX

### Entry point

Add `配置` as a project workspace mode beside `预览` and `世界` in the existing
large left workspace. This preserves the current project dashboard's
composition: preview remains the play surface, world remains the composition
surface, configuration becomes the rules and tuning surface. Collaboration,
deliverables, and resource evidence remain in their existing project panels.

```text
Project workspace
└─ 预览 | 世界 | 配置
```

The mode switch is not an administrator setting and does not belong inside the
global Resource Library.

### Layout

The configuration workspace uses progressive disclosure rather than a large
settings form:

```text
Left:    category tree and revision filter
Center:  typed editor for selected section
Right:   field inspector, constraints, provenance, change impact and evidence
Top:     current revision, compare, undo/redo, preview test
Bottom:  optional proposal/review strip when an Agent changeset is pending
```

The center surface changes by field type:

- scalar values render precise inputs with unit, range, step, and reset;
- enums and booleans render compact, accessible controls;
- tables provide explicit columns, row identity, validation, and sorting;
- curves provide editable control points plus a tabular alternative;
- weighted lists show normalization and reference validity;
- resource/composition references open the project inventory first and then
  contextual Resource Library browsing with exact provenance.

The UI must not hide invalid values. It identifies the exact field, constraint,
source revision, downstream native mapping, and available remediation.

### Direct edit flow

1. The user selects a section and changes one or more fields.
2. The editor validates local type and schema constraints immediately.
3. The user sees a concise diff and affected native mappings.
4. The user saves a new configuration revision; BeeGame writes the mapped
   project configuration data directly through the declared target adapter.
5. The user can apply it to the active preview immediately when hot reload is
   supported, or explicitly reload/start preview when it is not.
6. Preview/test/build/acceptance evidence updates only when the user requests
   that action; a failed action never overwrites the prior known-good revision.

Saving configuration is never a build, test, acceptance, or Claude Code command.
It creates a traceable project-data revision. The user may independently apply
it to preview or request native validation afterwards.

### Agent proposal flow

1. The user scopes a request to selected fields, a section, or an approved
   change request.
2. BeeGame gives Claude Code the schema, current values, design references,
   world context, project evidence, imports/compositions, and locks.
3. Claude Code returns normal project changes plus a configuration changeset.
4. BeeGame renders the changeset as a diff, including validation and scope
   impact.
5. The user accepts all, accepts selected edits, asks for revision, or rejects.
6. Accepted edits are saved as ordinary configuration revisions; the user may
   apply them to preview or explicitly request tests, build, or acceptance.

The UI must never turn a natural-language response into an unchecked direct
configuration write.

## World Editor relationship

World and configuration are related but separate:

- World data controls where content exists and how it is organized.
- Configuration controls values and references that influence behavior,
  progression, availability, and presentation.
- World objects may reference stable configuration field ids.
- A configuration field may reference a world object, composition, import, or
  collection only through declared typed relations.

This avoids two failure modes: using the World Editor to conceal global game
rules in object properties, and using the configuration panel as an improvised
scene editor.

## Claude Code and BeeGame boundaries

### BeeGame responsibilities

- store schema-backed values, revisions, locks, direct user edits, and diffs;
- present constraints, provenance, mapping facts, evidence, and change impact;
- directly write schema-valid project configuration data through declared target
  adapters, and hot-apply/reload the current preview when the target declares
  that capability;
- protect project ownership and permissions;
- expose exact project resource inventory and composition facts;
- request and display Claude Code work without driving its task lifecycle.

### Claude Code responsibilities

- derive configuration schema/defaults from approved project documents;
- author target-native loading, mappings, validation, documentation and tests;
- update documents when a proposed config change changes approved scope;
- make balancing and implementation reasoning explicit in project artifacts;
- run target-native preview/build/test/acceptance only when implementation or
  explicit user validation requires it, and report evidence.

### BeeGame non-responsibilities

- no hidden difficulty scoring, automatic balancing, or replacement selection;
- no platform-specific runtime loader in the shared configuration core;
- no automatic repair loop or synthetic acceptance status;
- no direct mutation of native project code merely because a slider changed;
- no inference of field meaning from filenames, comments, title words, or
  arbitrary labels.

## Validation and lifecycle

### Schema validation

Schema validation verifies ids, types, defaults, constraints, references,
cycles, unit declarations, mapping declarations, and section membership.

### Revision validation

Revision validation verifies changed values against the schema, reference
availability, lock policy, and document revision compatibility. It produces a
structured result and never silently coerces a value.

### Explicit native validation

Native validation belongs to the target project. It verifies that the mapped
representation loads, that the runtime applies the intended revision, and that
relevant player-facing behavior remains valid. Native evidence is linked to the
configuration revision and becomes stale when relevant values, mappings,
requirements, imports, or compositions change. Stale evidence is an information
state, not a lock on direct configuration editing or preview application.

### Migration

Existing projects can add configuration incrementally:

1. Claude Code identifies intentional project values through documents and
   implementation review.
2. It proposes a schema and native mapping rather than automatically extracting
   every numeric literal.
3. The user reviews the proposed editable surface.
4. The project introduces target-native config loading and tests.
5. Only then are approved values removed from direct source literals.

This prevents a mechanical migration from exposing algorithmic or unsafe
implementation constants as game controls.

## Delivery plan

### Phase 0 — Contract and evidence

- Define portable schema, revision, changeset, constraint, and mapping models.
- Add validation for type, ranges, references, locks, and revision staleness.
- Add a read-only configuration evidence panel for projects that already have
  supported configuration files.
- Define project adapter capability declarations without binding the core to a
  target platform.

### Phase 1 — Direct user tuning

- Add `配置` mode to the existing project workspace.
- Implement section tree, scalar/enum/boolean editors, diff, direct project
  data save, undo/redo, revision comparison, and explicit apply-to-preview plus
  preview-test actions.
- Add project inventory-based composition/resource reference fields.
- Implement target-native adapters for declared supported project types.

### Phase 2 — Structured advanced data

- Add tables, curves, weighted lists, conditional constraints, and clear
  validation messages.
- Link configuration fields to world objects and compositions through typed
  references.
- Add native validation evidence to revision history.

### Phase 3 — Agent collaboration and governance

- Add bounded Claude Code configuration proposal changesets and review UI.
- Add document-scope detection and reviewer evidence links.
- Add multi-user revision conflicts, audit records, export/import, and
  project-version impact analysis.

## Acceptance criteria

The configuration feature is ready for broad use only when:

1. A user can edit a declared game value without editing source code directly.
2. Every editable value has stable identity, type, constraints, description,
   provenance, and native mapping.
3. Unsupported or unsafe implementation constants never appear as arbitrary
   tuning controls.
4. Resource/composition references remain exact, pinned, and validated against
   project inventory.
5. Undo restores an earlier configuration revision without corrupting native
   project files.
6. A failed preview or validation does not replace the last known-good
   configuration revision, and saving never implicitly starts either action.
7. Locks prevent unauthorized Agent-originated changes.
8. Changes that alter approved requirements or player paths require document
   revision before implementation and acceptance.
9. The same portable contract can map to different supported project targets
   without hard-coding a platform in the shared core.
10. BeeGame presents evidence only; Claude Code and the project remain the
    authority for gameplay implementation and acceptance.

## Decisions intentionally deferred

- The first set of project-native configuration adapters.
- Whether advanced curves and tables are stored directly or as referenced
  target-native data assets for each adapter.
- Live hot-reload guarantees and multiplayer synchronization behavior.
- Team-level permissions for section or field ownership.
- Automated balancing experiments and analytics, which require separate
  consent, safety, and product decisions.
