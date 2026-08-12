# Document Authority Trust and Token Optimization Design

Date: 2026-08-12  
Status: Approved design direction, pending implementation-plan review  
Evidence source: `docs/superpowers/evidence/2026-08-12-eight-document-authority-sidecars.md`

## Goal

Keep the existing idea-to-eight-documents workflow and Claude Code authoring model, while making the resulting document package trustworthy, less repetitive, easier for humans and agents to consume, and substantially cheaper to generate.

The change must preserve all eight existing document responsibilities. It must not introduce an MVP document set, a skeleton workflow, another reviewer phase, or a replacement orchestration platform.

## Verified problems to solve

The Chrome-generated instance proved that the workflow can commit all eight documents, but also exposed the following systemic defects:

1. Twenty-six of forty-seven explicit upstream authority references were not resolvable. UI/UX contained twelve invalid IDs and Asset Plan contained fourteen.
2. The Asset Plan asserted that unselected external assets had commercial licenses and referred to `assets/_licenses/*.txt` files that did not exist.
3. The authority sidecars marked 210 of 212 records `confirmed`, even though the Markdown contained model estimates, assumptions and at least thirteen open decisions.
4. Production Materials and Audit Appendices occupied 118,287 bytes, or 28.8% of the final Markdown. Much of this was a second textual projection of facts already stated in the main sections.
5. Art and UI embedded 29,938 bytes of SVG source directly in Markdown.
6. Art and Asset used 52 and 64 H2 headings respectively; UI and Asset contained duplicate headings.
7. The reliable part protocol required eighteen successful model calls per document. UI/UX, Audio and Asset therefore accumulated 7,946,240 cache-read tokens across fifty-four successful calls.

## Non-goals

- Do not merge the eight documents into one GDD.
- Do not remove discipline-specific production content.
- Do not add another semantic reviewer or autonomous repair loop.
- Do not make BeeGameStudio interpret or rewrite Claude Code's game-design decisions.
- Do not silently resolve project-specific open decisions.
- Do not return to one-shot full-document JSON submission.
- Do not build a new generic document database or cross-project orchestration framework.
- Do not treat this instance's particular game facts as product defaults or fixtures.

## Design principles

1. The user and confirmed brief own intent. User settings and explicit user choices outrank model estimates.
2. Claude Code authors game-development content. BeeGameStudio validates trust, identity, structure, evidence and persistence only.
3. Every authoritative fact is authored once. Human views and machine views are deterministic projections of the same record where practical.
4. Unknown information remains unknown. A planned asset, estimated budget or proposed metric must never be rendered as verified fact.
5. Reliability and efficiency are separate gates. Bounded batching may reduce calls but may not weaken durable recovery or validation.

## Existing architecture retained

The implementation continues to use the current components:

- `game-document-contracts.ts` owns the eight document contracts, section order and material requirements.
- `complete-game-document.ts` validates and renders complete foundation Markdown.
- `foundation-authority-sidecar.ts` validates compact authority records and binds them to the Markdown digest.
- `native-canonical-document-tool.ts` owns durable draft parts and the final document/sidecar commit.
- `delivery-worker-session-port.ts` gives Claude Code the authoring contract.
- Document receipts remain the authority for successful persistence.

No new coordinator or workflow phase is introduced.

## 1. Authority trust model

### Record fields

Each authority record retains its current identity, section, kind, statement, responsibilities, optional value and optional unit. It adds:

```ts
type AuthoritySource =
  | 'user_setting'
  | 'confirmed_brief'
  | 'upstream_authority'
  | 'model_estimate'
  | 'measured_evidence'
  | 'external_evidence'

type AuthorityState =
  | 'confirmed'
  | 'assumed'
  | 'deferred'
  | 'verified'

type AuthorityEvidenceRef = Readonly<{
  kind: 'file' | 'receipt' | 'test' | 'measurement' | 'license' | 'url'
  locator: string
  digest?: string
}>
```

Each record adds:

```ts
source: AuthoritySource
evidenceRefs: readonly AuthorityEvidenceRef[]
```

### State rules

- `user_setting` and `confirmed_brief` may produce `confirmed` records.
- `upstream_authority` preserves the upstream state; it cannot upgrade it.
- `model_estimate` must use `assumed` or `deferred`.
- `measured_evidence` and `external_evidence` may use `verified` only with at least one evidence reference.
- `open_decision` must use `deferred`.
- `verified` without evidence is rejected.
- Model-authored budgets, dates, completion-rate targets and other estimates are rejected when marked `confirmed` or `verified` without qualifying upstream evidence.

### Priority

When two inputs attempt to define the same owned fact, the accepted order is:

1. explicit user setting or explicit user choice;
2. confirmed product brief;
3. verified evidence;
4. confirmed upstream authority;
5. assumption;
6. deferred/open decision.

