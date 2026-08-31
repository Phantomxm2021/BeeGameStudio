# Task 4 report: Presentation schema, requirements, and UI graph guards

## Implemented

- Added the closed twelve-kind `PRESENTATION_DOMAIN_MANIFEST` with strict value fields, optional requirement ownership policy, relationship target kinds, and conditional cardinalities.
- Added `parsePresentationModule` with immutable normalized output, strict value/requirement/edge/module validation, safe IDs, finite numeric boundaries, and canonical code-unit ordering.
- Added UI state/screen backlink and reachability checks, terminal-state outgoing-transition rejection, same-screen transition checks, trigger discriminant checks, and duplicate transition/audio-trigger guards.
- Added explicit animation, VFX, camera, audio spatial-context, music, and logical requirement validation.
- External targets are admitted only when their kind is declared by the manifest; local Presentation targets cannot be supplied externally.

## TDD evidence

- RED (API wiring): `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.test.ts` first failed with module resolution because the schema file did not exist.
- Assertion-level RED after API wiring: the temporary exported stub produced `Expected length: 12 / Received length: 0` for the manifest assertion and failed the parser behavior assertions with `not implemented`.
- GREEN: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.test.ts` → 9 pass, 0 fail, 37 expect calls.

## Fix round 1 evidence

- Added table-driven exact assertions for all twelve manifest entries, every role/target/cardinality list, absent references policy, five requirement owners, closed enums, and independent requirement/UI/behavior/external-target mutation matrices.
- Each mutation case first parses an unchanged legal baseline. Final focused result: 14 pass, 0 fail, 126 expect calls.
- Mutation-strength check: temporarily disabled the single `allowedKeys` unknown-field guard; the focused `strict values` and `requirements` tests failed because artifact/unknown-key mutations were accepted. The guard was restored before commit.
- No production defect was exposed, so no production file was changed in this round.

## Verification

- Focused test: 14 pass, 0 fail, 126 assertions.
- Server typecheck: `cd packages/agent-workflow-server && bun run typecheck` → exit 0.
- Biome: checked both Task4 files with no fixes required.
- `git diff --check` → clean.

## Boundary/self-review

- Only the two brief-listed Presentation source/test files are production/test changes; no Reviewer, Revision, Foundation, route/store/provider, Phase6+, or candidate/publication code was touched.
- Requirements contain only `requirementId`, `kind`, and `runtimeRole`; artifact/path/digest fields and hidden filename-like inference are rejected or ignored as appropriate.
- Labels such as `death.wav` remain valid text and are not treated as artifacts.
- No fixed business caps, fallback, compatibility path, or `startsWith`-based policy was added.

## Commit

Original implementation: `b3ca881c feat: validate Game IR presentation graphs`

Fix-round test commit: `acc69262 test: strengthen Presentation schema audit coverage`

This report update is a separate evidence commit.
