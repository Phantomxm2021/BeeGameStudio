# Eight-Document Authority Sidecars Design

**Date:** 2026-08-12

## Goal

Reduce the token cost of producing the eight complete game-development documents without shortening those documents, disabling Claude Code features, or allowing Bee Game Studio (BGS) to author or reinterpret game authority.

The optimization targets repeated machine-to-machine transfer of upstream prose. Each human-readable Markdown document remains complete. Claude Code also authors a compact, structured authority sidecar that downstream document authors consume by default.

## Scope

This design applies to the existing eight Foundation documents:

1. `docs/GDD.md`
2. `docs/LEVEL_SCENE_DESIGN.md`
3. `docs/BALANCE_DESIGN.md`
4. `docs/TECHNICAL_DESIGN.md`
5. `docs/ART_DIRECTION.md`
6. `docs/UI_UX_SPEC.md`
7. `docs/AUDIO_DESIGN.md`
8. `docs/ASSET_PLAN.md`

It changes four connected behaviors:

- document completion produces a Markdown document and an authority sidecar;
- downstream authors receive contracted authority records instead of upstream section bodies by default;
- service-owned syntax faults do not cause content regeneration;
- usage reporting distinguishes processing volume from weighted consumption and retry waste.

## Non-goals

- Do not shorten the eight Markdown documents into summaries or skeletons.
- Do not disable thinking, native Claude Code tools, prompt caching, or normal file inspection.
- Do not have BGS call another model to summarize authored documents.
- Do not let BGS infer game design decisions from prose.
- Do not reset the Claude Code context between document sections.
- Do not increase write chunk sizes merely to reduce the visible turn count.
- Do not use a fixed raw-token ceiling as the sole quality or efficiency gate.

## Chosen Approach

Every Foundation Markdown document has an adjacent JSON sidecar:

| Markdown | Authority sidecar |
| --- | --- |
| `docs/GDD.md` | `docs/GDD.authority.json` |
| `docs/LEVEL_SCENE_DESIGN.md` | `docs/LEVEL_SCENE_DESIGN.authority.json` |
| `docs/BALANCE_DESIGN.md` | `docs/BALANCE_DESIGN.authority.json` |
| `docs/TECHNICAL_DESIGN.md` | `docs/TECHNICAL_DESIGN.authority.json` |
| `docs/ART_DIRECTION.md` | `docs/ART_DIRECTION.authority.json` |
| `docs/UI_UX_SPEC.md` | `docs/UI_UX_SPEC.authority.json` |
| `docs/AUDIO_DESIGN.md` | `docs/AUDIO_DESIGN.authority.json` |
| `docs/ASSET_PLAN.md` | `docs/ASSET_PLAN.authority.json` |

Claude Code authors both outputs in the same document task. BGS validates, canonicalizes, persists, and projects the outputs. BGS never creates authority statements itself.

Embedding machine records inside Markdown was rejected because it would make human documents noisy. A separate BGS summarization pass was rejected because it would add token cost and could change authority.

## Authority Sidecar Contract

Claude Code submits only the semantic record array. The stored sidecar is canonical JSON with this logical shape:

```ts
type FoundationAuthoritySidecar = Readonly<{
  schemaVersion: 1
  documentPath: FoundationDocumentPath
  documentDigest: string
  records: readonly FoundationAuthorityRecord[]
}>

type FoundationAuthoritySubmission = Readonly<{
  records: readonly FoundationAuthorityRecord[]
}>

type FoundationAuthorityRecord = Readonly<{
  authorityId: string
  sectionId: string
  kind:
    | 'fact'
    | 'decision'
    | 'constraint'
    | 'metric'
    | 'dependency'
    | 'risk'
    | 'open_decision'
  state: 'confirmed' | 'assumed' | 'deferred'
  statement: string
  responsibilityIds: readonly GameDocumentResponsibility[]
  value?: string | number | boolean
  unit?: string
}>
```

Rules:

- BGS injects `schemaVersion`, `documentPath`, and `documentDigest` after it has canonicalized service-owned Markdown metadata. Claude Code does not predict or repeat those fields.
- `documentDigest` is the SHA-256 digest of the final canonical Markdown bytes.
- `documentPath` equals the assigned document path.
- `sectionId` must exist in that document's `GameDocumentContract`.
- `responsibilityIds` must be owned by that section contract.
- `authorityId` values are unique, stable, lowercase identifiers scoped by document and section.
- Records and nested identifier arrays use bytewise canonical order.
- Every contracted section exports at least one record.
- `open_decision` records use `state: 'deferred'`.
- `metric` records with a physical, temporal, currency, rate, ratio, or count value include a unit.
- Statements are compact declarative authority, not Markdown narrative or instructions.
- The canonical sidecar is limited to 96 KiB. Exceeding this limit fails the sidecar, not the completed Markdown.

Structural validation cannot prove semantic completeness. The document-author prompt therefore requires export of every downstream-relevant fact, decision, constraint, metric, dependency, risk, and unresolved decision. Chrome acceptance audits omissions against the Markdown and document contracts.

## Authoring and Commit Flow

