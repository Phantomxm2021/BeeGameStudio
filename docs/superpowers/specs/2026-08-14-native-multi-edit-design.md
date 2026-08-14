# Native MultiEdit Design

## Objective

Add one native, general-purpose `MultiEdit` file tool so the Agent can apply several exact replacements to one already-read file in one atomic tool call. The capability is intended to remove repeated model turns caused by the existing one-replacement `Edit` interface without moving document authorship, chunk selection, or file mutation control into Bee Game Studio.

This is a native file primitive, not a document-specific workflow feature.

## Evidence and Root Cause

The latest controlled Chrome GDD run stopped at the release budget gate:

- 15,779 durable document bytes;
- 92,302 fresh input tokens;
- 173,910 cache-read tokens;
- 11,002 output tokens;
- 277,214 raw processed tokens;
- one scaffold `Write` followed by four single-replacement `Edit` calls, with more placeholders still outstanding.

Each additional native turn reread roughly 34,782 cached context tokens. The model created fifteen independent placeholders even after native guidance requested two or three coherent groups. Prompt-only grouping therefore does not control the call count reliably.

The code already contains most multi-edit mechanics:

- `getPatchForEdits` simulates sequential replacements in memory;
- `normalizeFileEditInput` and edit-equivalence helpers understand edit arrays;
- `FileEditToolDiff` renders multiple edits;
- Bee Game Studio's passive activity and file-mutation observers already recognize the `MultiEdit` name.

The missing piece is a callable native tool with an array input and atomic execution. Adding API retry, BGS checkpoints, prompt-authored chunks, or another write protocol would not address this interface gap.

## Considered Approaches

### 1. Add a native `MultiEdit` tool — selected

Expose a separate file primitive with one path and an ordered array of exact replacements. It reuses the existing edit validation and write pipeline. The Agent chooses whether to call it, which replacements belong together, and what prose each replacement contains.

Benefits:

- preserves the existing `Edit` contract and compatibility;
- reduces repeated turns without making Bee Game Studio an authoring controller;
- supports atomic failure semantics;
- reuses tested multi-edit computation and UI paths.

Cost: one additional native tool schema is present in the model context. This small fixed cost is expected to be far lower than several repeated 34k-token turns and must be verified by Chrome evidence.

### 2. Extend `Edit` to accept either one replacement or an array — rejected

This avoids a new tool name but changes the public schema of an established core tool. Union inputs add provider ambiguity, complicate permissions and observable inputs, and create broader compatibility risk.

### 3. Let Bee Game Studio batch or schedule edits — rejected

This would make the business layer choose checkpoints or transform Agent file operations. It violates the established boundary and repeats the failure pattern that this worktree is intended to remove.

## Boundary

### The native Agent owns

- whether `MultiEdit` is appropriate;
- the number and order of replacements;
- replacement boundaries and all authored content;
- whether to use `Write`, `Edit`, `MultiEdit`, or another native tool;
- normal turn completion.

### Bee Game Studio may

- expose the unchanged native tool inventory to the worker;
- forward tool events;
- display one editing activity and the resulting diff;
- record passive metrics and file-mutation evidence;
- validate the final assigned document through the existing workflow.

### Bee Game Studio must not

- generate edit arrays or document checkpoints;
- split, merge, rewrite, retry, or reorder replacements;
- set a document-specific edit count;
- inject prose into replacement values;
- require `MultiEdit` for document completion;
- treat use of `Edit` or `Write` as a workflow failure.

## Tool Contract

The native tool name is `MultiEdit`.

```ts
type MultiEditInput = {
  file_path: string
  edits: Array<{
    old_string: string
    new_string: string
    replace_all?: boolean
  }>
}
```

Contract requirements:

- `file_path` is an absolute file path;
- `edits` is nonempty;
- edits execute in declared order against the in-memory result of the previous edit;
- `old_string` and `new_string` must differ;
- a non-`replace_all` `old_string` must resolve uniquely at the point it is applied;
- an edit must not target text introduced by an earlier edit in the same call, matching the existing `getPatchForEdits` safety rule;
- the tool remains general-purpose and contains no Markdown, GDD, section, placeholder, or document-size behavior.

The prompt description states only that `MultiEdit` is preferred when several independent exact replacements are already known for the same file. It does not prescribe a call count or checkpoint strategy.

