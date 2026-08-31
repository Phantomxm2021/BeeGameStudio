# Game IR Phase 4: Gameplay and Balance Design

Status: accepted after independent final review and root verification

## Goal

Implement the first two real Game IR domain modules without making Stage 5
reachable from the production workflow. Gameplay and Balance must become strict,
recomputable domain projections rather than generic JSON records or prose copied
from the eight Foundation documents.

This phase proves the domain-producer pattern that later World/Scene,
Presentation, Resource Realization, and Implementation/Verification modules will
reuse. It does not publish an incomplete seven-module candidate and does not
change Foundation Reviewer or Revision.

## Binding authority

This design is subordinate to
`docs/beegame-game-ir-stage-isolation-redesign.md`. Existing Game IR Core
contracts, source bindings, typed references, semantic admission, immutable
publication, recovery, and Stage 3/4 isolation remain unchanged unless this
design explicitly extends a domain-neutral type.

The following rules are non-negotiable:

- Gameplay reads only the receipt-bound GDD sections declared by its source
  manifest.
- Balance reads only the receipt-bound GDD and Balance sections declared by its
  source manifest.
- Phase 4 Gameplay and Balance mechanical receipts own no nodes or verified
  claims; semantic receipts own every domain node.
- Neither producer may fall back to an old IR, another producer's output, prose
  defaults, project-specific keywords, or a best-effort interpretation.
- One service-owned Gameplay–Balance pair assembler is the only writer of both
  final module projections.
- A module projection is not a `GameIrCandidate`. The complete candidate remains
  unavailable until all seven canonical modules exist.
- No token, duration, attempt, node, formula, transition, or file count is a
  business admission limit.

## Alternatives considered

### Selected: explicit schemas, strict producer receipts, one pair assembler

Gameplay and Balance receive explicit domain DTOs and invariant validators.
Phase 4 has no declared mechanical Gameplay or Balance roles, so mechanical
receipts are strictly empty. Semantic projection owns the declared domain
structures. One service validates both domains together and signs both complete
module projections only after bidirectional typed closure succeeds.

This is the smallest design that produces executable semantics while preserving
the existing single authority model.

### Rejected: direct model output of a complete Game IR candidate

This would let one worker invent all seven modules, hide producer ownership,
and turn semantic output into publication authority. It would also require
placeholder modules before the remaining domains exist.

### Rejected: generic configuration-driven typed-record DSL

The previous implementation already demonstrated that a generic record layer
can be structurally valid while failing to represent gameplay behavior,
formulas, units, and graph invariants. Domain behavior belongs in explicit
schemas and validators, not a second meta-schema.

## Phase boundary

Phase 4 produces exactly two immutable values:

```ts
type GameplayModuleProjection = Readonly<{
  schemaVersion: 'game-ir-gameplay-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate & { moduleId: 'gameplay' }
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  projectionDigest: string
}>

type BalanceModuleProjection = Readonly<{
  schemaVersion: 'game-ir-balance-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate & { moduleId: 'balance' }
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  projectionDigest: string
}>
```

They are durable-value candidates for the future complete-candidate assembler,
but Phase 4 does not add persistence, workflow state, controller routing, or a
partial publication format.

## Source protocol

Both domains consume one immutable `GameIrDomainSourceEnvelope`:

```ts
type GameIrDomainSourceEnvelope = Readonly<{
  schemaVersion: 'game-ir-domain-source.v1'
  taskId: string
  moduleId: 'gameplay' | 'balance'
  compileRequest: GameIrCompileRequest
  authoritySectionIndex: readonly GameIrSourceSection[]
  sectionIndex: readonly GameIrSourceSection[]
  sectionBytes: Readonly<Record<string, string>>
}>
```

`authoritySectionIndex` is the complete READY-bound canonical Foundation
Section Index; `sectionIndex` is the selected closure for the module. The
Foundation Section Index digest authenticates the complete section set and its
content. `canonicalizeGameIrSourceSections` is the sole Game IR source-order
authority, so both projections retain identical full authority ordering while
using only their fixed selected sections and exact UTF-8 bytes.

