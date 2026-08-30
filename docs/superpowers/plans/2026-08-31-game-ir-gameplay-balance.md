# Game IR Gameplay and Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement deterministic, source-bound Gameplay and Balance module projections without creating a partial Game IR candidate or production route.

**Architecture:** Add one reusable single-module Core parser, one strict domain-source/producer receipt boundary, explicit Gameplay and Balance schemas, and one pure assembler per domain. Mechanical and semantic target ownership is declared before dispatch and merged exactly once; complete seven-module assembly, persistence, provider dispatch, and workflow cutover remain outside this plan.

**Tech Stack:** TypeScript, Bun test, Zod v4 only where existing DTO contracts use it, Node standard crypto, existing Game IR Core contracts/model utilities.

**Spec:** `docs/superpowers/specs/2026-08-31-game-ir-gameplay-balance-design.md`

## Global Constraints

- Work only in `.worktrees/game-ir-stage-isolation` on `codex/game-ir-stage-isolation`.
- Do not modify `types.ts`, `schema.ts`, `controller.ts`, `transition.ts`, `recovery.ts`, or any protected Reviewer/Revision production file.
- Stage 5 production routing remains unreachable.
- Do not create a partial `GameIrCandidate`, placeholder modules, compatibility reader, fallback, dual write, migration, or provider dispatch.
- Gameplay source scope is every receipt-bound GDD section; Balance source scope is every receipt-bound GDD and Balance section.
- Mechanical and semantic target ownership is explicit and disjoint; failure in one producer never transfers ownership to another.
- Under the current non-fixed Balance table header contract, complete variable records are semantic-owned and their source literals are mechanically reverified after admission.
- No token, duration, attempt, node, formula, transition, point, or file count is a business admission limit.
- Use TDD, commit each task, and run `git diff --check` before every commit.

---

### Task 1: Single-module Core admission

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts`

**Interfaces:**
- Consumes: `GameIrCompileRequest`, `GameIrSourceSection`, `GameIrModuleCandidate`.
- Produces:

```ts
export function parseGameIrModuleCandidate(
  value: unknown,
  input: {
    request: GameIrCompileRequest
    sections: readonly GameIrSourceSection[]
    expectedModuleId?: GameIrModuleId
  },
): GameIrModuleCandidate
```

- `parseGameIrCandidate` must call `parseGameIrModuleCandidate` for every module and retain global cross-module ID/reference closure.

- [ ] **Step 1: Add failing single-module admission tests**

Add tests that admit one valid `gameplay` module without fabricating six modules, reject the wrong `expectedModuleId`, reject stale source bindings, and prove `parseGameIrCandidate` still rejects a cross-module dangling reference.

```ts
const module = parseGameIrModuleCandidate(rawGameplayModule(), {
  request,
  sections,
  expectedModuleId: 'gameplay',
})
expect(module.moduleId).toBe('gameplay')
expect(() =>
  parseGameIrModuleCandidate(rawGameplayModule(), {
    request,
    sections,
    expectedModuleId: 'balance',
  }),
).toThrow(/module/i)
```

- [ ] **Step 2: Run the new tests RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts
```

Expected: failure because `parseGameIrModuleCandidate` is not exported.

- [ ] **Step 3: Extract the existing module parser boundary**

Normalize source sections and the module exactly once inside the new function, reuse existing `parseModule`, and keep candidate-wide node/reference closure in `parseGameIrCandidate`. Do not add a second node parser.

```ts
export function parseGameIrModuleCandidate(value: unknown, input: ModuleInput) {
  const request = parseGameIrCompileRequest(input.request)
  const sections = sourceSectionMap(
    normalizeSourceSections(input.sections),
    request,
  )
  const module = parseModule(normalizeJsonValue(value, 'module'), sections, request)
  if (input.expectedModuleId && module.moduleId !== input.expectedModuleId)
    fail('module ID does not match expected module')
  return module
}
```

- [ ] **Step 4: Reuse it from complete-candidate admission**

`parseGameIrCandidate` must pass already normalized request/sections through one internal implementation so it does not repeatedly rebuild the Section Index map. The public single-module function and complete candidate must share that internal implementation.

- [ ] **Step 5: Verify and commit**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts
bun run typecheck
git diff --check
```

Commit:

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts
git commit -m "feat: admit isolated Game IR modules"
```

---

