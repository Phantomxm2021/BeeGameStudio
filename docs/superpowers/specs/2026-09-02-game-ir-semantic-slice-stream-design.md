# Game IR Stateless Semantic Slice Compilation Design

**Status:** revised after real-provider acceptance and confirmed on 2026-09-02.

## Purpose

Compile the Foundation READY documents into one strict, revision-bound Game IR
without sending or regenerating a complete domain payload in one model turn and
without relying on a reusable provider session.

The service remains the only owner of canonical Game IR JSON. Model calls are
stateless semantic compilation requests: each request receives only the
authority needed for one semantic slice and returns independent line records.

## Evidence and root cause

Real Chrome acceptance invalidated the packet-once lifecycle assumption:

- each Balance continuation started a new native provider process and Bee Game
  session;
- every retry resent a full prompt of roughly 122–160 KB;
- one run streamed 1,218,645 stdout bytes over about 4 minutes 44 seconds;
- the UI showed only a generic preparing state while hundreds or thousands of
  provider events were still arriving;
- Balance failures changed between unit-dimension ordering and formula
  AST/reference consistency, causing large semantic payloads to be regenerated.

The native CLI is effectively a one-turn process. The runtime closes stdin and
terminates the native process after a successful record-stream turn. A design
that requires the next slice to reuse that process is therefore not a valid
provider-independent contract. Silent fallback to a fresh session and a full
packet resend is a second execution track and must not exist.

Large JSON is a multiplier, not the complete root cause. The unstable behavior
comes from combining a large authority packet, aggregate generation, whole-unit
retry and session reuse. Merely changing the same large payload to YAML or
Markdown would preserve the same failure radius.

## Decision

Stage 5 uses one stateless semantic-slice compiler for every Game IR projection
module.

For each slice the service:

1. derives the slice from the existing projection contract dependency graph;
2. selects only the exact Foundation authority and admitted dependency facts
   required by that slice;
3. renders those facts as a compact, human-readable authority projection;
4. starts an independent provider request;
5. strictly parses one JSON object per physical output line;
6. admits valid records into the operation-local digest journal;
7. retries only rejected records or the owning slice;
8. deterministically assembles and validates the complete canonical module;
9. atomically publishes the existing canonical Game IR JSON.

No step depends on provider resume, session affinity, a prior prompt cache or
conversation memory. Replaying a request from persisted authority and journal
state must produce the same service-owned input bytes.

## Format responsibilities

| Boundary | Format | Responsibility |
| --- | --- | --- |
| Foundation authority | Raw Markdown plus Section Index | Editable business authority from Stages 2–4 |
| Model input | Compact Markdown field blocks and tables | Exact slice identity, contract, source fragments and admitted dependencies |
| Model output | Strict JSONL node records | One independently parseable semantic node per line plus one `done` line |
| Stage 5 staging | Canonical JSON journal entries | Tamper-evident admitted slice state |
| Stage 5 publication | Canonical JSON | The only complete Game IR consumed downstream |

YAML is not used at a machine boundary because implicit typing, whitespace and
multiple equivalent encodings weaken strict admission. Pure Markdown is not
used for model output because typed references and formula ASTs require exact
machine validation. JSONL is retained only as a sequence of small independent
records; the model never returns a complete domain JSON object or array.

## Semantic slice definition

A slice is derived from semantic dependencies, never from token, byte, record,
node, attempt or elapsed-time limits. Examples include:

- one formula dependency frontier;
- one unit/variable frontier;
- one gameplay rule and its condition/effect bindings;
- one scene subtree and its direct runtime bindings;
- one presentation event-binding frontier;
- one logical resource and its delivery variants.

The slice contract fixes allowed node kinds, value fields, edge roles and target
kinds. The service may split a dependency frontier further only when the domain
contract declares independently admissible semantic owners. Provider behavior
and observed output size must never redefine the authority graph.

## Minimal authority projection

Every request is self-contained but does not contain the complete operation
packet. It contains only:

- compile, publication, Foundation revision and slice identities;
- schema/contract digest and exact allowed node kinds;
- exact source fragments selected from the READY-bound Section Index;
- canonical IDs and fields of already admitted direct dependencies;
- the strict JSONL record contract;
- a precise diagnostic when retrying an invalid record or slice.

The service owns source selection. A worker cannot request arbitrary additional
documents or infer authority from a previous conversation. Source fragment IDs
resolve mechanically to exact document, section, excerpt and byte range.

Dependency summaries are projections of admitted canonical nodes, not copied
model prose. They contain only fields required by the current contract.

## Output contract

Each physical line is one strict JSON object:

```jsonl
{"record":"node","sliceId":"balance.formula.frontier.2","fragmentId":"f-017","node":{"id":"balance.formula.f02","kind":"balance.formula","value":{},"references":[],"edges":[]}}
{"record":"done","sliceId":"balance.formula.frontier.2"}
```

The parser rejects unknown fields, blank internal lines, malformed JSON,
duplicate or descending IDs, wrong slice IDs, missing or repeated `done`, and
records after `done`. It never strips, repairs, reorders or translates output.

