# AI Resource Selection Design

## Goal

Allow the game-building workflow to select published library assets deterministically and record that choice in the project's existing `assets/asset-manifest.json` without binding the library to a particular engine or runtime.

## Scope

This first delivery covers selection and auditability only:

1. A published-Pack-only selection API assembles a Resource Manifest from Pack and element metadata.
2. A project asset slot can be bound to one selected library element, with the selection reason and source retained.
3. The binding is visible in the project asset contract and can be replaced deliberately.

It does not generate assets, copy binaries into an engine-specific location, infer visual style from pixels, or introduce a vector database.

## Selection contract

The requester provides one or more asset requirements containing a stable slot id, accepted formats, resource category, desired dimension, style hints, game-type hints, and a purpose. The service evaluates only `published` Packs and `ready` elements.

Candidates are rejected when their dimension, category, format, or required dependency state conflicts with the requirement. Remaining candidates receive an explainable score:

- exact category and format compatibility;
- matching Pack/element dimension;
- overlapping style and game-type values;
- dependency completeness;
- deterministic lexical tie-break by Pack then element id.

The response contains the selected Pack and element identifiers, signed source URL, asset role/slot, compatibility facts, and score explanation. It never asks an LLM to parse filenames or to make an unrecorded final pick.

## Project contract extension

`BeeGameAssetSlot` gains an optional `resource_binding`:

```ts
{
  pack_id: string
  pack_version: string
  element_id: string
  source_url: string
  selected_at: string
  selection_reason: string[]
}
```

The existing `uploaded_urls` field remains for user uploads. A selected library item is recorded separately so it can be audited, refreshed, or deliberately materialized by a later integration executor.

## Boundaries and security

- The resource service remains responsible for signed source URLs and only emits source URLs for published, ready elements.
- The workflow server verifies project ownership and `assets.upload` before persisting a binding.
- The workflow server calls the resource service using a server-side configured URL; the browser never receives an unrestricted service credential.
- A Pack update or archival does not silently mutate an existing project binding; the recorded Pack version is retained for review.

## UI

The project Assets panel shows a distinct “Library” source state for a bound slot: Pack name, element name, reason, and a replace action. A missing or unavailable source becomes an explicit warning rather than falling back to an unrelated asset.

## Acceptance

1. Given a 3D fantasy environment slot, only published, ready, compatible library elements are eligible.
2. The selected result is deterministic and includes its reasons.
3. Binding a result writes `resource_binding` to the project asset manifest without changing the slot target path.
4. A user without project asset permission cannot bind resources.
5. An archived Pack or non-ready element cannot be newly selected.
