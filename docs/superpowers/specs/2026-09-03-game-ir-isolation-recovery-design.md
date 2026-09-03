# Game IR Isolation Recovery Design

**Status:** Approved in conversation on 2026-09-03; implementation is gated on
written-spec review.

## Purpose

Restore the already stable Foundation document-authoring, Foundation Reviewer,
Foundation Revision, and Checklist workflow exactly from its last verified
pre-Game-IR baseline. Only after that workflow passes a new end-to-end Chrome
acceptance may the existing Game IR work be salvaged into a completely
independent downstream compiler.

The design prevents a Game IR change, failure, pause, deletion, or replacement
from changing any Stage 2–4 or Checklist code, behavior, state, artifact, UI, or
recovery path.

## Current evidence

- Source branch: `codex/game-ir-packet-once-evaluation`.
- Source commit: `4335363b2cd33d1f0b7bd807bff95d9389c67ce1`.
- Recovery branch: `codex/game-ir-isolation-recovery`.
- Candidate stable code baseline:
  `d821e286ebf7eb3ad1b4725ae60dac7a9fef95b6`.
- The next commit, `109e7195d314bb716922ef2dd2de65567e428d64`,
  is the first Game IR boundary-test commit. The first Game IR production
  source commit is `f4a7d16f7bde3bb8a978f1a10350ad2cef84aa8f`.
- Relative to the candidate baseline, the source commit changes 55 runtime or
  test files outside `delivery-workflow/game-ir/` and adds or changes 86 files
  inside it. It also changes 15 Game IR documents and mistakenly tracks 15 SDD
  scratch reports under `.superpowers/sdd/`.
- The source range contains 293 commits and changes 171 files in total.
- Real acceptance demonstrated that a Technical document with the misspelled
  required H2 `Online, Networking and Service Applibility` is now rejected by
  a Stage 2 Markdown transport rule added during Game IR work. The stable code
  did not have that `unreachable H2 -> foundation_transport_needs_action`
  behavior.
- Large model **output** JSON is the known provider failure surface. JSON input
  is not prohibited merely because it is JSON.

The candidate baseline is not final authority until its branch ancestry and a
new complete Chrome acceptance are verified. Repository history contains
Stage 2 and Reviewer Chrome evidence but no baseline-bound report covering
Revision to zero open issues and Checklist. That absence is recorded rather
than invented. Exact Git lineage plus the user-approved
`codex/checklist-implementation` branch permits provisional mechanical
restoration; Milestone 1 acceptance, not historical inference, grants final
stable-baseline authority.

## Non-negotiable scope

This effort has two serial milestones:

1. **Stable workflow restoration and acceptance.** Restore the protected
   workflow and prove it without any active Game IR integration.
2. **Standalone Game IR salvage and acceptance.** Salvage only the independent
   Game IR core, replace its unstable model-output boundary, and prove that it
   cannot affect the protected workflow.

Milestone 2 cannot begin until Milestone 1 has a committed restoration receipt
and a successful real Chrome acceptance report.

Task 9–15 consumer cutover, global workflow integration, automatic Game IR UI,
and downstream consumer migration are excluded. They require a later design
and explicit approval after standalone Game IR acceptance.

## Authority and branch strategy

The current Game IR branch is immutable source evidence. It is not an
implementation workspace and cannot be merged as the recovery result.

The recovery worktree starts at the current source commit so its history and
Game IR files remain available. Stable workflow files are restored
mechanically from the verified stable commit. Existing mixed commits are not
cherry-picked, replayed, or hand-edited into shape.

Three authorities are distinct:

- **Stable workflow authority:** exact Git blobs from the verified baseline.
- **Game IR salvage source:** files under the current Game IR history, treated
  as candidates rather than trusted production code.
- **Recovery branch authority:** only reviewed, independently testable commits
  that pass the protected-boundary gate.

No implementation may revise an authority document to make an out-of-scope
code change appear compliant.

## Milestone 1: stable workflow restoration

### Baseline admission

The baseline-admission record must bind:

