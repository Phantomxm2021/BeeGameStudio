# Document Reviewer Efficiency Design

## Purpose

Reduce Foundation Reviewer latency, uncached input, cache reads and report
repetition without weakening document coverage or moving semantic review into
Bee Game Studio.

The current report-based Reviewer remains the only review path. Its revision,
digest, permission, recovery and routing contracts remain unchanged. This
change replaces only the Foundation specialist topology, tightens the
human-readable report responsibility and updates the Dashboard projection.

## Evidence and problem statement

The accepted Chrome run used five specialist sessions followed by one Final
Reviewer. It completed and produced actionable results, but its native
transcripts measured:

| Metric | Measured |
| --- | ---: |
| Uncached input | 692,631 tokens |
| Cache-read input | 3,338,335 tokens |
| Output | 165,193 tokens |
| Total raw tokens | 4,196,159 tokens |
| Provider-reported cost | USD 10.169738 |
| Wall-clock elapsed time | 44 minutes 38 seconds |
| Aggregate native-session time | 81.36 minutes |
| Specialist report bytes | 179,300 bytes |
| Final report bytes | 36,314 bytes |

The five specialists reread overlapping documents and produced five long
reports. The Final Reviewer then spent sixteen turns consolidating them and
rechecking source evidence. A specialist also produced a false blocking
conclusion because its fixed source set excluded `LEVEL_SCENE_DESIGN.md`; the
Final Reviewer later corrected it. These are topology and information-boundary
problems, not provider retry or native-core problems.

## Chosen architecture

Foundation review uses three concurrent domain Reviewers followed by one Final
Reviewer.

| Role | Readable documents | Complete responsibility |
| --- | --- | --- |
| `core-systems` | `GDD.md`, `LEVEL_SCENE_DESIGN.md`, `BALANCE_DESIGN.md`, `TECHNICAL_DESIGN.md` | core loop, rules, strategy, pacing, numeric feasibility, state, determinism and technical representation |
| `player-experience` | `GDD.md`, `LEVEL_SCENE_DESIGN.md`, `ART_DIRECTION.md`, `UI_UX_SPEC.md`, `AUDIO_DESIGN.md` | player flow, comprehension, interaction, accessibility, visual language, feedback and audiovisual consistency |
| `production-delivery` | `TECHNICAL_DESIGN.md`, `ART_DIRECTION.md`, `AUDIO_DESIGN.md`, `ASSET_PLAN.md` | implementation feasibility, performance budgets, asset counts, production scope, provenance, licensing, formats and runtime delivery |

All three roles start concurrently. The existing concurrency cap of three is
unchanged. The Final Reviewer starts only after all three immutable specialist
reports commit.

The largest measured domain source set is approximately 234 KB, below the
361 KB complete Foundation set and below the observed native context limit.
The topology does not return to one Reviewer reading all eight documents.

Checklist and Complete review topology remain unchanged in this change. Their
performance must be measured separately after the Foundation optimization is
accepted; this change does not infer that Foundation results automatically
apply to those scopes.

## Coverage authority

The three role definitions are static product contracts. Bee Game Studio does
not choose roles from keywords, document contents, model output or project
genre. Automated tests prove that every Foundation document and every review
responsibility is owned by at least one role.

Overlap is intentional only where a cross-document contract requires it:

- GDD and LEVEL join rules, pacing and player-flow authority;
- TECHNICAL joins simulation authority to production feasibility;
- ART and AUDIO join experience presentation to production delivery.

No sample game identity, title, mechanic or known defect is encoded into the
role topology or prompts. The existing accepted project is a regression
benchmark, not product logic.

## Specialist report responsibility

Specialists still author Markdown directly through native file tools. A report
contains:

1. reviewed scope and verdict;
2. one blocking-finding table;
3. one non-blocking-finding table;
4. a concise list of load-bearing contracts confirmed correct;
5. only the calculation or proof required to support a finding.

Each finding appears once and contains its owner path, exact evidence location,
defect, downstream impact and required outcome. Reports do not reproduce source
sections, add a second prose summary of the same table, or repeat the complete
finding list in their closing response.

This is a Reviewer authorship requirement, not server-side semantic
compression. Bee Game Studio does not parse findings, rewrite prose,
deduplicate conclusions, impose a semantic item cap or truncate report bytes.
Existing mechanical non-empty UTF-8, path, revision and digest validation is
unchanged.

## Final Reviewer responsibility

The Final Reviewer reads three specialist reports. All eight Foundation
documents remain available as read-only verification sources, but it reads
source material only to resolve specialist disagreement, verify a load-bearing
claim or consolidate a cross-domain finding.

