# V3 Agent Run persistence acceptance — 2026-10-13

Scope: existing Supabase, four newly created synthetic project rows, zero model calls. An existing project supplied owner/workspace metadata only; no game project files or rows were changed. Synthetic rows and their event history are retained.

## Results

- Read-only discovery found the V3 table, event table, and read/commit RPCs. Discovery alone does not establish the installed revision of a same-named RPC.
- First concurrent insert on the synthetic `writer-a` row produced one successful commit and one `revision-conflict` (`PT409`). Concurrent update of `cas`, writer claims across `writer-a`/`writer-b`, native turn claim, pause/measurement reservation, and authorized requirement change each produced one winner. The competing workspace writer received `workspace-busy` (`23505`).
- Reloaded Run/event revisions, paused state, and unknown measurement were preserved. A forged requirement-history rewrite and an ended-turn measurement rewrite were rejected without advancing the saved revision.
- A synthetic Agent Run was seeded with the former empty `plans/tasks/attempts` fields at revision 8. Host read omitted them, and the next host commit persisted revision 9 without them.
- A separate synthetic row was seeded with nonempty retired Task history at revision 2. Attempted conversion to an Agent Run was rejected as `task-mode-retired`; the row remained at revision 2 with its Task data intact.

Synthetic project IDs: `v3-db-cas-01fdecb7-0763-44cb-83bc-c2788868dbed`, `v3-db-writer-a-bbd40e3b-c9a2-41a7-acab-1f5f9d879166`, `v3-db-writer-b-0bff9e6a-6dd0-46d6-94cd-aa2bfc1800e4`, `v3-db-native-bc07909b-94a3-416b-8ba3-6de4792487a1`.

## Incident and limits

The first invocation created these project rows but both initial worker inserts returned unclassified `worker-error`; read-only inspection found no workflow rows. The cause cannot be reconstructed from that output. After adding sanitized error classification, a single insert on `cas` succeeded and the independent concurrent first-insert check on `writer-a` produced the expected one-winner result. The script then resumed the same four rows instead of creating another batch. This is not proof that transient worker startup/network errors cannot recur.

The acceptance is database and host-store evidence only: no real Agent/model execution, game-quality assessment, Preview, or deploy. No model fee was incurred. The test did not modify applied SQL migrations or the formal frontend.

## Formal-entry offline regression

The existing controlled-runner bootstrap test passed: formal project creation passed the confirmed brief to the V3 Agent goal route, and a later ordinary Chat message used the same V3 Run. Frontend adapter/Chat Hook regression passed 97 tests. These checks do not certify the already-running services as updated; this turn did not restart or deploy them, and it did not send a real user/game request.

## Deployed read-only follow-up

The next turn checked 47 remote V3 rows before replacing only the local runtime. The only unresolved writers were the three previously recorded synthetic `v3-edit-fault` / `v3-host-restart` rows; the runtime had no native child process. Those rows were neither cleared nor retried. The V3 runtime restarted from this worktree; frontend, billing, skills, and resources were left running. All five localhost service ports returned HTTP 200 afterward (the frontend response is the Vite page, not a health contract).

With the existing browser login cookie, the independent debug page read `v3-db-native-bc07909b-94a3-416b-8ba3-6de4792487a1` through the running API at revision 9. The response contained `agentTurns` and no `plans/tasks/attempts`, `writerLiveness=none`, and `deliveryEligible=false`. A separate old nonempty-Task fixture returned `409 task-mode-retired`, as intended.

The formal product page opened a previously saved no-model Agent probe, `v3-agent-product-probe-e4892323-3ef5-41ac-bc0b-61543c3aa924`; its Chat shell loaded and its existing measured static Preview rendered the synthetic `V3 Agent Synthetic` heading and `Ready` button in the isolated iframe. The temporary Preview was then stopped. The deployment dialog was viewed but no publish/re-publish action was taken. It showed a pre-existing successful synthetic publication; that historical record is not evidence of a new release or game quality. The new database-only fixture is not a valid formal product workspace: its runtime-state request failed, so it was not used to infer a product defect.

This follow-up verifies deployed read/Preview wiring only. It does not exercise a new formal idea submission, user message, real model, discussion-confirmed publication, or complete game delivery. The original two unclassified worker errors remain unexplained.

## No-idea / no-fee closure

