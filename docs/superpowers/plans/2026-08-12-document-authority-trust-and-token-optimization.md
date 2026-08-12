# Document Authority Trust and Token Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the current idea-to-eight-documents workflow while making every committed document, authority sidecar, reference, license claim, heading, and external artifact trustworthy, recoverable, and materially cheaper to generate.

**Architecture:** Keep the existing document contracts, Claude Code author, native commit tool, authority projection, and receipts. Upgrade the authority sidecar to schema v2, validate all cross-document and evidence references against files already committed on disk, delay final Markdown visibility until the audit, authority sidecar, and artifacts have all prepared successfully, and reduce model turns with bounded consecutive-part batches. BeeGameStudio owns validation, deterministic rendering, evidence checks, and persistence; Claude Code continues to own game-design content.

**Tech Stack:** TypeScript, Zod v4, Bun test, Node filesystem/crypto APIs, existing BeeGameStudio delivery workflow and Claude Code native tool runtime, Chrome on fixed local service ports.

---

## Constraints that apply to every task

- Keep all eight existing foundation documents, their current section responsibilities, and required production materials.
- Do not add a reviewer phase, repair agent, generic document database, alternate orchestrator, MVP path, or skeleton output.
- Do not add a named game concept to fixtures. Deterministic fixtures must use neutral contract text only.
- Do not let BeeGameStudio invent, rewrite, merge, or silently resolve game-design decisions.
- Preserve schema-v1 sidecar reads and one-part native-tool submissions.
- Write tests before implementation for every behavior change.
- Run focused tests after each task, then `bun run typecheck` and `git diff --check` before each commit.
- Do not start the Chrome run until all deterministic suites pass.

## Task 1: Upgrade authority sidecars to an evidence-aware v2 trust model

**Files:**

- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`

- [ ] **Step 1: Add failing v2 trust and migration tests**

Add tests proving all of the following:

1. new sidecars write `schemaVersion: 2`;
2. `model_estimate + confirmed` and `model_estimate + verified` are rejected;
3. `verified` without an evidence reference is rejected;
4. `open_decision` is rejected unless deferred and carrying owner/needed-by metadata;
5. `upstream_authority` cannot upgrade an upstream assumed/deferred record;
6. the same authority ID cannot be redefined by a lower-priority source;
7. schema-v1 sidecars remain readable, preserve their state, and project as legacy upstream authority rather than verified evidence;
8. projected v2 records retain source and evidence metadata.

Use the concrete record shape:

```ts
type AuthoritySource =
  | 'user_setting'
  | 'confirmed_brief'
  | 'upstream_authority'
  | 'model_estimate'
  | 'measured_evidence'
  | 'external_evidence'

type AuthorityState = 'confirmed' | 'assumed' | 'deferred' | 'verified'

type AuthorityEvidenceRef = Readonly<{
  kind: 'file' | 'receipt' | 'test' | 'measurement' | 'license' | 'url'
  locator: string
  digest?: string
}>
```

For `open_decision`, add a v2-only field:

```ts
decision: {
  owner: string
  neededBy: string
}
```

This is the machine representation needed to enforce the already-approved open-decision closure; it is not a new workflow concept.

Run RED:

```bash
bun test \
  packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.test.ts \
  packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
```

Expected: failures because v2 fields, source/state rules, and v1 migration do not exist.

- [ ] **Step 2: Split readable sidecar schemas from writable v2 schema**

Implement:

```ts
const storedAuthoritySidecarV1Schema = z.object({
  schemaVersion: z.literal(1),
  // existing v1 fields
}).strict()

const storedAuthoritySidecarV2Schema = z.object({
  schemaVersion: z.literal(2),
  documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
  documentDigest: sha256Schema,
  records: z.array(authorityRecordV2Schema).min(1),
}).strict()