### Task 2: Domain source and producer receipt contracts

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts`

**Interfaces:**
- Consumes: `GameIrCompileRequest`, complete receipt-bound Section Index, exact Markdown bytes.
- Produces:

```ts
export type GameIrDomainId = 'gameplay' | 'balance'

export type GameIrDomainSourceEnvelope = Readonly<{
  schemaVersion: 'game-ir-domain-source.v1'
  taskId: string
  moduleId: GameIrDomainId
  compileRequest: GameIrCompileRequest
  sectionIndex: readonly GameIrSourceSection[]
  sectionBytes: Readonly<Record<string, string>>
  sourceDigest: string
}>

export type GameIrMechanicalProjectionReceipt = Readonly<{
  schemaVersion: 'game-ir-mechanical-projection-receipt.v1'
  taskId: string
  moduleId: GameIrDomainId
  foundationRevision: string
  sourceDigest: string
  nodes: readonly GameIrNode[]
  verifiedClaims: readonly Readonly<{
    subject: string
    sourcePointer: string
    literal: string
  }>[]
  ownedTargets: readonly string[]
  receiptDigest: string
}>

export type GameIrDomainSemanticPacket = Readonly<{
  schemaVersion: 'game-ir-domain-semantic-packet.v1'
  taskId: string
  moduleId: GameIrDomainId
  foundationRevision: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  allowedNodeKinds: readonly string[]
  allowedRelationshipTypes: readonly string[]
  forbiddenTargets: readonly string[]
  packetDigest: string
}>
```

- Produces `buildGameIrDomainSourceEnvelope`, `admitGameIrMechanicalProjectionReceipt`, `buildGameIrDomainSemanticPacket`, and `assertDisjointDomainTargets`.

- [ ] **Step 1: Write failing source-closure tests**

Gameplay must require exactly every GDD Section Index entry; Balance must require every GDD and Balance entry. Test missing bytes, extra bytes, altered bytes, incomplete eight-document index, stale receipt digest, hidden/accessor properties, and caller-narrowed scope.

```ts
expect(
  buildGameIrDomainSourceEnvelope({
    moduleId: 'gameplay',
    request,
    sectionIndex,
    sectionBytes: exactGddBytes,
  }).sectionIndex.every(section => section.documentPath === 'docs/GDD.md'),
).toBe(true)
```

- [ ] **Step 2: Run source tests RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts
```

Expected: module does not exist.

- [ ] **Step 3: Implement exact source envelopes**

Reuse Core canonical JSON/digest and strict Section Index digest validation. Define one frozen source manifest:

```ts
const DOMAIN_SOURCE_DOCUMENTS = Object.freeze({
  gameplay: Object.freeze(['docs/GDD.md']),
  balance: Object.freeze(['docs/BALANCE_DESIGN.md', 'docs/GDD.md']),
} as const)
```

Sort by code units before comparing. Freeze returned arrays and records.

- [ ] **Step 4: Write failing producer identity and overlap tests**

Test a valid empty mechanical receipt, stale task/revision/source digest, duplicate/unsorted owned targets, semantic packet relabeling, mechanical target included in semantic output, and identical-value overlap.

```ts
expect(() =>
  assertDisjointDomainTargets(
    ['node:balance.var.hp#/value/baseline'],
    ['node:balance.var.hp#/value/baseline'],
  ),
).toThrow(/overlap/i)
```

- [ ] **Step 5: Implement strict producer receipt primitives**

All identities come from the source envelope. Empty mechanical nodes/claims are valid. Do not parse arbitrary tables here and do not add an ownership fallback.

- [ ] **Step 6: Verify and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts
bun run typecheck
git diff --check
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts
git commit -m "feat: define Game IR domain producer authority"
```

---

### Task 3: Gameplay schema and invariant validator

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-schema.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-schema.test.ts`

**Interfaces:**
- Consumes: one admitted `GameIrModuleCandidate` with `moduleId: 'gameplay'`, plus optional Balance nodes for cross-domain reference closure.
- Produces:

```ts
export type GameplayConditionExpression =
  | Readonly<{ kind: 'boolean'; value: boolean }>
  | Readonly<{ kind: 'reference'; referenceIndex: number }>
  | Readonly<{ kind: 'not'; operand: GameplayConditionExpression }>
  | Readonly<{ kind: 'all' | 'any'; operands: readonly GameplayConditionExpression[] }>
  | Readonly<{
      kind: 'compare'
      operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'
      left: GameplayScalarExpression
      right: GameplayScalarExpression
    }>

export function parseGameplayModule(
  module: GameIrModuleCandidate,
  externalTargets?: ReadonlyMap<string, GameIrNode>,
): GameIrModuleCandidate
```

