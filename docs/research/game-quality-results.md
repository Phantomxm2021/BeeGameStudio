# BGS quality capability changes and verification

Implemented the scoped system/Skill work. Real BGS project creation/repair and three-genre validation are **deferred by the user's explicit choice**, not counted as passed. No production runtime code, frontend, Codex CLI, workflow stage, acceptance schema or native Goal mechanism was changed. No new test/game fixture was created in this round.

## Gap → change → established result

| Gap / finding | Actual change | Evidence and limit |
| --- | --- | --- |
| Cross-domain runtime critique is not clearly discoverable | Creative Skill description and conditional routing now name running-game critique; a conditional runtime reference provides competing-cause diagnosis while the existing GDD tradeoff reference remains unchanged | Format/path checks passed. This makes guidance available; actual model selection and better creative decisions are **not verified**. |
| Camera judgments are scattered across disciplines | Art discovery cue plus optional `references/camera-framing.md`, distinguishing framing, geometry, UI, occlusion and input/update causes | Reference resolves; existing engine/Spatial ownership retained. No new camera system or tested camera-quality claim. |
| Audio owner has no direct pointer to integrated capture | Replaced its integration guidance with the existing player-path capture link and explicit Web Audio/private-graph/HTML-media/device-output limits | Existing capture contract checks passed; the existing real video/selected-node audio check also passed. No listening/mix-quality pass is claimed. |
| Playtest repair routing omits Creative and Audio | Replaced the existing owner paragraph; reused its version/observation/correction/retest record | No new schema, role invocation, automatic loop or review phase. Actual BGS repair behavior awaits authorized production tests. |
| Historical author PASS contains admitted visual differences | Audited the unchanged report and current rejection path; **did not reimplement an already-fixed waiver** | Three existing acceptance tests passed, including the historical `nonBlockingReason` shape. This is contract verification, not aesthetic judgment. |
| Feel, psychology/pacing, guidance and accessibility are already covered | Left existing Feel/Systems/Level/Balance/UI/Spatial methods and production prompts unchanged | Their current responsibilities are recorded in the audit. No proof of application follows merely from existing prose. |

