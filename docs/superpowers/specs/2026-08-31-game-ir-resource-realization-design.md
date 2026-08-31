# Game IR Resource Realization Phase 6 Design

**Status:** design candidate; implementation is not admitted until the audit in
this document and the companion plan pass independently.

**Parent authority:** `docs/beegame-game-ir-stage-isolation-redesign.md`

**Prior accepted boundary:**
`docs/superpowers/specs/2026-08-31-game-ir-world-presentation-design.md`

## 1. Outcome

Phase 6 adds the sole `resource-realization` Game IR module. It converts the
accepted Core through Presentation closure into an engine-neutral delivery
specification that Resource Planner and Resource Curator can later consume.
It expresses:

```text
logical requirement -> realization variant -> delivery artifact specification
```

Every admitted logical requirement has one or more variants and every admitted
variant has one or more delivery artifact specifications, without an
arbitrary maximum. There is no fixed limit on nodes, variants, artifacts,
tokens, attempts, duration, or file size.

This phase is compile-time projection only. It does not route production work,
write an Asset Manifest, inspect a resource library, download or generate an
asset, verify a local file, or change Foundation Reviewer/Revision behavior.

## 2. The single-authority split

The module and Asset Manifest describe different facts:

| Fact | Sole authority |
| --- | --- |
| Resource intent and responsibility | approved Foundation documents |
| Executable, source-bound requirement identity, consumer, acquisition profile, variants and delivery specification | compiled Game IR `resource-realization` module |
| Materialized current resource plan and actual selected/generated resource, provenance, license, local path, verification and project inventory | canonical Asset Manifest |
| Resource attempt, rejection and replacement history | workflow events |
| Disposable copied/generated target bytes | workspace output only |

Game IR is a deterministic execution projection of the approved documents,
not a second author of intent. The stable `requirementId` is the join key.
Game IR never claims that an artifact specification has been fulfilled. At
future production cutover the service must materialize Manifest requirements
from the receipt-bound Game IR resource-plan projection; a Planner may not
re-author them. The old Planner-authored requirement route is deleted at that
cutover, not retained as fallback. Phase 6 builds and tests the projection but
does not yet write or consume a Manifest.

Terms such as `delivery artifact` in this design always mean a required
artifact specification. Actual delivered file facts remain Manifest-owned.

## 3. Inputs and rebuild rule

The only final assembly input is:

```ts
export type ResourceRealizationAssemblyAuthority = Readonly<{
  phase5Authority: WorldPresentationAssemblyAuthority
  resourceRealization: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: ResourceRealizationSemanticReceipt
    validation: ResourceRealizationSemanticValidationResult
  }>
}>
```

`GameIrDomainSourceEnvelope` is extended to admit the canonical
`resource-realization` domain and still enforces its fixed document scope:

- `docs/ASSET_PLAN.md`
- `docs/TECHNICAL_DESIGN.md`
- `docs/ART_DIRECTION.md`
- `docs/UI_UX_SPEC.md`
- `docs/AUDIO_DESIGN.md`
- `docs/LEVEL_SCENE_DESIGN.md`

The assembler must first call `assembleWorldPresentationClosure` with the
complete replayable Phase 5 authority. It rejects a raw `Map`, detached Phase
5 closure/module, digest-only reference, partial authority, mixed identity, or
caller-authored prior projection.

Every source, receipt, packet and validation result binds the same task,
Foundation revision, READY receipt, compile request and full authority Section
Index. Phase 6 cannot relabel prior evidence.

## 4. Canonical model

### 4.1 Resource kinds and runtime roles

The V1 resource-kind vocabulary is exactly:

```text
model, mesh, material, texture, rig, animation, audio, music, vfx, shader,
ui-asset, font, scene, prefab, content, config
```

Runtime roles are non-empty canonical source values rather than a closed
project-specific vocabulary. The parser validates identity and evidence, not
English keywords. It therefore supports new genres and engines without a
compatibility parser.

### 4.2 `resource-realization.logical-resource`

Value:

```ts
{
  requirementId: string
  resourceKind: ResourceKind
  runtimeRole: string
}
```

Relationships:

- `required-by`: one or more prior-module nodes that consume or establish the
  requirement.

Rules:

- `requirementId` is globally stable within a Foundation revision and is the
  future Asset Manifest join key.
- The canonical node ID is `resource.requirement.<requirementId>` for both
  derived and semantic logical resources. `requirementId` is therefore the
  only external identity and cannot drift independently from the node ID.
