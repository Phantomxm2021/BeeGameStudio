# Native Document Authoring Boundary and Token Budget Design

## Objective

Make the existing idea-to-eight-documents workflow reliable and economical without allowing the Bee Game Studio business layer to control how the native Agent thinks or uses file tools.

The authoring target is a complete, production-usable document set rather than an MVP, outline, or skeleton. The acceptance budget is at most 600,000 raw processed tokens for one complete GDD and at most 4,000,000 raw processed tokens for authoring all eight documents. These numbers are release measurements and alerts; they are not runtime cutoffs and may never justify interrupting a healthy Agent turn.

## Proven Baseline

The latest controlled Chrome GDD run produced a complete 59,880-byte, 813-line document in 10 minutes 28 seconds. It consumed:

- 82,522 fresh-input tokens;
- 968,222 cache-read tokens;
- 32,131 output tokens;
- 1,082,875 raw processed tokens in total.

Cache reads represented 89.4% of the total. The document body was not the main cost. The dominant cost was repeated model evaluation after native file-tool stops while the same-turn history kept growing.

That run used one `Write`, sixteen `Edit` calls, and one final end-turn. Bee Game Studio selected every chapter checkpoint and rejected mutations that did not advance its cursor exactly once. This reduced the risk of a single oversized write but crossed the established business/runtime boundary and mechanically created many model stops.

Two failed approaches are therefore excluded:

1. serializing an entire document into one very large tool argument, which has already produced a tool start without input deltas or completion;
2. having Bee Game Studio prescribe checkpoint count, cursor order, tool choice, or per-call byte limits, which makes the business layer an execution controller.

## Non-Negotiable Boundary

### Bee Game Studio owns

- workflow-node selection;
- the assigned document path and document discipline;
- the confirmed product brief and approved authority projection;
- final document contracts and acceptance criteria;
- project-root authorization derived from user settings;
- observation of native events, file existence, terminal outcome, time, and usage;
- post-turn validation and scheduling of review or remediation.

### The native Agent owns

- reasoning and context management;
- whether and when to read an authorized file;
- whether to use `Write`, `Edit`, or another native project tool;
- how many file mutations to make;
- the size and ordering of those mutations;
- intermediate file layout while the turn remains active;
- normal end-turn behavior.

### Bee Game Studio must not

- construct chapter groups, draft cursors, or a file-operation sequence;
- impose a target or maximum argument size on native file tools;
- reject an otherwise project-authorized mutation because it contains multiple sections or does not match a Bee Game Studio cursor;
- require the first operation to be a partial `Write` or later operations to be `Edit`;
- inject a continuation instruction after every successful file operation;
- ask the Agent to restate completed content or return a custom completion payload;
- interrupt a healthy turn because a token target, tool count, or silence interval was exceeded;
- modify the native runtime core to compensate for a business-layer defect.

Project-path authorization is not editorial control. Bee Game Studio may deny a mutation outside the assigned project or outside the user's configured permission policy. It may not inspect the proposed prose to decide whether that specific native file call is allowed.

## Single Authoring Path

There is one production path for each foundation document:

```text
Bee Game Studio selects the document node
  -> starts one fresh native Agent session for that document
  -> sends one compact assignment and authority projection
  -> native Agent independently authors and saves the document
  -> native Agent ends normally
  -> Bee Game Studio validates the on-disk result
  -> workflow schedules review, remediation, or the next document
```

There is no cursor path, segmented-group path, custom body-commit path, or structured-package authoring path alongside it. Recovery uses the same path: a new native assignment is given the current on-disk document and precise validation findings. Bee Game Studio does not repair or continue the body itself.

The business prompt may state the result requirement that meaningful progress should be saved during long authoring work. It must leave the concrete save strategy to the native Agent. Observed native file mutations are passive durability evidence, not service-owned checkpoints.

## Token Reduction Strategy

### 1. Remove service-created model stops

Delete the checkpoint prompt, cursor protocol, and mutation-authority hook. Bee Game Studio sends no per-section follow-up and creates no hidden continuation turns. One document maps to one native session and one ordinary user assignment.

This removes model stops caused by the business protocol. It does not promise a particular native tool count because that decision remains with the Agent.

### 2. Minimize the initial assignment

The document assignment contains exactly:

- the document identity, discipline, purpose, and target path;
- a compact ordered list of required sections and production artifacts;
- the confirmed brief digest plus only the facts needed by this discipline;
- an index of exact upstream source ranges when upstream authority exists;
- concise ownership, non-duplication, quality, and completion rules;
- a change request only for remediation runs.

It does not contain a serialized checkpoint sequence, repeated descriptions of the same contract, completed document bodies, workflow history, audit history, or instructions already supplied by the native runtime.

### 3. Keep authority projections bounded by relevance

Each downstream document receives stable fact identifiers and the minimum source ranges selected by its declared upstream dependencies. The projection cannot contain copied upstream prose. The native Agent remains free to use its native read tools within project permissions; the projection is a navigation aid, not a read restriction.

Projection measurements are recorded per document:

- projected bytes;
- number of fact identifiers;
- number and total line count of upstream ranges;
- full-document reads observed during the turn.

### 4. Isolate document histories

Each of the eight authoring documents starts a fresh native session. It receives the confirmed authority and relevant upstream projection, not the accumulated chat/tool transcript from previous documents. Review and remediation also run in fresh sessions with the target file path and localized findings.

This preserves authority continuity through files and identifiers rather than through an ever-growing conversation.

### 5. Keep review and remediation localized

Review receives the completed target document, its contract, and only the upstream authorities necessary to evaluate it. Remediation receives stable finding identifiers, exact affected locations, required outcomes, and current authority. It does not receive all eight document bodies unless a finding explicitly spans them.

