# AI Resource Semantic Curation Design

## Status

Proposed design for review. This document is the authority for the AI
semantic-curation implementation. It does not change the Resource Library or
any user example project by itself.

## Goal

Allow the Resource Library to classify the semantic use of existing assets
without requiring an administrator to label every obvious asset manually,
while preserving one canonical resource record and one deterministic catalog
selection path.

The feature classifies `usage_tags` only. Technical identity, file facts,
content structure, dependencies and `asset_kind` remain owned by the existing
resource inspector and administrator-authored metadata.

## Non-goals

- Do not infer roles from filenames, paths, keyword lists or regular
  expressions.
- Do not let the model invent usage tags or modify the tag vocabulary.
- Do not let the model rewrite `asset_kind`, technical facts, capabilities,
  dependencies or content profiles.
- Do not add a second catalog, search route, resource manifest or write path.
- Do not add a feedback/compatibility layer or keep an obsolete semantic path.
- Do not bind the design to Web, Unity, Godot or another engine.

## Canonical usage-tag contract

`RESOURCE_USAGE_TAGS` in
`packages/beegame-resource-core/src/types.ts` is the only definition of the
allowed usage-tag vocabulary:

```text
character, npc, creature,
weapon-equipment, prop, vehicle,
building, environment, terrain, vegetation,
scene, level-map, tile,
ui, icon, effect,
combat, interaction, narrative,
music, sound-effect, ambient-audio, voice
```

Core validation, resource-server request validation, Workflow contracts, AI
structured output validation and the frontend options all consume this
contract. The frontend receives `usageTagOptions` from the curation API and
does not maintain a second list. AI output containing any other value is
rejected before persistence.

`asset_kind` and `usage_tags` have separate ownership:

| Field | Owner | Meaning |
| --- | --- | --- |
| `asset_kind` | Technical inspector | What the file objectively is |
| `usage_tags` | Confirmed semantic curator | What the asset can be used for |

## Canonical data flow

```text
R2 canonical object
  -> technical facts and content profile
  -> compact semantic evidence projection
  -> AI structured classification
  -> server validation against the frozen content hash
  -> high-confidence atomic usage-tag commit
  -> low-confidence pending semantic_suggestion
  -> existing catalog matcher
```

The AI reads the canonical R2 object through the resource service. It receives
only the evidence needed for that element: content hash, MIME/format, size,
technical facts, content profile, dependency summary and an engine-neutral
content preview or extract when the format supports one. The model must use
actual content evidence; filenames and paths are context only and never a
classification rule.

The output is a strict object containing:

- `element_id`
- `source_content_hash`
- `usage_tags`, each drawn from `RESOURCE_USAGE_TAGS`
- `confidence`: `high`, `medium` or `low`
- `evidence`, a non-empty structured list pointing to inspected content facts
- `curator_revision`

The model cannot submit a final resource row. The server owns the decision and
the write.

## Durable processing

Semantic classification uses the existing durable resource-processing job
boundary with a semantic-curation job kind. Each element is one durable item.
The job stores the input content hash and curator revision so a retry is
idempotent and stale output cannot overwrite a changed resource.

There is no artificial per-task wall-clock or token kill switch. Concurrency
is a throughput setting only. A slow model request remains a running item; a
process restart requeues only interrupted items. One failed element records a
failure and does not stop other elements in the same Pack.

If the same element hash and curator revision already have an accepted result,
the job reuses that result rather than invoking the model again. If the hash
changes, the old semantic result is not reused.

## Persistence rules

Only elements without an effective confirmed usage tag are eligible for AI
classification. Existing element, folder or Pack policy is authoritative and
is never overwritten by AI.

For a valid high-confidence result with content evidence:

1. The server verifies the element still exists and its content hash matches.
2. The server verifies every tag and evidence item.
3. The server writes `usage_tags` with element-level confirmed mode.
4. The server clears any pending `semantic_suggestion` in the same update.

For medium/low confidence or insufficient evidence:

- `usage_tags` is unchanged.
- The structured result is stored in the existing non-searchable
  `semantic_suggestion` field.
- The existing curation workbench can confirm or reject it through the existing
  one-batch curation operation.

The pending suggestion is not a second semantic fact and is never consumed by
catalog matching. It exists only to preserve a recoverable AI decision until a
final canonical commit is made.

## Batch and scope policy

The first production run processes ready elements in published Packs. Archived
Packs may be processed by the same job kind afterward but are excluded from
published catalog selection. The job processes items in deterministic Pack and
element order and does not load the whole Resource Library into one model
request.

The existing 798 untagged elements are therefore handled as independent
durable items: published elements first, archived elements second. No resource
is copied, renamed, converted or replaced by a placeholder during semantic
curation.

## Failure handling

| Condition | Result |
| --- | --- |
| R2 read failure | Item remains failed with the storage error; retry the item |
| Model response invalid | Item remains failed; do not write partial tags |
| Unknown tag | Reject the result and record validation error |
| Empty evidence | Keep tags unchanged and store a low-confidence pending result |
| Content hash changed | Reject stale result and enqueue the current hash |
| Process restart | Requeue interrupted items only |
| Existing confirmed tags | Skip; do not overwrite |

No failure path creates a second search route or silently converts a failed
classification into a placeholder.

## Acceptance criteria

The implementation is ready only when all of the following are true:

1. Core, server, Workflow, frontend and AI validation expose exactly the same
   usage-tag options.
2. An AI result with an unknown tag, missing evidence or stale content hash
   cannot change the canonical element row.
3. A high-confidence result changes only `usage_tags`, mode and the pending
   suggestion field; technical facts and `asset_kind` are unchanged.
4. A low-confidence result is visible to the existing curation workbench but
   cannot affect catalog matching.
5. A restart resumes unfinished items without re-running accepted items.
6. A single element failure does not stop the Pack job.
7. A real published catalog match uses the confirmed tags and returns the
   existing candidate/bundle contract.
8. The frontend renders options from the API rather than a duplicate constant.
9. No legacy semantic path, feedback path, compatibility path or second
   resource fact source remains.
10. A new-project end-to-end run confirms that resources are selected from the
    catalog; no user example project is modified.

## Explicit implementation boundary

The implementation may add only the semantic job state, model adapter contract,
strict validation, atomic confirmation and tests required by this design. It
must not refactor unrelated Workflow or Resource Library behavior. Before any
code is changed, the implementation plan must map each change to this document
and identify the old path that will be removed.
