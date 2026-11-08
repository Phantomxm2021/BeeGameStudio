# BGS UI / motion implementation and runtime results

Completed the source audit, minimal existing-Skill enhancement and three local playable prototype checks. **Autonomous BGS production-game quality is not validated by these prototypes.** No new Skill, production phase, review round, frontend mode or dependency was introduced; no generated BGS project was hand-edited, no service restarted and no model/image service called.

## What changed and why

| File | Responsibility / change |
| --- | --- |
| `game-ui-ux-designer/SKILL.md` | Replaced the existing composition bullet with the player's next task, each cue's purpose and repeated operation cost. Conditional link to player-task studies; existing states, user scope, Art and runtime ownership remain. Entry grew 223 bytes. |
| `game-ui-ux-designer/references/player-task-studies.md` | Original method/counterexamples drawn from verified Nintendo material; menu cost, world/screen tradeoff and contextual emotional value. Optional 3,316-byte reference, not a new Skill or game document. |
| `game-ui-ux-designer/references/motion-language.md` | Replaced the observation paragraph: actual inputs, quick return, state/focus, timed frames versus endpoint stills and limits of clock/pleasure claims. Existing motion-state table/curves/reduced-motion method reused. +329 bytes. |
| `game-playtest-performance/references/experience-validation.md` | Replaced capture guidance to accept sufficient existing clips/frame sequences and retain gaps between sparse frames. Reuses existing issue → authorized correction → retest and acceptance fields. +172 bytes. |
| `packages/agent-workflow-server/src/beegame/fixtures/ui-motion.ts` | Playable local UI/motion examples, reusing existing platformer and light-switch puzzle; small PvE rival encounter for dense feedback. Not production art or a generated project. |
| `packages/agent-workflow-server/src/beegame/ui-motion.browser.test.ts` | Existing isolated Chromium/CDP input, passive recording and edit preparation; actual states, focus, geometry, pause/retry, reduced motion, timed PNG sequences and source hashes. No solver/state injection. |
| `docs/research/ui-motion-research-notes.md` / this report | Source/license/status audit, ownership matrix, implementation rationale, actual observations and unverified scope. Research artifacts, not mandatory per-game files. |

All Skill paths above are under `.beegame/skills/bgs-game-skills/`. Art, Game Feel and Technical Art already have the required boundaries and were **not mechanically duplicated or expanded**. See [source verification and audit](ui-motion-research-notes.md).

## Actual runtime observations

Final run: [results.json](evidence/ui-motion/2026-10-31T09-51-43.105Z/results.json). Browser test 1 passed / 137 assertions, approximately 24.4 seconds. Each normal sample uses 1280×800; each reduced-motion sample uses 800×600 desktop. These are test conditions, not new platform minima or UI timing standards.

| Playable mood / decision being tested | Observed route and evidence | Limits |
| --- | --- | --- |
| Little Leap: relaxed platformer, warm shared typography/material; keep the landing path visible | Title → Begin → HUD → Pause/Resume → rapid Escape return → keyboard jump to flag → Result → retry. [Play](evidence/ui-motion/2026-10-31T09-51-43.105Z/platformer-1280x800-play.png), [normal-speed captured frame sequence](evidence/ui-motion/2026-10-31T09-51-43.105Z/platformer-1280x800-motion.html), [playable exact input source](evidence/ui-motion/2026-10-31T09-51-43.105Z/platformer-source.html) | A small authored prototype; not proof of platformer enjoyment, advanced character motion or production art. |
| Quiet Signal: quiet puzzle, low-distraction state change; let the completed board remain visible | Title → HUD → pause/recovery → middle switch → Undo → left/right solve → Result → retry. [Corrected 800×600 result](evidence/ui-motion/2026-10-31T09-51-43.105Z/puzzle-reduced-800x600-result.png), [frame sequence](evidence/ui-motion/2026-10-31T09-51-43.105Z/puzzle-1280x800-motion.html), [playable source](evidence/ui-motion/2026-10-31T09-51-43.105Z/puzzle-source.html) | A three-switch puzzle, not an exploration world or evidence of novice discovery. |
| Redline: rapid PvE rival feedback, stable hull/rival priority and short heading reveal | Title → HUD → pause/recovery → Space fire and confirmed rival hits → Result → retry. [HUD](evidence/ui-motion/2026-10-31T09-51-43.105Z/arena-1280x800-play.png), [frame sequence](evidence/ui-motion/2026-10-31T09-51-43.105Z/arena-1280x800-motion.html), [playable source](evidence/ui-motion/2026-10-31T09-51-43.105Z/arena-source.html) | Single local PvE encounter, not multiplayer, competitive balance or full combat readability validation. |