The service rejects a lower-priority record that attempts to replace a higher-priority record. It does not merge or reinterpret their content.

## 2. Referential integrity

### Upstream references

Claude Code no longer authors the Audit Appendix's display list of upstream authority references. It submits the authority records it actually consumed as structured references:

```ts
type UpstreamAuthorityReference = Readonly<{
  path: FoundationDocumentPath
  authorityId: string
}>
```

Before accepting the audit part, the service validates that:

- the path is permitted by the document contract;
- the referenced sidecar exists and matches its document digest;
- the authority ID exists exactly in that sidecar;
- the reference uses the full canonical ID;
- duplicate references are rejected;
- references are sorted bytewise before rendering.

The service then renders the human-readable `Upstream Authority` list from the validated records. Aliases, shortened IDs and section-name substitutes are not accepted.

### Open-decision closure

The audit appendix and authority sidecar must describe the same open-decision set:

- every submitted audit decision has exactly one `open_decision` authority record;
- every `open_decision` record has exactly one audit decision;
- both use `deferred` state;
- IDs, owner and needed-by milestone match.

Concrete calendar dates are accepted only when provided by a user setting, confirmed brief or verified project schedule. Otherwise `neededBy` must be a real contracted milestone ID or phase boundary.

## 3. License and external-reference truth

### License states

External assets and references use one of these states:

```ts
type LicenseState =
  | 'planned_original'
  | 'source_not_selected'
  | 'license_unverified'
  | 'verified'
  | 'replacement_required'
```

`verified` requires all of:

- a concrete source locator;
- a license type;
- an evidence file or stable license URL;
- a SHA-256 digest for local evidence files;
- commercial-use scope;
- attribution requirements.

The document renderer may say “commercial use verified” only for the `verified` state. Missing files, missing locators, generic source descriptions and planned purchases remain unverified.

### Filesystem validation

Any evidence reference under the project root is resolved and checked before commit. The path must be project-relative, remain inside the project root and exist as a regular file. Its digest is recomputed. A nonexistent `assets/_licenses/*.txt` path is rejected rather than rendered as evidence.

### Audio and visual references

Reference registers distinguish:

- a search direction, which may have description only and is not evidence;
- a design reference, which requires a stable URL and attribution metadata;
- a production asset, which additionally requires license verification.

## 4. One authority, multiple deterministic views

### Model-authored content

Claude Code remains responsible for:

- the executive summary;
- the ten discipline sections;
- authoritative records;
- the semantic content needed for contracted diagrams, matrices and registers;
- risks and open decisions.

### Service-rendered content

BeeGameStudio renders, without inventing new design facts:

- Upstream Authority;
- Open Decisions list from matched authority records;
- acceptance references that point to existing metric/constraint IDs;
- material headings and artifact links;
- metadata, canonical ordering and receipts.

Acceptance criteria may contain a short human-readable label, but repeated thresholds are rendered by reference to the owning authority record instead of being regenerated as a second independent statement.

### Production materials

Production materials remain mandatory, but each must be either:

- a unique structured view that adds operational value; or
- a deterministic projection from authority records and artifact data.

A production material is rejected when it merely repeats a main-section table with no distinct purpose or consumer.

## 5. External visual artifacts

Inline SVG is removed from Markdown output. The server persists generated visual material under:

```text
docs/artifacts/<document-id>/<material-id>.svg
```

The Markdown contains only:

```markdown
![Visual Pillar Board](artifacts/art-direction/visual-pillar-board.svg)

Artifact ID: `visual-pillar-board`
Purpose: Make the visual hierarchy and prohibited directions inspectable.
```

The artifact path, media type and digest are recorded in the document receipt. The final document is not visible until all required artifacts and the authority sidecar are prepared.

Mermaid source may remain inline because it is compact and semantically useful to agents. Large rendered Mermaid images, when produced, are artifacts and are not duplicated inline.

## 6. Heading and navigation rules

The service owns H1 and H2 headings. Section bodies may use H3 and H4 only.

Validation rejects:

- H1 or H2 inside a section body;
- duplicate normalized headings in one document;
- skipped heading levels;
- a concrete `neededBy` date without authoritative schedule evidence.

A compact table of contents is rendered from canonical headings. Protocol headings remain English; project-authored subsection language follows the configured project language.

## 7. Bounded multi-part submission

### Input shape

The native tool accepts a batch of consecutive parts:

```ts
type DocumentPartBatch = Readonly<{
  parts: readonly DocumentPart[]
}>
```

Rules:

- one to three parts per call;
- serialized input maximum: 16 KiB;
- parts must begin at the exact current `nextPart` and remain consecutive;
- each part is validated independently in order;
- the service persists each valid part before validating the next part;
- the response reports all accepted parts and the exact next expected part;
- retrying an already accepted identical part is idempotent;
- retrying an accepted part with different content is rejected;
- a failing later part does not discard earlier valid parts from the same call.

