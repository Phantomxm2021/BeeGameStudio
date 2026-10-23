# Fresh real-model acceptance: robot warehouse

Result: **not passed**. A new project was created through Chrome, without reusing earlier project documents. No automatic retry, budget extension, manual document repair, asset production, implementation or publishing was performed.

- Project: `robot-warehouse-sokoban-acceptance--1bdfa7ac12a1`
- Run: `794a82f5-6c1a-43d2-9bae-551891b6d439`
- Author: `da2df41a-779e-413b-8029-ed4ef8ff33e0`
- Attempt: `cffb6144-ebe5-4e83-9e08-5a99bba183b4`
- Started: 2026-09-12 13:31:32.565 UTC
- Finished: 2026-09-12 13:39:35.181 UTC (8m 02.616s)
- Final state: `needs_action / DOCUMENT_DRAFTING / FOUNDATION_DRAFTING`
- Delivered design documents: **0/8**. Reviewer and Revision did not start.

## Case

One fixed 6×6 Sokoban level, one robot, two crates and two goals. Keyboard and touch direction controls. Only successful walks/pushes consume a move; invalid actions do not. Victory takes precedence when both crates reach goals on move 30. Restart is available; undo, timers, random maps, extra levels, accounts, payments and leaderboards are excluded. The document set must include a consistent coordinate system and a legal solution within 30 moves.

## Observed sequence

1. The Author read the requirements and scoped references, then worked on a map-checking script. A Bash permission error and a command failure were recorded with specific safe error codes. After a script edit, Bash succeeded at 13:35:17 UTC. The preserved checker describes a valid six-move solution.
2. The Author wrote a private decision ledger at 13:36:43 and updated its task list. These auxiliary files correctly did not count as document progress.
3. At 13:37:16, approximately 5m 44s after startup, it launched a GDD writer. A second Agent call at 13:37:18 was rejected with `DELEGATE_DELIVERABLE_CONTRACT_REQUIRED` (missing or out-of-bound assigned file contract).
4. The valid delegate read the GDD reference and requirements and ran Bash. It had no completed document Write/Edit event. Its foreground call became background work after 120 seconds.
5. Eight minutes without changed design documents triggered `Author reached its no-document-progress limit`. The native process closed with requested termination, exit 143, and drained stdout. The project remained paused rather than retrying.

## What this run proves—and does not prove

- Confirmed: file-contract rejection is explicit; diagnostic codes are recorded; budget stop-loss remains active; the stopped background task has a readable `killed` result receipt and a matching standalone `.output` file despite disabled conversation persistence.
- Not established by this run: successful delegated document handoff, recovery of a completed result after eviction, or real-model Reviewer/Revision convergence. Those paths had offline coverage but were not reached here.
- Remaining failure: the Author spent most of its initial no-progress allowance on preparation and verification, then began delegation too late to produce the first document. The invalid second delegation also reduced productive work. The prior infrastructure fixes are insufficient to establish end-to-end real-model acceptance.

The new project and its private working files are preserved for inspection. Continuing requires a new explicit instruction; this test did not modify implementation code.
