# Resource Inventory Root Fix Design

## Goal

Make Resource Production acquire suitable Resource Library material before authoring replaceable placeholders, finish from durable progress after interruption, and avoid unbounded catalog turns without adding token, time, tool-call, or attempt limits.

## Authority and invariants

- Approved project documents own semantic resource duties and runtime output constraints.
- A library element is source material. Its source extension is not a runtime-output admission rule.
- A target adapter deterministically converts imported source material when the runtime cannot consume it directly. Generated output stays under `assets/generated/**`, retains the source resource identity, and is disposable.
- One canonical inventory ledger owns acquisition progress. Prompt history, query transcripts, candidate pages, and a second manifest are not state.
- A placeholder is a normal independently replaceable resource. It is authored only after the catalog service returns a bounded no-match decision for the requirement group.
- No token, wall-clock, tool-call, or automatic-attempt business limit may terminate Resource Production.
- A stopped worker session must make the durable dispatch interrupted and actionable; it must never remain projected as running.

## Root defects being removed

1. `asset_format_capabilities` is currently interpreted by the worker as a source-format whitelist even though architecture assigns source conversion to target adapters.
2. Resource Library exposes only low-level pack pagination. Sparse element metadata forces the worker to scan pages repeatedly while carrying an expanding conversation.
3. Placeholder creation has no service-proven catalog exhaustion precondition, so the worker can author placeholders and continue browsing.
4. `resourceProductionState` persists only a final receipt. Accepted selections, inspected catalog revisions, no-match decisions, and remaining requirements are volatile until terminal completion.
5. A stopped worker session can leave `activeDispatch.status=running`, causing the Workflow card to remain in preparation.

## Design

### 1. Separate source compatibility from target delivery

`project_target.asset_format_capabilities` continues to describe formats consumable by the selected runtime. It no longer filters source candidates.

Resource Library candidate facts include a deterministic delivery disposition:

- `direct`: source can be copied to the canonical runtime resource path;
- `convert`: one registered target adapter can produce a runtime-compatible output;
- `unsupported`: no registered adapter can deliver the source for this target.

Only `direct` and `convert` candidates are selectable. Importing a `convert` candidate copies exact source material and dependency closure, then the adapter atomically writes generated output. The Manifest keeps one resource record with source provenance and generated delivery files; it does not create a second semantic resource.

The first implementation supports the source forms already demonstrated by the current Resource Library and target: FBX/GLB/GLTF model material and OGG/WAV audio material. FBX may use the configured FBX→GLB adapter; OGG is direct-delivery only when the target declares OGG. This plan does not require an OGG→WAV converter. The adapter registry, not shared workflow logic, owns all capabilities.

### 2. Add one bounded requirement-aware catalog operation

Every Manifest requirement group contains one canonical `acquisition_profile` authored during `RESOURCE_PLAN`: accepted dimensions, asset kinds, usage tags, required capabilities, and optional style constraints. These fields use Resource Library enums or exact approved style values. The service never derives them from requirement IDs, names, purposes, project names, filenames, or free text. Foundation Review verifies that each profile represents its approved semantic duty before Resource Production begins.

Replace agent-driven whole-pack pagination with `match_requirements` as the inventory worker's discovery operation. Its request identifies unresolved canonical requirement groups and target adapter capabilities; the service reads their acquisition profiles from the Manifest. It does not accept free-text search, regular expressions, project names, or filename predicates.

The Resource Library service evaluates authored pack metadata, inspected element facts, semantic categories/capabilities, target delivery disposition, and style/dimension constraints. It returns a bounded candidate set per requirement group plus a catalog revision. Each candidate contains exact Pack/version/element identity, technical facts, dependency summary, delivery disposition, and the requirements it may cover.

Low-level catalog browsing and direct import are not Resource Curator capabilities. Resource Library administration retains its separate management UI, while Workflow has one candidate-acquisition lane.

Sparse metadata does not silently mean no-match. Elements missing required semantic inspection or an immutable source content hash are reported as `unclassified` with only a bounded aggregate count; their internal IDs are never returned to the LLM. Catalog inspection must enrich them outside the Workflow before they can become candidates.

### 3. Persist one canonical inventory commit