const readableAuthoritySidecarSchema = z.discriminatedUnion('schemaVersion', [
  storedAuthoritySidecarV1Schema,
  storedAuthoritySidecarV2Schema,
])
```

`createFoundationAuthoritySidecar` must always create v2. `validateFoundationAuthoritySidecar` must read v1 or v2 and return one normalized in-memory type without changing stored bytes.

- [ ] **Step 3: Enforce state/source/evidence and priority rules**

Add pure validators:

```ts
function assertAuthorityTrust(record: FoundationAuthorityRecord): void
function authorityPriority(record: FoundationAuthorityRecord): number
function assertNoLowerPriorityReplacement(records: readonly FoundationAuthorityRecord[]): void
```

The replacement key is the full canonical `authorityId`. Duplicate IDs remain invalid; when migration or input composition exposes the same ID twice, the error must name both source priorities rather than selecting one silently.

Rules:

- `user_setting` and `confirmed_brief`: confirmed only;
- `model_estimate`: assumed or deferred only;
- `measured_evidence` and `external_evidence`: verified only when evidence is non-empty;
- `upstream_authority`: preserve supplied upstream state and evidence exactly;
- `open_decision`: deferred with `decision.owner` and `decision.neededBy`;
- local file evidence requires a lowercase SHA-256 digest syntactically; existence is checked later when a workspace is available.

- [ ] **Step 4: Normalize v1 projections without upgrading trust**

When projecting a v1 sidecar, map records in memory to:

```ts
{
  ...legacyRecord,
  source: 'upstream_authority',
  evidenceRefs: [],
}
```

Do not convert legacy `confirmed` license prose into `verified`. Projection ordering and frozen output must remain unchanged.

- [ ] **Step 5: Update test fixtures and worker contract wording**

Update neutral test records to include explicit source/evidence. Update the native author contract fixture so it no longer teaches the old six-field record shape.

- [ ] **Step 6: Run GREEN and commit**

```bash
bun test \
  packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.test.ts \
  packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
bun run typecheck
git diff --check
git add \
  packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.ts \
  packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.test.ts \
  packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts \
  packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
git commit -m "feat: add evidence-aware authority records"
```

## Task 2: Replace untrusted license prose with structured evidence registers

**Files:**

- Create: `packages/agent-workflow-server/src/beegame/document-evidence.ts`
- Create: `packages/agent-workflow-server/src/beegame/document-evidence.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts`

- [ ] **Step 1: Add failing evidence-state tests**

Test the five states:

```ts
type LicenseState =
  | 'planned_original'
  | 'source_not_selected'
  | 'license_unverified'
  | 'verified'
  | 'replacement_required'
```

Required RED cases:

- `verified` without source locator, license type, commercial-use scope, attribution policy, or evidence is rejected;
- a missing project-relative evidence file is rejected;
- a local evidence digest mismatch is rejected;
- `javascript:`, `data:`, and malformed external URLs are rejected;
- a search direction without a selected source remains `source_not_selected` and is not rendered as licensed;
- a valid `https:` license URL or digest-matching local license file validates;
- project-root traversal is rejected.

Run RED:

```bash
bun test \
  packages/agent-workflow-server/src/beegame/document-evidence.test.ts \
  packages/agent-workflow-server/src/beegame/complete-game-document.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts
```

- [ ] **Step 2: Implement a focused evidence schema and filesystem validator**

Use one focused type, not a generic asset database:

```ts
export const documentEvidenceEntrySchema = z.object({
  evidenceId: canonicalIdSchema,
  category: z.enum(['search_direction', 'design_reference', 'production_asset']),
  displayName: z.string().trim().min(1),
  purpose: z.string().trim().min(1),
  state: z.enum(LICENSE_STATES),
  sourceLocator: z.string().trim().min(1).optional(),
  licenseType: z.string().trim().min(1).optional(),
  commercialUse: z.boolean().optional(),
  attribution: z.string().trim().min(1).optional(),
  evidenceRefs: z.array(authorityEvidenceRefSchema),
}).strict()
```

Implement:

```ts
export async function validateDocumentEvidenceEntries(input: {
  workspacePath: string
  entries: readonly DocumentEvidenceEntry[]
}): Promise<readonly DocumentEvidenceEntry[]>
```

Resolve local paths with `resolve`, `relative`, `lstat`, and SHA-256 recomputation. Require a regular file. Return canonical bytewise ordering. Error messages must include the evidence ID and failing locator.

- [ ] **Step 3: Make the two license/reference registers structured**

Extend the production-material union with `evidence_register`. Change only:

- `docs/AUDIO_DESIGN.md#sound-reference-register`;
- `docs/ASSET_PLAN.md#license-register`.

The model submits entries, not an arbitrary Markdown table. The service renders the table deterministically and uses the exact state language. It must never render “commercial use verified” for any state other than `verified`.

Keep all material IDs and purposes unchanged. This is a format hardening, not removal of a responsibility.

