# Foundation convergence — live acceptance

Status: live run stopped on an execution defect; bounded repair verified against the saved candidate, regression testing before continuation. No acceptance verdict yet.

## Authorization and boundary

The user explicitly authorized service restart and a new paid real-model acceptance round on 2026-09-09. Preserve historical projects. This run ends at Foundation authoring, review, revision, and whole-candidate review; do not proceed to Checklist, Game IR, implementation, or publication. Do not manually edit generated documents or source during the live run.

## Preflight and identity

- Fifteen existing persisted workflows were stopped or needs-action; none was running.
- Old runtime PID 4506 was verified against the intended worktree and port 62174. SIGTERM hung in cleanup; the verified idle process was terminated and replaced.
- New runtime PID 14654 listens on 62174, using the repaired worktree. Frontend and other services were retained.
- Chrome UI: http://127.0.0.1:62173/.
- Project: `fixed-route-tower-defense--ba6cac9c5ea1`.
- Project ID: `project_1788956193150_muysxd`.
- Run ID: `7093df19-c417-4a9c-ac85-063dba2d7800`.
- Created: 2026-09-09T12:16:34.704Z.
- Author handle: `328a374b-7636-45db-b623-18f3e4d12d15`.

## Case

Same desktop React 2D tower-defense request: fixed build points, one tower, one polyline route, three waves, kill-only coins, pause/focus freeze/manual resume/restart, geometric visuals and procedural audio, no external assets or persistence/network features. The selected fixed-route proposal said “clear wave three”; the confirmed notes explicitly retain the original requirement that every third-wave enemy must be killed and base HP must remain positive. Building is allowed during combat, without adding a separate preparation phase.

## Verification plan

Observe real persisted policy and obligation receipts; inspect dependency evidence and repair identities; verify any disagreement or durable stop is not presented as PASS. On terminal state, independently inspect available final documents and publication digests, record actual results and usage. Earlier offline tests are not a substitute for this run.

## Observed execution and first blocker

- Author completed all eight documents, recording 181,221 tokens.
- Initial format review blocked noncanonical document references in Level and Art, and missing audio material markers. Automatic Revision round 1 produced a private candidate.
- Candidate full review journal `e292871fdd59897e3a314e0c2f8a3736d8cbea6d85df375d131a9bdbb841beff` uses `complete-obligations.v2`.
- Five fact tasks completed and their usage was settled. At 12:37:31Z the service recorded `execution_failed`; workflow stopped at sequence 2, DOCUMENT_REVIEW, needs_action. No semantic tasks were started and no candidate PASS was published.
- Read-only replay reproduced the precise failure: `SEM.content_asset_feasibility` included normalized `level.required_assets`, but omitted its canonical `LEVEL#content_matrix` provenance section. The strict evidence validator correctly rejected the incomplete service packet.
- Bounded fix: new-policy packets include the service-catalog owners of their declared facts, deduplicated as read-only evidence. The legacy manifest and legacy packet selection remain unchanged; evidence validation is not weakened.
- Added tests for all ten packets' fact owners, exact asset/Level provenance, forged-evidence rejection, and unchanged legacy selection. Focused semantic suite: 20/20 passing; package TypeScript check and diff check passed.
- Replay of the saved real candidate after the fix builds all ten packets and 32 obligations without starting workers or changing any project artifacts.

## Independent initial-document observations

These are provisional checks to compare with eventual automated findings, not a verdict on a future repaired candidate:

- Level bp_03=(300,360) is 60 units from the horizontal path y=420; its diagram says 70 and the global bound says at least 70. Balance repeats the 70–80 range.
- GDD summary links a Balance label to the Technical file.
- UI disagrees about whether clicking empty space cancels selection; Esc cancellation and pause precedence is unclear.
- UI/Technical freeze screen requires resume then pause to access restart, while GDD permits restart in paused state.
- Audio music-state diagram draws a suspended-to-terminal restart edge while its label says the transition does not exist.