1. Claude Code authors and verifies the complete assigned Markdown document with its existing native workflow.
2. Claude Code submits the authority records through the canonical document completion tool.
3. BGS canonicalizes service-owned Markdown syntax, including section-marker whitespace and required front matter.
4. BGS computes the canonical Markdown digest, injects non-semantic sidecar identity metadata, and validates the stored sidecar against the final bytes and the assigned `GameDocumentContract`.
5. BGS stages both files and a prepared receipt.
6. BGS makes the document pair visible to workflow progression only after both files are durable and their digests match the receipt.
7. Restart recovery either completes the prepared pair or keeps the document incomplete; it never reports a document complete with a stale or missing sidecar.

The workflow does not ask Claude Code to rewrite a valid Markdown document when only the sidecar fails. It dispatches a bounded sidecar-repair task using the canonical Markdown as read-only authority.

## Downstream Projection

`GameDocumentContract.upstreamSections` remains the allowlist. Its meaning changes from “inject or read these complete section bodies by default” to “select authority records belonging to these source sections.”

For a downstream target, BGS:

1. loads the required upstream sidecars;
2. verifies each sidecar digest against its canonical Markdown;
3. selects records whose `sectionId` is listed in the target's upstream contract;
4. preserves contract order and bytewise record order;
5. exposes only the selected sidecar paths and authorized source-section references in the author assignment.

Claude Code reads the compact sidecars first. It may inspect an authorized source section when rationale, examples, or human context are genuinely necessary. The full source document is not embedded in the prompt and is not presented as the default machine interface.

Missing, stale, malformed, or out-of-contract sidecars fail closed before a downstream worker starts. There is no fallback that silently injects every upstream document body.

## BGS and Claude Code Boundary

Claude Code owns:

- the complete human document;
- the authority statements and their classification;
- deciding when an authorized source section needs deeper inspection;
- normal thinking, file tools, and document verification.

BGS owns only:

- the static document and dependency contracts;
- schema, identity, digest, size, ordering, and ownership validation;
- service-owned syntax normalization;
- durable commit and restart recovery;
- exact projection of records selected by the static contract;
- usage measurement and presentation.

BGS must not rewrite statements, rank decisions, add inferred facts, or remove conflicting authority. Conflicts remain visible for the responsible Claude Code author or user to resolve.

## Failure and Repair Behavior

- **Service syntax variance:** normalize section markers and front matter before content validation; do not call the model again.
- **Invalid sidecar with valid Markdown:** retain the Markdown and request only a sidecar repair.
- **Markdown digest changed:** invalidate the old sidecar and block downstream use until a matching sidecar is committed.
- **Missing required authority coverage:** block downstream dispatch and request a sidecar repair from the owning document task.
- **Invalid downstream selector:** treat it as a product-code contract error, not a model retry.
- **Model or API error:** surface the provider error and preserve completed durable files.
- **Restart during commit:** reconcile the prepared receipt before scheduling new model work.

## Usage Telemetry

Persist per document and per attempt:

- fresh input tokens;
- cache-read tokens;
- cache-creation tokens when available;
- output tokens;
- raw processed tokens;
- weighted tokens from the billing authority;
- model turns and tool calls;
- Markdown and sidecar byte counts;
- projected authority bytes;
- authorized full-section reads when observable;
- retry tokens and a stable retry reason.

The project UI presents raw processed volume, fresh input, cache, output, weighted consumption, and retry waste as separate values. It must not label raw `input + cache + output` as the effective cost.

The primary efficiency measure is weighted tokens per successfully validated document. Secondary measures are projected authority bytes, full-section fallback reads, failed-attempt tokens, and total elapsed time.

## Compatibility and Migration

Existing completed projects without sidecars remain readable by humans, but they cannot act as trusted upstream authority for a new optimized document run. When such a project resumes, BGS schedules sidecar-only backfill for each required completed document in dependency order. It does not regenerate the Markdown.

New runs require sidecars from the first document onward. No legacy full-body fallback is introduced.

## Verification

Automated verification must cover:

- sidecar schema, canonical ordering, size, ID uniqueness, section ownership, states, units, and digest binding;
- service-owned marker normalization before digest calculation;
- two-file prepared commit and restart recovery;
- sidecar-only repair without Markdown regeneration;
- exact downstream selection by contracted source sections;
- rejection of missing, stale, extra, and out-of-contract records;
- absence of full upstream bodies from document assignment prompts;
- per-document usage aggregation and distinct UI metrics;
- compatibility backfill for pre-sidecar Markdown.

The final acceptance is a real Chrome run through the normal BGS UI and fixed service ports:

1. create a new test project without committing the test idea to source;
2. generate all eight documents and stop before game implementation;
3. confirm all sixteen files are durably present;
4. audit each Markdown document for discipline completeness, human clarity, Agent usability, required production materials, and non-redundancy;
5. sample every sidecar against its Markdown and verify downstream traceability;
6. report per-document and total fresh input, cache read, output, weighted tokens, turns, retries, projected authority bytes, and full-section reads;
7. compare the result with the existing eight-document baseline without treating cache reads as fresh billable input.

Acceptance requires complete, usable documents; zero full-document regeneration caused by BGS-owned syntax or sidecar faults; exact token reporting; and demonstrably smaller default upstream context for documents two through eight. A token reduction does not pass if document quality or downstream implementability regresses.