- [ ] **Step 4: Keep compatibility narrow and explicit**

Existing committed Markdown is not migrated. Old in-progress v1 drafts containing raw `markdown_table` license registers may resume only through the existing draft schema; new drafts must use `evidence_register`. Do not silently infer verified evidence from legacy table prose.

- [ ] **Step 5: Run GREEN and commit**

```bash
bun test \
  packages/agent-workflow-server/src/beegame/document-evidence.test.ts \
  packages/agent-workflow-server/src/beegame/complete-game-document.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts
bun run typecheck
git diff --check
git add \
  packages/agent-workflow-server/src/beegame/document-evidence.ts \
  packages/agent-workflow-server/src/beegame/document-evidence.test.ts \
  packages/agent-workflow-server/src/beegame/complete-game-document.ts \
  packages/agent-workflow-server/src/beegame/complete-game-document.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts
git commit -m "fix: require evidence for license claims"
```

## Task 3: Enforce real upstream references and exact open-decision closure

**Files:**

- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts`

- [ ] **Step 1: Add failing referential-integrity tests**

Cover:

- allowed path but nonexistent authority ID;
- shortened ID, section alias, and wrong-document ID;
- stale sidecar whose digest no longer matches Markdown;
- duplicate reference;
- non-bytewise reference order in input being canonicalized for rendering;
- audit decision missing from authority;
- authority open decision missing from audit;
- mismatched owner or needed-by;
- untrusted concrete date in `neededBy`;
- a milestone ID backed by a confirmed/verified schedule record succeeding.

Include representative malformed IDs matching the audited UI/Asset failure pattern, but do not include the audited game concept or copy its content.

- [ ] **Step 2: Resolve references while the audit part is prepared**

Add a workspace-aware resolver:

```ts
export async function resolveUpstreamAuthorityReferences(input: {
  workspacePath: string
  targetPath: FoundationDocumentPath
  references: readonly UpstreamAuthorityReference[]
}): Promise<readonly ResolvedUpstreamAuthorityReference[]>
```

For each allowed path, read Markdown and sidecar from disk, call `validateFoundationAuthoritySidecar`, and require exact membership of `authorityId`. Reject duplicates. Return frozen bytewise ordering.

Do not let `renderCompleteGameDocument` trust a model-authored display string. Its input receives already-resolved references and renders:

```md
- `docs/GDD.md` — `gdd.core_loop.primary`
```

- [ ] **Step 3: Validate audit/authority decision closure at final preparation**

Implement a pure function:

```ts
export function assertOpenDecisionClosure(input: {
  audit: CompleteGameDocumentAuditAppendix
  authority: FoundationAuthoritySidecar
  trustedScheduleAuthorityIds: ReadonlySet<string>
}): void
```

Use the same `decisionId` as the authority record's canonical ID. Require exact set equality and matching owner/needed-by. A concrete date must cite a confirmed or verified user/brief/schedule authority record; otherwise require a stable milestone/phase ID.

- [ ] **Step 4: Render acceptance and audit views from authority IDs**

Acceptance criteria may retain a short label but any threshold/constraint reference must resolve to an authority ID. Render upstream references and open decisions server-side. Reject exact normalized duplication of a whole section body as a production material body; broader semantic redundancy remains a Chrome document-quality check, not a new reviewer.

- [ ] **Step 5: Run GREEN and commit**

```bash
bun test \
  packages/agent-workflow-server/src/beegame/complete-game-document.test.ts \
  packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts
bun run typecheck
git diff --check
git add \
  packages/agent-workflow-server/src/beegame/complete-game-document.ts \
  packages/agent-workflow-server/src/beegame/complete-game-document.test.ts \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts \
  packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts \
  packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts
git commit -m "fix: resolve document authority references"
```

## Task 4: Normalize headings and externalize SVG production materials

**Files:**

- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/document-readiness-audit.ts`
- Modify: `packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts`

- [ ] **Step 1: Add failing heading and artifact tests**

Prove:

- H1/H2 inside section bodies are rejected;
- duplicate normalized H3/H4 headings are rejected;
- H3 directly followed by H5 is rejected;
- the renderer adds one compact table of contents from canonical headings;
- Art/UI `inline_svg` input becomes an external `.svg` file and a short Markdown link;
- Markdown contains no `<svg` source;
- receipt artifact path/media/digest match disk;
- an artifact write failure leaves the final Markdown unchanged/invisible;
- missing or stale artifact causes receipt reconciliation to fail closed.