The final report contains one verdict, one deduplicated owner-grouped blocking
register, one non-blocking register, explicit specialist disagreements and one
preservation list. It does not restate each specialist report before presenting
the consolidated result.

`decision.json` remains the only structured Reviewer output and remains limited
to routing identity, verdict, affected canonical paths and final report path.

## Bee Game Studio boundary

This change must not:

- modify native Agent core code, context management, Write or Edit tools;
- add MCP, a Reviewer submission tool or a structured finding packet;
- parse or repair Markdown semantics;
- select a role dynamically from project content;
- add provider retries, watchdog deadlines or automatic semantic retries;
- add a feature flag, legacy topology or alternate review path;
- write source documents from Reviewer sessions;
- infer findings or remediation instructions on the server.

Bee Game Studio continues to own only dispatch identity, fixed read/write
permissions, revision and digest validation, immutable report commitment,
durable recovery, usage persistence and workflow routing.

## Dashboard

The existing workflow card presents the three Foundation domains and Final
Reviewer using product-facing names:

- Core Systems;
- Player Experience;
- Production Delivery;
- Final Consolidation.

For each role it shows status, original failure reason, elapsed time and the
persisted usage composition when available:

- input;
- cache input;
- output.

The card shows one review-level total for the same three token categories and
elapsed wall-clock time. It does not show weighted tokens or mix provider cost
with raw token counts. Missing historical usage is shown as unavailable; it is
never reconstructed from report size or UI totals.

The final persisted Markdown, verdict and affected paths remain the only
semantic result shown to the user. Specialist reports are operational evidence
and are not duplicated inline in the main Dashboard card.

## Failure and recovery behavior

Existing behavior remains authoritative:

- one failed domain returns only that role to pending;
- accepted siblings are reused only when their bytes and source revision still
  match;
- any source-revision change invalidates the entire review;
- Final Reviewer output is invalidated when a specialist report changes;
- provider or transport errors remain visible without automatic semantic retry;
- long native SSE gaps do not trigger a workflow watchdog;
- `NEEDS_REVISION` routes through the existing report-driven remediation path.

Role names from incomplete pre-change review runs are not converted. Such runs
restart Foundation review on their current canonical revision under the single
new topology. Completed historical runs remain immutable.

## Acceptance budgets

The next Web/React Chrome acceptance uses the same fixed service ports and a
fresh isolated review copy. It stops after the final Foundation report before
document remediation consumes additional tokens.

The Foundation review targets are:

| Metric | Acceptance target |
| --- | ---: |
| Uncached input | at most 500,000 tokens |
| Cache-read input | at most 2,500,000 tokens |
| Output | at most 110,000 tokens |
| Total raw tokens | at most 3,100,000 tokens |
| Wall-clock elapsed time | at most 30 minutes |
| Specialist reports | exactly 3 |
| Final reports | exactly 1 |

Report bytes are observed but are not a rejection gate. A valid comprehensive
finding must never be removed merely to satisfy a byte target.

## Quality acceptance

Performance success cannot compensate for weaker review. Acceptance combines
code inspection and the real generated reports and must prove:

1. the eight Foundation documents and all three domain responsibility matrices
   are covered;
2. source hashes remain unchanged;
3. all four reports are committed under the active project revision;
4. the benchmark's load-bearing arithmetic, state, experience, technical and
   production failures remain discoverable without encoding them in code;
5. no same-class false blocker is caused by a domain lacking its required
   upstream authority;
6. the Final Reviewer removes duplicates, records disagreements and preserves
   confirmed-correct contracts;
7. report evidence is understandable and actionable for both production staff
   and downstream agents;
8. Dashboard raw usage matches native transcript totals for the final code;
9. retry and restart preserve committed sibling reports and final report bytes;
10. no legacy Reviewer symbol, hidden fallback or native-core modification is
    introduced.

If token or latency budgets fail, preserve the transcripts and identify the
responsible read/tool/output flow. Do not respond by shrinking document
coverage, adding server semantic processing or changing only prompt wording.

## Side effects and mitigations

Three specialists provide fewer independent viewpoints than five. The explicit
coverage matrix and Final Reviewer mitigate that risk, and acceptance compares
substantive coverage rather than exact wording or issue counts.

Each domain reads more documents than an old specialist. The measured source
sets remain bounded, and the all-eight single-session design remains rejected.

Provider nondeterminism means one run cannot prove a universal percentage
reduction. The budgets are product acceptance thresholds for this topology;
future model endpoints must be remeasured rather than assumed equivalent.