All three have Title, Play HUD, Pause and Result screenshots at both tested sizes. UI and game actions use ordinary mouse/keyboard events. Pause freezes the inspected simulation state; hidden controls stop participating in layout/input; focus reaches Resume or retry, then returns to play. The tested rapid return ends Playing; reduced-motion runs produce the same outcomes with no heading animation at the observed pause boundary. Header/controls remain outside the world viewport in the tested Play state. No inventory/settings screens were added: these short loops have neither feature. Failure-result variants and broader input/navigation combinations remain outside this run's evidence.

Frame viewer HTML plays original PNGs using observed screencast timestamps; it is not a newly rendered animation, exported movie or accurate display-FPS measurement. Still captures include before/after observation times, not assumed target timings. Headless rAF samples were around 16.7ms median under these conditions; they do not establish GPU FPS, physical latency or performance on user devices. Capturing itself adds overhead.

## Two corrections, with their different evidence status

1. **Controlled transition regression.** The before fixture deliberately scheduled a stale pause-completion write. Reproduce: Begin → Pause/Resume → immediate Escape pause/return → wait beyond that completion. It incorrectly returned to Paused. Existing unique-edit preparation removed the state write; the same input path remained Playing. [Before](evidence/ui-motion/2026-10-31T09-51-43.105Z/platformer-before-1280x800-rapid-return.png), [after](evidence/ui-motion/2026-10-31T09-51-43.105Z/platformer-1280x800-rapid-return.png), [patch/source hashes](evidence/ui-motion/2026-10-31T09-51-43.105Z/repair.json). This validates the local repair/retest method, not autonomous discovery or a BGS production defect.
2. **Actually observed layout defect.** The first full interaction check passed, but screenshot inspection found that the puzzle's 800×600 result card covered the lower part of the third completed tile. Root cause: a half-width stacked card exceeded the quiet region below the board at that viewport. Changed this sample's result to a compact bottom row; preserved the same board/camera/actions, then added the board-vs-result bounds observation. The corrected result starts at y=405.59 while the tile bottom is y=323.32. [Before](evidence/ui-motion/2026-10-31T09-49-26.949Z/puzzle-reduced-800x600-result.png), [after](evidence/ui-motion/2026-10-31T09-51-43.105Z/puzzle-reduced-800x600-result.png), [record](evidence/ui-motion/2026-10-31T09-51-43.105Z/board-visibility-repair.json). This is a prototype layout error, not grounds for another global BGS rule; the existing actual-composition method is sufficient.

The first attempted run also exposed a **driver** error: it asserted a UI property immediately after the game-state change, before the next UI frame. Waiting for the observed UI commit fixed the driver; no production state logic was patched. [Failed run](evidence/ui-motion/2026-10-31T09-48-07.977Z/results.json) retained. The later [interaction-passed but visually defective run](evidence/ui-motion/2026-10-31T09-49-26.949Z/results.json) is retained rather than relabeled as visual approval.

## Existing BGS game: read-only baseline

Also ran the actual existing `apple-catch-audited` dist build, rather than substituting a prototype for it. The isolated browser loaded its delivered assets without rebuild, normal mouse start, left-arrow movement, natural three-miss defeat and mouse retry. Screenshots confirm Title → Play HUD → defeat Result → reset HUD; result focus was “再玩一次” and retry restored both counters to zero. Build-file hashes remained identical. This is an observation of an existing build, **not evidence that the revised Skills were used or improved it**.

[Title](evidence/ui-motion/2026-10-31T09-51-43.105Z/existing-game/apple-readonly-2026-10-31T10-02-55.552Z/title.png), [HUD](evidence/ui-motion/2026-10-31T09-51-43.105Z/existing-game/apple-readonly-2026-10-31T10-02-55.552Z/play.png), [defeat result](evidence/ui-motion/2026-10-31T09-51-43.105Z/existing-game/apple-readonly-2026-10-31T10-02-55.552Z/result.png), [retried HUD](evidence/ui-motion/2026-10-31T09-51-43.105Z/existing-game/apple-readonly-2026-10-31T10-02-55.552Z/retried.png), [actual recorded frame sequence](evidence/ui-motion/2026-10-31T09-51-43.105Z/existing-game/motion.html), [raw record and unchanged build hashes](evidence/ui-motion/2026-10-31T09-51-43.105Z/existing-game/apple-readonly-2026-10-31T10-02-55.552Z/results.json).

