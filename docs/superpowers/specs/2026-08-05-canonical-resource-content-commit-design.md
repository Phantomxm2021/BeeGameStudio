# Canonical Resource Content Commit Design

## Objective

Make Resource Content Author produce one validated, engine-neutral JSON/YAML content set without generic file mutation, post-accept rejection, Manifest shard rereads, compatibility branches, or a second completion channel.

## Root defect

The current worker writes arbitrary files through generic `Write/Edit/MultiEdit`, then calls a status-only `SubmitResourceContentResult`. That tool accepts only the declared status; the workflow validates the filesystem after acceptance and can therefore fail an already accepted terminal. The dispatch carries paths rather than exact Manifest identities, so the model rereads every Manifest module and can invent requirement identities. `beegame-content-v1` validates only the common header and does not define the canonical resource-registry binding shape.

## Single authority

`CommitResourceContent` is the only Resource Content Author terminal and the only content mutation boundary. It has two mutually exclusive operations:

- `commit`: submit the complete initial content set, or every unlocked replacement document during remediation;
- `needs_inventory`: submit exact current Manifest requirement IDs whose verified inventory is genuinely missing.

There is no separate `SubmitResourceContentResult`, generic content `Write`, self-revision state, feedback artifact, compatibility parser, or second ledger.

## Frozen input projection

The workflow service derives one immutable contract from the current canonical Manifest and inventory receipt:

- schema identity and allowed JSON/YAML kinds;
- required requirement IDs;
- verified resource IDs;
- exact requirement-to-resource inventory bindings;
- protected content paths and deterministic current content defects;
- only the approved Foundation document paths that own executable JSON/YAML facts.

The worker must not read `assets/manifest/**`. It receives exact inventory identities in the dispatch contract and reads only the approved fact-owner documents when authoring game-specific data.

## Canonical content contract

Every submitted document contains exactly:

```text
path, schema, id, kind, fulfills, resources, data
```

The service derives JSON versus YAML serialization from the canonical kind. It validates before mutation:

- path remains under the single content root and matches the kind format;
- `schema` is exactly `beegame-content-v1`;
- IDs and paths are unique;
- all required kinds exist exactly once in the merged candidate set;
- `fulfills` contains only current requirement IDs and covers every required requirement;
- `resources` contains only verified current resource IDs and references every Manifest resource;
- `resource-registry.data.bindings` is the sole binding representation and contains exact current requirement and resource IDs;
- submitted and preserved documents form one valid set.

Other `data` fields remain engine-neutral and game-specific objects owned by the approved design documents. Shared validation must not encode Web, React, Unity, Godot, Prefab, or keyword-based semantics.

## Commit behavior

The tool parses the entire candidate set in memory and calls the same canonical validator used by filesystem audit and the post-write gate. Validation failure writes nothing and returns a compact tool error inside the same model turn. After all validation succeeds, each changed document is serialized by the service and atomically replaces its target path. The accepted tool result contains the canonical content IDs and written paths and ends the dispatch immediately.

The final workflow boundary reuses the same validator and verifies the dispatch revision. It cannot apply a different contract after tool acceptance.

## Recovery

An invalid tool call leaves canonical files unchanged and remains in the current dispatch. A process interruption after an accepted commit is reconciled from the files and dispatch identity; it does not ask the model to regenerate valid content. A failed pre-existing run is not migrated or parsed through an old protocol; new runs and newly dispatched retries use only the canonical tool contract.

## Acceptance

- An invalid envelope, invented requirement ID, unknown resource ID, missing kind, missing coverage, or invalid resource-registry binding is rejected before any file mutation.
- A valid tool call writes the complete set and cannot later fail under a different content validator.
- Resource Content Author has no generic mutation tools and no access requirement to Manifest modules.
- Initial authoring uses one commit tool call rather than eleven serial writes.
- The workflow retains one Resource Production state, one inventory receipt, one content set, and one terminal channel.