- [ ] **Step 2: Implement heading validation as a deterministic parser**

Add pure helpers in `complete-game-document.ts`:

```ts
function validateSectionHeadingStructure(sections: readonly CompleteGameDocumentSection[]): void
function normalizedHeading(text: string): string
function renderCanonicalTableOfContents(...): readonly string[]
```

Only parse Markdown heading lines outside fenced code blocks. The service owns H1/H2. Bodies may contain H3/H4 only. Normalize Unicode, trim, collapse whitespace, and compare case-insensitively for duplicates.

- [ ] **Step 3: Prepare SVG artifacts without duplicating their content**

For every contracted `inline_svg` material:

1. validate SVG syntax as today;
2. derive `docs/artifacts/<document-id-slug>/<material-id>.svg`;
3. prepare exact UTF-8 bytes and SHA-256 digest;
4. render only the Markdown image reference, artifact ID, and contract purpose;
5. record `{ artifactId, path, mediaType: 'image/svg+xml', digest }` in the receipt.

The slug is derived deterministically from `CANONICAL_PROJECT_DOCUMENT_IDS` by lowercase and underscore-to-hyphen conversion. Reject unsafe material IDs and any resolved path outside the workspace.

- [ ] **Step 4: Extend readiness auditing**

The deterministic readiness audit must reject inline SVG, missing artifact files, digest mismatches, duplicate headings, and section-owned H1/H2. Keep Mermaid source inline.

- [ ] **Step 5: Run GREEN and commit**

```bash
bun test \
  packages/agent-workflow-server/src/beegame/complete-game-document.test.ts \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts \
  packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts
bun run typecheck
git diff --check
git add \
  packages/agent-workflow-server/src/beegame/complete-game-document.ts \
  packages/agent-workflow-server/src/beegame/complete-game-document.test.ts \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts \
  packages/agent-workflow-server/src/beegame/document-readiness-audit.ts \
  packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts
git commit -m "feat: externalize document visual artifacts"
```

## Task 5: Make document, sidecar, and artifact visibility one fail-closed commit

**Files:**

- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`

- [ ] **Step 1: Add failing visibility and recovery tests**

Capture the current bug explicitly: after the audit part, the target Markdown is currently written with `document_prepared` before authority exists. Replace that expectation with:

- audit preparation stores the complete draft but does not create/replace target Markdown;
- authority validation failure leaves target Markdown, sidecar, and receipt at the old baseline;
- artifact failure leaves final Markdown invisible;
- successful authority call publishes artifacts and sidecar before Markdown, then commits the receipt;
- retry after a crash between prepared files and final receipt reconciles exact digests;
- a committed retry is idempotent;
- changing any already-prepared body/authority/artifact is rejected.

- [ ] **Step 2: Upgrade the draft and receipt schemas**

Draft v2 stores the audit appendix and prepared artifact metadata. Receipt v3 contains:

```ts
type CompleteGameDocumentCommitReceiptV3 = {
  schemaVersion: 3
  dispatchId: string
  targetPath: string
  baselineDigest: string | null
  finalDigest: string
  authorityPath: string
  authorityDigest: string
  artifacts: readonly {
    artifactId: string
    path: string
    mediaType: 'image/svg+xml'
    digest: string
  }[]
  documentId: string
  version: string
  updatedAt: string
  status: 'package_prepared' | 'committed'
}
```

Continue reading receipt v1/v2. New complete-document commits write v3 only.

- [ ] **Step 3: Delay all final visibility until authority closure succeeds**

Change the part flow:

1. header/sections/materials/audit are durably stored under the dispatch draft;
2. audit returns `document_parts_prepared`, not `document_prepared`;
3. the next expected input is authority;
4. authority submission creates v2 sidecar, validates upstream/open-decision/evidence closure, renders Markdown, and computes artifacts;
5. prepare artifact files and sidecar through temporary sibling files and fsync them;
6. prepare receipt v3;
7. rename artifacts, then sidecar, then Markdown last;
8. write committed receipt and remove draft.

Publishing Markdown last is the visibility boundary. An orphan prepared artifact is recoverable and is not evidence of a committed document.

- [ ] **Step 4: Make reconciliation validate the complete package**

`reconcileCanonicalDocumentCommitReceipt` must verify:

- target digest;
- sidecar digest and sidecar-to-document binding;
- every artifact path/media/digest;
- receipt identity;
- no missing draft recovery metadata while status is prepared.

Do not mark a receipt committed merely because Markdown exists.

- [ ] **Step 5: Run GREEN and commit**

```bash
bun test \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
bun run typecheck
git diff --check
git add \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
git commit -m "fix: commit complete document packages atomically"
```

## Task 6: Add bounded two/three-part batches with partial durable success

**Files:**

- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/workflow-tool-input-budget.test.ts`