- exact stable commit SHA;
- source branch and commit SHA;
- ancestry proof showing the stable commit directly precedes the first Game IR
  boundary-test commit and precedes the first Game IR production-source
  commit;
- every available historical Chrome project/run record for Foundation
  drafting and Foundation Review, plus an explicit negative finding that no
  baseline-bound Revision-to-zero-and-Checklist receipt exists;
- the exact protected file manifest and each baseline Git blob ID.

`d821e286...` may be used only as the provisional restoration source. It
becomes the admitted stable baseline only after the new local and Chrome gates
in this milestone pass. If they fail, the failure is captured and classified
without patching protected code; selecting a different baseline requires a new
written audit and user approval.

### Protected behavior

The protected system includes:

- Stage 2 document contracts, author prompts, raw-Markdown transport,
  candidate admission, receipts, batching, retry, resume, and display;
- Stage 3 facts, semantic review, audit tasks, Issue Registry, admission,
  recovery, and display;
- Stage 4 revision packets, prompts, tools, patch authority, changed-section
  rules, targeted recheck, publication, recovery, and display;
- Checklist projection, authoring, admission, publication, display, and its
  transition to the pre-existing downstream phase;
- shared controller, dispatch, transition, run schema/types, run store,
  recovery, session manager, native runtime, model runtime, observability,
  worker contracts/prompts, and stage-card projection insofar as they serve
  the protected workflow.

Every runtime or test file changed after the verified baseline and outside
`packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/` is
restored to its baseline Git blob. Milestone 1 has no audit-based retention
exception. Game IR-only documents under `docs/` remain read-only salvage
evidence and cannot justify a runtime retention. Tracked post-baseline files
under `.superpowers/sdd/` are removed because they are disposable execution
scratch, not product evidence. The only new Milestone 1 files allowed outside
the Game IR source directory are this design, its implementation plan, the
versioned boundary checker, its immutable manifest, and the final restoration
receipt; every such path is named explicitly in the manifest.

### Game IR disconnection

During Milestone 1, Game IR source files may remain in the worktree only as
unreachable salvage candidates. The protected runtime must contain no Game IR
phase, state, dispatch, worker, prompt, retry, recovery, UI card, compatibility
reader, feature flag, or fallback.

The protected modules must not import Game IR. No registration or side effect
may cause Game IR code to load during the protected workflow.

### Mechanical restoration gate

The repository must provide one versioned boundary checker. Given the admitted
stable commit and protected manifest, it fails unless:

- every protected path has the exact baseline blob ID;
- no protected source imports a Game IR source path;
- no runtime registry contains a Game IR worker, phase, state, or transition;
- no non-Game-IR test changes a protected expected result to accommodate Game
  IR;
- no obsolete alias, compatibility reader, fallback, or feature flag remains.

The checker itself cannot redefine the baseline or silently omit a protected
path. Its manifest is generated once from Git evidence, reviewed, and then
treated as immutable Milestone 1 input.

### Local acceptance

Before Chrome, the recovery branch must pass:

1. typecheck;
2. Stage 2 focused and integration tests;
3. Stage 3 focused and integration tests;
4. Stage 4 focused and integration tests;
5. Checklist focused and integration tests;
6. controller, dispatch, transition, schema, recovery, session, and native
   transport regression tests;
7. the mechanical protected-boundary checker;
8. `git diff --check`.

The full test commands and exact expected pass counts are captured in the
implementation plan after baseline admission; they cannot be invented before
the stable checkout is inspected.

### Real Chrome acceptance

One new project is run from zero through:

```text
Idea -> Confirmed Brief -> Eight Foundation Documents
     -> Stage 3 Reviewer -> Stage 4 Revision until zero open issues
     -> Checklist
```

Acceptance requires:

- all eight canonical raw-Markdown documents commit successfully;
- Reviewer and Revision appear as distinct Stage 3 and Stage 4 UI stages;
- every published business issue enters the automatic revision loop;
- revision continues until no open issue remains;
- document revision/version metadata changes correctly;
- Checklist is produced through its single existing authority path;
- no Game IR task, state, log, artifact, UI, or write occurs;
- task usage, duration, and failure reason remain observable.

