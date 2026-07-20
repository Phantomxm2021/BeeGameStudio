# BeeGame logical asset and composition contract

## Purpose

The Resource Library stores reusable logical asset roots and objective compatibility metadata. A root may be one self-contained file or a root file plus its required file dependency closure. Contents embedded inside that root are subresources, not independently selected Pack elements.

This boundary is engine-neutral. The generated project remains responsible for runtime behavior, import settings, scene assembly, animation graphs, physics, input, and native acceptance.

## Resource layers

1. **Pack** — a curated collection sharing style, license, game-type fit, and versioning policy.
2. **Resource element** — one independently deliverable logical asset root, such as a GLB character, a glTF scene with external buffers and textures, an animation library, a sprite atlas, a font, or an audio bank.
3. **File dependency closure** — required external files referenced by the root. `dependencyBindings` preserve their authored relative paths during project integration.
4. **Embedded subresources** — inspected meshes, skins, skeletons, animation clips, materials, textures, morph targets, atlas regions, or scene nodes. They remain inside the root element and may be addressed by project code without separate matching or copying.
5. **External semantic relations** — optional relationships between independently deliverable elements, such as an animation library targeting a compatible skeleton or a separately authored collider belonging to a model.
6. **Project requirement** — a game/art responsibility to satisfy. It may be fulfilled by several imports, one composition, or project-authored procedural/embedded work.
7. **Project import** — one explicitly selected logical root copied into the project inventory with fixed Pack/version provenance. Imports are independent of requirements and may be reused.
8. **Project composition** — a game-facing unit. `direct` loads one complete import; `composed` assembles any number of imports, nested compositions, and project-authored responsibilities through a target-native recipe.

## Metadata axes

Metadata must not mix technical delivery type with game subject matter:

- `assetKind` describes the delivery type: model, scene, animation library, texture, audio, font, and similar objective forms.
- `usageTags` describe intended game roles: character, weapon, prop, environment, UI, combat, ambience, and similar roles.
- `capabilities` describe facts that apply to the root as a whole: skinned, rigged, contains animations, modular, navigation, or spatial audio.
- `contentProfile.components` records facts about individual embedded subresources. Clip-level duration, roles, root motion, loop behavior, or skeleton signature belong here rather than in root capabilities.
- `technicalFacts` records primitive, inspected source-file evidence such as pixel dimensions, geometry counts, bounds, and the presence of normals or texture coordinates. These facts survive catalog resolution and project import as `technical_facts`; they are evidence for the target-native importer, not engine settings.
- `relations` describe only external element-to-element meaning.

Inspection facts and authored semantics have different provenance. Automated inspection may record component types, counts, duration, hierarchy signatures, and file references. Administrator-authored roles may classify a discovered clip or component, but must never be inferred from its name.

## Pack authoring automation

Automation is intentionally split by confidence rather than by file type:

1. Upload and background processors may persist deterministic technical facts, including format, dimensions, geometry bounds and counts, normal/texture-coordinate presence, embedded components, hashes, and authored external references.
2. Pack and folder defaults provide reviewed semantic metadata to their descendants. An element may inherit, explicitly override, or opt out of those defaults.
3. A future model-assisted classifier may create reviewable suggestions, but suggestions must retain evidence and provenance and must never overwrite accepted metadata or make an unpublished Pack selectable.

The processor must not derive gameplay meaning from filenames, directory words, model node names, material names, or animation clip names. This keeps authoring portable across languages and prevents a probabilistic label from becoming a hard selection constraint.

Complex model parsers run outside the resource API process with a file-size limit, deadline, sanitized environment, and structured output validation. A failed parser produces a retryable processing-item error; it does not roll back the uploaded source file or invent fallback metadata.

## Agentic discovery and choice

BeeGame does not select the first candidate, decide scene contents, or assemble project code. The native Resource Library tool exposes three read-only catalog views to Claude Code: paginated Pack browsing with facets, Pack-scoped element browsing with exact structured filters, and published Pack inspection. None of these views requires a project requirement or role identifier. Claude Code derives a shared art-direction baseline from the approved documents, may select material from any number of Packs that can fit that baseline, and authors the game-facing composition. BeeGame never mixes Packs automatically.

Pack boundaries preserve curation, provenance, licensing and authored style metadata; they are not scene-isolation rules. Cross-Pack composition is valid when Claude Code documents how dimension, rendering style, shape language, material treatment, palette, scale and theme remain coherent. Exact taxonomy-label equality is neither necessary nor sufficient. A decoration Pack may enrich a scene but cannot be represented as full coverage while required ground, path, structure, character, effect, UI or audio responsibilities remain unresolved.

Publication/readiness, explicit target formats, required root capabilities, required embedded subresources, dependency readiness, and explicit external compatibility are technical constraints. Category, usage tags, style, and game type are catalog evidence that Claude Code may use while reasoning; BeeGame does not convert them into a score or choose an element. Missing or incomplete semantic metadata must be reported as such and must not be rewritten into a false “library is empty” conclusion.

The project can use either a complete logical root or a modular construction kit. A modular Pack is useful when it covers several roles even if it contains no complete level. Claude Code may choose ground, path, structures, props, characters, effects, UI, and audio, then implement their layout and behavior in the target runtime.

Missing skeleton compatibility is not retargetability: an independent animation remains unresolved until a verified signature/profile or explicit relation establishes compatibility. Animations embedded in one character root are not separately selected.

Claude Code may browse, import, author and observe iteratively whenever the current task requires it. An import call is an exact copy request, not an asset-plan checkpoint: each selection has its own stable import id and target-appropriate project-relative destination and is never forced into a requirement slot. The resource service resolves signed URLs, copies the exact selected roots and dependency closures, pins Pack versions, and returns project inventory. It never chooses replacements on failure or dictates how many import batches the creative process may need.

