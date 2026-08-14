# Foundation Markdown Stream Design

## Objective

Replace the eight Foundation documents' initial large-file authoring path with one canonical Markdown response stream. The model authors the document; Bee Game Studio only persists the exact visible Markdown bytes, validates mechanical completeness, and atomically publishes the completed file.

This change targets the observed failure mode where a 40–90 KB document is serialized inside one `Write.content` JSON string, or reconstructed through many `Edit` calls. The former can stall or terminate before the tool JSON closes; the latter multiplies model turns and cached-context reads.

## Scope

The stream applies only to the first complete authoring pass for the eight canonical Foundation documents:

- `docs/GDD.md`
- `docs/TECHNICAL_DESIGN.md`
- `docs/ART_STYLE_GUIDE.md`
- `docs/LEVEL_SCENE_DESIGN.md`
- `docs/BALANCE_DESIGN.md`
- `docs/UI_UX_SPEC.md`
- `docs/ASSET_SPEC.md`
- `docs/AUDIO_DESIGN.md`

Review remains a separate workflow node. A later explicit remediation remains a targeted native editing assignment and is not hidden inside initial authoring. Automatic post-draft calibration is removed; a completed initial document is not regenerated merely because another document committed later.

## Non-goals

- Do not modify the model runtime repository, native `Write`, `Edit`, context management, thinking, provider protocol, or retry behavior.
- Do not introduce BGS-authored checkpoints, sections, summaries, continuations, or content repair.
- Do not preserve the former native-file initial-authoring lane as a fallback.
- Do not silently retry a stopped, truncated, invalid, or disconnected response.
- Do not change review semantics, resource production, implementation, or acceptance stages.

## Single Authoring Lane

For an initial Foundation assignment, Bee Game Studio starts a model turn whose output contract is exactly one Markdown document body. File-mutation and terminal-result tools are not part of this authoring contract. The model receives the confirmed brief, the document contract, and the existing bounded authority projection, then emits only the document body as visible output text.

The service consumes visible text deltas in order and writes their exact UTF-8 bytes to a dispatch-owned pending file under `.beegame/workflow/pending-documents/<runId>/<dispatchId>.md`. It does not inspect semantic paragraphs, choose boundaries, insert text, or rewrite content.

The canonical document is never partially visible. On normal stream termination, the service closes and fsyncs the pending file, validates the complete Markdown with the existing `validateCompleteGameDocumentMarkdown`, computes SHA-256 and byte length, then atomically renames the pending file to the assigned canonical path. It fsyncs the destination directory before recording acceptance.

The resulting JSON receipt contains control data only:

```json
{
  "runId": "...",
  "dispatchId": "...",
  "documentPath": "docs/GDD.md",
  "byteLength": 57336,
  "sha256": "...",
  "status": "committed"
}
```

The document body never appears inside this receipt or any other tool argument.

## Stream Assembly Rules

Only visible assistant text deltas belong to the document. Thinking blocks, tool events, usage events, system messages, and terminal metadata are excluded.

The accumulator is append-only and ordered. It tracks the provider message identity and stream block index so replayed or duplicate deltas fail closed instead of duplicating text. The final complete assistant message is used only to reconcile transport completion; it is not appended again after its deltas.

The stream contract rejects:

- any tool-use block during initial document authoring;
- more than one visible assistant text block when their ordering cannot be proven;
- an empty body;
- a body exceeding a documented safety ceiling;
- an incomplete SSE response or missing normal terminal event;
- invalid UTF-8 assembly;
- Markdown that fails the existing complete-document contract;
- a target path outside the assigned canonical document;
- an existing canonical target that changed after dispatch began.

Markdown fences and explanatory preambles are not stripped heuristically. If the model returns them and the canonical validator rejects the result, the dispatch fails visibly. BGS does not repair the output.

## Failure and Recovery

Every dispatch owns one pending path and one receipt identity. A failed or interrupted stream never advances the workflow and never replaces the canonical document. The pending file and a bounded diagnostic record remain available for inspection, including received byte count, last event time, provider request identity when available, and terminal reason. Prompt bodies and credentials are not copied into diagnostics.

Resume does not append guessed content to a partial Markdown file. The user or workflow may explicitly start a new authoring dispatch; that dispatch receives a new identity and pending file. There is no API retry or automatic `continue` path.

On process recovery, a committed receipt whose file digest matches is accepted idempotently. A pending file without a committed receipt remains failed/incomplete and is never promoted automatically.

## Workflow Boundary

Bee Game Studio owns:

- assignment identity, target path, model selection, confirmed authority input, and document contract;
- byte-for-byte persistence of visible Markdown deltas;
- mechanical validation, digesting, atomic visibility, receipt persistence, and workflow advancement;
- truthful failure and usage reporting.

The model owns every document byte and all creative and professional content decisions. BGS does not select sections beyond the existing document contract, does not write prose, does not decide checkpoints, and does not trigger hidden self-review.

## Token and Time Accounting

Each initial document must complete in one model response and zero model tool turns. Usage is recorded per dispatch as fresh input, cache read, and output. The acceptance report must show:

- all eight per-document values and totals;
- elapsed time per document and wall-clock total;
- received Markdown bytes;
- stream delta count and longest inter-delta silence;
- absence of file tool calls and automatic calibration dispatches.

Target budgets for the complete eight-document initial stage are:

- fresh input no more than 500,000 tokens;
- output no more than 500,000 tokens;
- cache reads no more than 10,000,000 tokens;
- no hidden retries or calibration usage.

These are acceptance limits, not prompts that authorize BGS to shorten or rewrite documents.

## Verification

### Automated tests

- ordered text deltas produce byte-identical Markdown;
- final assistant reconciliation does not duplicate streamed bytes;
- a stream with a tool call fails before canonical publication;
- disconnect, truncation, invalid Markdown, and over-limit output preserve the prior canonical file;
- successful validation fsyncs and atomically publishes before the receipt is accepted;
- committed receipt replay is idempotent and digest-verified;
- document-author prompts require pure Markdown and expose no initial-authoring file tools;
- the former initial native-file authoring path and calibration scheduler are unreachable;
- all non-document workers retain their existing tool and result contracts.

### Controlled Chrome acceptance

Run the existing React workflow through controlled Chrome on the fixed service ports with the user's configured model. Create a new ordinary project without embedding the test idea in product code. Complete all eight documents and verify:

- eight canonical files are present and pass their complete-document contracts;
- no dispatch stalls inside `input_json_delta` for `Write` or `Edit`;
- no initial document dispatch emits a file tool call;
- no automatic calibration runs after a document commits;
- the UI reports real elapsed time, failures, and separated usage categories;
- actual documents are audited for discipline coverage, readability, redundancy, and usefulness to human and Agent implementers.

Code tests and generated-document inspection are both required for acceptance.