- [ ] **Step 1: Write the complete valid Gameplay graph fixture**

Include entity, capability, action, condition, effect, event, rule, initial state, terminal success/failure states, transitions, objective, and explicit outcomes. Bind every identity/value/reference/edge exactly once.

- [ ] **Step 2: Add RED mutations**

Mutate the fixture to cover unknown kind/value field, embedded target ID in value, out-of-range expression reference, missing/wrong-kind edge, duplicate singleton role, missing transition endpoint, unreachable state, terminal outgoing transition, objective without outcome, and inferred outcome from a name.

```ts
expect(() => parseGameplayModule(withUnreachableState(valid))).toThrow(
  /unreachable state/i,
)
```

- [ ] **Step 3: Implement strict value parsers**

Use exact-key checks and closed kind/value maps. Parse recursive condition expressions without imposing a depth or node count business cap; cycle is impossible because the AST is a JSON tree.

- [ ] **Step 4: Implement role and reachability validation**

Build maps from the already admitted nodes. Define closed role tables in code, for example:

```ts
const SINGLETON_ROLES = Object.freeze({
  'gameplay.transition': Object.freeze({
    from: Object.freeze(['gameplay.state']),
    to: Object.freeze(['gameplay.state']),
  }),
  'gameplay.capability': Object.freeze({
    'belongs-to': Object.freeze(['gameplay.entity']),
  }),
} as const)
```

Traverse from every `state.value.initial === true`; require every non-initial state reachable. Require no outgoing transition from terminal states.

- [ ] **Step 5: Verify expanded graphs and commit**

Generate a graph larger than the normal fixture without a fixed count limit, assert stable canonical digest across reordered input rejection/normalized assembly, then run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-schema.test.ts
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts
bun run typecheck
git diff --check
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-schema.test.ts
git commit -m "feat: validate Game IR gameplay graphs"
```

---

### Task 4: Balance schema, formulas, and unit inference

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/balance-schema.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/balance-schema.test.ts`

**Interfaces:**
- Consumes: one admitted `balance` module plus optional Gameplay targets.
- Produces:

```ts
export type BalanceDimension = Readonly<{ base: string; exponent: number }>
export type BalanceUnit = Readonly<{
  symbol: string
  dimensions: readonly BalanceDimension[]
  scale: Readonly<{ numerator: number; denominator: number }>
}>

export type BalanceFormulaExpression =
  | Readonly<{ kind: 'literal'; value: number; unitReferenceIndex: number }>
  | Readonly<{ kind: 'reference'; referenceIndex: number }>
  | Readonly<{ kind: 'negate' | 'absolute'; operand: BalanceFormulaExpression }>
  | Readonly<{
      kind: 'binary'
      operator: 'add' | 'subtract' | 'multiply' | 'divide' | 'minimum' | 'maximum'
      left: BalanceFormulaExpression
      right: BalanceFormulaExpression
    }>

export function parseBalanceModule(
  module: GameIrModuleCandidate,
  externalTargets?: ReadonlyMap<string, GameIrNode>,
): GameIrModuleCandidate
```

- [ ] **Step 1: Write a complete valid Balance fixture**

Include dimensionless, currency, health, and time units; variables/parameters with bounds; formulas using every operator; economy source/sink; progression curve; reward, cost, and gameplay-triggered reward-cost binding.

- [ ] **Step 2: Add RED unit/value tests**

Reject duplicate/unsorted dimensions, non-integer exponents, zero denominator, non-finite values, lower greater than upper, baseline outside bounds, missing/wrong unit reference, and unknown value fields.

- [ ] **Step 3: Add RED formula tests**

Reject dangling formula reference, dependency cycle, AST/reference mismatch, add/subtract/min/max dimension mismatch, output unit mismatch, proven zero-literal division, and caller-supplied dependency summary.

```ts
expect(() => parseBalanceModule(cyclicFormulaModule())).toThrow(/cycle/i)
expect(() => parseBalanceModule(unitMismatchModule())).toThrow(/unit/i)
```

- [ ] **Step 4: Implement formula dependency and unit inference**