- A Presentation logical-resource leaf produces exactly one **derived** node.
  Its derived bindings name the exact Presentation requirement leaf and the
  values are copied without reinterpretation except for the one canonical kind
  mapping `ui -> ui-asset`; animation, vfx, audio and music retain their exact
  kind and runtime role.
- Requirements not owned by Presentation are **semantic** nodes grounded in
  the fixed Phase 6 source closure. They must identify at least one real
  prior-module consumer with `required-by`; an unattached catalog wish is not
  executable Game IR.
- The two producer paths are disjoint by source ownership. A semantic result
  that repeats a Presentation-owned `requirementId` is rejected rather than
  merged or preferred.

### 4.3 `resource-realization.acquisition-profile`

Value:

```ts
{
  name?: string
  purpose?: string
  required: boolean
  dimensions: readonly ResourceDimension[]
  assetKinds: readonly ResourceAssetKind[]
  usageTags: readonly ResourceUsageTag[]
  capabilities: readonly ResourceCapability[]
  styles: readonly string[]
  sourcingPolicy: {
    allowedSourceKinds: readonly (
      | 'resource-library'
      | 'agent-authored'
      | 'user-provided'
    )[]
    licenseConstraints: readonly string[]
    responsibleParty: string
    handoffCriteria: readonly string[]
  }
  coverage?: readonly {
    assetKinds?: readonly ResourceAssetKind[]
    usageTags?: readonly ResourceUsageTag[]
    capabilities?: readonly ResourceCapability[]
    relationKinds?: readonly ResourceRelationKind[]
    embeddedKinds?: readonly ResourceEmbeddedComponentKind[]
  }[]
}
```

Relationships:

- `describes`: exactly one `resource-realization.logical-resource`.

There is exactly one semantic-owned profile per logical resource. The closed
vocabularies come from `@bee-game-studio/beegame-resource-core`; Phase 6 does
not copy or rename those lists. This is the exact discovery contract later
materialized to Manifest v8 `acquisition_profile`. An empty canonical array is
a real source-authored value where the shared contract permits it, not a
fallback. Coverage preserves independent multi-part obligations and is never
flattened onto every delivery file.

The profile mechanically matches Manifest v8 admission: `dimensions` and
`assetKinds` are non-empty; all arrays are unique and canonical; when
`coverage` is present it is non-empty, every entry contains at least one
declared non-empty constraint array, and top-level `capabilities` is empty.
These are structural discovery rules, not business-size caps.

`sourcingPolicy` carries the approved source, authorization/license,
responsibility and handoff constraints needed by Resource Curator. It is not
copied into Manifest v8 `acquisition_profile`; the future Curator dispatch is
derived from the receipt-bound pair of Manifest requirement identity and this
Game IR policy. Actual chosen source, license/provenance evidence and local
files remain Manifest-owned facts. Schedules may be kept in Foundation prose,
but Phase 6 does not convert them into workflow deadlines or attempt limits.

Separating this profile from the logical-resource node is required by producer
ownership: Presentation identity/kind/role can remain derived while resource
discovery semantics remain source-owned. The assembler joins them only in its
derived resource-plan projection.

### 4.4 `resource-realization.delivery-target`

Value:

```ts
{
  platform?: string
  runtime?: string
  assetFormatCapabilities: readonly string[]
}
```

Exactly one semantic-owned delivery target is required. Capabilities are
unique, canonical, source-bound and non-empty. Manifest version, canonical
roots and `resource_library_usage` remain service-owned and are not included.

### 4.5 `resource-realization.variant`

Value:

```ts
{
  activation:
    | { kind: 'required' }
    | { kind: 'alternative'; groupId: string }
    | {
        kind: 'conditional'
        predicate:
          | {
              field: 'platform' | 'runtime'
              operator: 'eq'
              value: string
            }
          | {
              field: 'asset-format-capability'
              operator: 'contains'
              value: string
            }
      }
}
```

Relationships:

- `realizes`: exactly one `resource-realization.logical-resource`.

Variants are semantic-owned. `activation` must be supported by source
evidence. No platform, quality tier, locale, fallback, or preferred variant is
invented. `alternative` means an intentional design alternative, not an old
and new runtime route. `conditional` is an exact predicate over the admitted
delivery target, not opaque prose or a recovery fallback. Its field/value must
exist in that target; otherwise the variant is rejected as unreachable.