See [audit, real call chain and source decisions](game-quality-audit.md), [exact Skill-only changes against this round's starting files](evidence/game-quality/skill-changes.patch), [file hashes/byte deltas](evidence/game-quality/changes.json), and [historical author-report excerpt with provenance](evidence/game-quality/historical-report-excerpt.json). Existing unrelated/uncommitted work was preserved.

## Modified files

All Skill paths below are under `.beegame/skills/bgs-game-skills/`:

- `game-creative-director-expert/SKILL.md`: runtime-critique discovery/routing; +190 bytes.
- `game-creative-director-expert/references/runtime-critique.md`: new optional runtime diagnosis, kept separate from GDD-only tradeoff reading.
- `game-art-director-expert/SKILL.md`: camera-framing discovery and conditional reference; +193 bytes.
- `game-art-director-expert/references/camera-framing.md`: new optional method under the existing owner; 3,947 bytes.
- `game-audio-designer/SKILL.md`: integrated observation/capture pointer and coverage limits; +291 bytes.
- `game-playtest-performance/references/experience-validation.md`: existing repair routing replaced; +306 bytes.

The catalog remains 21 Skills. Creative's existing tradeoff reference is unchanged for compatibility and does not acquire runtime-only reading cost; no new `creative-critique`, Camera or Audio Skill is introduced. `docs/research/game-quality-{audit,results}.md` and the evidence directory are this investigation's records, not mandatory game documents. Third-party raw material remains in the investigating workspace's `backups/game-quality-research-20261031`; no third-party scripts/code were installed or executed.

## Existing checks actually run

```bash
bun test packages/agent-workflow-server/src/beegame/runtime-acceptance.test.ts -t 'delivery rejects declared visual differences|host-required visual delivery|visual comparison statuses'
bun test packages/agent-workflow-server/src/bgs/skills.test.ts packages/agent-workflow-server/src/beegame/skill-play-capture.test.ts packages/agent-workflow-server/src/beegame/preview-test-recording.test.ts
BGS_PLAY_CAPTURE_BROWSER=1 bun test packages/agent-workflow-server/src/beegame/skill-play-capture.test.ts -t 'actual Preview path retains video'
bun run --cwd packages/agent-workflow-server typecheck
python3 /Users/nswell/.codex/skills/.system/skill-creator/scripts/quick_validate.py <modified-skill-directory>
git diff --check
```

- Acceptance: 3 passed / 28 assertions; 29 unrelated tests filtered out.
- Existing Skill-root/capture/observation contracts: 3 passed / 24 assertions. Initially two media tests skipped; the existing Preview video/selected-node audio test was then explicitly enabled and passed / 26 assertions in about 6.9 seconds. The separate source-driven 2D media scenario remains unrun. That technical fixture is not a three-genre production test.
- Backend type check passed. Three modified Skill entrypoints passed the existing format validator; referenced local paths exist; whitespace check passed.

No new regression code was added merely to assert wording. These checks establish compatibility and existing contract behavior. They do not execute a model applying the new methods or establish game appeal. Full test facts and limits: [checks.json](evidence/game-quality/checks.json).

## Three requested real-game validation scenarios

| Scenario | Existing evidence / availability | This round's disposition |
| --- | --- | --- |
| Fast arcade/reaction: apple-catch-audited | Prior read-only actual-build Title/HUD/defeat/retry [observations](evidence/ui-motion/2026-10-31T09-51-43.105Z/existing-game/apple-readonly-2026-10-31T10-02-55.552Z/results.json). Historical declared acceptance admits visual differences. | Reuse as diagnosis evidence only. No BGS repair or after observation this round; **pending authorization**. Its headless target-switch pause was not reached; not a game-failure verdict. |
| Exploration/puzzle/platform | No additional generated runnable project found in the inspected local project inventory. Earlier playable fixtures are authored demonstrations. | No fixture is relabeled as BGS validation. Real project and before/repair/after evidence **not run / deferred**. |
| Building/simulation/XR tabletop | No suitable generated runnable local project/device observation available in the inventory. | Real project and before/repair/after evidence **not run / deferred**. XR comfort would additionally need the actual target device. |

No per-project source, GDD, asset, report or original evidence was manually repaired by this system investigation. Once separately authorized, normal BGS implementation/repair should select one supported problem per real scenario, preserve before evidence, make its scoped change and reuse the existing focused test/submit path. This is use of the current workflow, not an added pipeline or prefilled answer.

## Integration, cost and remaining gaps

Built-in source resolution defaults to the repository `.beegame/skills/bgs-game-skills`; configured catalog overrides still apply. Native startup/resume registers those roots and lists Skills with forceReload. No backend restart is needed for these source-file changes under that default. Already-loaded prose in an active model's history is not retroactively replaced; actual rereading/application is unverified. Check the configured root and native load facts in future authorized work rather than assuming deployment or adoption.

Catalog count and default role count are unchanged. The three entry files grew by 674 bytes total; substantive references are conditional. Bytes are not model tokens. This round used **0 BGS model calls, 0 paid image calls, 0 real project tasks, 0 restarts and 0 new dependencies**. Contract commands took roughly 0.4 seconds, plus about 6.9 seconds for the existing local media check, excluding type/format checks; end-to-end BGS token/time improvement remains **unmeasured**. Codex research/authoring tokens are not available from these BGS counters. [Measured scope and deltas](evidence/game-quality/cost-and-scope.json).

Not completed: three real-game repair/retest comparisons; autonomous method selection/application; runtime camera improvements; integrated audible mix/cue quality; physical latency, actual device performance, representative player understanding/appeal or XR comfort. Those are not supplied by source links, format checks or passing functional contracts. The system's deterministic validation still cannot independently verify a model's truthful observation or aesthetic judgment; this patch improves available diagnosis, not a guaranteed autonomous taste filter.
