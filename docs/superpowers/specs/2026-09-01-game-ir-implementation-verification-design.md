# Game IR Phase 7: Implementation and Verification Design

Status: proposed for independent review

## 1. Goal

Phase 7 completes the isolated Game IR compiler with one
`implementation-verification` domain. It converts the approved implementation
and acceptance intent in GDD, Level/Scene, Balance and Technical Design into a
strict task-facing execution graph. It then assembles the six real domain
modules into the first complete `GameIrCandidate` and exercises the existing
atomic publication authority without making production workflow routing
reachable.

This phase does not change Foundation Reviewer, Foundation Revision, Checklist
authorship, resource acquisition, Content, Comprehensive Reviewer, UI or
Chrome behavior.

## 2. Binding authority and invariants

This design is subordinate to:

- `docs/beegame-game-ir-stage-isolation-redesign.md`;
- the accepted Phase 4 Gameplay/Balance design;
- the accepted Phase 5 World/Presentation design;
- the accepted Phase 6 Resource Realization design.

It narrowly supersedes earlier references to a seven-module candidate, a
business `core` module, caller-supplied publication candidate/admissions and
the generic semantic-admission publication route. Historical phase behavior
and evidence remain accepted; only these not-yet-used completion boundaries
are replaced by sections 3 and 8 of this design.

The following rules are mandatory:

- Phase 7 receives `ImplementationVerificationAssemblyAuthority` and replays
  `assembleResourceRealizationClosure`; a detached Phase 6 closure is never
  authority.
- The source closure is exactly every receipt-bound Section Index entry from
  GDD, Level/Scene, Balance and Technical Design, in canonical order.
- The mechanical receipt is empty. Implementation ownership, acceptance
  meaning and evidence requirements are semantic decisions.
- A semantic worker may produce only candidate nodes and exact source claims.
  The service injects identity and bindings, re-admits the module and owns the
  final projection and complete candidate.
- A required prior node is referenced by typed edge or derived input. IDs,
  labels, paths and keywords are never used to infer a hidden relationship.
- No fixed token, duration, attempt, task, node, edge, scenario, invariant or
  evidence count is a business admission limit.
- There is no fallback, compatibility reader, partial publication, dual write,
  caller-built target map or caller-supplied complete candidate.
- Publication accepts replayable Phase 7 authority, never a caller candidate or
  detached per-module admission array.

## 3. Correct canonical module set

The earlier Core contract listed `core` beside six domain modules, but no
`core` domain schema, owner, producer or non-duplicated business responsibility
was ever defined. Core is the shared compile request, source binding, candidate
parser, graph admission and publication infrastructure. It is not a seventh
business domain.

Phase 7 therefore deletes the unused canonical `core` module requirement. The
complete V1 domain module set is exactly these six modules. Candidate and
publication order is the existing code-unit order:

```text
balance
gameplay
implementation-verification
presentation
resource-realization
world-scene
```

This candidate order is distinct from replay dependency order. Phase 7 replays
Gameplay/Balance, then World/Presentation, then Resource Realization, and
finally Implementation/Verification. No API treats dependency order as
candidate serialization order.

This is a clean pre-production schema correction. No old seven-module reader,
alias, empty `core` module, migration or fallback remains. Existing generic
Core code keeps its name and behavior; only canonical candidate/publication
coverage changes from a fictitious seven-module set to the six real domains.

## 4. Domain model

Phase 7 owns exactly five node kinds.

### 4.1 `implementation-verification.target`

Represents one concrete implementation destination described by Technical
Design.

Value fields:

- `label`: non-empty source-authored label;
- `runtime`: non-empty runtime identity;
- `platforms`: non-empty canonical sorted unique platform identities;
- `projectRoots`: non-empty canonical sorted unique safe project-relative
  roots.

Relationships:

- none.

The node does not store generated paths, build success, tool availability or
runtime observations.

### 4.2 `implementation-verification.unit`

Represents one cohesive implementation ownership boundary, not a worker task
or mutable progress record.

Value fields:

- `label`;
- `responsibility`: one source-authored responsibility statement;
- `ownedPaths`: non-empty canonical sorted unique safe project-relative path
  prefixes.

Relationships:

- `targets`: exactly one `implementation-verification.target`;
- `implements`: at least one node from Gameplay, Balance, World/Scene,
  Presentation or Resource Realization;
- `depends-on`: zero or more other implementation units.

The unit graph must be acyclic. Every owned path must equal or descend from
exactly one target `projectRoot`. Target roots are segment-aware disjoint; unit
paths are segment-aware disjoint across units. Thus `src/game` overlaps
`src/game/player`, but does not overlap `src/gameplay`. Units do not contain
status, attempts, assignees, prompts or generated task IDs.

