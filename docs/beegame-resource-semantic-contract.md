# Resource semantic contract

BeeGame separates library facts, project requirements, local resource files, and project-authored content descriptions. No filename, keyword, regular expression, slot, or persisted assembly object may decide game meaning.

| Layer | Purpose | Authority |
| --- | --- | --- |
| Pack metadata | Shared style, license, provenance and discovery facts | Authored Pack metadata |
| Element metadata | Objective delivery form and inspected technical facts | Element metadata and deterministic inspection |
| Project requirement | Observable material or content responsibility | Approved project documents |
| Project resource | Exact local file root selected or authored for the project | Manifest provenance and local files |
| Content JSON/YAML | How semantic IDs, resources, scenes and events are used | Project-authored content files |
| Target output | Disposable files generated for a runtime | Target adapter and build evidence |

The authoritative storage contract is [BeeGame resource and content contract](./beegame-resource-content-contract.md).

## Canonical usage vocabulary

`character`, `npc`, `creature`, `weapon-equipment`, `prop`, `vehicle`,
`building`, `environment`, `terrain`, `vegetation`, `scene`, `level-map`,
`tile`, `ui`, `icon`, `effect`, `combat`, `interaction`, `narrative`,
`music`, `sound-effect`, `ambient-audio`, `voice`.

The Resource Pack inspector is the authority for assigning these capabilities. They must not be inferred from a filename, folder, extension, title, or model-generated guess.

## Operational rules

1. Catalog filters narrow explicit metadata only; they do not replace Pack inspection or Agent judgment.
2. Every selected library resource is resolved by exact Pack, version, and element identity and copied with its dependency closure.
3. A downloaded resource is an independent project resource. Requirement coverage is expressed by `fulfills` in project content files, not by mutating the library item.
4. When no suitable Catalog material exists, the Resource Agent authors an independent provisional resource and continues. A library gap is not a project blocker.
5. Provisional and final resources use the same Manifest resource record and the same JSON/YAML references. Replacement must not create a second gameplay loading path.
6. The Manifest stores only final requirements and local resources. Candidate pages, rejected candidates, query history, and build attempts remain workflow events.
7. Scene layout, event order, entity mapping, UI mapping, and audio mapping belong to content JSON/YAML, never to filenames or a persisted assembly record.
8. Generated target files are disposable outputs. They do not receive a second semantic identity and cannot become an alternate source of truth.
9. Each fact has one owner. Old readers, fallback fields, shadow records, dual writes, and compatibility branches are prohibited during development.