The one-part form remains accepted as a compatibility path. The full-document one-shot form remains compatibility-only and is not instructed by the worker prompt.

### Call target

The prompt instructs Claude Code to submit two or three consecutive parts while staying below 16 KiB. A ten-section, five-material document should normally complete in six to nine successful calls instead of eighteen.

### Unnecessary tool use

The authoring prompt explicitly states that:

- `TodoWrite` is unnecessary for the fixed canonical part sequence;
- a post-commit full-document `Read` is unnecessary;
- the committed receipt and recomputed service digest are the completion proof.

BeeGameStudio does not disable Claude Code tools globally; it provides the scoped instruction for this document-author task only.

## 8. Migration and compatibility

- Existing schema-version-1 sidecars remain readable.
- New commits write schema version 2 with source and evidence fields.
- Version-1 records are treated as `source: upstream_authority` only when read from their own digest-valid sidecar; their existing state is preserved.
- Version-1 license statements do not become verified evidence.
- Existing one-part drafts can resume under the batched tool because `nextPart` semantics are unchanged.
- Existing final Markdown files are not rewritten automatically.

## 9. Failure handling

- Invalid authority reference: reject the audit part with the missing path and authority ID.
- Missing evidence: reject `verified`; allow the record only after the caller explicitly changes it to an unverified state.
- Oversized batch: reject before persisting any part and report the byte count and 16 KiB limit.
- Out-of-order batch: reject before persisting any part and return the current `nextPart`.
- Invalid second or third part: retain prior valid parts from that batch and return the precise failed part plus the new `nextPart`.
- Artifact write failure: keep the draft prepared but do not expose final Markdown or sidecar.
- Receipt/digest mismatch: fail closed and retain recovery metadata.

API errors must preserve the concrete validation reason in server logs and return a bounded user-visible error message. Generic “tool failed” messages are not sufficient.

## 10. Testing strategy

### Unit and contract tests

Tests must prove:

- model estimates cannot be confirmed or verified without evidence;
- user settings outrank lower-priority model records;
- every upstream ID resolves against a digest-valid sidecar;
- the twenty-six invalid-reference patterns from the audited instance are rejected;
- open decisions have exact audit/sidecar closure;
- nonexistent license evidence cannot be verified;
- inline SVG is persisted externally and replaced by a Markdown reference;
- duplicate H2/H3 and body-owned H1/H2 are rejected;
- two- and three-part batches persist in order;
- partial success within a batch is recoverable and idempotent;
- an oversized batch is rejected without mutation;
- all eight document contracts still require their existing sections and production responsibilities.

### Full generated fixture

A neutral, non-game-specific fixture must produce all eight complete documents. It must not contain a tower-defense or other named showcase concept. The fixture verifies contract completeness, not prose quality.

### Chrome acceptance

After all deterministic tests pass, create a new project through Chrome using a neutral user-supplied game idea. Use the fixed service ports. Stop immediately after all eight documents commit and before document review or implementation.

Measure:

- 8/8 document and sidecar receipts;
- document and artifact digest matches;
- upstream authority resolution rate;
- license/evidence state validity;
- open-decision closure;
- duplicate heading count;
- inline SVG byte count;
- successful and failed calls per document;
- input, cache-read and completion tokens separately;
- Markdown, sidecar and artifact sizes;
- human and agent readability of the actual generated documents.

## 11. Acceptance criteria

The design is implemented only when all of the following are true:

1. All eight existing document responsibilities and required sections remain intact.
2. All explicit upstream authority references resolve exactly; target is 100%.
3. No asset or reference is rendered as license-verified without real evidence.
4. Every open decision appears in both the audit view and authority sidecar with deferred state.
5. Model estimates and invented dates are not confirmed authority.
6. Foundation Markdown contains no inline SVG source.
7. No document contains duplicate canonical headings or section-owned H1/H2.
8. The deterministic complete-foundation audit passes for all eight documents.
9. Normal generation requires no more than nine successful document-part calls per document.
10. Failed or interrupted batched generation resumes without losing accepted parts.
11. A new Chrome run commits all eight documents and stops before review/implementation.
12. The new Chrome run shows a material reduction in cache-read tokens relative to the audited one-part protocol; input, cache and completion are reported separately.

## Expected effect

The design targets these conservative outcomes without reducing document scope:

- Markdown reduced from 410 KB to approximately 300–335 KB;
- sidecars reduced from 110 KB to approximately 70–85 KB through structured, non-repetitive statements;
- approximately 30 KB of inline SVG moved to artifacts;
- approximately 50,000–90,000 fewer completion tokens across eight documents;
- successful document calls reduced from eighteen to six-to-nine per document;
- cache-read tokens reduced by approximately 50–65% on a clean comparable run.

These are measurement targets, not pre-declared verified results. The Chrome acceptance run determines the actual outcome.