Variant and delivery artifact identity is solely `GameIrNode.id`; neither node
contains a second `variantId` or `artifactId` value. Alternative groups are
non-empty: every `groupId` has at least two variants for the same logical
resource. Conditional predicate fields and values are exact, non-empty and
source-bound.

### 4.6 `resource-realization.delivery-artifact`

Value:

```ts
{
  artifactClass:
    | 'runtime-resource'
    | 'content-definition'
    | 'generated-output'
  path: string
  format: string
  codec?: string
  runtimeRole: string
  technicalConstraints?: readonly {
    name: string
    assertion:
      | { operator: 'eq'; value: string | number | boolean; unit?: string }
      | { operator: 'lte' | 'gte'; value: number; unit: string }
      | { operator: 'range'; min: number; max: number; unit: string }
      | {
          operator: 'one-of'
          values: readonly (string | number)[]
          unit?: string
        }
  }[]
  budgets?: readonly {
    metric: string
    limit: number
    unit: string
  }[]
}
```

Relationships:

- `part-of`: exactly one `resource-realization.variant`.

Rules:

- `path` is a safe canonical project-relative delivery path. Absolute paths,
  backslashes, dot segments and empty segments are rejected. Runtime resource,
  content definition and generated output classes are confined respectively
  to `assets/runtime`, `assets/content` and `assets/generated`.
- `format` is the same lowercase ASCII filename-extension vocabulary used by
  `deliveryTarget.assetFormatCapabilities`, without a leading dot. `path` must
  end in `.<format>` and the target capability set must contain `format`.
  Codec is optional because it is not meaningful for every format; when
  supplied it is source-bound.
- `format`, `codec`, constraints and budgets are delivery requirements, not
  observations about an existing file.
- Optional fields are omitted when Foundation does not require them. The
  producer must not synthesize `unknown`, `N/A`, zero, an empty sentinel or a
  guessed default.
- `eq` accepts a finite number, boolean or non-empty string; `lte`/`gte` accept
  only finite numbers; `range` is an ordered finite numeric pair; `one-of` is
  non-empty, homogeneous, unique and canonical. Budgets use finite non-negative
  limits and are unique/canonical by metric and unit. Constraints are likewise
  unique/canonical by name.
- Each supplied value has direct owner evidence. Artifact order is canonical;
  no positional identity exists.
- Two artifact specifications may not claim the same path. A resource may
  still produce multiple distinct files through multiple artifact nodes.
- Budgets are source-authored requirements. The system introduces no global
  or per-kind token, time, count, byte, polygon, texture or audio cap.

This is the minimum model. Separate constraint, budget, authority-binding and
runtime-binding node types are deliberately not introduced: their facts
already belong to the requirement, acquisition profile, target, variant,
artifact value, or relationship. Adding wrapper nodes would create indirection
without a second identity.

## 5. Producer ownership

### 5.1 Mechanical producer

Phase 6 V1 declares no mechanically owned node kind. Markdown tables remain
human-authored prose without a separately versioned machine table contract;
using their layout as an implicit DSL would make heading/table shape a second
schema. The mechanical receipt is therefore valid only when it contains no
nodes, claims, or owned targets and is still bound to the exact source digest.

If a future Foundation schema introduces an explicit structured resource
table, that is a versioned design change. It must replace ownership for the
affected fields; it cannot run beside the semantic producer as fallback.

### 5.2 Semantic projection request and producer

The worker does not receive a caller-selected target list. Before semantic
generation the service calls:

```ts
export function prepareResourceRealizationSemanticProjectionPacket(
  authority: ResourceRealizationSemanticProjectionAuthority,
): ResourceRealizationSemanticProjectionPacket
```

That authority contains the full replayable Phase 5 authority plus the Phase
6 source and empty mechanical receipt. The service rebuilds Phase 5 and emits
packet-only descriptors for the exact Presentation requirements, their digest,
the complete allowed prior-node target catalog, fixed source/evidence closure,
allowed Phase 6 kinds/relationships, and the exact forbidden IDs/targets. A
descriptor contains only requirement ID/kind/runtime role, owner node ID/kind,
requirement leaf pointer and its evidence pointer. It is not a `GameIrNode`,
module, candidate, projection or closure and cannot be admitted or published.
The sole assembler later derives the final logical-resource nodes again. The
worker receipt binds this packet digest. Nothing in this catalog is supplied
or reconstructed by the worker or production caller.

The semantic producer may emit only acquisition-profile, delivery-target,
variant, delivery-artifact and non-Presentation logical-resource nodes. It
reads the complete fixed source scope, supplies owner bindings for every
semantic value and relationship, and returns either one strict candidate or a
structured missing/ambiguous diagnostic. It cannot read old IR, Asset
Manifest, resource inventory, filenames, workspace output, reviewer state, or
model preference.

