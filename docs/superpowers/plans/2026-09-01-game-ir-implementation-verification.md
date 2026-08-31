# Game IR Phase 7 Implementation and Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the sole Implementation/Verification Game IR domain, assemble the complete six-domain candidate, and bind immutable publication to replayable Phase 7 authority.

**Architecture:** Phase 7 replays the accepted Phase 6 authority, compiles one strict five-kind Implementation/Verification graph, validates complete prior-node ownership and proof closure, then constructs the six-domain candidate in code-unit order. Publication is cut over once to Phase 7 authority and the detached generic semantic-admission route is deleted.

**Tech Stack:** TypeScript, Bun test runner, Zod v4 contracts, Node crypto/filesystem primitives, Biome.

**Spec:** `docs/superpowers/specs/2026-09-01-game-ir-implementation-verification-design.md`

## Global Constraints

- All production edits remain inside `delivery-workflow/game-ir`; the roadmap is the only status document edited.
- Foundation Reviewer/Revision, controller/state/recovery, Checklist, Manifest, resource workflow, Content, UI and production routing remain byte-identical.
- Canonical modules are exactly `balance`, `gameplay`, `implementation-verification`, `presentation`, `resource-realization`, `world-scene` in code-unit order; no `core` placeholder remains.
- Dependency replay order is Phase 4 → Phase 5 → Phase 6 → Phase 7 and is never used as candidate serialization order.
- No compatibility, fallback, forwarding wrapper, caller candidate/admissions, dual write or fixed business count/token/time/attempt cap.
- Every behavior change is TDD: observe RED on the exact boundary, implement the minimum production change, run focused and cumulative gates, then commit.
- Implementation workers use Luna high; independent review and corrective boundary decisions use Sol high.

---

### Task 1: Canonical six-domain contract and neutral fidelity primitives

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-fidelity.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-fidelity.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.ts`

**Interfaces:**
- Produces: six-value `GAME_IR_CANONICAL_MODULE_IDS`; neutral `GameIrSemanticSourceSection`, diagnostic reason-code types and `sectionEvidencePointer` exports.
- Preserves: compile request/receipt/candidate schema versions and canonical JSON/digest rules.

- [ ] Write RED tests proving `core` is rejected, the exact six IDs are code-unit sorted, and the moved fidelity primitives preserve existing bytes/errors.
- [ ] Run the focused contracts/fidelity tests and record the expected old seven-module failure.
- [ ] Delete `core` from the canonical IDs and move the live shared primitives without aliases or forwarding exports.
- [ ] Update domain-projection imports only; do not delete generic semantic admission yet.
- [ ] Run focused tests, root/server typecheck and Biome; commit `refactor: canonicalize six Game IR domains`.

### Task 2: Phase 5 descriptor localization and generic admission dependency removal

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase6-admission.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/resource-realization-producer.ts`

**Interfaces:**
- Produces: Phase 5-local World/Presentation validator descriptors derived from canonical source documents, domain manifests and Phase 5 check IDs.
- Removes: all production imports from `semantic-admission.ts` except publication, which Task 8 deletes.

- [ ] Add characterization tests for Phase 5 packet bytes, manifest digests, checks and diagnostic errors.
- [ ] Add a RED static assertion that Phase 5/6/Resource production files do not import generic semantic admission.
- [ ] Implement the local Phase 5 descriptor and import neutral source/evidence primitives from semantic fidelity.
- [ ] Run Phase 5/6/Resource producer gates and prove byte/error parity; commit `refactor: localize Phase 5 validator descriptors`.

### Task 3: Extend the real domain source/projection protocol

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts`

**Interfaces:**
- Produces: `GameIrDomainId` including `implementation-verification`; exact GDD/Level/Balance/Technical source envelope; existing empty-mechanical and semantic receipt protocols for the new domain.

- [ ] Write RED tests for the exact four-document closure, full receipt-bound Section Index, caller byte rejection and an empty-only mechanical receipt.
- [ ] Extend the closed domain ID/source maps and projection discriminants; do not add a new generic producer framework.
- [ ] Run domain source/projection plus Phase 4–6 characterization tests; commit `feat: admit implementation verification source authority`.

### Task 4: Strict Implementation/Verification schema

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/implementation-verification-schema.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/implementation-verification-schema.test.ts`

**Interfaces:**
- Produces: `IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST`, five node-kind/value types and `parseImplementationVerificationModule(value, {request, sections, priorModules})`.
- Consumes: exact Phase 6 prior sequence and existing five domain parsers.

- [ ] Build one complete valid fixture with one target, multiple units, scenarios, invariants and evidence requirements.
- [ ] Write RED matrix tests for exact fields/unions, non-empty roots/paths, safe paths, canonical arrays and forbidden status/result/command fields.
- [ ] Write RED prior-admission tests for complete/order-exact modules, cross-label and malformed same-kind values/edges.
- [ ] Write RED graph tests for exact-once prior ownership, full prior scenario/invariant coverage, unit dependency cycles, segment-aware root/path overlap and orphan closure.
- [ ] Write RED proof tests for same-unit, multi-evidence and integration-unit dependency closure; reject irrelevant or incomplete proof owners.
- [ ] Implement one explicit manifest/parser using existing Core and domain parsers; no meta-schema or fixed count ceiling.
- [ ] Run focused tests, typecheck and Biome; commit `feat: add implementation verification schema`.