Before returning the first bounded match result, the service persists one current inventory transaction for the Manifest plan revision and one immutable observation keyed by that transaction. A reconstructed Curator, including a Continue dispatch with a new dispatch ID, adopts that exact transaction only after active-dispatch validation. Neither the Curator nor `CommitResourceInventory` can issue a second match for the transaction. The Curator then submits one complete decision set through `CommitResourceInventory`. The service verifies active-dispatch authority and persists one decision-independent commit receipt path under `.beegame/workflow/resource-inventory-commits/` before staging. It stores:

- Manifest plan revision and catalog revision;
- one or more library decisions, or exactly one placeholder decision, per required requirement group;
- selected candidate identity and delivery disposition;
- deterministic no-match status and placeholder specification;
- prepared, applying, or committed state plus each staged resource and its frozen output-file hashes;
- final resource IDs and requirement bindings.

The service applies exact imports, conversions and placeholders only inside a receipt-specific staging workspace. Resolution computes the revision, identities, dependency closure and source hashes from one in-memory published Catalog snapshot; it cannot re-read mutable Pack rows after accepting the revision. Every downloaded root/dependency must equal its frozen content hash. The project Manifest and runtime/generated roots remain unchanged until every staged file equals the output hashes frozen in the durable receipt. Immediately before publication, the service revalidates active-dispatch authority, then publishes all files and one canonical Manifest as one resumable transaction. Exact orphan files left before the Manifest index publication are reconciled by hash; conflicting bytes are rejected. On interruption it resumes the same receipt from its staged resources; it never asks the LLM to select again. A failed operation remains an exact receipt failure and is not converted into no-match. After commit, staging and the current-transaction pointer are removed.

The final Workflow inventory receipt is derived from the committed receipt and current audited files. The LLM does not reconstruct bindings from conversation history. There is no second inventory state: the commit receipt is transactional until committed, then `resourceProductionState.inventoryReceipt` is authoritative and the receipt is only immutable commit evidence.

### 4. Enforce acquisition order

For each required group, the service issues exactly one current-revision candidate set:

1. Agent chooses one or more suitable candidates and imports them; the same selected resource may satisfy several requirement groups; or
2. Agent accepts the service-proven no-match result and authors a placeholder.

The complete commit is rejected when a placeholder decision targets a group with selectable candidates. This removes the current browse-and-placeholder dual behavior.

When every required group has either one or more library decisions or exactly one placeholder decision, the service applies and validates the commit, then derives the many-to-many inventory bindings automatically. The Resource Curator never reproduces bindings from historical tool calls.

### 5. Reconcile worker lifecycle

`session.stopped`, transport loss after the session is terminal, and service shutdown all flow through one dispatch interruption transition. The transition preserves elapsed time and ledger progress, clears `thinking=working`, and exposes Continue. A late progress event cannot restore running state.

The reason a particular session was stopped remains transport evidence; business recovery does not depend on guessing that reason.

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
- Invalid or missing local file after commit: invalidate the inventory receipt and create one new current-plan inventory commit; already verified resources are supplied as immutable accepted material and are not downloaded again.
- No suitable catalog material: persist the service-proven no-match and author one normal placeholder through the registered target adapter.

## Tests and acceptance

Automated tests must prove:

1. Resource plans require structured acquisition profiles and never infer them from prose or identifiers.
2. FBX candidates remain eligible through an explicitly configured FBX→GLB adapter, and OGG candidates remain eligible when OGG is a declared direct target format; no undeclared audio conversion is inferred.
3. Requirement matching is bounded and does not expose pack pagination to the Resource Curator.
4. Selectable candidates block placeholder authoring; a proven no-match allows it.
5. A prepared inventory commit resumes incomplete file operations without repeating selection or completed downloads.
6. Inventory receipt is service-derived from the committed receipt and audited files.
7. Stopped sessions cannot leave a running dispatch or working-thinking projection.
8. No resource task contains token, time, tool-call, or attempt termination logic.
9. No old Workflow catalog action, alternate inventory state, feedback document, or compatibility parser remains in production code.

End-to-end acceptance uses a new Web + React + 3D project with Resource Library usage `preferred`. It must import at least one suitable library resource, create placeholders only for proven gaps, survive one service restart without repeating completed acquisition, leave no running state after stop, and reach Resource Content without unbounded catalog pagination.