### 5.3 Derived producer

Only the assembler derives Presentation-owned logical requirements. Derived
IDs and ordering are functions of the exact Presentation node ID,
requirement leaf pointer and values. The semantic producer is told those
targets are forbidden and cannot shadow them.

There is no merge preference. Ownership overlap is an error.

## 6. References, closure and invariants

The Phase 6 schema manifest is the sole node/field/relationship authority.
Allowed external `required-by` targets are canonical node kinds from Core,
Gameplay, Balance, World/Scene and Presentation. The exact allow-list is
derived from the imported accepted manifests, not repeated as a loose string
list.

Admission proves:

1. exact node/value schema and canonical ordering;
2. globally disjoint node IDs across the rebuilt Phase 5 closure and Phase 6;
3. reference and relationship target existence/type;
4. exactly one acquisition profile per logical requirement and exactly one
   delivery target per module;
5. one logical requirement to one-or-more variants;
6. every variant to exactly one logical requirement and one-or-more artifact
   specifications;
7. every artifact to exactly one variant;
8. unique `requirementId`, canonical node ID and artifact path;
9. Presentation requirement coverage is exact—no missing, duplicate or extra
   derived requirement;
10. semantic requirements do not shadow Presentation ownership;
11. all logical requirements have a real prior-module consumer;
12. every supplied value/relationship has valid owner or derived binding;
13. source policy is complete, acquisition vocabularies are canonical, numeric
    assertions are finite, and artifact class/path/extension/format agree;
14. the derived Manifest-v8 resource-plan projection is lossless and exact;
15. no actual resource, inventory, provenance, attempt, verification or
    generated-output observation appears in the module; a generated-output
    specification remains allowed;
16. replayed semantic fidelity is PASS for the complete packet.

The validator does not impose arbitrary maximum counts. The parent authority
requires every canonical V1 module to be non-empty. Resource Realization also
requires one delivery target and at least one logical resource with its
profile, variant and artifact. A purported zero-resource game is therefore a
missing-projection diagnostic; even fully programmatic delivery requires a
content/config artifact specification. It is not admitted as an empty module.

## 7. Validation and sole assembler

Phase 6 has two read-only preparation APIs. Section 5.2 defines the pre-worker
semantic projection packet. The second API prepares independent validation:

```ts
export function prepareResourceRealizationSemanticValidationPacket(
  authority: ResourceRealizationValidationPreparationAuthority,
): ResourceRealizationSemanticValidationPacket
```

This is the second read-only preparation step. The earlier semantic projection
packet is the worker input; this semantic validation packet is the independent
validator input. Its authority contains the full Phase 5 authority and Phase
6 source/mechanical/semantic receipt, but not a validation result. Preparation
rebuilds Phase 5, rebuilds and verifies the original projection packet,
replays the semantic candidate, derives Presentation-owned requirements,
parses the strict module, and creates the exact fidelity packet.

The sole final writer is:

```ts
export function assembleResourceRealizationClosure(
  authority: ResourceRealizationAssemblyAuthority,
): ResourceRealizationClosure
```

It repeats the same rebuild and admission path, admits only PASS, and returns
the rebuilt Phase 5 closure plus one immutable Resource Realization projection,
one mechanically derived resource-plan projection, and closure digest. The
resource-plan projection contains only:

```ts
{
  projectTarget: {
    platform?: string
    runtime?: string
    assetFormatCapabilities: readonly string[]
  }
  requirements: readonly {
    id: string
    name?: string
    purpose?: string
    required: boolean
    acquisitionProfile: ResourceAcquisitionProfile
    sourcingPolicy: ResourceSourcingPolicy
  }[]
}
```

The Manifest-v8 row materializer consumes only the fields its schema owns;
`sourcingPolicy` is retained in the Curator dispatch projection. The projection
is fully reconstructible from the admitted module and has its own digest; it
is not independently writable. At Phase 8 cutover, the service converts this
projection mechanically to the current Manifest v8 spelling, adds only
service-owned roots/policy/version, and deletes Planner re-authoring. The same
cutover introduces one immutable materialization receipt binding Game IR
READY/publication digest, Resource module digest, resource-plan projection
digest and canonical Manifest digest. Manifest and Game IR never mutually
self-attest. The assembler neither accepts nor exposes a second high-level
builder.

