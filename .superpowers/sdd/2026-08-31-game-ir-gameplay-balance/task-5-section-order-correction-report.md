# Task 5 Section Index order correction report

## Status

Complete. Game IR now treats the receipt-bound Foundation Section Index array
as the only source-section ordering authority. Core and domain admission still
validate strict JSON shape, unique section identity, receipt digest binding,
document coverage, line ranges, exact selected bytes, and immutable output,
but they no longer sort or reject the authenticated array using a second
comparator.

The Task 5 complete-document fixture no longer pads every document by 100
blank lines or re-sorts the Foundation index. Both unpadded fixture profiles
exercise the real line-number boundary, including `9` and `96` in
`docs/ASSET_PLAN.md`.

## Root cause

Foundation emits its Section Index in its own document/line order and commits
the index through `foundationReceipt.sectionIndexDigest`. Game IR had two
additional ordering decisions:

- `domain-source.ts` normalized the authority array and sorted it with raw
  code-unit comparison.
- `model.ts` required the resulting array to satisfy a separate
  `localeCompare` order.

Those comparators disagree on ordinary unpadded numeric line fragments. For
example, a section starting at line `9` and another starting at line `96` are
ordered differently by the two rules. The Task 5 fixture had hidden the
production-reachable mismatch by adding 100 blank lines to every rendered
document and then applying the domain comparator in the fixture.

The source-index audit also found equivalent duplicate authority in
`semantic-admission.ts`: full indexes were independently required to be in
locale order, selected source sections were re-sorted, and packet source
sections were independently required to be sorted. Those source-index-only
checks were removed. Unrelated canonical ordering for module IDs, node IDs,
references, edges, targets, claims, evidence pointers, and canonical JSON was
left intact.

## TDD evidence

### RED: unpadded complete fixture

After deleting only the 100-line fixture padding and fixture-side re-sort, and
before changing production code:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.test.ts
```

Result: `14 pass, 1 fail, 37 expect() calls`. The complete fixture failed on
its first mechanical admission with:

```text
invalid Game IR candidate: source sections must be unique and sorted
```

The stack crossed the required production path through
`admitGameIrMechanicalProjectionReceipt` into Core admission.

The regression was then tightened to compare the source envelope's authority
array directly with the exact unpadded array returned by
`buildFoundationSectionIndex`:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.test.ts \
  -t 'compiles two complete Foundation fixture source profiles twice deterministically'
```

Result before the production correction: `0 pass, 1 fail` with 14 other tests
filtered. The diff showed `domain-source.ts` had moved `startLine: 9` sections
behind two-digit sections and moved `startLine: 96` ahead of the Foundation
authority position.

### GREEN: exact regression

After removing the duplicate source-index ordering checks:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.test.ts \
  -t 'compiles two complete Foundation fixture source profiles twice deterministically'
```

Result: `1 pass, 0 fail, 104 expect() calls`.

For each of the two distinct complete profiles, the test now proves:

- the full authority array equals the exact unpadded Foundation index;
- all eight canonical Foundation documents remain present;
- the real `docs/ASSET_PLAN.md` fixture includes line starts `9` and `96`;
- the selected Gameplay closure equals an order-preserving filter of every GDD
  section in the authority array;
- every selected GDD section can independently traverse source envelope build,
  mechanical admission, semantic result admission, and
  `assembleGameplayModule`;
- repeated assemblies have identical canonical projection bytes, module
  digests, and projection digests;
- the two source profiles remain observably distinct.

The Core regression was also updated to prove that a receipt-digest-valid
authority array is accepted without imposing another order, while altered
heading/line metadata and duplicate section identities remain rejected.

## Implementation

### Core model

`model.ts` retains complete normalized Section Index construction in insertion
order, duplicate `(documentPath, sectionId)` rejection, receipt digest
recomputation, document receipt checks, line/digest validation, and the lookup
map used by owner binding admission. It removes only the independent
source-section sort-order rejection and its comparator.

### Domain source

`domain-source.ts` retains strict dense-array/plain-object validation, hidden
and accessor rejection, exact eight-document authority coverage, receipt
digest validation, duplicate identity rejection, exact domain document
manifest selection, exact selected byte keys, per-section byte digests, source
digest validation, immutable copies, and caller-narrowing rejection.

Normalization no longer sorts the authority array. Gameplay and Balance
closures are derived with `filter`, preserving authenticated authority order.
Envelope validation recomputes the same exact ordered subset from the authority
array.

### Semantic admission audit correction

`semantic-admission.ts` retains strict index and packet JSON validation,
duplicate section identity rejection, eight-document coverage, exact receipt
digest checks, exact source bytes, closure equality, packet digest checks, and
evidence validation. It now preserves full authority order and selects manifest
sections through insertion-preserving map/filter traversal rather than a
second source-index comparator.

## Verification

Focused model/domain-source/domain-projection/gameplay-producer suites:

```text
bun test \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.test.ts
```

Result: `50 pass, 0 fail, 257 expect() calls` across 4 files.

Full Game IR:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts
```