Derive dependencies from AST reference indices. Evaluate units recursively with memoization and an active-node set for cycle detection. Canonicalize dimensions by base and remove zero exponents.

```ts
function combineDimensions(
  left: readonly BalanceDimension[],
  right: readonly BalanceDimension[],
  direction: 1 | -1,
): readonly BalanceDimension[]
```

- [ ] **Step 5: Implement economy/progression closure**

Require exact role/target kinds for amount, unit, reward, cost, and gameplay trigger edges. Progression points must be finite and strictly increasing by input coordinate; do not cap their count.

- [ ] **Step 6: Verify and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/balance-schema.test.ts
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts
bun run typecheck
git diff --check
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/balance-schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/balance-schema.test.ts
git commit -m "feat: validate Game IR balance formulas"
```

---

### Task 5: Gameplay producer admission and assembler

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.test.ts`

**Interfaces:**
- Consumes Task 1 `parseGameIrModuleCandidate`, Task 2 source/producer receipts, Task 3 `parseGameplayModule`.
- Produces:

```ts
export type GameplayModuleProjection = Readonly<{
  schemaVersion: 'game-ir-gameplay-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate & Readonly<{ moduleId: 'gameplay' }>
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  projectionDigest: string
}>

export function buildGameplaySemanticPacket(input: {
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
}): GameIrDomainSemanticPacket

export function admitGameplaySemanticResult(
  packet: GameIrDomainSemanticPacket,
  value: unknown,
): GameIrDomainSemanticReceipt

export function assembleGameplayModule(input: {
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
  semantic: GameIrDomainSemanticReceipt
  externalTargets?: ReadonlyMap<string, GameIrNode>
}): GameplayModuleProjection
```

- [ ] **Step 1: Write RED authority tests**

Reject semantic result relabeling, stale packet/source/mechanical digest, worker-supplied task/revision/digest, unknown node kind/edge role, source claim outside exact GDD sections, missing binding claim, and semantic target overlapping mechanical ownership.

- [ ] **Step 2: Implement service-owned semantic packet and result admission**

Allowed kinds are the closed Gameplay kinds. Allowed relationship types come from Task 3's exported frozen role manifest. Source claims become owner bindings only after exact source pointer admission; the worker does not submit binding authority objects.

- [ ] **Step 3: Write RED assembler tests**

Test missing/extra node accounting, duplicate IDs across producer receipts, reordering, stale receipt, caller-supplied projection digest, and a semantic result that passes DTO parsing but fails Gameplay reachability.

- [ ] **Step 4: Implement the one Gameplay assembler**

Reparse both receipts, prove disjoint ownership, merge/sort nodes, call `parseGameIrModuleCandidate`, call `parseGameplayModule`, freeze the result, and compute `projectionDigest` from all fields except itself. Do not expose a merge helper accepting arbitrary nodes.

- [ ] **Step 5: Verify deterministic real-source fixtures and commit**

Use the repository complete Foundation fixture's exact GDD sections for two distinct rule-driven source envelopes. Compile twice and compare canonical projection bytes/digests.

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.test.ts
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-schema.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-*.test.ts
bun run typecheck
git diff --check
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.test.ts
git commit -m "feat: assemble Game IR gameplay projections"
```

---

### Task 6: Balance producer admission and assembler

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/balance-producer.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/balance-producer.test.ts`

**Interfaces:**
- Consumes Task 1/2 contracts, Task 4 `parseBalanceModule`, and optional Gameplay projection targets.
- Produces:

```ts
export type BalanceModuleProjection = Readonly<{
  schemaVersion: 'game-ir-balance-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate & Readonly<{ moduleId: 'balance' }>
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  projectionDigest: string
}>

export function buildBalanceSemanticPacket(input: {
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
}): GameIrDomainSemanticPacket

export function admitBalanceSemanticResult(
  packet: GameIrDomainSemanticPacket,
  value: unknown,
): GameIrDomainSemanticReceipt

export function assembleBalanceModule(input: {
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
  semantic: GameIrDomainSemanticReceipt
  gameplay?: GameplayModuleProjection
}): BalanceModuleProjection
```

- [ ] **Step 1: Write RED semantic ownership tests**

Under the current table contract, verify the packet declares variable/parameter records as semantic-owned and the mechanical receipt may be empty. Reject column-name aliases masquerading as mechanical authority, regex-derived numeric claims, producer overlap, wrong source documents, and literal claims that do not byte-match the Balance table.