The service derives the source closure from a fixed domain manifest, not from
producer output:

- Gameplay: every indexed GDD section.
- Balance: every indexed GDD and Balance section.

`sectionBytes` must contain that closure exactly, byte-match the Section Index,
and bind to the Foundation READY receipt. The producer never chooses or narrows
its own evidence scope.

## Producer protocol

### Mechanical pass

The current Phase 4 source formats declare no Gameplay or Balance mechanical
roles. Both domains therefore require `nodes`, `verifiedClaims`, and
`ownedTargets` to be empty. Non-empty mechanical output is unauthorized and is
rejected before semantic packet construction.

The current `variable-parameter-table` contract declares required semantic
content but not fixed column names. Phase 4 must not guess column roles from
aliases, column position, or regex. A complete variable record is
semantic-owned. After semantic admission, the service reparses every claimed
ID, number, range, unit text, and source cell from exact table bytes. Balance
claims are exact `/bytes/<start>/<end>` ranges into selected Balance source
bytes; admission checks both the semantic literal and the UTF-8 byte slice.
This is evidence admission, not a second mechanical writer.

Phase 4 does not treat arbitrary prose, headings, Mermaid labels, or numbers
found by regex as mechanical authority. Semantic ownership is fixed before
dispatch and is never selected because a mechanical parser failed. The strict
empty mechanical receipt binds source-envelope and receipt digests only.

### Semantic pass

The semantic packet is built by the service from the complete source envelope
and admitted mechanical receipt. It declares:

- exact module and revision identity;
- exact source section bytes;
- mechanical node IDs and target paths already owned;
- allowed semantic node kinds and relationship types;
- the fields semantic projection owns;
- the fields semantic projection is forbidden to write.

The semantic result is a strict discriminated union. `PROJECTED` contains
domain records and source claims. `FAIL/missing-projection` and
`AMBIGUOUS/ambiguous-projection` contain packet-bound, node-qualified
diagnostics with exact evidence pointers. The service injects task, module,
revision, producer mode, and canonical binding identity. Worker-supplied
authority, digest, fallback node, arbitrary JSON field, or mechanical target is
rejected.

An unresolved mapping returns `missing-projection` or
`ambiguous-projection` with the existing node-qualified target subject and
exact evidence. It never emits a guessed node.

### Unique ownership

For Phase 4 the ownership table is fixed:

| Domain target | Producer |
| --- | --- |
| Balance variable/parameter record under the current non-fixed table header contract | semantic, followed by mechanical literal verification |
| Gameplay behavior and graph semantics | semantic |
| Balance formula AST and dependency semantics | semantic |
| Balance economy, progression, reward and cost relationships | semantic |
| Canonical ordering, digests, inferred formula units, graph summaries | derived by assembler |

The assembler rejects duplicate accounting even when the duplicate values are
identical.

## Gameplay schema

Gameplay node kinds are closed in V1:

- `gameplay.entity`
- `gameplay.capability`
- `gameplay.action`
- `gameplay.rule`
- `gameplay.condition`
- `gameplay.effect`
- `gameplay.event`
- `gameplay.state`
- `gameplay.transition`
- `gameplay.objective`
- `gameplay.outcome`

Their strict values are:

| Kind | Value fields |
| --- | --- |
| entity | `label` |
| capability | `label` |
| action | `label` |
| rule | `label` |
| condition | `expression` |
| effect | `effect` |
| event | `label` |
| state | `label`, `initial`, `terminal` (`none`, `success`, or `failure`) |
| transition | `label` |
| objective | `label` |
| outcome | `label`, `result` (`win`, `loss`, or `neutral`) |

Labels are display identities, not relationship or behavior prose. They must be
non-empty, and unknown value fields are rejected.

Every node has the existing Core identity, typed references, relationship edges,
producer mode, and Source Bindings. Domain values contain only scalar metadata
or an explicit expression; relationships never hide as IDs inside prose.

### Condition expression

Conditions use a closed boolean AST:

