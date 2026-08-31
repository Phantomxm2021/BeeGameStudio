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

### Task 1: Neutral fidelity primitives without a canonical cutover

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-fidelity.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-fidelity.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts`
- Modify import-only consumers in Phase 5/6 and Resource producer.

**Interfaces:**
- Produces: neutral `GameIrSemanticSourceSection`, diagnostic reason-code types and `sectionEvidencePointer` exports.
- Preserves: current canonical module set and generic publication behavior until the atomic Task 7 cutover.

- [ ] Add characterization tests for exact source-section/evidence pointer/reason-code bytes and errors.
- [ ] Move the definitions to semantic fidelity and update every live production/test import in the same change; generic semantic admission imports them internally but does not re-export them.
- [ ] Prove no duplicate definitions or forwarding exports remain and all existing Game IR tests/typechecks stay green.
- [ ] Commit `refactor: neutralize Game IR fidelity primitives`.

### Task 2: Phase 5 descriptor localization and generic admission dependency removal

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase6-admission.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/resource-realization-producer.ts`

**Interfaces:**
- Produces: Phase 5-local World/Presentation validator descriptors derived from canonical source documents, domain manifests and Phase 5 check IDs.
- Removes: all production imports from `semantic-admission.ts` except publication, which the atomic Task 7 cutover deletes.

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
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts` (production-file classification only; Task 7 later replaces the old semantic/core policies atomically)

**Interfaces:**
- Produces: `IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST`, five node-kind/value types and `parseImplementationVerificationModule(value, {request, sections, priorModules})`.
- Consumes: exact Phase 6 prior sequence and existing five domain parsers.

- [ ] Write one missing-interface RED, then add the minimal compiling manifest/parser shell and make one complete valid fixture GREEN before adding negative cases.
- [ ] Add each exact-field/union, non-empty root/path, safe-path, canonical-array and forbidden status/result/command mutation one at a time; observe an assertion-specific RED and implement the minimum GREEN.
- [ ] Add prior-admission mutations one at a time for complete/order-exact modules, exact moduleId-to-domain-parser binding and malformed same-kind values/edges. Keep the raw full prior map for parser identity, filter external targets per domain, prove existing legal cross-domain targets/edges remain accepted, then prove Core global closure across all six modules.
- [ ] Add graph mutations one at a time for exact-once prior ownership, full prior scenario/invariant coverage, unit dependency cycles, segment-aware root/path overlap and orphan closure.
- [ ] Add proof mutations one at a time for same-unit, multi-evidence and integration-unit dependency closure; reject irrelevant or incomplete proof owners while the valid fixture remains GREEN.
- [ ] Keep one explicit parser using existing Core and domain parsers; no meta-schema or fixed count ceiling.
- [ ] Run focused tests, typecheck and Biome; commit `feat: add implementation verification schema`.

### Task 5: Producer and semantic receipt

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/implementation-verification-producer.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/implementation-verification-producer.test.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/implementation-verification-test-helpers.ts` (test-only fixture helper)

**Interfaces:**
- Produces: service-built semantic packet, semantic receipt/diagnostic replay and a Core-admitted candidate module; never a final projection.
- Consumes: exact source envelope, empty mechanical receipt and manifest kinds/roles.

- [ ] Write one missing-interface RED, add the minimal compiling producer shell, then make one valid packet/receipt replay fixture GREEN.
- [ ] Add exact packet-shape, allowed-kind/role/evidence-namespace and forbidden caller identity/bindings/module mutations one at a time through assertion-specific RED to minimum GREEN.
- [ ] Add direct owner claim, exact UTF-8 literal, missing/ambiguous diagnostic, hidden/accessor key and stale packet/receipt replay mutations one at a time.
- [ ] Keep the producer wrapper minimal and reuse existing domain-projection and semantic-fidelity primitives.
- [ ] Run producer/schema/cumulative Phase 4–6 tests; commit `feat: add implementation verification producer`.