Token accounting separates initial authoring, review, remediation, retries, and unrelated next-document activity. A successful authoring budget cannot hide retry waste or include tokens from a document dispatched after the acceptance boundary.

## Token Budgets and Interpretation

The raw processed-token ceilings for the first full eight-document acceptance are:

| Document | Authoring ceiling |
| --- | ---: |
| GDD | 600,000 |
| Technical Design | 550,000 |
| Level and Scene Design | 500,000 |
| Balance Design | 500,000 |
| Art Design | 450,000 |
| UI/UX Design | 450,000 |
| Audio Design | 400,000 |
| Asset Plan | 450,000 |
| **Total** | **3,900,000** |

The remaining 100,000 tokens are acceptance headroom, not a ninth task. These ceilings cover initial authoring only. Review, remediation, resource research, implementation, and QA are reported separately so later stages cannot make document-generation efficiency appear better or worse.

Every result reports:

- fresh input;
- cache read;
- cache creation;
- output;
- raw processed total;
- provider-weighted or billed usage when available;
- native model stops;
- tool calls by type;
- failed or denied proposal waste;
- elapsed time;
- final bytes and lines.

Raw processed tokens are the reproducible engineering-volume metric. Cache reads are not presented as equivalent to fresh generation cost, but they remain part of the hard raw ceiling because they measure the repeated-context problem this change is intended to reduce.

## Completion and Failure Semantics

A document is complete only when the native turn ends normally and the assigned file passes the final contract. File existence alone does not advance the workflow while the turn is still active.

If the turn fails or ends with an incomplete document:

1. Bee Game Studio preserves the existing file exactly as written;
2. it records the native terminal reason, last event time, usage, and validation findings;
3. it schedules one normal remediation assignment against that file;
4. it does not synthesize missing prose, inject a cursor, replay the whole original prompt, or retry blindly.

An active thinking stream or native file operation is never interrupted by a Bee Game Studio idle watchdog. Transport loss and process termination are operational errors and must be surfaced with their concrete API/runtime error rather than reported as generic inactivity.

## Implementation Scope

The implementation removes, rather than replaces, service-owned checkpoint machinery from initial foundation-document authoring:

- `foundation-document-draft.ts` cursor groups, cursor parsing, and checkpoint prompt generation;
- `foundation-document-mutation.ts` content-aware native mutation authorization;
- the initial document permission callback that invokes that authorization;
- worker-prompt text requiring bounded checkpoints, exact sequence, or service-selected target inspection;
- tests and receipt fields whose only purpose is the cursor protocol.

It retains or strengthens:

- assigned-project path safety derived from user permissions;
- one-document-per-worker scope;
- native tool inventory and thinking configuration;
- compact authority projection generation;
- final Markdown contract validation;
- normal native terminal handling;
- usage and event observability;
- review and remediation as separate workflow nodes.

No second compatibility path remains. Existing incomplete files containing Bee Game Studio draft cursors are treated as ordinary incomplete Markdown during remediation; the service neither interprets nor advances those cursors.

## Verification

### Boundary regressions

Tests prove that an initial document author:

- receives the native tool inventory unchanged;
- is not given a checkpoint sequence or cursor protocol;
- can issue a project-authorized multi-section `Write` or `Edit` without Bee Game Studio content inspection;
- cannot mutate outside the assigned project permission boundary;
- can finish through a normal end-turn with a valid document;
- is not required to call a custom commit or completion tool;
- is not restarted while native thinking or file activity is alive.

### Prompt and launch diff

For the same GDD assignment, persist the direct-native and Bee Game Studio launch contracts. They may differ only in workflow correlation, the business assignment, approved authority projection, target path, and user-configured environment. Native thinking, tools, permissions within that project, and completion behavior must match.

### Controlled Chrome GDD gate

Run the Web React product through controlled Chrome on the repository-owned fixed service ports: frontend `62173`, runtime `62174`, billing `62175`, skills `62176`, and resources `62177`. Create a fresh ordinary project idea that is not embedded in product code or test fixtures. Generate only the GDD, then pause before the next author writes content.

The gate passes only when:

- the GDD is complete, production-usable, and passes its mechanical contract;
- no service-owned checkpoint, cursor, or custom body commit appears;
- native reasoning, tool choice, and normal completion remain intact;
- no silent retry or next-document token contamination occurs;
- raw authoring usage is at most 600,000 tokens;
- fresh, cache, output, stop, tool, duration, and failure-waste measurements are preserved;
- a human-discipline audit and an implementation-Agent audit both find the document usable.

If the document is correct but exceeds 600,000 tokens, the implementation does not pass. Investigation may reduce duplicate business input or authority projection only. It may not reintroduce service-owned tool choreography or change the native runtime core.

### Eight-document gate

After the GDD gate passes, run a fresh controlled Chrome project through all eight authoring nodes. The workflow pauses before review or resource research is included in the authoring measurement.

The gate passes only when:

- all eight documents exist and pass their individual contracts;
- their combined raw authoring usage is at most 4,000,000 tokens;
- each document stays within its tabled ceiling;
- no document inherits another document's native session transcript;
- the set is usable by a human game-development team and by implementation Agents;
- no skeleton, placeholder, duplicated authority, test-project wording, or hidden service-authored content is present.

## Decision Rules

- Reliability is not purchased by giving Bee Game Studio control over native file operations.
- Token savings are not purchased by reducing required production content.
- A metric regression triggers diagnosis, not an automatic runtime restriction.
- A successful example is necessary but insufficient; code-level boundary evidence and real generated-document quality must agree.
- The implementation is complete only after both controlled Chrome gates pass. Unit tests alone cannot establish success.