```ts
type GameplayConditionExpression =
  | { kind: 'boolean'; value: boolean }
  | { kind: 'reference'; referenceIndex: number }
  | { kind: 'not'; operand: GameplayConditionExpression }
  | { kind: 'all' | 'any'; operands: readonly GameplayConditionExpression[] }
  | {
      kind: 'compare'
      operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'
      left: GameplayScalarExpression
      right: GameplayScalarExpression
    }
```

`GameplayScalarExpression` is a literal or a typed reference index. Indices
must resolve to the node's canonical `references` array; embedded target IDs are
forbidden.

### Effect expression

Effects use a closed operation union:

```ts
type GameplayEffect =
  | { operation: 'set' | 'add' | 'remove'; targetReferenceIndex: number; value?: string | number | boolean }
  | { operation: 'emit'; targetReferenceIndex: number }
```

The exact operation shape is strict. An omitted required value, an unexpected
value, or an out-of-range reference index is rejected.

### Required relationships

Relationship edges are role-bearing and closed by node kind. Examples include:

- action `requires` condition and `causes` effect/event;
- rule `triggered-by` event and `guards` condition;
- transition `from` state, `to` state, and optional `on` event/condition;
- objective `succeeds-with` or `fails-with` outcome;
- capability `belongs-to` entity.

The schema defines required and repeatable roles per kind. Unknown roles,
duplicate singleton roles, wrong target kinds, and dangling targets fail closed.

### Gameplay invariants

Admission must mechanically prove:

- every transition has exactly one `from` and one `to` state;
- every referenced state, event, condition, effect, and outcome exists with the
  declared target type;
- initial states exist and are reachable;
- declared terminal states cannot have outgoing transitions;
- every objective reaches at least one explicit outcome;
- win/loss outcomes are explicit values, not inferred from names;
- duplicate actions, transitions, and relationship roles are rejected;
- an unreachable state is a compiler integrity failure, not silently deleted.

The validator does not require a fixed number of states or transitions.

## Balance schema

Balance node kinds are closed in V1:

- `balance.unit`
- `balance.variable`
- `balance.parameter`
- `balance.formula`
- `balance.economy-source`
- `balance.economy-sink`
- `balance.progression-curve`
- `balance.reward`
- `balance.cost`
- `balance.reward-cost-binding`

Their strict values are:

| Kind | Value fields |
| --- | --- |
| unit | `symbol`, `dimensions`, `scale` |
| variable | `label`, `baseline`, optional `minimum`/`maximum`, `unitReferenceIndex` |
| parameter | `label`, `baseline`, optional `minimum`/`maximum`, `unitReferenceIndex` |
| formula | `label`, `expression`, `outputUnitReferenceIndex` |
| economy-source | `label` |
| economy-sink | `label` |
| progression-curve | `label`, `points` |
| reward | `label` |
| cost | `label` |
| reward-cost-binding | `label` |

Unknown value fields are rejected. Amount, currency, reward, cost, trigger, and
gameplay target relationships live only in typed references and role-bearing
edges.

### Units

Units are structural rather than display strings:

```ts
type BalanceUnit = Readonly<{
  symbol: string
  dimensions: readonly Readonly<{ base: string; exponent: number }>[]
  scale: Readonly<{ numerator: number; denominator: number }>
}>
```

Dimensions are unique and code-unit sorted. Exponents and rational scale values
must be finite integers; denominator cannot be zero. Dimensionless values use an
empty dimension list. Display aliases do not create a second unit authority.

### Variables and bounds

Variable and parameter nodes reference exactly one unit. Their admitted value
contains the canonical baseline and optional inclusive lower/upper bounds.
Values must be finite. Lower cannot exceed upper, and the baseline must lie
inside declared bounds.

### Formula AST

Formulas use a closed, recomputable AST:

```ts
type BalanceFormulaExpression =
  | { kind: 'literal'; value: number; unitReferenceIndex: number }
  | { kind: 'reference'; referenceIndex: number }
  | { kind: 'negate' | 'absolute'; operand: BalanceFormulaExpression }
  | {
      kind: 'binary'
      operator: 'add' | 'subtract' | 'multiply' | 'divide' | 'minimum' | 'maximum'
      left: BalanceFormulaExpression
      right: BalanceFormulaExpression
    }
```