Actual Token usage and elapsed time are recorded for comparison. They are not
business pass/fail limits.

Milestone 1 ends with a committed restoration receipt containing the baseline
identity, protected manifest digest, local test evidence, Chrome run ID,
document digests, final workflow state, usage, and elapsed time.

## Milestone 2: standalone Game IR salvage

### Salvage classification

Every current Game IR production file and test is classified before migration:

- `KEEP`: deterministic schema, identity, admission, assembly, publication, or
  test behavior that is independent of protected code;
- `REWRITE`: behavior needed by Game IR but bound to shared workflow or an
  unstable model-output protocol;
- `DELETE`: global workflow hooks, protected-stage dependencies,
  compatibility/fallback routes, or obsolete output protocols;
- `REFERENCE_ONLY`: evidence useful for reasoning but not eligible for the
  production runtime.

There is no `KEEP_FOR_COMPATIBILITY` classification.

### Package boundary

The recovered Game IR is a separate package:

```text
packages/beegame-game-ir/
  src/input/
  src/compiler/
  src/domains/
  src/protocol/
  src/admission/
  src/publication/
  src/cli/
  tests/
```

It cannot import `agent-workflow-server/src/beegame/delivery-workflow` or any
Stage 2–4/Checklist implementation. It may use standard library and generic
repository dependencies that do not carry Bee Game workflow semantics.

Its sole input is an externally supplied Foundation READY bundle:

```ts
type FoundationReadyBundle = Readonly<{
  readyReceipt: unknown
  documents: ReadonlyMap<string, Uint8Array>
}>
```

Game IR owns validation of this untrusted boundary. It does not require the
protected system to export a new internal type.

Its sole durable output is a Game IR publication and receipt under:

```text
.beegame/game-ir/**
```

The package has no write permission to canonical Foundation documents,
Foundation workflow state, audit/revision artifacts, Checklist, or DeliveryRun.

### Model boundary and output format

JSON input is permitted when it is the simplest immutable request envelope.
The model must never be asked to emit one complete domain or complete Game IR
JSON value.

The model emits an append-only, line-oriented Game IR record protocol. A
representative shape is:

```text
@record gameplay.action action.move
@source docs/GDD.md#player_actions
@field actor player
@field target reachable-cell
@requires state.playing
@end
@done gameplay
```

The final grammar is deliberately smaller than the canonical Game IR schema.
It must provide deterministic escaping for multiline values and reserved
markers without adopting YAML implicit typing or Markdown heuristics.

Rules:

- each closed record is parsed, validated, and journaled independently;
- an incomplete trailing record is never admitted;
- recovery starts from the first uncovered semantic obligation, not from a
  provider session;
- the service deterministically assembles canonical JSON from admitted typed
  records;
- the model never emits canonical publication JSON;
- there is one parser and one writer, with no JSONL, StructuredOutput,
  Markdown, or YAML fallback;
- completion comes from obligation closure plus a valid `@done`, not a fixed
  Token, byte, time, attempt, node, or record cap;
- identical authority, admitted prefix, invalid bytes, and diagnostic is
  explicit proven no progress and fails inside Game IR only.

### Independent execution

Game IR is started through its own CLI/service entry point after a caller
supplies a Foundation READY bundle. Milestone 2 does not register that entry
point with the existing workflow controller or UI.

The Game IR process owns its model calls, record transport, journal, recovery,
diagnostics, and publication. A Game IR crash or cancellation cannot mutate or
change the status of the protected workflow.

### Game IR acceptance

Local tests must prove:

- all six canonical domains are non-empty and schema-valid;
- every semantic record is source-bound to the admitted Foundation bundle;
- all IDs and references have one canonical spelling and owner;
- resource realization covers logical assets and their multiple delivery
  variants, including model, effect, scene, UI, and audio requirements;
