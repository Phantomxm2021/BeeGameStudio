# Canonical Resource Content Commit Design

## Objective

Make Resource Content Author produce one validated, engine-neutral JSON/YAML content set without generic file mutation, post-accept rejection, Manifest shard rereads, compatibility branches, or a second completion channel.

## Root defect

The current worker writes arbitrary files through generic mutation tools, then calls a separate status-only terminal. That terminal accepts only the declared status; the workflow validates the filesystem after acceptance and can therefore fail an already accepted terminal. The dispatch carries paths rather than exact Manifest identities, so the model rereads every Manifest module and can invent requirement identities. `beegame-content-v1` validates only the common header and does not define the canonical resource-registry binding shape.

## Single authority

`CommitResourceContent` is the only Resource Content Author terminal and the only content mutation boundary. It has two mutually exclusive operations:

- `commit`: submit the complete initial content set, or every unlocked replacement document during remediation;
- `needs_inventory`: submit exact current Manifest requirement IDs whose verified inventory is genuinely missing.

There is no separate status terminal, generic content mutation tool, self-revision state, feedback artifact, compatibility parser, or second ledger.

## Frozen input projection

The workflow service derives one immutable, dispatch-bound contract from the current canonical Manifest and inventory receipt:

- schema identity and allowed JSON/YAML kinds;
- required requirement IDs;
- verified resource IDs;
- exact requirement-to-resource inventory bindings;
- protected content paths and deterministic current content defects;
- only the approved Foundation document paths that own executable JSON/YAML facts.
- dispatch ID, inventory revision and complete content baseline revision.

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
- the merged candidate set is non-empty and every file kind/format belongs to the engine-neutral allowed set; the shared layer does not force every project to instantiate every allowed kind;
- `fulfills` contains only current requirement IDs and covers every required requirement;
- `resources` contains only verified current resource IDs and references every Manifest resource;
- `resource-registry.data.bindings` is the sole binding representation and contains exact current requirement and resource IDs;
- submitted and preserved documents form one valid set.

Other `data` fields remain engine-neutral and game-specific objects owned by the approved design documents. Shared validation must not encode Web, React, Unity, Godot, Prefab, or keyword-based semantics.

## Commit behavior

The tool parses the entire candidate set in memory and calls the same canonical validator used by filesystem audit and the post-write gate. Validation failure writes nothing and returns a compact tool error inside the same model turn. After all validation succeeds, the service serializes the complete merged set into a sibling staging root and publishes the whole content root. A dispatch-bound prepared/committed receipt records the baseline revision, final directory digest, staging/backup locations and exact paths. The tool rechecks active-dispatch authority immediately before publication. The accepted tool result contains the canonical content IDs and written paths and ends the dispatch immediately.

The final workflow boundary reuses the same validator and verifies the dispatch revision. It cannot apply a different contract after tool acceptance.

## Recovery

An invalid tool call leaves canonical files unchanged and remains in the current dispatch. A process interruption is reconciled from the prepared receipt, staging/backup roots and final digest; it does not ask the model to regenerate valid content. A stopped or superseded dispatch cannot publish. A failed pre-existing run is not migrated or parsed through an old protocol; new runs and newly dispatched retries use only the canonical tool contract.

The dispatch-bound receipt is the sole durable Resource Content terminal authority. `tool.completed` and the model's final prose are transport telemetry only and never form a second completion channel. Both `commit` and `needs_inventory` persist one accepted terminal receipt before the tool returns. Terminal construction and restart recovery read that receipt, verify its dispatch identity and current digest where mutation occurred, and then advance without redispatching the model.

Every native tool exposed to the Query Engine must satisfy the complete runtime tool interface at compile time, including result mapping. Tests must exercise the real tool adapter rather than an identity `buildTool` substitute alone. A successful filesystem commit followed by transport-result failure must recover from the receipt and must not be reported as a missing tool call.

Receipt recovery and terminal consumption share one Controller serialization lane. A resumed Controller consumes the recovered terminal through the same unlocked terminal handler already owned by that lane; it must not enqueue the public serialized handler behind itself. Recovery also removes the obsolete transport failure from the restored dispatch before normal phase progression.

## Acceptance

- An invalid envelope, invented requirement ID, unknown resource ID, missing kind, missing coverage, or invalid resource-registry binding is rejected before any file mutation.
- A valid tool call writes the complete project-required set and cannot later fail under a different content validator.
- Resource Content Author has no generic mutation tools and no access requirement to Manifest modules.
- Initial authoring uses one commit tool call rather than eleven serial writes.
- The workflow retains one Resource Production state, one inventory receipt, one content set, and one terminal channel.
- Missing runtime result mapping fails compilation or an adapter contract test before a worker can run.
- A committed receipt advances the same dispatch after restart even when no `tool.completed` event survived.
- Consuming a recovered terminal cannot deadlock the Controller serialization lane or leave the UI indefinitely in preparation.