### 4.3 `implementation-verification.acceptance-scenario`

Represents one independently observable behavior explicitly supported by the
source documents.

Value fields:

- `label`;
- `precondition`;
- `action`;
- `expectedOutcome`.

Relationships:

- `covers`: at least one prior Gameplay, Balance, World/Scene, Presentation or
  Resource Realization node;
- `owned-by`: exactly one implementation unit;
- `proved-by`: at least one evidence requirement.

This is not a Checklist line and does not copy Checklist prose. Phase 8 may
mechanically relate a Checklist source tag to this node's owner binding, but
Checklist remains its own raw-Markdown authority.

### 4.4 `implementation-verification.invariant`

Represents a condition that must remain true across implementation and
verification.

Value fields:

- `label`;
- `assertion`: non-empty source-authored assertion;
- `scope`: `runtime | state | numeric | resource | persistence`.

Relationships:

- `constrains`: at least one implementation unit or prior domain node;
- `proved-by`: at least one evidence requirement.

An invariant is not a second Balance formula or Technical specification. It
links to those authorities and states only the source-supported condition that
verification must prove.

### 4.5 `implementation-verification.evidence-requirement`

Declares what future native implementation validation must produce. It never
claims that evidence already exists.

Value fields:

- `label`;
- `kind`: `unit-test | integration-test | build | runtime-observation |
  visual-observation | audio-observation | file-inspection`;
- `expected`: non-empty source-authored success condition;
- optional `artifactPaths`: canonical sorted unique safe project-relative
  expected evidence locations.

Relationships:

- `owned-by`: exactly one implementation unit.

It contains no `passed`, `status`, timestamps, hashes of future files or
invented test commands. Actual test/build/runtime results remain workflow
evidence in later stages.

## 5. Required prior-node coverage and graph closure

The service mechanically derives `requiredPriorNodeIds` as every node ID in the
replayed Gameplay, Balance, World/Scene, Presentation and Resource Realization
modules. A worker cannot shrink, reorder or replace this set.

The module is valid only when:

- exactly one implementation target exists;
- at least one unit, acceptance scenario, invariant and evidence requirement
  exists;
- every unit reaches the sole target;
- the `implements` edges across all units cover every required prior node
  exactly once, with no missing, extra or multiply owned prior node;
- every prior-domain node required by an acceptance scenario is implemented by
  its owning unit or a transitive dependency of that unit;
- every required prior node is covered by at least one acceptance scenario or
  constrained by at least one invariant;
- every scenario and invariant has at least one evidence requirement;
- every evidence requirement proves at least one scenario or invariant;
- for a scenario or invariant, derive its `requiredProofOwners`: the scenario
  owner plus owners of every covered prior node, or the directly constrained
  units plus owners of every constrained prior node;
- each proving evidence owner's support closure is itself plus all transitive
  `depends-on` units; every evidence must support at least one required proof
  owner, and the union of all proving evidence support closures must cover the
  complete `requiredProofOwners` set;
- every unit owns or transitively supports at least one scenario or invariant;
- dependency cycles, orphan nodes, duplicate IDs, duplicate/overlapping path
  ownership and duplicate relationship edges are rejected.

All node IDs and arrays use code-unit canonical order. Expanded valid graphs
are accepted without a count ceiling.

## 6. Source and producer protocol

`GameIrDomainId` and the domain source/projection protocol gain the sole new
domain ID `implementation-verification`. Its immutable source documents remain
the already-declared GDD, Level/Scene, Balance and Technical Design set.

The producer follows the accepted pattern:

1. validate the source envelope;
2. admit an exactly empty mechanical receipt;
3. build a service-owned semantic packet from the manifest kinds, roles and
   exact evidence namespace;
4. admit one semantic receipt or structured FAIL/AMBIGUOUS diagnostic;
5. inject owner bindings from exact source claims;
6. re-admit the complete Phase 6 prior closure and the current module;
7. return no final projection by itself.

Domain validation uses the existing Gameplay, Balance, World/Scene,
Presentation and Resource Realization parsers against one exact dependency
sequence. Complete candidate serialization separately uses the code-unit order
in section 3. The validator does not flatten prior manifests into a permissive
kind union.

## 7. Phase 7 fidelity and assembly

The Phase 7 authority is:

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

The sole high-level assembler must:

1. replay `assembleResourceRealizationClosure(phase6Authority)`;
2. rebuild the Phase 7 source, mechanical receipt, semantic packet and module;
3. admit the exact validator result through shared semantic-fidelity
   primitives;
4. reject any caller module, projection, prior closure, candidate or digest;
5. produce an immutable `ImplementationVerificationClosure` containing the
   replayed Phase 6 closure, Phase 7 projection, complete six-module candidate,
   candidate digest and closure digest.

