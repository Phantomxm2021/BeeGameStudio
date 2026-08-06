# Resource Library Curation and Inventory Root Fix Design

## Goal

Make Resource Library material easy to curate once and reuse repeatedly, then make Resource Production acquire suitable library material before authoring replaceable placeholders. The design must finish from durable progress after interruption and avoid unbounded catalog turns without adding token, time, tool-call, or attempt limits.

## Authority and invariants

- Approved project documents own semantic resource duties and runtime output constraints.
- A library element is source material. Its source extension is not a runtime-output admission rule.
- A target adapter deterministically converts imported source material when the runtime cannot consume it directly. Generated output stays under `assets/generated/**`, retains the source resource identity, and is disposable.
- One canonical inventory ledger owns acquisition progress. Prompt history, query transcripts, candidate pages, and a second manifest are not state.
- A placeholder is a normal independently replaceable resource. It is authored only after the catalog service returns a bounded no-match decision for the requirement group.
- Workflow matching has exactly two outcomes: `matched` and `no-match`. Catalog curation quality is an administration concern and can never become a third Workflow terminal state.
- Pack publication makes a collection visible. Selection eligibility belongs to each root element and its exact dependency closure; one invalid unrelated element must never exclude an otherwise valid Pack.
- Technical facts are inspector-owned. Semantic labels are administrator-confirmed. A model suggestion is temporary curation input, is never searchable, and is deleted when accepted or rejected.
- The only effective semantic label is the confirmed element value or its confirmed folder/Pack inheritance. There is no second tag index or legacy metadata fallback.
- Capabilities used as hard constraints must be objectively inspected or explicitly confirmed. A group-level composition objective is never misrepresented as a capability of one file.
- A semantic or technical mutation invalidates only the affected element and elements whose required dependency closure contains it.
- No token, wall-clock, tool-call, or automatic-attempt business limit may terminate Resource Production.
- A stopped worker session must make the durable dispatch interrupted and actionable; it must never remain projected as running.

## Root defects being removed

1. `asset_format_capabilities` is currently interpreted by the worker as a source-format whitelist even though architecture assigns source conversion to target adapters.
2. Resource Library exposes only low-level pack pagination. Sparse element metadata forces the worker to scan pages repeatedly while carrying an expanding conversation.
3. Placeholder creation has no service-proven catalog exhaustion precondition, so the worker can author placeholders and continue browsing.
4. `resourceProductionState` persists only a final receipt. Accepted selections, inspected catalog revisions, no-match decisions, and remaining requirements are volatile until terminal completion.
5. A stopped worker session can leave `activeDispatch.status=running`, causing the Workflow card to remain in preparation.
6. The retired catalog-curation match result exposed Resource Library curation debt as a third Workflow outcome. The Curator could neither select it nor create a placeholder for it, so a complete decision set and durable receipt were impossible.
7. Match observations are keyed only by Manifest plan revision. After matching policy changes, Retry can adopt a stale observation and reproduce the retired result without contacting Resource Library.
8. Current matching re-evaluates whole-Pack publish readiness. One unrelated invalid element therefore removes every usable element in that Pack from Workflow matching.
9. Current acquisition profiles require every capability on one candidate element. Set-level needs such as model plus material plus textures, multiple tower variants, or an audio variant collection are incorrectly reduced to impossible single-file predicates.
10. Technical inspection, semantic suggestion, inheritance and confirmation are not presented as one curation queue. Administrators repeatedly revisit individual files and published Packs may remain semantically incomplete.

## Design

### 1. Separate source compatibility from target delivery

`project_target.asset_format_capabilities` continues to describe formats consumable by the selected runtime. It no longer filters source candidates.

Resource Library candidate facts include a deterministic delivery disposition:

- `direct`: source can be copied to the canonical runtime resource path;
- `convert`: one registered target adapter can produce a runtime-compatible output;
- `unsupported`: no registered adapter can deliver the source for this target.