References resolve only to variable, parameter, or formula nodes. Formula
dependency edges are derived from the AST and must exactly match the node's
typed references; caller-supplied dependency summaries are rejected.

Unit inference is deterministic:

- add, subtract, minimum, and maximum require equal dimensions;
- multiply adds dimension exponents;
- divide subtracts dimension exponents;
- negate and absolute preserve the operand unit.

The inferred result must match the formula's declared output unit. Formula
cycles, division by a mechanically proven zero literal, non-finite literals,
and stale dependency summaries fail closed.

### Economy, progression, reward, and cost

- Economy source/sink nodes reference an amount variable or formula and one
  currency/resource unit.
- Progression curves contain ordered control points with finite coordinates;
  duplicate or decreasing input coordinates are rejected. No fixed point count
  is imposed.
- Reward and cost nodes reference exact amount formulas/variables.
- Reward-cost-binding nodes use explicit `reward`, `cost`, and triggering
  gameplay action/event relationships.

Cross-module references use the existing global typed-reference closure. Phase
4 validates references between Gameplay and Balance projections in both
directions; references to not-yet-implemented modules remain impossible rather
than represented by placeholders.

The completion gate proves both directions with the same READY receipt: Gameplay
conditions/effects may bind typed Balance targets, and Balance reward/cost
bindings may target typed Gameplay actions/events. Task/revision identity,
module kind, source bytes, and projection digests are revalidated on every
assembler call; stale or wrong-kind links fail closed. World/Scene,
Presentation, Resource Realization, and Implementation/Verification are not
represented until their own phases exist.

## Module assembler

`assembleGameplayBalanceModules` is the sole final projection authority. On
every invocation it:

1. reparses both source envelopes and all four mechanical/semantic receipts;
2. Core-admits both complete local node maps;
3. requires one task, Foundation revision, full compile request, READY receipt,
   and complete authority Section Index identity;
4. constructs both opposite-domain target maps from those Core-admitted modules;
5. typed-validates Gameplay and Balance together;
6. signs and returns both frozen projections and canonical digests.

No caller can provide merged nodes, derived fields, graph summaries, or a final
projection digest.

Because Core currently validates only a complete seven-module candidate, Phase
4 adds a domain-neutral `parseGameIrModuleCandidate` entry point that reuses the
same node/reference/binding logic. `parseGameIrCandidate` must call that same
entry point for every module. This is one parser factored at a smaller boundary,
not a compatibility reader or partial-candidate authority.

## Error classification

- Malformed DTO, duplicate ownership, stale digest, graph failure, formula
  cycle, unit mismatch, or producer writing an unauthorized target is a Stage 5
  compiler integrity failure.
- A faithful source section that lacks a required gameplay/balance fact produces
  `missing-projection`.
- Two evidence-supported interpretations that cannot be mechanically
  distinguished produce `ambiguous-projection`.
- Missing or ambiguous diagnostics may later become a
  `FoundationDefectReport`; Phase 4 does not route them into Foundation state.
- Provider failure and interrupted dispatch belong to the future Stage 5
  runtime, not these pure domain libraries.

## Files and dependency direction

Planned production files under `delivery-workflow/game-ir/`:

- `domain-source.ts`: strict source envelope and exact source closure.
- `gameplay-schema.ts`: Gameplay DTOs and invariant validator.
- `balance-schema.ts`: Balance DTOs, formula/unit inference, and validator.
- `gameplay-producer.ts`: mechanical accounting, semantic packet/result
  admission, and source-bound Core preparation.
- `balance-producer.ts`: semantic variable-record admission, exact source-literal
  reverification, and source-bound Core preparation.
- `gameplay-balance-assembler.ts`: sole bidirectional typed validation and final
  projection authority for the Gameplay–Balance pair.