- [ ] **Step 1: Add failing batch protocol tests**

Test:

- two consecutive valid parts persist and return both accepted identities;
- three consecutive valid parts persist;
- an identical retry is idempotent;
- a changed retry is rejected;
- a batch beginning after the current `nextPart` is rejected without mutation;
- a batch with a valid first part and invalid second body retains the first part and reports the precise second failure/new `nextPart`;
- more than three parts is rejected without mutation;
- serialized input over 16 KiB is rejected without mutation and reports actual bytes;
- legacy `{ part }` remains accepted;
- legacy draft v1 resumes under the batch protocol.

- [ ] **Step 2: Add the batch envelope without eagerly parsing every part**

Use:

```ts
const documentPartBatchEnvelopeSchema = z.object({
  parts: z.array(z.unknown()).min(1).max(3),
}).strict()
```

Do not use `z.array(documentPartSchema)` at the outer boundary because it would reject an invalid later part before earlier valid parts can persist.

- [ ] **Step 3: Implement preflight and sequential persistence**

Algorithm:

1. compute serialized UTF-8 bytes; reject over 16 KiB before mutation;
2. parse only minimal part identities for the full batch and confirm the sequence starts at current `nextPart`; reject out-of-order before mutation;
3. for each part, fully parse, validate, and durable-write independently;
4. after each successful write, advance the draft;
5. on later failure, return/throw a bounded error containing failed identity and the now-current `nextPart`;
6. return `{ status: 'parts_prepared', acceptedParts, nextPart }`.

Errors must reach server logs with their original message and return a bounded user-visible cause; do not collapse them to generic tool failure.

- [ ] **Step 4: Run GREEN and commit**

```bash
bun test \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts \
  packages/agent-workflow-server/src/beegame/workflow-tool-input-budget.test.ts
bun run typecheck
git diff --check
git add \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts \
  packages/agent-workflow-server/src/beegame/workflow-tool-input-budget.test.ts
git commit -m "feat: batch canonical document parts"
```

## Task 7: Update the Claude Code contract and prove all eight documents remain complete

**Files:**

- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts`
- Create: `packages/agent-workflow-server/src/beegame/complete-foundation-fixture.test.ts`

- [ ] **Step 1: Add failing prompt-contract tests**

Require the document-author prompt to say:

- submit two or three consecutive parts when the serialized batch stays under 16 KiB;
- use one part when a body is large;
- wait for exact `nextPart` and never skip;
- submit authority only after `document_parts_prepared`;
- use explicit source/state/evidence fields;
- do not use `TodoWrite` for the fixed sequence;
- do not perform a full-document `Read` after a committed digest receipt;
- do not write the assigned path directly;
- do not claim verified licenses without concrete evidence;
- do not hand-author the rendered upstream/open-decision display lists.

Also assert that the prompt does not disable Claude Code reasoning, thinking, or unrelated tools globally.

- [ ] **Step 2: Update the native tool prompt and worker authority block**

Keep wording short. Provide the exact input examples once, followed by current contract IDs. Do not repeat full source Markdown or the same protocol in multiple paragraphs.

The normal target is six to nine successful document-part calls per document. This is a target, not a client-side hard-coded call count.

- [ ] **Step 3: Add a neutral complete-foundation fixture**

Create a deterministic fixture that generates all eight documents using neutral phrases such as “interactive project”, “primary action”, and “production milestone”. It must not describe a tower-defense game or any other named showcase concept.

For each document, the fixture must create:

- every contracted section;
- every contracted production material in its real format;
- v2 authority records with valid trust states;
- digest-valid upstream references;
- exact open-decision closure;
- valid evidence-register states;
- external SVG artifacts where required;
- a committed v3 receipt.

Assertions:

```ts
expect(committedDocuments).toHaveLength(8)
expect(readinessAudit.valid).toBe(true)
expect(inlineSvgBytes).toBe(0)
expect(unresolvedAuthorityReferences).toEqual([])
expect(duplicateCanonicalHeadings).toEqual([])
expect(documentPartCalls.every(count => count <= 9)).toBe(true)
```

- [ ] **Step 4: Run the full deterministic regression**

```bash
bun test packages/agent-workflow-server/src/beegame
bun run typecheck
git diff --check
```

Do not proceed if any existing eight-document responsibility is missing or relaxed.

- [ ] **Step 5: Commit**

```bash
git add \
  packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts \
  packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts \
  packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts \
  packages/agent-workflow-server/src/beegame/complete-foundation-fixture.test.ts
