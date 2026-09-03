# Task 3A — Align restored workflow stage fixtures

Date: 2026-09-03 (Asia/Shanghai, UTC+08:00)
Branch: `codex/game-ir-isolation-recovery`

## RED evidence

The broad baseline server command before correction was:

```text
bun test packages/agent-workflow-server/src/__tests__
352 pass
3 fail
1260 expect() calls
Ran 355 tests across 42 files.
```

The three failures were the `workflow stage snapshot display projection` tests. They all came from the stale `phaseCount: 10` fixture in `workflow-stage-snapshot-projection.test.ts`; `session-routes.test.ts` contained the same stale fixture literal. The evidence is appended to `docs/superpowers/evidence/2026-09-03-stable-workflow-local-verification.md`.

## Bounded correction

Only these two test fixtures changed:

- `packages/agent-workflow-server/src/__tests__/workflow-stage-snapshot-projection.test.ts`
- `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`

Both import `DELIVERY_PROGRESS_STAGES` and derive `phaseCount` from `.length`. The v2 boundary manifest/checker now requires exactly five ordered test-only corrections. The two new immutable records are:

```text
workflow-stage-snapshot-projection.test.ts
baselineBlobId: e7c0659f2b59eea75c2b8fe95a0b75be2380816d
correctedBlobId: a847be0ee6f4481a17d9c88a8fbb315e6abd4e97
reason: derive snapshot fixture phase count from DELIVERY_PROGRESS_STAGES

session-routes.test.ts
baselineBlobId: 8c9c7cb701071d06f222225b1b691cd6fd67b33d
correctedBlobId: 57cdfa88f45d514a4e644c0470ee578d85fe5f23
reason: derive frozen stage fixture phase count from DELIVERY_PROGRESS_STAGES

failureEvidencePath: docs/superpowers/evidence/2026-09-03-stable-workflow-local-verification.md
```

No production source changed. `phaseCount: 9` remains only in the explicitly non-current-contract test fixture.

## Verification

```text
bun test packages/agent-workflow-server/src/__tests__/workflow-stage-snapshot-projection.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
21 pass, 0 fail, 99 expect() calls

bun test scripts/game-ir-isolation-boundary.test.ts
28 pass, 0 fail, 40 expect() calls

bun scripts/game-ir-isolation-boundary.ts
game-ir isolation boundary: PASS

bun run typecheck
tsc --noEmit: PASS

git diff --check
PASS

bun test packages/agent-workflow-server/src/__tests__
355 pass, 0 fail, 1265 expect() calls
Ran 355 tests across 42 files.
```

`rg` confirms there are no remaining `phaseCount: 10` literals under `src` or `tests`; no Chrome/model call was made.
