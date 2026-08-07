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

Technical capabilities are inspector-owned. Usage tags are semantic policy owned
by the administrator, but the only searchable/matchable semantic fact is the
element's own confirmed tag set (`usageTagsMode: override`). Pack and folder
semantic defaults are removed; they cannot be created, inherited, or used as a
fallback. A temporary suggestion may show evidence in the curation workbench,
but it is never searchable and is cleared on confirmation or rejection. Batch
processing is only a transport unit: confirmation always carries one decision
per element and never applies one shared tag set to multiple elements.
Nothing is inferred from a filename, folder name, extension, title, keyword or
structured metadata alone.

## Operational rules

1. Catalog filters narrow explicit metadata only; they do not replace Pack inspection or Agent judgment.
2. A requirement without `coverage` describes one atomic candidate. A requirement with `coverage` describes independent obligations; its aggregate capabilities are not imposed on every file. The service solves those obligations into one deterministic candidate bundle.
3. Every selected library resource is resolved by exact Pack, version, and element identity and copied with its dependency closure. A multi-file requirement selects one service-returned bundle; Workflow never reconstructs a bundle.
4. A downloaded resource is an independent project resource. Requirement coverage is expressed by `fulfills` in project content files, not by mutating the library item.
5. When no suitable Catalog material exists, the Resource Agent authors an independent provisional resource and continues. A library gap is not a project blocker.
6. Provisional and final resources use the same Manifest resource record and the same JSON/YAML references. A later library match replaces a provisional resource in place; it never creates a second gameplay loading path.
7. The Manifest stores only final requirements and local resources. Candidate pages, rejected candidates, query history, and build attempts remain workflow events.
8. Scene layout, event order, entity mapping, UI mapping, and audio mapping belong to content JSON/YAML, never to filenames or a persisted assembly record.
9. Generated target files are disposable outputs. They do not receive a second semantic identity and cannot become an alternate source of truth.
10. Each fact has one owner. Old readers, fallback fields, shadow records, dual writes, and compatibility branches are prohibited during development.
11. Admin semantic curation is preview-first. Only resources for which the
    service can generate a bounded visual preview enter the semantic model
    request. A model or mesh is rendered from its canonical bytes; an image or
    texture is normalized to a preview image. Audio, documents, and other
    resources without a visual renderer remain unclassified and do not enter a
    structured-only semantic path.
12. One or two rendered previews are sent as individual multimodal image
    inputs. More than two rendered previews are normalized into one JPEG Atlas
    with an ordered cell-to-element map. These are encodings of the same
    `visualInput` contract, not separate semantic routes. The Atlas and
    previews are ephemeral and never become Resource Library records.
13. Every visual decision must contain a `content_preview` evidence item tied
    to its supplied image or Atlas cell. Category, kind, asset kind, technical
    facts, content profiles, and dependency facts may provide bounded context,
    but they cannot replace the rendered image. A decision without visual
    evidence is rejected before any tag or suggestion is persisted.
14. A render, visual-input, model, or Atlas failure leaves the item without a
    semantic result and requeues it through the existing durable job. No
    fallback classifier, feedback path, compatibility path, or second queue is
    created.