git commit -m "test: verify trusted eight-document generation"
```

## Task 8: Run a real Chrome generation and audit the actual output

**Files:**

- Create: `docs/superpowers/evidence/2026-08-12-eight-document-trust-and-token-acceptance.md`
- Modify only if the real run reveals a reproducible product defect: the smallest owning source/test files from Tasks 1–7

- [ ] **Step 1: Verify the tree before runtime testing**

Use the `superpowers:verification-before-completion` skill before making any completion claim.

```bash
bun test packages/agent-workflow-server/src/beegame
bun run typecheck
git diff --check
git status --short
```

Expected: deterministic suite green and no unrelated tracked changes.

- [ ] **Step 2: Start services on the fixed ports**

Use exactly:

- frontend `62273`;
- runtime `62274`;
- billing `62275`;
- skills `62276`;
- resources `62277`.

Record process IDs, log paths, and the code commit under test. Fail if any service silently selects another port.

- [ ] **Step 3: Drive the real UI through Chrome**

Use the `chrome:control-chrome` skill. Create a new project from a neutral user-supplied game idea through the visible BeeGameStudio UI. Do not inject a test game concept into product code or fixtures.

Wait for all eight foundation document receipts to become committed. Stop the workflow immediately at the transition to document review. Do not allow reviewer or implementation work to begin.

- [ ] **Step 4: Verify physical output and receipts**

For all eight documents, recompute from disk:

- Markdown digest;
- authority sidecar digest and document binding;
- every external artifact digest/media/path;
- upstream reference resolution;
- open-decision set equality;
- license/evidence state validity;
- heading uniqueness and levels;
- inline SVG byte count;
- readiness-audit result.

No claim is accepted solely from UI status.

- [ ] **Step 5: Measure token and call efficiency**

Record per document:

- successful part calls;
- failed/local retries;
- fresh input tokens;
- cache-read tokens;
- completion tokens;
- Markdown bytes;
- sidecar bytes;
- artifact bytes.

Compare against the existing evidence baseline at `docs/superpowers/evidence/2026-08-12-eight-document-authority-sidecars.md`. Report cache reads separately. Pass target: no more than nine successful part calls per document and material cache-read reduction on a comparable clean run.

- [ ] **Step 6: Audit the actual documents, not only code**

Review each document for:

- discipline responsibility completeness;
- non-skeletal implementation usefulness;
- unnecessary restatement within its own responsibility;
- human navigation/readability;
- agent consumption usefulness;
- trustworthy metadata/evidence;
- absence of fabricated verification.

Do not evaluate project-specific design disagreements in this pass. Evaluate systemic document quality and the correctness of the generation mechanism.

- [ ] **Step 7: Write and commit acceptance evidence**

The evidence file must state one of:

- `ACCEPTED`: every design acceptance criterion passed; or
- `NOT ACCEPTED`: list exact failed criteria, logs, files, and reproduction steps.

Never convert a failed Chrome run into an approval based on unit tests.

```bash
git add docs/superpowers/evidence/2026-08-12-eight-document-trust-and-token-acceptance.md
git commit -m "docs: record trusted document generation acceptance"
```

## Final completion gate

The work is complete only after all eight tasks and all twelve acceptance criteria in the approved design are checked. The final response must link:

- the approved design;
- this plan;
- the Chrome acceptance evidence;
- the exact implementation commit range.

It must also answer plainly:

1. Can a user enter a game idea and receive all eight complete documents now?
2. Did all references, evidence, decisions, artifacts, and receipts validate?
3. How many calls and tokens did the actual run use?
4. What, if anything, remains outside the idea-to-documents scope?
