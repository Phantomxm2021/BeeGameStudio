# Continuous Bounded Document Turn Chrome Acceptance

## Scope

- Date: 2026-08-13 (Asia/Shanghai)
- Browser: user Chrome, Web React application
- Fixed ports: frontend `62173`, runtime `62174`, billing `62175`, skills `62176`, resources `62177`
- Acceptance boundary: generate a fresh non-tower-defense GDD, measure its committed cost and quality, then stop the workflow
- Runtime boundary: only BGS files changed; the native runtime core was not modified

## Fresh project

- Project: `Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/salt-marsh-restoration-campaign--32294df18414`
- Input: a single-player, top-down coastal salt-marsh restoration and community-management game for Web/React
- Selected direction: `潮汐季汛修复战役模式`
- GDD: `docs/GDD.md`
- GDD dispatch: `6808bbb1-7c96-4689-9af9-a1240e2986cd`
- Native request: `b249f715-0c61-4a1e-a013-d0c5080ede7c`
- Receipt: `.beegame/workflow/document-commits/6808bbb1-7c96-4689-9af9-a1240e2986cd.json`
- Final SHA-256: `7dc96113acd10f6269f82edff47e467b281d926e6c9ce367117dbdd0e48d70c0`
- Final size: 59,880 UTF-8 bytes, 813 lines including BGS front matter

## Execution evidence

- Exactly one native `turn_started` event covered the entire GDD.
- The turn used one `Write` and 16 `Edit` tool calls. The canonical successful sequence is one preamble `Write`, 12 section `Edit` calls, and three production-material `Edit` calls.
- One extra `Edit` was rejected before mutation because the proposed `Scope, Dependencies and Open Decisions` replacement exceeded the measured 4,800-byte safety limit. The same durable cursor was shortened and accepted; no completed prefix was rewritten.
- All successful file operations used the same session ID and request ID. No per-section native turn or intermediate group-terminal round was created.
- The file was visibly durable during execution: 5,744 bytes at cursor `1:0`, 9,933 bytes at `2:0`, 27,133 bytes at `6:0`, 52,029 bytes at `12:0`, then the completed 59,803-byte authored body before front matter.
- The terminal outcome was `success`, with 1,508 stdout chunks and 2,323,507 stdout bytes. Maximum observed stdout chunk gap was 44,618ms and terminal silence was 2ms.
- GDD authoring duration was 628,012ms: **10m 28.012s**.

## Token comparison

| Category | Previous bounded-group run | Continuous-turn run | Change |
| --- | ---: | ---: | ---: |
| Fresh input | 98,783 | 82,522 | -16,261 (-16.5%) |
| Cache read | 1,520,013 | 968,222 | -551,791 (-36.3%) |
| Completion | 41,873 | 32,131 | -9,742 (-23.3%) |
| Total | 1,660,669 | 1,082,875 | **-577,794 (-34.8%)** |
| Wall time | 15m 24.242s | 10m 28.012s | **-4m 56.230s (-32.1%)** |
| Markdown bytes | 61,554 | 59,880 | -1,674 (-2.7%) |

The reduction did not come from replacing the GDD with a smaller skeleton. The
new document is within 2.7% of the earlier byte size and retains the full
contract. It came from removing 12 per-group summary/end-turn model calls, two
diagnostic calls, and the false-stop recovery turn. The new run has 18 model
stops total: 17 tool-use stops and one final end-turn stop.

The rejected oversized section consumed 68,298 tokens. Without that rejected
proposal, the measured run would have been approximately 1,014,577 tokens.
This is the largest directly recoverable residual in this instance, but it is
not safe to recover it by weakening the byte gate or merging chapters.

Current token composition remains dominated by native context reads:

- cache read: 968,222 tokens (89.4%)
- fresh input: 82,522 tokens (7.6%)
- completion: 32,131 tokens (3.0%)

The remaining cost is principally the native fixed context and the growing
same-turn history read around each of the 16 required safe file checkpoints.
Reducing that materially would require fewer/larger mutations or native-runtime
context changes. The former reintroduces the oversized-write failure and the
latter is outside the BGS boundary, so neither is part of this change.

## Mechanical document validation

- Canonical GDD validator passed after stripping the deterministic BGS front matter.
- Draft inspection reports `complete: true`, `completedGroupCount: 13`, and no remaining cursor.
- Canonical section markers: 12/12.
- Production material markers: 3/3.
- Production materials include one dense table and two Mermaid diagrams.
- Receipt status: `committed`; receipt digest equals the on-disk SHA-256.
- Mechanical audit sidecar reports `canonicalStructure`, `productionMaterials`, and `repeatedContent` as `passed`.
- Placeholder/cursor scan found no unfinished authored placeholder or draft cursor.
- Exact substantive-paragraph scan: 56 blocks, zero duplicate blocks.

## Document quality audit

The GDD is suitable as the gameplay/product authority for a human team and for
downstream implementation agents:

- Product authority is explicit: audience, promise, differentiator, content volume, platform constraints, and non-goals.
- Gameplay authority is implementable: three nested loops, player verbs, target rules, controls, six entity families, four state variables, settlement order, state transitions, save/recovery semantics, and invariants.
- Production authority is usable: P0/P1/P2 scope, downstream ownership boundaries, risk register, assumptions, open decisions, analytics intent, accessibility/localization gates, and observable acceptance criteria.
- The 64 authored subheadings and 233 table rows make decisions searchable rather than hiding them in long prose.
- Numerical coefficients and implementation details are delegated to Balance, Technical, Art, and UI documents instead of being duplicated as fake authority in the GDD.
- The production overview and diagrams intentionally summarize owning sections as quick-reference artifacts; no exact duplicated substantive block was detected.

The document still has modest editorial compression space, roughly 8-12%, in
repeated boundary/delegation sentences and some experience-pillar rationale.
That is not a correctness problem and should not be pursued by deleting rules,
acceptance criteria, or production materials. It would save output tokens, but
output is only 3.0% of the current total; editorial shortening is therefore not
the main token optimization lever.

## Stop-boundary deviation

The application immediately dispatched `docs/LEVEL_SCENE_DESIGN.md` after the
GDD receipt. Chrome control timed out repeatedly while trying to click the
visible Stop button. The fixed-port stack was therefore terminated to prevent
continued token use. By then the second document had written 9,111 bytes. This
does not contaminate the GDD dispatch metrics above, but this run does **not**
claim the stricter “stop before the second document writes bytes” condition.
The stop-control failure was in the Chrome control connection; the GDD native
turn had already succeeded and committed.

## Code verification

- Focused foundation/session regression: 55 passed, 0 failed, 354 assertions.
- Plan regression set after Chrome acceptance: 23 passed, 0 failed, 111 assertions.
- `bun run typecheck`: passed (`tsc --noEmit`).
- `git diff --check`: passed before evidence-only changes.

## Verdict

The continuous bounded turn achieves its primary objective: it preserves one
durable, byte-bounded native file mutation per checkpoint while eliminating the
per-group native-turn loop. A complete, production-useful GDD was committed in
one turn with 34.8% fewer tokens and 32.1% less wall time than the prior run.

The implementation is accepted for GDD authoring. The only failed acceptance
condition is test isolation after the GDD: Chrome control did not stop the next
dispatch before it wrote bytes. That operational deviation is documented and
is separate from GDD correctness, durability, token accounting, and quality.
