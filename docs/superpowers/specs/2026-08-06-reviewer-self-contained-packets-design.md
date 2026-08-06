# Reviewer Self-Contained Packet Design

## Goal

Eliminate Reviewer failures caused by context compaction losing document reference identities while preserving one Review Cycle, one canonical reference index and one submission path.

## Root cause

The first Reviewer turn receives all frozen artifacts and the complete reference index. Continuation turns receive only packet metadata and explicitly depend on the prior conversation. Context compaction can retain artifact aliases such as `a2` while dropping the stable `referenceId` mapping and exact artifact content. The submission boundary correctly rejects those aliases, but the Worker has no canonical way to reconstruct the active packet. Failed tool calls are then hidden by a generic missing-terminal error.

## Design

The service continues to build one canonical frozen projection per Cycle and revision. Every continuation packet deterministically projects the union of artifacts required by its current checks, the matching subset of the canonical reference index, and the existing packet metadata. This data is transmitted in the active packet prompt, so the packet is valid in a fresh or compacted execution context. It is a transient request view and does not create another ledger, index or persisted state.

The model-facing packet distinguishes non-submittable artifact IDs from stable `referenceId` values. Evidence and subjects still submit only stable `referenceId` values. Server validation remains strict and continues to enforce each check's artifact scope.

If no packet is accepted, terminal construction reports the last deterministic submission-contract rejection observed in the dispatch. A dispatch with no submission attempts keeps the existing missing-call error. Previously accepted packet checkpoints remain untouched; resume starts from the first incomplete packet.

## Exclusions

- No Bash, Grep, workspace read or transcript lookup tools for Reviewer.
- No fallback protocol, compatibility branch, retry counter or second reference index.
- No relaxation of reference or artifact-scope validation.
- No replay of accepted packets.

## Acceptance

1. A continuation prompt contains only the active packet's required frozen artifacts and matching canonical references.
2. The packet can submit valid document evidence without relying on earlier conversation messages.
3. Artifact aliases are not presented as valid submission identities.
4. Invalid references remain rejected.
5. A rejected submission followed by prose reports its concrete contract error, not a generic missing-call error.
6. Existing Reviewer and Workflow tests remain green.