- The independent debug page still described a retired Task event mode. Its copy now states that old Task Runs cannot be executed there; this is wording cleanup, not a new compatibility path. The running page serves the corrected text without a runtime restart.
- The formal bootstrap, debug-authentication, and Agent-vs-retired-Task store tests passed 8/8 under normal local execution. An initial restricted-sandbox run failed only the asynchronous fake-runner observation (7/8); the same test passed in the normal local execution conditions. That restricted result is retained, not silently counted as a pass.
- No-model backend measurement/readiness/publication-confirmation and route-discovery tests passed 35/35; formal frontend Preview and deployment-dialog tests passed 27/27. These include stale-source and failed/unknown-result rejection, but are controlled tests, not proof of a real game's quality.
- A real browser session loaded the saved no-model Agent probe's formal project shell and measured static Preview. The deployment dialog showed its previously published synthetic version and an enabled re-publish control, consistent with the existing policy that explicit user publication of measured bytes is separate from automatic quality acceptance. No new publication was submitted.

Items deliberately not closed by these checks: a new idea's actual Agent execution, eight-domain design/Skills adoption, complete Scene/UI/resource/gameplay quality, true Token savings, unresolved external operations, Unity/Godot operations, and the original unclassified two-worker incident. A real publication-confirmation decision also needs an eligible post-measurement discussion chain and user action; the existing no-model tests validate its contract, not that deployed end-to-end case.

## Existing-project publication-readiness audit (read-only)

The 47 retained V3 workflow rows were screened without reading message text or changing projects. Only two synthetic database fault fixtures had a requirements revision after their latest measurement; both ended in failed turns and neither provided an eligible completed plain-chat discussion chain. The measured product probe `v3-agent-product-probe-e4892323-3ef5-41ac-bc0b-61543c3aa924` had no post-measurement requirement change. In the formal logged-in page, its deployment dialog completed readiness checking and enabled **重新发布**, consistent with an unchanged measured build. Its displayed successful publication is the pre-existing 14:35:17 synthetic record, not a publication from this audit.

No discussion-confirmation UI or actual publication was exercised: no existing eligible discussion-chain candidate was found, and creating one would require a new project turn. The browser tab was closed after inspection. The remaining end-to-end confirmation/publication acceptance therefore stays unverified rather than being inferred from the offline tests or enabled re-publish control.

The formal-entry offline regression now also verifies that a real `agent/messages` submission through the normal Chat API (using a local fake model) settles as an ordinary `message` turn and forms exactly the discussion chain consumed by publication readiness. This closes the previous gap between separately forged publication-test state and the formal message route; it does not demonstrate the deployed confirmation UI or authorize cloud publication. The focused formal-entry test passed 1/1, and the focused publication-confirmation test passed 1/1 under normal local execution. A restricted-sandbox run failed because its temporary HTTP listeners could not start; it is not counted as a product regression.

## Authorized live attempt on the existing product probe

The user authorized one paid ordinary question and possible republication of the already-public product probe. Before sending, the retained Run showed no writer, one settled measurement, and no requirement changes. The formal Chat displayed the submitted question briefly as working, then returned to idle. Browser error diagnostics reported `No saved native conversation/exit evidence; do not restart the original goal`. A read-only database check confirmed the Run remained at version 6 with one turn, no requirement change and no source edit. That probe's synthetic measured turn has no `nativeSessionId`, so it cannot be used to exercise a real native follow-up; the refusal protected the continuity boundary. The message was **not** accepted as a V3 Agent turn, no model invocation or publication is evidenced, and it was not automatically retried.

Two older synthetic source-edit records have saved native-session IDs, completed measurements and transcript files, but they are different projects and have not been authorized for public release. A formal page inspection of one candidate did not progress beyond its initial syncing state; browser diagnostics showed its project runtime-state request failed. Do not treat it as an eligible replacement without a separate readiness check and user choice. The formal Chat's error was visible in browser diagnostics but not in the conversation; this is a presentation gap, not permission to fabricate native history or bypass the server's refusal.

## Authorized new-project publication acceptance — 2026-10-14

The user then authorized one new, explicitly public synthetic project and one ordinary follow-up discussion. Formal idea selection and settings created `project_1791905319724_o4tr51` (`three-tap-acceptance`): click a dot three times to finish, then restart. The real native Agent produced the runnable React project, editable Scene/UI content and eight design records; we did not hand-edit that project. Its final saved measurement `4ac52121-41df-4e38-91b8-391954dd38a0` reported build, runtime-smoke and selected UI-data-consumption checks passed. These checks cover an actual measured build and selected behavior/data observations, **not** general game quality.

The first formal Chat follow-up was rejected before model execution. The native dispatcher appended a requirement snapshot for the default `message` intent, but labeled the commit `agent.turn-claimed`; the installed database RPC requires `requirements.changed` whenever the requirements value changes. The saved Run remained version 10 with one turn and no appended change. The dispatcher now emits `requirements.changed` for both default `message` and explicit `change`; its 39-test Agent-goal suite passed under normal local loopback access. An initial restricted-sandbox test run could not start Bun's loopback test server and is not counted as a product failure. Only the V3 runtime was restarted; other services and project files remained intact.

