# AI Resource Semantic Curation Design

## Status

Implementation authority for AI semantic curation. It does not change the
Resource Library or any user example project by itself.

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

The AI reads the canonical R2 object through the resource service. Semantic
curation is preview-first: only a resource that can produce a bounded visual
preview enters the model request. Models and meshes are rendered by the
engine-neutral preview processor; images and textures are normalized into
preview images. Resources without a visual renderer remain unclassified and
are not sent through a structured-only path.

The visual input is one canonical contract. For one or two resources, it
contains ordered individual JPEG images. For more than two resources, it
contains one JPEG Atlas with an ordered cell-to-element map. The original
resource bytes and library record are never changed, and the previews/Atlas
are never stored as library resources. Raw binary is never placed in the
structured text projection; it is delivered to the model as multimodal image
input.

The structured projection contains only bounded identity and technical context.
Category, kind, asset kind, content profile, technical facts, and dependencies
cannot replace the rendered visual evidence. Every visual decision must cite a
`content_preview` evidence item tied to its supplied image or Atlas cell.
Filenames and paths are not part of the semantic projection and cannot
influence classification.

The output is a strict object containing:

- `element_id`
- `source_content_hash`
- `usageTags`, each drawn from `RESOURCE_USAGE_TAGS` (the model response field)
- `confidence`: `high`, `medium` or `low`
- `evidence`, a non-empty structured list that includes `content_preview` for
  every visual decision and points to the supplied image or Atlas cell
- `curator_revision`

The durable element row uses `usage_tags`; the Workflow bridge prompt and
semantic model response use the exact `usageTags` field and evidence-source
enums from the core contract for every request. The model is not expected to
discover the vocabulary from prose, and the parser remains the final authority
that rejects any value outside those enums.

The model cannot submit a final resource row. The server owns the decision and
the write.

## Per-element decision and confirmation contract

The batch is only a transport and billing unit. It never defines a shared
semantic label set. Every model decision, pending suggestion and administrator
confirmation is owned by exactly one `elementId` and carries its own
`usageTags`, content hash and curator revision. Two elements may happen to
receive the same tags, but that is the result of two independent decisions.

The confirmation contract is an ordered set of element decisions:

```text
decisions: [
  {
    elementId,
    usageTags,
    sourceContentHash,
    suggestionRevision
  }
]
```

The server rejects a shared `usageTags` value paired with multiple
`elementIds`, missing or duplicate decisions, stale hashes, and decisions for
elements outside the requested Pack. The UI may provide an explicit
"accept all suggestions" action, but it must submit each resource's own
suggestion through this same per-element contract. It must not provide a
global tag picker that applies one tag set to heterogeneous elements.

For visual recognition, model elements use bounded rendered previews and
inspected geometry/material facts; images use bounded image previews and image
facts. Audio, documents, and other non-renderable resources do not enter this
semantic model path until they have an explicit visual preview renderer.
Dependencies remain context and never become a substitute semantic tag. If a
render or visual-input build fails, the item is requeued. If the model result
does not cite visual evidence, the result is rejected before persistence.

Provider-specific function-call argument envelopes are normalized once at the
Workflow model-runtime boundary. The semantic curator receives only the
canonical tool input; transport fields such as `raw_arguments` are never part
of the semantic decision contract and are not accepted by the semantic parser.

## Durable processing

Semantic classification uses the existing durable resource-processing job
boundary with a semantic-curation job kind. Each element is one durable item,
but the worker claims up to eight ordered items as one model batch. A batch has
one stable durable identity and one provider usage receipt; the returned
decisions are validated as a complete set before any element commit. The job
stores the input content hash and curator revision so a retry is idempotent and
stale output cannot overwrite a changed resource. The accepted batch receipt
is recorded on the claimed items, so a restart resumes that batch rather than
creating a second queue or re-running completed items.

The job also stores the effective model-config owner and `modelConfigId`.
Those identities point to the same model configuration managed by Workflow
Settings. The resource service resolves that record from the existing backend
configuration store and sends the resulting runtime environment through the
existing Workflow model runtime bridge. It does not read a resource-specific
model URL, token, or model name, and it never selects a fallback provider.
The persisted `modelType` is part of that same request identity and must cross
the bridge with the runtime environment. The isolated model worker must use
that request-scoped provider before any local Claude settings; local settings
must never redirect a Resource Library request to another provider.

There is no artificial per-task wall-clock or token kill switch. Concurrency
is a throughput setting only. A slow model request remains a running item; a
process restart requeues only interrupted items. One failed element records a
failure and does not stop other elements in the same Pack.

The structured model output allocation is derived from the current batch size
and is not a job token quota or a workflow kill switch. This prevents a
complete decision batch from being silently truncated by the runtime's generic
default output size. A provider-reported truncation is recorded as a distinct
provider output failure.

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
  one-batch transport operation using the per-element decision contract.

The pending suggestion is not a second semantic fact and is never consumed by
catalog matching. It exists only to preserve a recoverable AI decision until a
final canonical commit is made.

## Batch and scope policy

The first production run processes ready elements in published Packs. Archived
Packs may be processed by the same job kind afterward but are excluded from
published catalog selection. The job processes items in deterministic Pack and
element order and does not load the whole Resource Library into one model
request.

All renderable untagged elements are handled as independent durable items in
ordered batches of at most eight: published elements first, archived elements
second. Non-renderable elements remain unclassified until a visual renderer is
available. No library resource is copied, renamed, or replaced by a
placeholder during semantic curation; an ephemeral rendered preview is the
only allowed conversion.

For a batch of one or two renderable items, the model request contains the
individual preview images. For a batch larger than two, it contains one JPEG
Atlas and its ordered cell map. Both forms are the same `visualInput` contract
and are validated before the request is sent.

Each accepted semantic batch receipt partitions the claimed durable items into
completed decisions and explicit `retryItems`. The partition is exact: an
item cannot be both accepted and retried, and no claimed item may be omitted.
Retried items are requeued with their current diagnostic and selected after
older queued work; a batch containing only retries schedules a later batch
instead of spinning inside the current batch.

## Failure handling

| Condition | Result |
| --- | --- |
| R2 read failure | Item remains failed with the storage error; retry the item |
| Model render or Atlas failure | Exclude the item from the current model call, requeue it with the render diagnostic, and retry it in the next batch |
| Model response invalid | Item remains failed; do not write partial tags |
| Unknown tag | Reject the result and record validation error |
| Missing `content_preview` evidence | Reject the batch result, persist no tag or suggestion, and requeue the item |
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
9. A heterogeneous batch cannot cause one resource's tags to be written to
   another resource; an explicit bulk accept preserves each element's own
   decision.
10. No legacy semantic path, feedback path, compatibility path or second
   resource fact source remains.
11. A new-project end-to-end run confirms that resources are selected from the
   catalog; no user example project is modified.

## Explicit implementation boundary

The implementation may add only the semantic job state, model adapter contract,
strict validation, atomic confirmation and tests required by this design. It
must not refactor unrelated Workflow or Resource Library behavior. Before any
code is changed, the implementation plan must map each change to this document
and identify the old path that will be removed.
