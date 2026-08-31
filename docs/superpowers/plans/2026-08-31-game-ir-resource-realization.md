# Game IR Resource Realization Phase 6 Implementation Plan

**Design authority:**
`docs/superpowers/specs/2026-08-31-game-ir-resource-realization-design.md`

**Execution policy:** each implementation task starts with a failing focused
test, is implemented by a Luna high subagent, and is reviewed by the Sol high
main agent or an independent Sol high reviewer. A task is not complete until
its focused suite, affected prior suites, typecheck and diff checks pass.

## Guardrails

- Work only in `codex/game-ir-stage-isolation`.
- Preserve the Phase 5 accepted baseline `b87d7fa4` and protected production
  paths.
- Do not touch Reviewer, Revision, workflow routing/state/recovery, resource
  workflow, Asset Manifest, UI, or Chrome.
- Delete conflicting or duplicate Phase 6 implementations; do not add
  fallback, compatibility, alias, dual read/write or legacy paths.
- Do not add fixed token, time, attempt, node, variant, artifact or byte caps.
- Raw JSON structures remain internal Game IR artifacts; this phase does not
  change Foundation Markdown generation.

## Task 1: extract the shared semantic-fidelity protocol

Files:

- add `semantic-fidelity.ts` and focused characterization tests
- modify `phase5-admission.ts` and its tests only to consume the extraction

RED assertions lock canonical bytes, receipt/packet/check parsing, exact error
behavior, ordering and mutation rejection before extraction. Move only
domain-neutral protocol primitives. Phase 5 manifests, checks, bindings and
invariants remain in `phase5-admission.ts`. Full Phase 5 output must remain
byte/digest equivalent. Do not copy the protocol into Phase 6.

## Task 2: admit the Resource domain source

Files:

- modify `domain-source.ts` and `domain-source.test.ts`
- modify only Game IR test helpers that construct all-domain fixtures

RED assertions:

- canonical `resource-realization` source with its exact fixed document scope
  is admitted;
- omitted, extra or mixed Foundation sections are rejected;
- existing four domain sources remain byte-equivalent;
- implementation-verification is still not admitted in Phase 6.

Implementation: extend the domain ID union/set without introducing a generic
unknown domain or caller-selected source scope.

## Task 3: strict Resource Realization schema

Files:

- add `resource-realization-schema.ts`
- add `resource-realization-schema.test.ts`

RED assertions cover the five node kinds, exact fields, resource kinds,
activation discriminants, safe paths, optional fields, constraint/budget
discriminated unions, finite values, artifact class/root/extension/format
agreement, sourcing policy, canonical ordering, relationships, references and all closure
invariants. Include shared resource-core acquisition vocabularies, exact
Manifest-v8 resource-plan projection, multi-variant and multi-file valid
fixtures and failures for duplicate IDs/paths, orphan nodes and forbidden
actual-resource fields.

RED cases also cover empty dimensions/asset kinds, empty or constraint-free
coverage, top-level capabilities beside coverage, unsupported target format,
path/format mismatch, invalid codec shape and non-canonical arrays.

Implementation: one manifest and one parser; reuse Core parsing, canonical
comparison and source-binding validation. Do not build a second generic parser.

## Task 4: producer and empty mechanical ownership

Files:

- add `resource-realization-producer.ts`
- add `resource-realization-producer.test.ts`
- update Game IR-only projection typing/tests

RED assertions prove the service-built pre-worker projection packet, replayed
Phase 5 derived requirements and target catalog, exact packet manifests,
empty-only mechanical ownership, strict semantic result admission, structured
diagnostics, packet-digest binding and rejection of Presentation-owned shadow
targets. Caller-supplied target/forbidden lists are rejected by shape.

Implementation: reuse the shared domain semantic packet machinery. Extend only
the type boundaries required for the new canonical domain.

## Task 5: Phase 6 fidelity admission

Files:

- add `phase6-admission.ts`
- add `phase6-admission.test.ts`

RED assertions cover exact source bytes, reconstruction of the pre-worker
packet, derived Presentation requirements, complete check coverage, semantic
fidelity, non-empty canonical module, exact acquisition profiles and delivery
target, missing/extra/shadowed requirements, variant/artifact closure, safe
unique paths and forbidden actual-resource facts.

Implementation: compose the extracted shared packet/admission protocol and add
only Phase 6 invariants. Do not copy Phase 5 protocol or relax its contracts.

## Task 6: sole replaying assembler

Files:

- add `resource-realization-assembler.ts`
- add `resource-realization-assembler.test.ts`

RED assertions prove that preparation and final assembly both rebuild Phase 5,
bind one identity, replay Phase 6 receipts, derive exact Presentation
requirements, derive an exact resource-plan/Curator-policy projection, admit
PASS, and reject detached/tampered/partial authority.

Implementation exports only
`prepareResourceRealizationSemanticProjectionPacket`,
`prepareResourceRealizationSemanticValidationPacket` and
`assembleResourceRealizationClosure` as high-level operations.

## Task 7: complete profiles and parity

Files:

- add `resource-realization-profiles.integration.test.ts`
- update `foundation-parity.test.ts`
- update `stage-boundary.test.ts`
- update only isolated Game IR fixtures/helpers

RED assertions run two complete profiles, multi-file delivery, expanded graph
sizes, Phase 5 rebuild parity, protected-file identity and no production
reachability.

Also prove repeated assembly byte/digest determinism, input mutation cannot
change a frozen closure, Presentation `ui -> ui-asset` derivation, and complete
alternative groups plus mechanically evaluable conditional predicates.

## Task 8: whole-phase deletion and boundary audit

Mechanically scan Phase 6 changed production paths and their reachable Game IR
call graph for old resource Game IR symbols, detached
closures, legacy/current loaders, fallbacks, compatibility aliases, dual
writes, placeholders, fixed business caps and production callers. Delete any
conflict instead of accommodating it.

The existing unreachable Manifest `.max(256)` is outside this phase's writable
boundary and is a mandatory Phase 8 cutover deletion. It cannot constrain
Phase 6 fixtures or survive the eventual production routing cutover.

Run:

1. all `game-ir/*.test.ts`;
2. the established Foundation gate suites;
3. package and root typechecks;
4. Biome/lint on changed files;
5. `git diff --check`;
6. protected-path diff against the Phase 5 baseline;
7. AST isolation and single-writer scans.

An independent Sol high reviewer then audits the complete Phase 6 range
against the design. Any Critical, Important or Minor correctness/boundary gap
returns to the responsible Luna high implementation task, followed by full
re-verification. Only an empty audit accepts Phase 6.

## Task 9: status only

After acceptance, update the roadmap/progress ledger to record Phase 6 as
implemented and accepted, with exact commits and verification evidence. Do not
mark Phase 7–9, publication, routing, consumer cutover or Chrome complete.