### Task 5: Producer and semantic receipt

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/implementation-verification-producer.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/implementation-verification-producer.test.ts`

**Interfaces:**
- Produces: service-built semantic packet, semantic receipt/diagnostic replay and a Core-admitted candidate module; never a final projection.
- Consumes: exact source envelope, empty mechanical receipt and manifest kinds/roles.

- [ ] Write RED tests for exact packet shape, allowed kinds/roles/evidence namespace and forbidden caller identity/bindings/module fields.
- [ ] Write RED tests for direct owner claims, exact UTF-8 literals, missing/ambiguous diagnostics, hidden/accessor keys and stale packet/receipt replay.
- [ ] Implement the minimal producer wrapper with existing domain-projection and semantic-fidelity primitives.
- [ ] Run producer/schema/cumulative Phase 4–6 tests; commit `feat: add implementation verification producer`.

### Task 6: Phase 7 fidelity admission

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase7-admission.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase7-admission.test.ts`

**Interfaces:**
- Produces: `prepareImplementationVerificationSemanticValidationPacket(authority)` and `admitImplementationVerificationSemanticValidationResult(authority, packet, result)`.
- Consumes: replayable Phase 6 authority and Phase 7 source/mechanical/semantic values.

- [ ] Write RED tests proving Phase 6 is replayed, never accepted as a detached closure, and every prior node ID is service-derived.
- [ ] Cover exact fixed checks: source fidelity, projection completeness, prior closure, ownership, dependency, scenario, invariant, proof closure and forbidden actual evidence.
- [ ] Cover PASS/FAIL/AMBIGUOUS exact seams, evidence namespaces, identity/digest tampering, expanded graphs and no fixed count ceiling.
- [ ] Implement packet reconstruction and final invariants using shared semantic-fidelity primitives; commit `feat: admit Phase 7 semantic fidelity` after focused/cumulative gates.

### Task 7: Sole Phase 7 assembler and complete candidate

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/implementation-verification-assembler.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/implementation-verification-assembler.test.ts`

**Interfaces:**
- Produces: `assembleImplementationVerificationClosure(authority): ImplementationVerificationClosure` containing replayed Phase 6 closure, Phase 7 projection, complete six-domain candidate and digests.
- Consumes: only `ImplementationVerificationAssemblyAuthority`.

- [ ] Write RED authority-shape tests rejecting caller module, prior closure, candidate, Section Index and digest fields.
- [ ] Write RED candidate tests for exact six modules in code-unit order, non-empty modules, global ID/reference/edge/derived closure and one compile identity.
- [ ] Implement the sole assembler: replay Phase 6, rebuild/admit Phase 7, call Core complete-candidate parser once, deep-freeze and digest.
- [ ] Add determinism, input-mutation, full-prior coverage and expanded-profile tests; commit `feat: assemble complete Game IR candidate`.

### Task 8: Authority-bound publication cutover and old-track deletion

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/publication.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/publication.test.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts`

**Interfaces:**
- Produces: `GameIrPublicationAuthority = {workspacePath, publicationId, phase7Authority}`; existing prepare/commit/validate/recover functions replay Phase 7 internally.
- Removes: caller `compileRequest`, `candidate`, `sectionIndex`, `admissions` and every generic semantic-admission API.

- [ ] Rewrite publication fixtures around real Phase 7 authority; observe RED where old caller candidate/admissions are still accepted.
- [ ] Add rejection tests for all deleted fields, detached candidate/result relabeling and staged/journal self-attestation.
- [ ] Cut publication planning to the sole assembler and derive every artifact/manifest/graph/marker byte internally.
- [ ] Delete generic semantic admission and update AST/static gates to require zero production/test imports.
- [ ] Run publication crash/concurrency/symlink/FIFO/recovery suite and complete Game IR tests; commit `refactor: bind Game IR publication to Phase 7 authority`.

### Task 9: Profiles, Foundation parity and phase-boundary audit

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/implementation-verification-profiles.integration.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts`
- Modify only necessary isolated test helpers.

**Interfaces:**
- Proves: runtime/numeric/persistence/resource/visual/audio profiles; complete candidate/publication; Foundation and protected-stage parity; zero production caller.

- [ ] Add at least two structurally different complete profiles, including an integration evidence unit and expanded graph beyond ordinary counts.
- [ ] Use real controller READY documents and the same compile request/Section Index; compare all eight document bytes and Foundation state before/after Phase 7 assembly/publication preparation.
- [ ] Update AST boundaries for six canonical domains, no `core`, no generic semantic admission, exactly one Phase 7 assembler/publication path and no protected imports/callers.
- [ ] Run the complete Game IR suite, Foundation 21-file gate, root/server typecheck, Biome, `git diff --check` and protected-path diff; commit `test: close Phase 7 isolation and parity`.

### Task 10: Whole-phase deletion audit and acceptance status

**Files:**
- Modify only if audit finds a real defect: files in the Phase 7 Game IR boundary.
- Modify after zero-finding review: `docs/beegame-game-ir-stage-isolation-redesign.md`.

**Interfaces:**
- Produces: independent Sol final review and exact acceptance evidence; leaves Phase 8–9 pending.

- [ ] Scan all Game IR production/callers for `core` module literals, generic semantic admission, caller candidate/admissions, compatibility/fallback/placeholder routes, arbitrary caps and duplicate assemblers.
- [ ] Independently review source fidelity, domain schema, complete coverage/proof closure, candidate order, publication/recovery and test validity; repair every finding through new Luna RED→GREEN commits and repeat until `0 Critical / 0 Important / 0 Minor`.
- [ ] Re-run full Game IR, Foundation gate, root/server typecheck, Biome, diff/static/protected scans on final HEAD.
- [ ] Update the roadmap with exact commits/counts and mark only Phase 7 accepted; keep Phase 8 consumer cutover, Phase 9 fresh workflow and Chrome pending.
- [ ] Commit `docs: close Phase 7 Game IR status`.