Result: `159 pass, 0 fail, 777 expect() calls` across 12 files.

Root and package typechecks:

```text
bun run typecheck
(cd packages/agent-workflow-server && bun run typecheck)
```

Result: both `tsc --noEmit` commands exited 0.

Protected Foundation parity and Stage boundary:

```text
bun test \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts
```

Result: `7 pass, 0 fail, 122 expect() calls` across 2 files.

Biome and diff check:

```text
biome check \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.test.ts
git diff --check
```

Result: Biome checked all 5 TypeScript files with no issues; diff-check exited
0.

## Changed files

- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.test.ts`
- `.superpowers/sdd/2026-08-31-game-ir-gameplay-balance/task-5-section-order-correction-report.md`

## Self-review

- No Foundation, Reviewer, Revision, routing, persistence, publication format,
  compatibility, migration, fallback, dual-reader, or fixed-cap behavior was
  changed.
- The production diff is deletion-led: source-index comparators and their
  rejection loops were removed instead of introducing a new comparator or
  normalization layer.
- `Map` insertion order and `Array.prototype.filter` provide the required
  authority-order preservation without new helpers or dependencies.
- Duplicate identity checks remain independent of position, so deleting sort
  checks does not weaken uniqueness.
- Receipt digest recomputation still occurs before owner binding, domain
  selection, semantic packet construction, or envelope admission.
- Exact selected bytes and per-section SHA-256 validation are unchanged.
- All unrelated internal canonical array rules remain in place.
- A Game IR source-index comparator audit found no remaining production sort or
  ordering rejection for `sectionIndex`, `authoritySectionIndex`, or
  `sourceSections` in the changed boundary.

## Concerns

No scoped implementation concern remains. Per the controller ruling, the
protected Foundation Section Index producer and digest implementation were not
modified; Game IR validates that receipt digest and preserves the supplied
authority array instead of re-authoring its order.

---

## Fix round 1/5: one Game IR canonical order

This section supersedes the initial report's ordering ruling and its final
concern statement above. Independent review established that Foundation's
`digestSectionIndex` sorts entries before hashing. The Foundation receipt
therefore authenticates the exact Section Index set and metadata, but it does
not authenticate the caller-supplied array permutation. Preserving caller
order, as implemented in `c7b0f980`, allowed multiple Game IR source envelope,
packet, and projection byte orders under the same valid Foundation receipt.

### Superseding architecture

Game IR now derives one order after strict boundary normalization:

```text
documentPath + NUL + startLine + NUL + sectionId
```

The key is compared with raw JavaScript code-unit comparison. The exported
Core function `canonicalizeGameIrSourceSections` is the only production
source-index canonicalizer. It rejects duplicate `(documentPath, sectionId)`
identities, returns a new array, and does not mutate caller input.

- Core calls it before receipt digest recomputation and source lookup map
  construction.
- Domain source calls it after strict JSON/metadata normalization and filters
  each selected closure from that canonical full index.
- Generic semantic admission calls it after strict normalization. Its module
  closure first collects all manifest and owner-binding section keys into a
  set, then filters the canonical full index. Node or map insertion order can
  no longer determine source order.
- Publication calls the same function on its already-validated, frozen
  authority array before comparing semantic packets and computing publication
  authority bytes.

Builder inputs may arrive in any receipt-valid permutation and normalize to
the same bytes. Already-signed domain envelopes and semantic packets must carry
the canonical array; validation does not silently forgive post-sign reorder.

### RED evidence

#### Domain source permutation

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts \
  -t 'canonicalizes receipt-valid caller permutations before selecting a domain'
```