### Task 6: Phase 7 fidelity admission

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase7-admission.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase7-admission.test.ts`

**Interfaces:**
- Produces: `ImplementationVerificationValidationPreparationAuthority = {phase6Authority, implementationVerification: {source, mechanical, semantic}}`, `prepareImplementationVerificationSemanticValidationPacket(preparationAuthority)` and `admitImplementationVerificationSemanticValidationResult(preparationAuthority, packet, result)`.
- Consumes: replayable Phase 6 authority and Phase 7 source/mechanical/semantic values; validation is never an input to its own packet construction.

- [ ] Write one missing-interface RED, add the minimal compiling admission shell, then make one valid preparation/packet/PASS fixture GREEN.
- [ ] Add mutations one at a time proving Phase 6 is replayed, never accepted as a detached closure, every prior node ID is service-derived and validation cannot enter preparation authority; observe assertion-specific RED before minimum GREEN.
- [ ] Add each fixed check separately: source fidelity, projection completeness, prior closure, ownership, dependency, scenario, invariant, proof closure and forbidden actual evidence.
- [ ] Add PASS/FAIL/AMBIGUOUS seam, evidence namespace, identity/digest tampering and expanded-graph cases individually; retain no fixed count ceiling.
- [ ] Reconstruct packets and final invariants with shared semantic-fidelity primitives; commit `feat: admit Phase 7 semantic fidelity` after focused/cumulative gates.

### Task 7: Atomic complete-candidate and publication cutover

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/implementation-verification-assembler.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/implementation-verification-assembler.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/publication.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/publication.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-traversal.integration.test.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts`

**Interfaces:**
- Produces: `assembleImplementationVerificationClosure(authority): ImplementationVerificationClosure` with replayed Phase 6, Phase 7 projection, complete six-domain candidate and digests.
- Produces: `GameIrPublicationAuthority = {workspacePath, publicationId, phase7Authority}`; existing prepare/commit/validate/recover functions replay Phase 7 internally.
- Produces: exact six-entry `GameIrPublishedModuleEvidence` discriminated by Phase 4/5/6/7 and derived only from replayed source/projection digests; Phase 4 contains no invented validation result.
- Removes atomically: canonical `core`, caller `compileRequest/candidate/sectionIndex/admissions`, every generic semantic-admission API and all imports/tests for that file.

- [ ] Write one missing-interface RED, add only the minimal compiling assembler/publication test shell, and keep one complete assembler-to-publication end-to-end fixture RED at the explicit `not implemented`/old-authority-rejected boundary. Do not make it GREEN through a temporary adapter or parallel route.
- [ ] In one indivisible implementation change, delete canonical `core`, update every closed module/source map, implement the sole assembler with one Core complete-candidate parse, cut publication planning to Phase 7 authority, derive the exact six-entry Phase 4/5/6/7 evidence and every artifact/manifest/graph/marker byte internally, then make the complete end-to-end fixture GREEN.
- [ ] In that same green cutover, delete generic semantic admission and update stage-boundary/traversal/static gates to require zero source or test imports and no `core` module literals outside explicit rejection evidence. Do not commit an intermediate state.
- [ ] After the valid end-to-end fixture is GREEN, add authority and candidate mutations one at a time for caller module/prior closure/candidate/Section Index/digest fields, exact code-unit order, non-empty modules and global ID/reference/edge/derived closure; observe assertion-specific RED before minimum GREEN.
- [ ] Add publication mutations one at a time rejecting old caller fields, detached candidate/result relabeling, missing/duplicate/relabelled/generic-homogenized evidence and staged/journal self-attestation; independently reconstruct exact evidence bytes from replayed authorities/projections.
- [ ] Run assembler determinism/mutation/expanded tests, publication crash/concurrency/symlink/FIFO/recovery, complete Game IR, root/server typecheck and Biome before committing.
- [ ] Commit the atomic green cutover as `feat: publish complete Game IR from Phase 7 authority`.

### Task 8: Profiles, Foundation parity and phase-boundary audit

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

### Task 9: Whole-phase deletion audit and acceptance status

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