Only `direct` and `convert` candidates are selectable. Importing a `convert` candidate copies exact source material and dependency closure, then the adapter atomically writes generated output. The Manifest keeps one resource record with source provenance and generated delivery files; it does not create a second semantic resource.

The first implementation supports the source forms already demonstrated by the current Resource Library and target: FBX/GLB/GLTF model material and OGG/WAV audio material. FBX may use the configured FBX→GLB adapter; OGG is direct-delivery only when the target declares OGG. This plan does not require an OGG→WAV converter. The adapter registry, not shared workflow logic, owns all capabilities.

### 2. Establish one canonical curation pipeline

Every uploaded root element moves through one pipeline:

1. storage finalization records the immutable object identity and content hash;
2. deterministic inspection records format, MIME type, dimensions, duration, embedded components, external references, dependency bindings and other source facts;
3. the inspector derives only objectively provable `assetKind` and capabilities;
4. the semantic suggestion service proposes controlled usage tags, style and relation roles from previews, inspected content and administrator-authored Pack context;
5. an administrator confirms, edits or rejects those proposals at Pack, folder or selected-element scope;
6. the repository derives effective metadata and element selection readiness.

Filename, path, project name, free-text keyword matching and regular expressions are never evidence for production metadata. Suggestions may use rendered image/model/audio previews and structured inspected facts. A suggestion contains controlled proposed values, confidence and concise evidence, but it cannot participate in search or matching. Approval writes the one canonical field and removes the suggestion. Rejection also removes it and may set `manual-only`; proposals never become a parallel metadata source.

Technical facts and semantic policy remain distinct:

- `assetKind`, content hash, format, dependency bindings and inspected capabilities are technical facts;
- `usageTags`, style and optional semantic relation roles are confirmed semantic facts;
- Pack and folder defaults may own confirmed `usageTags` and style policy;
- an element may inherit, explicitly override, or opt out with `manual-only`;
- effective metadata is calculated through the single element → closest folder → Pack precedence already used by the repository.

The searchable taxonomy has four non-overlapping dimensions:

- `assetKind`: what the root technically is, such as model, material, texture, sprite, audio clip or data;
- `usageTags`: reusable game-facing roles from the current controlled vocabulary, such as character, building, terrain, icon, combat, music or sound effect;
- `capabilities`: verified source-intrinsic technical properties, such as rigged, tileable, nine-slice, loop points or embedded animations;
- `styles`: administrator-confirmed presentation descriptors inherited from Pack/folder policy and used for ranking unless explicitly mandatory.

Pack marketing tags and game-type labels remain administration browsing aids. They are not hard element predicates and cannot substitute for `usageTags`. Free-form labels never enter Workflow matching. The taxonomy has one current version; changing a controlled value performs one atomic canonical data rewrite and index rebuild, never aliases an old and new value at read time.

Unchanged content hashes reuse deterministic inspection facts. New elements inherit confirmed folder/Pack policy immediately. A Pack update inspects and queues only new or changed elements. Identical binary content may reuse technical inspection facts, but semantic meaning remains governed by the current Pack/folder/element policy.

The administration UI exposes one **Needs curation** workbench rather than requiring repeated Pack browsing. It groups elements by missing semantic labels, unresolved dependencies, incomplete inspection, failed preview and low-confidence suggestions. Administrators can preview evidence and confirm or edit proposals for a Pack, folder or selection. Each operation shows its affected-element count. Publication reports selectable and isolated element counts and links directly to blocking items.

### 3. Make selection readiness element-scoped

Pack `published` status means its eligible contents are visible to consumers. It does not assert that every contained element is selectable. A root element is selection-ready only when:

- the Pack is published and its license/version authority is valid;
- the root and every required dependency are `ready`, have immutable hashes and resolve to canonical storage objects;
- technical asset kind and delivery disposition are deterministic;
- external references are mapped by the exact dependency closure;
- effective confirmed usage tags are non-empty;
- every hard capability used for matching has verified provenance.