The expected focus-loss pause was not reached by activating another headless target. Diagnostic observation showed the game document stayed `visibility=visible` and `hasFocus=true` while the other target was active. Its source pauses on blur/hidden; this driver action did not produce the required conditions. Pause remains **unverified on this actual build**, not a proved game defect or a pass. The first timed-out attempt is retained; no synthetic blur, state injection or controller call was substituted. A short separate read-only observation completed the other reachable states. One local script quoting error was corrected before that second browser launch; it did not run the game or call BGS.

Compared the [selected concept](evidence/ui-motion/2026-10-31T09-51-43.105Z/existing-game/selected-concept.png) with the actual title: the reference basket is above the primary button, while the build puts it below; the title lettering also differs visibly. These are observed composition/type differences. Whether they were authorized adaptations was not audited here, and no acceptance verdict is inferred. The existing UI/Art comparison method already owns this question; no additional global rule or reviewer was added. Production visual repair, if wanted, must use normal authorized BGS work, not a manual edit by this system investigation.

## Checks and integration

```bash
BEEGAME_TEST_REAL_BROWSER=1 bun test packages/agent-workflow-server/src/beegame/ui-motion.browser.test.ts
bun test packages/agent-workflow-server/src/beegame/skill-play-capture.test.ts packages/agent-workflow-server/src/beegame/preview-test-recording.test.ts
bun run --cwd packages/agent-workflow-server typecheck
python3 /Users/nswell/.codex/skills/.system/skill-creator/scripts/quick_validate.py .beegame/skills/bgs-game-skills/game-ui-ux-designer
git diff --check
```

New real-browser check passed; existing capture checks 2 passed / 2 explicitly skipped; type check, Skill format and relative-link checks passed. The skipped full Preview video/audio tests are **not** counted as verified. Native PNG motion capture ran in this task; no ffmpeg, third-party dependency install or production media change.

Agent continues selecting the existing UI Skill for HUD/menu/focus/interface motion. Read player-task studies only for an unresolved salience/menu-cost decision, and the existing motion reference for actual transition work. Gameplay contact/physics/camera belongs to Feel/Technical Art/programming as before. Requested playtest work uses the existing Preview/capture and evidence fields; narrow repairs do not require replaying all screens or loading all references. The existing source/design authority and delivery mechanism remain unchanged.

The unchanged catalog has 21 entries. Normal UI entry delta is 223 bytes, not a measured model-token increment; larger references load only when applicable. This task's browser runs invoked no BGS model/image calls, so their model usage is zero. Codex research/authoring tokens are not attributable with the available BGS counters; no end-to-end token/time saving is claimed. The three local-prototype browser attempts total about 56.2 seconds, including the failed driver run and visual repair/retest; final-run time is not total research/implementation time. Prototype PNG evidence across attempts is about 49 MB. Existing-game inspection time/bytes are recorded separately in the linked cost record; the first pause attempt timed out and is not counted as a pass. [Measured scope/cost](evidence/ui-motion/2026-10-31T09-51-43.105Z/cost-and-scope.json).

## Not completed / not established

- Real BGS Agent selection/application and improvement in a production game's visual judgment: not run. The local prototypes demonstrate executable examples and observation/repair, not reliable autonomous taste. No generated game was manually corrected as substitute evidence.
- Representative player understanding, pleasure, emotion and perceived flow: no participants; not established by scripted reachability or this assistant's screenshots.
- Audio/haptic synchronization, gamepad/touch/XR, other engines, physical latency, device/GPU performance, many viewport ranges and prototype failure-result variants: not validated. The actual existing-game defeat variant was observed, while its focus-loss pause was not. Prototypes contain no audio; no synthetic tone substitutes for it.
- Sakurai spoken video content/transcripts: not obtained. Official author/title and original chapter metadata are verified; detailed teaching is not invented from titles. Nintendo Wire remains secondary; original CEDEC material unavailable.
- Wholesale reuse rights for OpenAI candidate and sprite Skill/code: not established by inspected files; none copied or installed. Recent pushes do not establish that every third-party animation is production-ready.

These limitations are acceptance gaps, not reasons to create more review agents, documents or automatic model retries. Future authorized production work should inspect one relevant actual game passage and whether the method changed its implementation decision, while reusing unaffected evidence.
