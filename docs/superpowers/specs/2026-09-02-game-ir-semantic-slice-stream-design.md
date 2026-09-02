# Game IR Semantic Slice Stream Design

**Status:** approved for implementation on 2026-09-02.

## Problem

The current Game IR projection protocol asks one model turn to return an entire domain as one `StructuredOutput` object. The real Gameplay acceptance produced 150 nodes and 77 evidence groups in a 46,426-byte JSON value. The provider first stopped at its natural 32,000-output-token boundary. A continued turn then produced a semantically complete candidate with one forbidden root `reason`; the protocol discarded that candidate and requested another complete serialization, which failed during provider transport retry.

The first slice implementation removed the complete-domain output, but real
Chrome acceptance proved that `node-kind slice = one StructuredOutput` is still
indivisible. `balance.slice.2` contains formula nodes whose recursive expression
trees are data-dependent. The native provider emitted the tool argument as a
sequence of cumulative DSML/JSON snapshots rather than true deltas: 208 stream
frames repeatedly contained the growing semantic object, `agent.raw.jsonl`
grew from about 447 KB to 1.7 MB after the tool had started, Chrome stopped
responding, and the provider finally produced an empty tool identity. The
journal was not the cause; the aggregate StructuredOutput transport was.

JSON remains appropriate for committed canonical machine state. A complete
domain or complete semantic slice is not an appropriate model-output unit.

## Decision

Each of the existing six projection operations uses one service-owned semantic
slice record stream. Slices remain derived mechanically from the domain
projection contract's node-kind dependency graph. Their order remains
independent of token count, elapsed time, node count, provider behavior, or
model choice.

The model returns raw NDJSON records, not a StructuredOutput tool call and not
a JSON array. Each node record contains exactly one semantic node and its sole
service-owned evidence fragment ID. The final record completes the current
slice. Text frames must be true deltas. Cumulative frames, DSML, tool calls,
empty tool identities and malformed record boundaries are provider protocol
errors and are never interpreted as semantic output.

The exact immutable operation packet is supplied once when a live operation
session starts. The transport validates and retains complete records across a
provider continuation; the service strictly parses the completed record stream
and appends the admitted slice to the operation-local journal. Recovery into a
new session resupplies the same packet after journal verification. Once every
declared slice is admitted, the service deterministically merges them and runs
the existing full-domain admission and phase closure. Only then does it write
the existing canonical operation manifest.

The journal is staging state, not a second authority. It is deleted after the canonical manifest is committed. Recovery revalidates its complete digest chain and resumes the exact next slice. A committed operation manifest supersedes and removes any stale journal.

The ten canonical model-operation manifests and checkpoint v47 chain remain unchanged. A slice dispatch is internal work within one projection operation; it never creates another phase, publication, ready receipt, or consumer-visible authority.

## Output contract

A projection slice transport contains one JSON object per physical line:

```jsonl
{"record":"node","sliceId":"balance.slice.2","fragmentId":"fragment-id","node":{"id":"formula-id","kind":"balance.formula","value":{},"references":[],"edges":[]}}
{"record":"done","sliceId":"balance.slice.2"}
```

The current slice contract fixes the only permitted node kinds, value fields,
edge roles and target kinds. Node records must be in strict code-unit ID order.
The service mechanically groups `fragmentId` values into canonical source
evidence groups; this is derived authority, not output repair. A slice may be
empty by emitting only its exact `done` record.

Every record is exact and strict. Unknown fields, an internal blank line,
duplicate or descending node IDs, an incorrect slice ID, a missing or repeated
`done`, or any record after `done` is rejected. The service does not repair,
strip, reorder, reinterpret or normalize model output into compliance.

## Durable journal

The operation-local journal is append-only and contains:

- compilation identity and Foundation READY receipt digest;
- operation step and immutable operation packet digest;
- ordered service-derived slice contracts and their digest;
- one admitted result per completed slice;
- predecessor and entry digests forming one tamper-evident chain.

There is no compatibility reader. An unknown schema, stale identity, changed packet, changed slice plan, duplicate slice, skipped predecessor, modified result, or invalid digest fails closed. The service never reconstructs an old whole-domain candidate from the journal.

## Single-track deletion

The implementation removes:

- the projection `workflowJsonSchema` / StructuredOutput route;
- the complete-slice semantic JSON envelope and parser;
- projection DSML/tool-call/fallback parsing;
- projection continuation that resubmits an aggregate semantic candidate;
- projection raw/transcript logging of semantic payload frames;
- the dispatch identity fallback used when a staged packet has no `packet.source`;
- tests and fixtures that admit either old aggregate projection protocol.

Validation operations may continue using their existing small StructuredOutput contract. Foundation Reviewer/Revision, Checklist, UI, Task 9–15, raw Markdown documents, canonical Game IR DTOs, committed reader and downstream consumers are outside this change.

## Error and recovery behavior

- Invalid slice output returns an exact slice-bound diagnostic and retries only that slice.
- Repeating the same invalid slice candidate with the same diagnostic is explicit no progress; it is not hidden by another full-domain rewrite.
- Provider truncation continues the same raw record stream without repeating
  completed text. It cannot discard prior admitted slices.
- A cumulative frame, DSML frame, empty tool identity or malformed record
  stream fails as `provider_stream_protocol_error`; there is no fallback parser.
- A process restart loads and verifies the journal, then dispatches the exact next slice.
- Full-domain admission failure identifies the owning slice from the node kind/evidence subject and reopens only that slice after invalidating it and its successor digest chain. It never mutates an admitted slice silently.
- No business token, time, attempt, slice-count, node-count, or byte-count cap is introduced.

## Acceptance

Automated acceptance must additionally prove true incremental frames, NDJSON
record parsing, cumulative-frame/DSML/tool rejection, continuation without
replay, semantic-payload-free raw/transcript logs, and static unreachability of
the projection StructuredOutput route. It must still prove strict slice scope,
deterministic ordering, cross-slice references, evidence completeness, tamper
rejection, exact recovery, operation-manifest uniqueness, stale-journal cleanup
and unchanged validation behavior.

Chrome acceptance runs the existing real project from its current Foundation READY authority through all six committed Game IR modules and pauses before Checklist. UI status is insufficient: logs, run state, journal cleanup, ten-operation manifest chain, publication, committed reader, module content, source claims, dependency graph, tokens, duration, retries and recovery are inspected. Metrics are observations, not thresholds.