After the correction, exactly one ordinary follow-up message was accepted and answered without source edits, rebuilds or new measurements. Read-only state showed two settled turns, one append-only requirement change, zero source edits and the same latest measurement. Formal deployment readiness displayed that exact post-measurement message and required explicit confirmation that it did not change the game. The first click of **部署** made no deployment record: `BeeGameLivePreviewPage` discarded the dialog's `discussionConfirmation` argument before forwarding to `DashboardView`, so the backend correctly refused publication. With the user's specific approval, only that parameter forwarding was fixed (no layout change); 29 focused frontend tests and frontend TypeScript checking passed. The first failed publish attempt created no cloud deployment row.

The second formal publish, using the same message and measurement, succeeded as `deploy_0127705490e54ca4a568d61e896a18e6`. Its saved build log identifies measurement `4ac52121-41df-4e38-91b8-391954dd38a0`, the current requirement revision and the one confirmed message request key; it states `quality: unverified` and that no rebuild occurred. The public URL is `https://game.beegame.studio/deployments/deploy_0127705490e54ca4a568d61e896a18e6/files/index.html`. Opening the live page showed 0/3; three actual clicks produced 3/3 and “完成！”, and **重开** returned it to 0/3. This verifies the public synthetic page's basic loop and the publication handoff, not eight-domain or production game quality.

At the end, the project's UI displayed 92.8 Credits, 249,108 input Tokens, 4,688,632 cached-input Tokens and 42,011 output Tokens. Those are displayed aggregate project figures, not a stage-level cost attribution; the displayed 50-minute project duration includes human/tool waiting and should not be treated as model execution time. No extra project, model rerun, or manual game repair was started.

## Offline follow-up on this acceptance — no new model run

The retained native transcript was read without changing the game. Its 74 model requests split into 73 production requests (156,475 uncached input, 4,685,760 cached input, 41,007 output) and one ordinary discussion request (92,633 uncached input, 2,872 cached input, 1,004 output). The production context grew from 26,149 tokens on its first request to 100,847 on its last. The following descriptive groups use transcript event boundaries, not a claim that each group was unnecessary:

| Production activity | Requests | Uncached input | Cached input |
| --- | ---: | ---: | ---: |
| Initial exploration and format discovery | 13 | 68,485 | 388,768 |
| Content/implementation and smoke work | 30 | 43,030 | 1,758,352 |
| Measurement and UI probe correction | 16 | 24,349 | 1,220,480 |
| Observation and design-record writing | 9 | 15,922 | 823,544 |
| Final checks and handoff | 5 | 4,689 | 494,616 |

The transcript shows nine TodoWrite calls and three formal measurements. The first attempted consumption JSON placed `steps` at the consumption root; the host rejected it as an unrecognized key. The Agent then inspected measurement source/schema and retried. `steps` actually belongs inside each `uiProbes` item. This is a tool-interface ambiguity, not evidence that the schema should accept a root-level click path. The generated `measure.mjs --help` now states the correct location and a schema/tool-help regression covers it. A later unverified probe targeted an inactive completion node; narrowing to observable nodes produced a passing selected probe, but that pass does not verify every game state. Design records written after an earlier passing measurement changed the measured source identity and required the final measurement. Existing professional context already says to finish affected records before final measurement; adding another instruction would not prove Agent adherence. No request cap, automatic context reset, automatic replay or relaxation of evidence gates was added. Savings remain unmeasured without a new authorized live run.

The generic measurement inspection previously described a clean, settled post-measurement ordinary message as requiring remeasurement, even though publication supports explicit user confirmation that it did not change the game. Read-only inspection now reports `discussion-confirmation-required` only when the discussion chain is complete and all source, dependency, report, artifact and check inputs remain unchanged. It remains `current:false`; Preview/export are still refused without their normal evidence, and explicit changes or file drift still report `measurement-stale`. The existing publication confirmation remains mandatory. Focused measurement regression: 30 pass; Agent-goal regression: 39 pass.

The first failed publication already produced a toast, but the dialog did not retain its error. It now shows the same failure inline while keeping the publish choice available. Frontend deployment/page regressions: 30 pass; frontend and repository TypeScript checks passed. The formal Chat failure path already adds an error bubble and leaves the unsent composer draft intact during the current page session; the initial live observation of a missing durable error across a reload is narrower than “no error was shown.” No new persistence of rejected user text or error details was added to browser/server storage, and no automatic resend was introduced. Refresh durability of a pre-acceptance Chat failure remains a separate, unverified product gap rather than a claimed fix.

This synthetic project still validates publication plumbing and a minimal play loop only. The saved receipt states `quality: unverified`; selected UI probes and two observed Skill loads do not establish complete eight-domain design or professional game quality.