The service computes readiness for one root plus its dependency closure. An invalid leaf isolates that closure; an unrelated invalid element has no effect. Pack-level publication checks retain only Pack authority and collection-wide invariants such as license, version, duplicate logical paths and the existence of at least one selectable root. Element issues remain visible to administrators but never become a third Workflow match status.

Changing an element, dependency binding, inherited semantic policy or relevant adapter revision invalidates only affected readiness projections. Catalog revision and element readiness revision make this invalidation deterministic.

### 4. Add one bounded requirement-aware catalog operation

Every Manifest requirement group contains one canonical `acquisition_profile` authored during `RESOURCE_PLAN`. The profile separates:

- root hard constraints: accepted dimensions, asset kinds and source-intrinsic required capabilities;
- semantic preferences: confirmed usage tags and approved style values;
- set coverage: required kinds, relation roles, variants or embedded components that may be satisfied by several elements.

Composition, placement, scaling, connection, scene assembly and runtime behavior remain content/implementation duties. They cannot become source-intrinsic capabilities. The service never derives profiles from requirement IDs, names, purposes, project names, filenames or free text. Foundation Review verifies that each profile represents the approved semantic duty before Resource Production begins.

Replace agent-driven whole-pack pagination with `match_requirements` as the inventory worker's discovery operation. Its request identifies unresolved canonical requirement groups and target adapter capabilities; the service reads their acquisition profiles from the Manifest. It does not accept free-text search, regular expressions, project names, or filename predicates.

The Resource Library service evaluates confirmed semantic metadata, inspected element facts, element-scoped readiness, target delivery disposition and style/dimension constraints. It first produces eligible roots, then deterministically forms bounded candidate bundles whose union covers the requirement's set obligations. A bundle may contain one self-contained element or several related roots/dependencies. It returns a bounded result per requirement group plus a catalog revision. Each candidate bundle contains exact Pack/version/element identities, technical facts, dependency closure, delivery disposition, covered obligations and remaining gaps.

Low-level catalog browsing and direct import are not Resource Curator capabilities. Resource Library administration retains its separate management UI, while Workflow has one candidate-acquisition lane.

Workflow sees only selection-ready roots and complete selectable bundles. A complete bundle appears as `matched`; otherwise the group is `no-match`. Missing metadata is never interpreted as a match and is never returned to the Curator as a third status. The result includes a bounded administrative diagnostic summary—counts by exclusion code and uncovered obligation—without exposing unusable element identities to the Curator or turning curation debt into a Workflow branch.

Hard constraints reject candidates. Confirmed usage tags and styles rank semantically suitable candidates unless the approved profile explicitly marks one as mandatory. Set-level coverage is evaluated across the bundle, never by requiring every obligation on one element. The same exact selected resource may satisfy multiple requirement groups, and one group may select multiple resources.

### 5. Persist one canonical inventory commit

Before returning the first bounded match result, the service persists one current inventory transaction for the Manifest plan revision and the deterministic match-policy revision, plus one immutable observation keyed by that transaction. A reconstructed Curator, including a Continue dispatch with a new dispatch ID, adopts that exact transaction only when both revisions still match. When the policy revision changes and no prepared receipt exists, the current pointer is atomically replaced and only the failed inventory match is recomputed; completed documents, reviews, checklist and resource plan are untouched. An orphaned old observation is never parsed as current state. Once a prepared receipt exists, its frozen decision set remains resumable and policy changes do not restart completed acquisition. Neither the Curator nor `CommitResourceInventory` can issue a second match for the same current transaction. The Curator then submits one complete decision set through `CommitResourceInventory`. The service verifies active-dispatch authority and persists one decision-independent commit receipt path under `.beegame/workflow/resource-inventory-commits/` before staging. It stores:

- Manifest plan revision and catalog revision;
- one or more library decisions, or exactly one placeholder decision, per required requirement group;
- selected candidate identity and delivery disposition;
- deterministic no-match status and placeholder specification;
- prepared, applying, or committed state plus each staged resource and its frozen output-file hashes;
- final resource IDs and requirement bindings.