- the model-output protocol is not JSON, JSONL, YAML, or Markdown;
- interrupted output preserves only complete admitted records;
- stale receipts, changed documents, duplicate IDs, dangling references,
  unknown fields, and conflicting records fail closed inside Game IR;
- publication JSON is generated only by deterministic service code;
- no Game IR execution writes outside `.beegame/game-ir/**`;
- disabling or deleting Game IR leaves the protected build and workflow tests
  unchanged.

One real acceptance consumes the Milestone 1 project without rerunning its
Foundation workflow. It records Game IR artifacts, six-domain coverage,
source-map evidence, Token usage, elapsed time, failure diagnostics, and proof
that protected files and workflow state remain byte-identical.

## Later integration boundary

Global integration is not part of either milestone. After standalone Game IR
acceptance, the preferred later design is an outer launcher that runs the
stable workflow and then invokes the independent Game IR package with the
READY bundle. The protected workflow does not import Game IR.

Any request for an automatic Game IR UI stage or in-controller invocation is a
new architectural change requiring a separate spec, explicit approval, and a
new protected-stage parity review.

## Enforcement and failure consequences

The following are repository gates, not advisory rules:

| Violation | Required consequence |
| --- | --- |
| A protected file differs from its admitted baseline blob | Reject the task and discard its whole task commit. |
| Protected code imports Game IR | Reject the task and discard its whole task commit. |
| Game IR imports protected implementation | Reject the task and discard its whole task commit. |
| An implementation worker changes a path outside its task allowlist | Discard every change from that worker turn; do not salvage selected hunks. |
| A compatibility reader, fallback, alias, dual state, or dual parser is added | Reject the task and delete the alternate route. |
| An authority document is changed to legalize implementation drift | Reject the task and restore the document. |
| An expensive Chrome run starts before all local gates pass | Stop the run; local evidence must be completed first. |
| Chrome exposes a protected-workflow regression | Reject the integration task; do not patch the protected stage. |
| The same architectural hypothesis fails three implementation attempts | Stop implementation and reopen architecture review; no fourth patch. |
| Evidence, tests, or boundary diff is missing | Completion and commit are forbidden. |
| Game IR writes a protected artifact or state | Fail Game IR acceptance and discard that implementation task. |
| Model output reintroduces monolithic JSON or a JSON compatibility path | Fail protocol acceptance and remove that path. |

Only the failing task commit is discarded. Earlier reviewed commits and user
work are not reset or overwritten. Destructive Git commands are not part of
the recovery protocol.

## Commit and review discipline

Each task:

1. declares its exact file allowlist;
2. begins with a failing test or mechanical evidence check;
3. makes one bounded behavior change;
4. runs focused tests;
5. runs the protected-boundary gate;
6. receives a main-agent scope and correctness review;
7. commits independently.

No task may include opportunistic cleanup. A newly discovered defect outside
the allowlist is recorded and left unchanged. Addressing it requires a new,
explicitly approved task with a new allowlist; it cannot be folded into the
current task.

## Cost discipline

- Git inspection, fixture replay, static checks, and local tests precede model
  execution.
- Milestone 1 uses one final real protected-workflow acceptance after local
  gates pass.
- Milestone 2 reuses the accepted Milestone 1 project and performs one final
  standalone Game IR acceptance after local gates pass.
- Failed provider output is not accepted or manually repaired.
- Actual usage and duration are evidence, not arbitrary quality ceilings.

Expected effort is approximately 9–16 hours, with a normal path around 11–12
hours. The estimate is not a runtime admission limit.

## Completion criteria

The effort is complete only when:

1. the protected workflow matches the admitted stable baseline and passes one
   new end-to-end Chrome acceptance without Game IR;
2. standalone Game IR passes local and real acceptance against the accepted
   READY bundle;
3. Game IR has no import, runtime, state, write, retry, UI, or recovery coupling
   with the protected workflow;
4. model output is incremental non-JSON records and canonical JSON is generated
   deterministically by the Game IR service;
5. no compatibility or old execution track remains;
6. all commits carry test, boundary, and audit evidence.