- `domain-projection.ts`: shared producer receipt identity and disjoint-accounting
  helpers only where both domains truly use identical logic.

Dependency direction is:

```text
contracts -> model -> domain source/schema -> domain producer -> Gameplay-Balance pair assembler
```

Domain files may import Core contracts/model utilities. Core contracts and the
Foundation adapter must not import domain producers. Reviewer/Revision must not
import any Game IR file.

No new dependency is required.

## Testing

### Contract tests

- exact schemas, unknown-field rejection, frozen outputs;
- canonical ordering and digest replay;
- stale Foundation revision, receipt, Section Index, and source bytes rejection;
- mechanical/semantic target overlap rejection;
- non-empty Gameplay or Balance mechanical nodes/claims rejection;
- strict missing/ambiguous diagnostic identity and node qualification;
- no partial candidate or placeholder module API.

### Gameplay tests

- complete action-condition-effect-event-state-transition-objective graph;
- dangling/wrong-kind relationship;
- missing transition endpoint;
- unreachable state and illegal terminal outgoing transition;
- objective with no outcome;
- condition/effect reference-index mismatch;
- same source compiled twice yields identical bytes and digest;
- expanded graphs beyond common fixture sizes remain valid.

### Balance tests

- semantic variable records with units, values, bounds, and source bindings;
- claimed IDs, numbers, ranges, units, and source cells that do not byte-match
  the admitted table fail closed; no column alias or position heuristic exists;
- formula AST evaluation and dependency reconstruction;
- formula cycle, dangling reference, unit mismatch, invalid bounds, zero literal
  division, and non-finite value rejection;
- economy source/sink and reward/cost closure;
- progression curve ordering without a fixed point cap;
- same source compiled twice yields identical bytes and digest.

### Cross-domain tests

- reward/cost binds to a real Gameplay action/event;
- gameplay condition can read a typed Balance variable/formula;
- target kind mismatch and missing cross-module target fail closed;
- mixed task, revision, READY receipt, or full request identity fails closed;
- a raw opposite-domain `ReadonlyMap` is not an assembly input;
- producer output cannot write another domain's node;
- two different complete Foundation fixtures produce valid, distinct projections;
- zero-resource fixture remains valid because resource modules are outside this
  phase and no placeholder is fabricated.

### Non-regression tests

- current Game IR Core suite remains green;
- Foundation 263-test regression remains green;
- all 21 protected Stage 3/4 files remain byte-identical to baseline;
- full server production source remains free of a Game IR route;
- root/package typecheck, Biome, and diff-check pass.

## Acceptance gate

Phase 4 is accepted after independent final review and root verification. The
following completion-gate conditions are satisfied:

- Gameplay and Balance schemas cover every capability listed in the authority
  document;
- mechanical and semantic ownership is explicit, disjoint, and complete;
- formulas are recomputable and unit checked;
- gameplay state and objective graphs are mechanically closed;
- all owner-bearing identities, values, references, and relationship edges have
  exactly one Source Binding;
- real complete-document fixtures produce deterministic module projections;
- no complete Game IR candidate, publication, workflow state, or production
  route is fabricated;
- Reviewer/Revision parity and the protected-file boundary remain unchanged;
- independent correctness and dual-track audits report no actionable finding.

Chrome acceptance remains deferred until every canonical domain module and the
single consumer cutover are complete.

The prior Phase 4 approval was withdrawn after final review found unresolved
authority, diagnostic, manifest, and test-isolation defects. The correction is
implemented, independently reviewed, and root-verified; Phase 4 is accepted.
Phase 5–9 remain unstarted. Complete candidate assembly/publication, production
routing/persistence, and Chrome acceptance remain unavailable.

## Explicit non-goals

- World/Scene, Presentation, Resource Realization, or
  Implementation/Verification producers.
- LLM/provider dispatch or retry orchestration.
- Complete candidate assembly or publication.
- DeliveryRun schema, controller, transition, or recovery changes.
- Foundation Issue admission or document revision.
- Legacy readers, migrations, fallback values, dual writes, or project-specific
  extraction rules.