The service applies exact imports, conversions and placeholders only inside a receipt-specific staging workspace. Resolution computes the revision, identities, dependency closure and source hashes from one in-memory published Catalog snapshot; it cannot re-read mutable Pack rows after accepting the revision. Every downloaded root/dependency must equal its frozen content hash. The project Manifest and runtime/generated roots remain unchanged until every staged file equals the output hashes frozen in the durable receipt. Immediately before publication, the service revalidates active-dispatch authority, then publishes all files and one canonical Manifest as one resumable transaction. Exact orphan files left before the Manifest index publication are reconciled by hash; conflicting bytes are rejected. On interruption it resumes the same receipt from its staged resources; it never asks the LLM to select again. A failed operation remains an exact receipt failure and is not converted into no-match. After commit, staging and the current-transaction pointer are removed.

The final Workflow inventory receipt is derived from the committed receipt and current audited files. The LLM does not reconstruct bindings from conversation history. There is no second inventory state: the commit receipt is transactional until committed, then `resourceProductionState.inventoryReceipt` is authoritative and the receipt is only immutable commit evidence.

### 6. Enforce acquisition order

For each required group, the service issues exactly one current-revision candidate set:

1. Agent chooses one or more suitable candidates and imports them; the same selected resource may satisfy several requirement groups; or
2. Agent accepts the service-proven `no-match` result and authors a placeholder.

The complete commit is rejected when a placeholder decision targets a group with selectable candidates. This removes the current browse-and-placeholder dual behavior.

When every required group has either one or more library decisions or exactly one placeholder decision, the service applies and validates the commit, then derives the many-to-many inventory bindings automatically. The Resource Curator never reproduces bindings from historical tool calls.

### 6.1 Guarantee placeholder adapter coverage

`CommitResourceInventory` projects the exact registered provisional adapter descriptions to the Curator. A placeholder decision must choose a format registered by the active target, an `assetKind` declared by the requirement acquisition profile, and a target-supported destination extension. Placeholder decisions cannot declare capabilities; the service records only the adapter's actual output facts. The service rejects invented kinds and formats before preparing a receipt.

The active adapter set includes direct programmatic media for model, raster visual and audio duties plus one engine-neutral JSON program-resource adapter. JSON program resources are normal files under the runtime asset root and describe a replaceable provisional representation for semantic kinds that cannot be safely emitted as media bytes, including materials, shaders, VFX, fonts, UI documents and data. They are consumed through the same canonical resource binding and JSON loading path as other declared resources; they do not create a runtime/source fallback, second Manifest or second loader. A later library import replaces the resource binding and file through the same inventory commit.

### 7. Reconcile worker lifecycle

`session.stopped`, transport loss after the session is terminal, and service shutdown all flow through one dispatch interruption transition. The transition preserves elapsed time and ledger progress, clears `thinking=working`, and exposes Continue. A late progress event cannot restore running state.

The reason a particular session was stopped remains transport evidence; business recovery does not depend on guessing that reason.

### 8. Cut over existing Resource Library data once

This development system does not retain a compatibility reader or a second catalog. Existing binaries and explicit administrator-confirmed semantic values remain, but all derived technical facts and readiness projections are rebuilt through the canonical inspector.

The cutover performs one deterministic pass:

1. preserve canonical R2 object identities, immutable binaries, Pack authority and explicitly confirmed element/folder/Pack semantic policy;
2. clear obsolete derived inspection/readiness projections;
3. inspect each distinct content hash once and rebuild dependency closures;
4. queue elements without confirmed effective semantics in the one Needs curation workbench;
5. publish the new catalog revision only after the canonical projection is complete;
6. remove the cutover command and every retired whole-Pack matching/readiness branch after verification.

No project Workflow performs this curation. No old API, fallback query, compatibility parser, shadow tag table or alternate catalog remains.

## Worker contract

The Resource Curator receives:

- approved resource/style/target authority;
- unresolved requirement groups only;
- one bounded candidate set per group;
- `ResourceLibrary match_requirements` as its only discovery operation;
- `CommitResourceInventory` as its only mutation and terminal operation.