## Atomic Execution

`MultiEdit` follows the native `Edit` pipeline:

1. Expand and normalize the file path.
2. Enforce read-before-edit and modification-time freshness once for the target file.
3. Enforce file permissions, sandbox rules, path denial rules, file-size limits, settings guards, hooks, and secret checks using the same authority as `Edit`.
4. Read the original file once.
5. Simulate every replacement sequentially in memory with `getPatchForEdits`.
6. Validate the resulting complete content before any mutation.
7. Create one history backup and perform one atomic file write.
8. Update read state, diagnostics, hooks, analytics, and the structured diff once.

If any replacement or validation fails, the tool returns an actionable error and writes no bytes. It must never leave a partially edited file.

## Permissions and UI

One permission decision covers one path and shows the combined diff of all replacements. Auto-approval remains governed by the user's project settings; the tool adds no Bee Game Studio permission policy.

The existing multi-edit diff component should be reused. Summary and activity output identify the target path without echoing large replacement bodies into logs.

## History and Token Behavior

`MultiEdit` is classified as a native file mutation alongside `Write` and `Edit` for passive history projection. After a later successful file mutation, older mutation bodies may be compacted by the existing projection logic, while:

- the latest mutation remains available to the model;
- durable raw JSONL evidence remains unchanged;
- the file on disk is the source of truth;
- Bee Game Studio does not synthesize summaries or replacement arrays.

The feature does not promise a fixed token saving. Its release criterion is measured behavior: fewer repeated model turns and a complete valid GDD within the existing 280,000 raw-token gate.

## Compatibility

- Existing `Write` and `Edit` schemas and behavior remain unchanged.
- Existing callers are not migrated automatically.
- The core native tool inventory adds `MultiEdit` wherever general file primitives are allowed.
- Agent/subagent restrictions follow the same policy as `Edit`; no broader file authority is granted.
- Existing BGS observers that already recognize `MultiEdit` remain passive and require no document-specific dispatch.

## Error Handling

The tool fails closed for:

- unread or unexpectedly modified files;
- denied or invalid paths;
- empty edit arrays;
- identical old/new strings;
- missing or ambiguous matches;
- unsafe sequential overlap;
- secret or protected-settings violations;
- hook or permission rejection;
- file-size or write failure.

All pre-write failures leave the original file byte-for-byte unchanged. Post-write hooks may report failure but must use the same established semantics as native `Edit` rather than inventing a BGS recovery path.

## Verification

### Native tests

- JSON schema accepts a nonempty edit array and rejects malformed or empty arrays.
- Two or more independent replacements produce the exact expected file and combined patch.
- Later replacements see earlier in-memory results where allowed.
- a missing, duplicate, identical, or unsafe-overlap edit causes no filesystem mutation;
- read-before-edit, stale-file, permissions, hooks, settings, secret, encoding, line-ending, and size behavior match `Edit`;
- history, analytics, activity, and diff UI handle `MultiEdit` without logging full replacement bodies;
- existing `Write` and `Edit` regression suites remain unchanged and green.

### Boundary tests

- Bee Game Studio forwards and observes `MultiEdit` but never constructs its input;
- document workers retain `Write` and `Edit` and are not required to use `MultiEdit`;
- no prompt contains BGS-authored checkpoint counts or content chunks.

### Chrome release gate

Use a fresh ordinary Web React project on the fixed ports:

- frontend `62173`;
- runtime `62174`;
- billing `62175`;
- skills `62176`;
- resources `62177`.

Stop after the GDD and record raw JSONL usage, native calls, elapsed time, durable file mutations, validator output, and document quality. The GDD must be complete and production-usable at or below 280,000 raw processed tokens. If it fails, stop and analyze evidence; do not continue eight-document generation and do not alter the test idea.

Only after the GDD gate passes may the same Chrome workflow generate and audit all eight documents against the 2.4-million raw-token aggregate budget.

## Non-Goals

- no BGS document writer, batching service, checkpoint scheduler, retry loop, or watchdog;
- no prompt-only workaround for the missing native capability;
- no change to example ideas or generated document content;
- no second document-generation track;
- no reduction in required document completeness or production quality;
- no modification of provider stream handling as part of this feature.