Before implementation: `0 pass, 1 fail`. Reversing the same receipt-valid
eight-document index produced a reversed `authoritySectionIndex`, a different
Balance subset order, and a different `sourceDigest`.

#### Generic semantic packet permutation

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts \
  -t 'canonicalizes caller permutations to one complete semantic packet'
```

Before implementation: `0 pass, 1 fail`. Reversing the same receipt-valid
index reversed `packet.sectionIndex` and changed packet bytes/digest. The
generic fixture's manual `localeCompare` pre-sort was removed, and its GDD
sections now use the explicit unpadded `9` and `96` line starts.

#### Complete Gameplay fixture permutation

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.test.ts \
  -t 'compiles two complete Foundation fixture source profiles twice deterministically'
```

Before implementation: `0 pass, 1 fail`. The unpadded complete Foundation
fixture retained Foundation order rather than the required Game IR code-unit
order, and its reversed valid permutation produced distinct source authority
arrays.

#### Shared Core API

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts \
  -t 'defines one code-unit canonical Section Index order for every caller permutation'
```

Before implementation: `0 pass, 1 fail, 1 error`; Bun reported that the named
`canonicalizeGameIrSourceSections` export did not exist.

#### Downstream publication audit

The first full Game IR run after the three primary boundaries were corrected
reported `143 pass, 19 fail`. Every failure was in publication and reported:

```text
invalid Game IR publication: semantic packet Section Index is detached from publication authority
```

Publication still compared the new canonical semantic packet against its raw
caller-order authority array. Routing the validated publication authority
through the same shared canonicalizer fixed the common root cause; no separate
publication comparator was added.

### GREEN evidence

Focused Core/domain/semantic/Gameplay tests:

```text
bun test \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.test.ts
```

Result: `70 pass, 0 fail, 382 expect() calls` across 5 files.

Full Game IR:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts
```

Result: `162 pass, 0 fail, 798 expect() calls` across 12 files.

Protected Foundation parity and Stage boundary:

```text
bun test \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts
```

Result: `7 pass, 0 fail, 122 expect() calls` across 2 files.

Root and server-package typechecks both ran `tsc --noEmit` and exited 0.
Biome checked all changed TypeScript files with no issues, and
`git diff --check` exited 0.

### Regression coverage

- Core proves forward and reversed valid permutations canonicalize identically,
  the input array is not mutated, and duplicate identities still fail.
- Domain source proves complete authority arrays, selected Balance arrays,
  canonical envelope bytes, and `sourceDigest` are identical across caller
  permutations.
- Generic semantic admission proves exact full indexes, exact selected source
  sections, canonical packet bytes, and `packetDigest` are identical across
  permutations while every required GDD section remains present.
- The complete unpadded eight-document Gameplay fixture proves both source
  permutations produce identical full/selected arrays, envelope bytes, and
  source digests. Every selected GDD section still traverses mechanical and
  semantic admission through deterministic Gameplay assembly.
- Existing altered heading/line/digest, duplicate identity, exact byte,
  hidden/accessor, caller narrowing, and post-sign reorder tests remain green.

### Fix-round changed files

- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-producer.test.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/publication.ts`
- `.superpowers/sdd/2026-08-31-game-ir-gameplay-balance/task-5-section-order-correction-report.md`

### Fix-round self-review

- No Foundation, Reviewer, Revision, schema, compatibility, fallback,
  migration, dual-reader, route, or fixed-cap behavior changed.
- No production `localeCompare` or local code-unit source-index sort remains in
  Core, domain source, semantic admission, or publication.
- Domain and semantic selection use `filter` over the canonical full index;
  insertion order is not an authority.
- Duplicate identity and exact Foundation digest validation happen before any
  candidate owner or source bytes are admitted.
- Unrelated module, node, reference, edge, target, claim, evidence, and JSON
  canonical ordering rules are unchanged.
- The shared canonicalizer returns a new array and introduces no dependency,
  compatibility path, or new abstraction layer.

### Fix-round concerns

No scoped concern remains. Foundation's protected order-insensitive digest is
unchanged; Game IR now deterministically canonicalizes the authenticated
content set exactly once at its Core boundary and reuses that implementation
everywhere source-index order is material.