- [ ] **Step 2: Implement Balance packet/result admission**

Use closed Balance kinds and role manifest. Admit variable/table source claims only when the claim names exact source cells/slices; mechanically reparse ID/number/range/unit literal text and compare it to the semantic record.

- [ ] **Step 3: Write RED assembler and cross-domain tests**

Reject formula graph failures after DTO admission, missing gameplay trigger, wrong gameplay target kind, duplicate producer ownership, stale Gameplay projection revision, and any reference to an unimplemented module.

- [ ] **Step 4: Implement the one Balance assembler**

Merge only admitted mechanical/semantic nodes, build a global target map from Balance plus the optional same-revision Gameplay projection, run Core single-module admission and `parseBalanceModule`, then return a frozen digest-bound projection.

- [ ] **Step 5: Verify two source profiles and commit**

Use one numerically simple and one formula-dense complete Foundation fixture. Include a zero-resource profile to prove no resource placeholder is required.

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/balance-producer.test.ts
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/balance-schema.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-*.test.ts
bun run typecheck
git diff --check
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/balance-producer.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/balance-producer.test.ts
git commit -m "feat: assemble Game IR balance projections"
```

---

### Task 7: Phase 4 cross-domain and isolation completion gate

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance.integration.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts`
- Modify: `docs/beegame-game-ir-stage-isolation-redesign.md`
- Modify: `docs/superpowers/specs/2026-08-31-game-ir-gameplay-balance-design.md`

**Interfaces:**
- Consumes: final Task 5 Gameplay and Task 6 Balance projection APIs.
- Produces: Phase 4 completion evidence only; no production route or complete candidate.

- [ ] **Step 1: Add cross-domain mutation coverage**

Build both projections from the same READY receipt and exact source envelope. Prove Gameplay can read a typed Balance target, Balance reward/cost can bind a Gameplay action/event, wrong kinds and stale revisions reject, and the projection pair is deterministic.

- [ ] **Step 2: Prove no partial-candidate/publication API exists**

AST-scan new production files for `parseGameIrCandidate`, `prepareGameIrPublication`, `commitGameIrPublication`, controller/store imports, DeliveryRun writes, Foundation Issue admission, and placeholders for the other five modules. Synthetic fixtures must demonstrate every detector fires.

- [ ] **Step 3: Re-run protected parity**

The shared 21-file manifest must remain byte-identical to baseline `70df2e2c`. The full server source scan must still prove Game IR unreachable from production routes.

- [ ] **Step 4: Run the complete Phase 4 verification**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-artifacts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-check-definitions.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-cutover.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-production-manifest.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-rules.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-definitions.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-extraction.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-store.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-impact-analysis.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-batches.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-publication.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-round-policy.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts
bun run typecheck
(cd packages/agent-workflow-server && bun run typecheck)
./node_modules/.bin/biome check docs/beegame-game-ir-stage-isolation-redesign.md docs/superpowers/specs/2026-08-31-game-ir-gameplay-balance-design.md packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir
git diff --check
```

Expected: all Game IR tests pass; Foundation remains 263/263 or higher; both typechecks and static checks pass; protected production diff is empty.

- [ ] **Step 5: Update phase status truthfully**

Mark Phase 4 complete only after independent review is clean. Keep Phase 5–9 unstarted and state explicitly that complete candidate publication and Chrome acceptance remain unavailable.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance.integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts docs/beegame-game-ir-stage-isolation-redesign.md docs/superpowers/specs/2026-08-31-game-ir-gameplay-balance-design.md
git commit -m "test: prove isolated Game IR gameplay and balance"
```

---

## Completion gate

The plan is complete only when:

- Tasks 1–7 have task-level independent reviews with no unresolved actionable finding;
- Gameplay and Balance domain schemas cover every capability in the approved spec;
- producer target ownership is explicit, disjoint, and complete;
- Gameplay graph and Balance formula/unit invariants are mechanically enforced;
- two complete Foundation source profiles produce deterministic, distinct projections;
- no partial candidate, placeholder module, persistence format, controller route, or Foundation Issue path exists;
- Game IR and Foundation regression suites, both typechecks, Biome, diff-check, protected-file parity, and full-server unreachable scan pass;
- final whole-branch correctness and dual-track reviews are clean.