It does not receive generic `Glob`, `Grep`, `LS`, `Read`, or shell tools. The service projects all required authority and current inventory facts into the contract. This prevents workspace scans and unsupported tool calls from expanding context.

## Failure behavior

- Catalog/network failure before commit: interrupt the current dispatch and rematch the same current plan; do not convert failure into no-match.
- Download or conversion failure after prepare: preserve the exact commit receipt and resume its incomplete operations; do not create a placeholder automatically.
- Stale catalog or plan revision before prepare: reject the decision set and rematch the current plan.
- Stale match-policy revision before prepare: invalidate only the unprepared current inventory transaction and rematch the same approved plan; never rerun upstream phases.
- Invalid or missing local file after commit: invalidate the inventory receipt and create one new current-plan inventory commit; already verified resources are supplied as immutable accepted material and are not downloaded again.
- No suitable catalog material: persist the service-proven no-match and author one normal placeholder through the registered target adapter.

## Tests and acceptance

Automated tests must prove:

1. Resource plans require structured acquisition profiles and never infer them from prose or identifiers.
2. FBX candidates remain eligible through an explicitly configured FBX→GLB adapter, and OGG candidates remain eligible when OGG is a declared direct target format; no undeclared audio conversion is inferred.
3. Requirement matching is bounded, has only `matched | no-match`, and does not expose pack pagination or catalog curation states to the Resource Curator.
4. Selectable candidates block placeholder authoring; a proven no-match allows it, including when the administration catalog contains non-selection-ready material.
5. A prepared inventory commit resumes incomplete file operations without repeating selection or completed downloads.
6. Inventory receipt is service-derived from the committed receipt and audited files.
7. Stopped sessions cannot leave a running dispatch or working-thinking projection.
8. No resource task contains token, time, tool-call, or attempt termination logic.
9. No old Workflow catalog action, alternate inventory state, feedback document, or compatibility parser remains in production code.
10. One invalid unrelated element does not remove valid elements from a published Pack; an invalid dependency removes only roots whose closure contains it.
11. A match-policy revision change invalidates only an unprepared inventory observation; an applying/committed receipt remains resumable and upstream Workflow phases remain intact.
12. A Curator that receives all `no-match` groups still commits placeholders and reaches Resource Content instead of returning prose without a durable receipt.
13. Every canonical asset kind has at least one registered target placeholder representation, placeholder kinds must belong to their requirement profile, and the Curator prompt exposes the exact adapter choices without relying on model memory.
14. Technical inspection is reused by unchanged content hash, while changed/new elements alone are re-inspected and re-curated.
15. Suggested semantic tags never appear in catalog facets or matches before administrator confirmation; approval writes the canonical field and removes the suggestion.
16. Pack, closest-folder and element semantic policies resolve through one precedence rule, and new files inherit confirmed policy without manual per-file edits.
17. One candidate bundle may cover a requirement with several elements, and aggregate capabilities such as variants or material/texture coverage are not required on a single file.
18. Match diagnostics report bounded exclusion counts and uncovered obligations without exposing unusable candidates or introducing another terminal status.
19. The administration workbench can batch-confirm Pack/folder/selection proposals atomically and reports the exact affected-element count.
20. No whole-Pack selection gate, suggestion-backed search, filename inference, old metadata fallback, alternate Catalog or compatibility parser remains.

End-to-end acceptance first curates one mixed-quality Pack containing valid roots, one unrelated invalid root and one root with a broken dependency. The valid roots must remain searchable, the unrelated invalid root must be isolated, and only the dependent root may be excluded. A new Web + React + 3D project with Resource Library usage `preferred` must then import at least one suitable library candidate bundle, create placeholders only for proven gaps, survive one service restart without repeating selection, inspection or completed downloads, leave no running state after stop, and reach Resource Content without unbounded catalog pagination. A second project with a different idea must reuse the same confirmed metadata and inspection without requiring administrator re-curation.