True text-delta continuation may be used inside one provider request when the
provider streams a single response. It is transport behavior only and cannot
carry authority into another request. Cumulative frames, DSML, tool-call frames
and empty identities are provider protocol errors with no fallback parser.

## Admission, repair and completion

Admission happens at the smallest independently owned record:

- a valid record is persisted once and is not regenerated;
- an invalid record is retried with its exact contract, dependencies, source
  fragments and mechanical diagnostic;
- if a full-module invariant identifies multiple records owned by one slice,
  that slice and its successor digest chain are invalidated and rebuilt;
- a Foundation business defect produces `FoundationDefectReport`; it is never
  repaired by inventing Game IR facts;
- repeating identical invalid bytes with the identical diagnostic and unchanged
  authority is explicit proven no progress, not an arbitrary attempt timeout.

The operation becomes complete only after all declared slices are admitted and
the existing full-domain schema, reference graph, source evidence and cross-domain
checks pass. The existing canonical operation manifest is then written once.

## Durable state and recovery

The operation-local journal remains staging state, not a second authority. It
binds compilation identity, Foundation READY receipt digest, slice-plan digest,
admitted records and predecessor digests.

After restart, the service verifies the journal and starts a fresh independent
request for the exact next slice. It does not attempt to resume or reconstruct a
provider session. A committed canonical operation manifest supersedes the
journal, which is then deleted. Unknown schema, stale identity, changed source,
changed plan or digest mismatch fails closed.

## Stage isolation

This design changes Stage 5 projection compilation only.

- Stage 3 Foundation Reviewer must not import, read or validate Game IR.
- Stage 4 Foundation Revision must not depend on Game IR parser, schema,
  journal or publication state.
- Checklist, Comprehensive Reviewer/Revision, UI and Task 9–15 consumer cutover
  remain outside this change.
- Canonical Game IR DTOs, ten operation manifests, publication receipt and
  committed reader remain unchanged unless a separately reviewed schema defect
  is proven.

Protected Stage 3/4 path and behavior parity is a required gate. A Game IR
failure cannot silently re-enter Reviewer/Revision or mutate Foundation state.

## Single-track deletion

The final implementation must delete, not retain behind flags:

- `liveGameIrProjectionSessions` and equivalent session-affinity state;
- projection session rebinding and packet-bearing session identity;
- full operation/domain packet rendering for model requests;
- packet-once cache and digest-only continuation prompts;
- fresh-session fallback that resends a full packet;
- complete-domain and complete-slice StructuredOutput projection routes;
- projection DSML/tool-call/compatibility parsers;
- whole-domain correction and regeneration branches;
- tests and fixtures asserting provider-session reuse.

Validation operations may retain their existing small StructuredOutput contract
because they do not share the projection payload or lifecycle. This is a
different operation responsibility, not a second projection track.

## Observability

Every provider request records safe metadata:

- module, slice and retry identity;
- provider session ID;
- prompt and output byte counts;
- first-event, last-event and terminal timestamps;
- parsed/admitted/rejected record counts;
- diagnostic code and digest;
- whether any full-packet marker was detected.

Prompt bodies, semantic payloads and secrets are not written to runtime logs.
The metadata must distinguish active provider streaming, deterministic
validation, retry and proven no progress. Changing how the UI presents that
metadata is a separate task after Stage 5 stabilizes and is outside this design.

Metrics are evidence, not admission limits. The design introduces no fixed
token, byte, time, attempt or record cap.

## Migration order

1. Freeze and mechanically protect Stage 3/4 behavior.
2. Add failing tests that reproduce fresh-session full-packet resend.
3. Implement the stateless minimal authority projection and record-level retry.
4. Cut Balance over first because it exercises units, formulas and recursive
   references, while using shared compiler infrastructure only.
5. Run mock fault matrices before real-provider acceptance.
6. Cut the other five projection modules to the same compiler.
7. Delete packet-once, full-packet and fallback production paths in the same
   cutover; do not leave a compatibility window.
8. Run complete Game IR publication/reader verification.
9. Run fresh Chrome workflows on multiple structurally different projects and
   stop before Checklist.
10. Only after Stage 5 acceptance, resume Task 9–15 consumer migration.

## Verification

Automated tests must prove:

- every slice succeeds in a fresh provider session;
- no prompt contains the complete domain or operation packet;
- an invalid formula, unit, source binding or reference retries only its owner;
- admitted records are never regenerated;
- crash recovery resumes from the exact journal cursor without session state;
- malformed JSONL, cumulative frames and compatibility shapes fail closed;
- deterministic assembly produces byte-identical canonical output;
- no packet-once/full-packet/fallback production route remains reachable;
- Stage 3/4 protected parity remains unchanged.

Chrome acceptance must use at least three projects with different structures:
formula-heavy, scene/resource-heavy and interaction/state-heavy. For each run,
inspect logs, journal cleanup, ten-operation manifest chain, publication,
committed reader, module content, source claims and dependency graph. Record
actual tokens, duration, bytes and retries without assigning arbitrary pass/fail
thresholds.

## Completion criteria

The design is complete only when all six projection modules use the stateless
compiler, the old projection paths are absent from production code, the
canonical Game IR is published successfully for all acceptance profiles, and
Reviewer/Revision parity remains unchanged.