No production source may call any of the three Phase 6 high-level APIs in this
phase. Tests and the future Phase 7 assembler are the only consumers until
production cutover.

## 8. Source fidelity packet

The packet follows the accepted Phase 5 admission structure and adds:

- the exact derived Presentation requirement set and digest;
- the complete semantic Phase 6 candidate;
- exact fixed source documents/sections/bytes;
- the rebuilt prior-module target closure;
- mandatory checks for requirement coverage, variant/artifact closure,
  path uniqueness/safety, ownership separation and forbidden actual-resource
  facts.

PASS returns complete, unique, canonical check coverage. Digest echo or a
boolean result is insufficient. Failure returns compiler diagnostics only;
Phase 6 does not create Foundation issues or revision patches.

The common exact packet/receipt/check-coverage parsing protocol is not copied
from `phase5-admission.ts`. Before Phase 6 admission is written,
characterization tests lock Phase 5 bytes, digests and errors, and
protocol-only primitives are moved into one neutral Game IR
`semantic-fidelity.ts`. Phase 5 and Phase 6 retain small domain-invariant
wrappers over that protocol. This behavior-preserving extraction stays inside
the isolated Game IR directory; duplicate protocol parsers are rejected by
review and static scan.

## 9. Phase 7 boundary

Phase 7 receives replayable authorities, not detached closures:

```ts
type ImplementationVerificationAssemblyAuthority = Readonly<{
  phase6Authority: ResourceRealizationAssemblyAuthority
  implementationVerification: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: ImplementationVerificationSemanticReceipt
    validation: ImplementationVerificationSemanticValidationResult
  }>
}>
```

It must call `assembleResourceRealizationClosure(phase6Authority)` before
projecting its own module.

## 10. File boundary

New production files are limited to the isolated Game IR directory:

- `semantic-fidelity.ts`
- `resource-realization-schema.ts`
- `resource-realization-producer.ts`
- `phase6-admission.ts`
- `resource-realization-assembler.ts`

Expected existing-file edits are limited to Game IR domain IDs/source scope,
the behavior-preserving Phase 5 admission extraction/import, and Game IR-only
tests/helpers. Foundation Reviewer, Foundation Revision,
workflow controller/state/schema/recovery, resource workflow, Asset Manifest,
UI and production routing are protected and byte-identical to the Phase 5
baseline.

No old dirty `game-ir.ts`, `GameIrResourceAuthority`, current loader, resource
graph reader, resource-stage importer, migration reader, compatibility alias,
fallback, dual write, placeholder or intermediate assembly record is restored.

## 11. Test and acceptance matrix

Implementation is TDD and must cover at least:

- exact schemas, unknown fields and non-JSON objects;
- the empty-only mechanical receipt rule;
- one requirement -> one variant -> one artifact;
- one requirement -> multiple variants;
- one variant -> multiple delivery files;
- all resource kinds across complete profile fixtures;
- required, alternative and conditional variants;
- safe root-confined paths, duplicate paths, extension/format agreement and
  artifact identity;
- strict finite constraint/budget unions and optional omission without
  sentinels;
- exact acquisition profile and source/license/responsibility/handoff policy;
- direct source bindings and derived Presentation bindings;
- exact Presentation requirement coverage;
- missing/extra/shadowed requirement rejection;
- wrong target kind, missing target, duplicate global ID and detached closure;
- mixed task/revision/READY/compile identity;
- stale/tampered prior authority replay;
- FAIL/AMBIGUOUS validation and incomplete coverage rejection;
- expanded graphs proving no business count cap;
- a visual 3D profile and an audio/UI/content profile, each with multi-file
  delivery;
- repeated assembly byte/digest determinism and frozen output after input
  mutation;
- Presentation `ui -> ui-asset` derivation, complete alternative groups and
  mechanically evaluable conditional predicates;
- Foundation parity and protected-file byte identity;
- AST isolation: no production caller, no forbidden import, no compatibility
  route, and exactly one closure writer.

Verification includes the complete Game IR suite, Foundation gate, server and
root typechecks, formatter/lint, `git diff --check`, protected-path diff and
static scans. Chrome is not part of Phase 6 acceptance.

## 12. Explicit non-goals

Phase 6 does not implement Phase 7, complete seven-module publication,
production routing, consumer cutover, Asset Manifest writes, Planner/Curator
dispatch, resource acquisition, placeholder adapters, Content/Gate,
Reviewer/Revision, UI changes, compatibility, migration, or Chrome acceptance.