## Non-prescriptive capability flow

These are capability boundaries, not a BeeGame-owned state machine or mandatory invocation order:

- Approved documents may describe visual, audio and interaction responsibilities without pretending that a library element has already been chosen.
- Catalog calls expose paginated Pack and element facts without mutating the project, binding an element to a requirement, or choosing a result.
- Claude Code may choose any number of logical roots and may revisit discovery after observing the target runtime. One responsibility may need many imports, and one import may support several parts of the authored game.
- `import_elements` copies only roots explicitly chosen by Claude Code and their exact dependency closures. It records immutable provenance and copied-file facts atomically; Claude Code should not hand-author or repeatedly rewrite those inventory records.
- Claude Code authors target-native files: scene/prefab/node/blueprint data, source code, atlas or animation configuration, tile layers, UI layout, audio cues, physics and gameplay wiring.
- Project-facing traceability is descriptive, not a scene authoring language and not a completion mechanism. The target runtime, native art Skill and native Validator observe the result; ResourceLibrary cannot certify integration.

If an existing project imported elements before a Pack's latest deterministic analysis, Claude Code may call `refresh_import_metadata`. The operation resolves only the exact pinned Pack version and element identities already recorded in the project. It updates objective catalog facts while preserving local files, status, usage evidence, compositions and target-native code; it does not reselect, redownload or rebuild the scene.

The lifecycle is deliberately monotonic:

- import: `available` → `referenced`, or `failed`;
- composition: `planned` → `assembled` → `integrated`, or `failed`;
- requirement: `planned` → `satisfied`, or `blocked`.

An `available` import is only inventory. It cannot satisfy a requirement until target-project usage is evidenced. An assembled composition cannot satisfy a requirement until its target-native integration is evidenced.

## Domain examples

| Domain | Direct logical asset | Composed alternative |
|---|---|---|
| 2D animation | sprite sheet or atlas with internal regions/frames | independent atlas, timing data, effects, and audio |
| 3D character | FBX/GLB containing mesh, skin, skeleton, materials, and clips | character root plus external animation library, collider, equipment, voice, or VFX |
| Scene / map | authored scene containing hierarchy and supported markers | modular environment kit plus layout, collision, navigation, lighting, ambience, and gameplay markers |
| UI | complete UI document/screen | components, icons, atlas, fonts, audio, and project layout recipe |
| Audio | audio bank/cue with internal variants | independent clips assembled by a project cue or playlist |

For 2D, a texture by itself is not silently treated as a sheet, atlas, tileset, or UI document. Those technical identities come from reviewed metadata or an inspected descriptor. Atlas regions, sprite frames, tiles, and tile layers are embedded components of the logical root; Claude Code chooses their runtime slicing, timing, draw order, collision, and placement in the target project.

For 3D, a skinned FBX/GLB that already contains its mesh, skin, skeleton, materials, textures, and clips remains one logical root. External animation libraries are independent only when the files are independently deliverable and compatibility is proven by inspected signatures or explicit relations. BeeGame must not split an embedded character file merely to fill separate conceptual responsibilities.

Physics and input behavior remain project/runtime responsibilities even when the library provides collider, physical-material, or input-profile data.

## Integration and acceptance

Copy the selected root and its complete dependency closure while preserving required relative paths. A copied file is not integrated until project runtime references resolve and load it.

Source-file facts must not be converted into a global runtime convention. Coordinate systems, UV orientation, material setup, units, pivots and animation import rules vary by source format and target toolchain. Claude Code uses the recorded facts with the project's native importer or adapter; when required evidence is absent it inspects that resource once in the target toolchain rather than guessing a universal scale or texture transform.

A `direct` composition contains exactly one import. A `composed` composition may reference many imports, requirements, or nested compositions and requires a project-owned target-native recipe once assembled or integrated. The manifest records traceability, not an engine-independent scene graph: transforms, animation graphs, physics, tile layers, atlas slicing and gameplay markers remain in the target project's native files. Native acceptance must observe the resulting game-facing behavior in either mode.

## Compatibility

Existing Packs without typed metadata remain readable and manual-only for constraints they cannot prove. Version 4 and earlier project slots migrate one-way into requirements plus independent imports; new writes do not create slot-bound Resource Library bindings. Existing composition records without `assembly_mode` retain the earlier `composed` meaning. Administrators can classify and inspect elements incrementally without splitting embedded contents into new elements.

## Audit invariants

- Public project manifests and Dashboard APIs use only `requirements`, `imports`, and `compositions`; `slots` is confined to the pre-v5 reader and audit path.
- Exploration returns alternatives and evidence. It never selects the first candidate, edits project files, or invents semantic metadata from names.
- Import resolution is exact by Pack and element ID, version-pinned, dependency-complete, path-safe, and format-safe.
- Valid authored parent-directory references are preserved, but neither Pack resolution nor project copying may escape its root.
- A copied file is never represented as runtime integration.
- ResourceLibrary reports catalog, provenance, copied-file and dependency facts only. It has no integration-verification or completion action; visibility, framing, visual coherence, audio playback, interaction and current-revision runtime acceptance require native observation.
- Existing import metadata may be refreshed only from the exact pinned provenance. Metadata refresh never changes project-authored files or claims that the rendered result improved.
- Reviewer evidence becomes stale when requirement, import provenance, or composition design changes. Runtime-only status/evidence updates do not rewrite the reviewed design revision.
- Validator acceptance requires project references and runtime evidence; BeeGame does not author, repair, or operate the generated scene on Claude Code's behalf.