PASS coverage is fixed by a service-owned manifest and includes source
fidelity, projection completeness, prior closure, implementation ownership,
dependency acyclicity, scenario coverage, invariant coverage, evidence closure
and forbidden actual-evidence fields. FAIL/AMBIGUOUS is diagnostic-only.

## 8. Complete candidate and publication

The assembler, not a caller, constructs the first complete
`GameIrCandidate`. It uses the same compile request and full receipt-bound
Section Index for all six modules and calls the existing Core candidate parser
once across the entire module set. The candidate is canonical, deeply frozen
and byte/digest deterministic.

The pre-production publication authority currently accepts a caller candidate
and a second array of generic semantic-admission results. That route predates
the real Phase 4-7 replaying authorities and would become a parallel admission
track if retained. Phase 7 deletes it rather than adapting it.

The sole publication authority becomes:

```ts
type GameIrPublicationAuthority = Readonly<{
  workspacePath: string
  publicationId: string
  phase7Authority: ImplementationVerificationAssemblyAuthority
}>
```

`prepareGameIrPublication`, `commitGameIrPublication`, validation and recovery
all replay `assembleImplementationVerificationClosure(phase7Authority)` and
derive the compile request, Section Index, candidate and module fidelity
evidence internally. No caller-supplied `candidate`, `compileRequest`,
`sectionIndex` or `admissions` field remains.

The old generic `semantic-admission.ts` exists only to serve that detached
publication route. Phase 7 deletes the generic packet/result admission API.
Neutral diagnostic reason codes and evidence-pointer parsing still used by
domain projection move once into `semantic-fidelity.ts`; no alias or forwarding
wrapper remains.

Publication remains unreachable from production routing. Recovery rebuilds
from the same external Phase 7 authority; committed bytes and journals never
self-attest.

## 9. Checklist boundary

Checklist remains the sole delivery-completeness document and is not ingested
as Phase 7 source. Implementation/Verification nodes are execution semantics,
not a replacement Checklist or task graph. The current Checklist source tag
identifies only a document block; one block may produce several observable
checkboxes and several Phase 7 scenarios/units. It is therefore insufficient
to select an owner mechanically. Phase 7 does not claim a Checklist-to-scenario
crosswalk.

Phase 7 freezes unit `ownedPaths`, `depends-on` and required Resource
Realization edges as the only ownership/dependency input; Phase 8 must not
re-author those facts. Phase 8 separately defines the exact single-track
projection into the production task contract, removes the old
artifact/verification count caps and introduces one unique admitted
Checklist-to-scenario bridge that fails closed on missing or ambiguous
mapping. First-match selection and broadcasting one block tag to every possible
owner are forbidden.

Resource task IDs are likewise not Game IR node IDs. Phase 8 may obtain actual
Manifest `resourceIds` only through the admitted chain
`resource-realization.logical-resource.value.requirementId ->
ResourceInventoryReceipt.bindings -> Manifest resourceId`. It may not cast an
arbitrary Resource Realization `implements` target into a resource ID. Phase 8
decides whether one admitted unit maps to one or more execution attempts
without changing ownership, paths or dependencies.

## 10. File boundary

New production files remain inside the isolated Game IR directory:

- `implementation-verification-schema.ts`;
- `implementation-verification-producer.ts`;
- `phase7-admission.ts`;
- `implementation-verification-assembler.ts`.

Existing edits are limited to domain-neutral Game IR contracts/source IDs,
candidate/publication canonical module coverage, removal of the obsolete
generic semantic-admission route and isolated tests/helpers.
Foundation Reviewer, Revision, controller, state, recovery, resource workflow,
Checklist implementation, Manifest, Content, UI and production routing are
protected.

## 11. Acceptance

Acceptance requires:

- exact schema and all five node kinds;
- domain-specific prior re-admission with exact order and no omissions;
- valid single and expanded profiles covering runtime, numeric, persistence,
  resource, visual and audio evidence requirements;
- dependency and ownership closure, including path overlap rejection;
- scenario/invariant/evidence closure and forbidden actual-result rejection;
- exact source bytes, owner claims, identity and validator coverage;
- complete six-module candidate parsing and deterministic publication/recovery
  integration;
- deletion of caller candidate/admissions publication and the unused generic
  semantic-admission production route;
- Foundation byte/state parity and protected-path identity;
- AST isolation proving no production caller or protected import;
- full Game IR and Foundation gates, root/server typecheck, Biome and
  `git diff --check`;
- independent Sol review with zero Critical, Important and Minor findings.

Chrome is not Phase 7 acceptance. Phase 8 performs single-track consumer
cutover; Phase 9 performs fresh multi-project Chrome validation.
