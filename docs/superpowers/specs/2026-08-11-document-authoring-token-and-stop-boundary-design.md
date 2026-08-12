# Document Authoring Token and Stop Boundary Design

## Goal

Produce all eight complete game-development documents through the existing Bee Game Studio workflow and Claude Code file-authoring path without oversized tool calls, repeated full-context amplification, hidden background work after Stop, or incomplete usage accounting.

This design does not change the configured model, disable thinking, replace Claude Code authoring with BGS-authored Markdown, introduce an MVP document format, or bind documents to one engine or platform.

## Verified Failure Mechanism

The latest real workflow run established both unsafe extremes:

- A single large native `Write` payload of roughly 70 KB timed out while the tool-call JSON was still streaming.
- The current instruction to use one native file operation per contract section completed a level document, but caused 48 tool calls and 49 model requests. Because every request reused a growing conversation, that dispatch consumed 152,364 input, 5,646,933 cache-read, and 76,040 output tokens.
- The initial level-authoring turn contained 35,748 characters, including 25,410 characters of inline upstream authority. The service also injects a complete old target on replacement or retry.
- Stop marked the workflow stopped while the live worker continued for about fourteen minutes, wrote another document, and consumed tokens that the stopped run rejected from usage accounting.

The root problem is therefore the BGS orchestration boundary: unsafe write-call sizing, excessive model/tool round trips, oversized inline authority, stop dispatch identity, and stopped-tail usage rejection. It is not a model configuration or thinking-mode defect.

## Authoring Boundary

BGS owns only:

- the confirmed brief;
- target document path and document contract;
- required upstream paths and section identifiers;
- permission, filesystem scope, usage accounting, cancellation, and validation;
- service-owned protocol metadata normalization.

Claude Code owns:

- reading the permitted upstream material it needs;
- reasoning and selecting document content;
- writing the complete assigned document to disk;
- performing one final bounded verification.

BGS must not inline complete previous documents or complete projected upstream section bodies into the authoring prompt. It must not compose, summarize, or rewrite game-design content on Claude Code's behalf.

## Native File-Operation Boundary

Later Chrome and native-stream evidence supersedes the earlier BGS-managed write strategy. BGS must not prescribe the native file-operation count, argument size, chunk boundaries, or sequence.

Across 25 completed native Write/Edit calls, argument bytes and the longest stdout-byte gap had a Pearson correlation of 0.981. Calls below 1 KiB averaged a 0.98-second maximum gap; calls above 6 KiB averaged 64.45 seconds and reached 95.47 seconds. The BGS instruction requiring three to eight writes capped at 12 KiB caused the native runtime to prepare large tool JSON arguments whose content was buffered upstream, making the UI appear disconnected even though the process later resumed.

The same run exposed a separate prompt-layer conflict. BGS produced an 858-byte authority projection containing exact source paths, section markers and digests, but another instruction required all authorized upstream sections to be read in one batched round. The native runtime consequently loaded a 21.8 KB target plus 62.3 KB and 72.5 KB upstream files before a four-minute reasoning interval. BGS therefore supplies the compact projection and allowed paths but does not prescribe whether, when, or how much upstream content the native runtime reads.

The corrected boundary is:

- BGS supplies product authority, target path, filesystem scope, permissions, cancellation and completed-file validation;
- the native runtime owns whether it uses Read, search, Write, Edit or another native capability, including the operation count, size, range and order;
- BGS passively records tool identity, byte counts and timing but never terminates, resizes, replays or rewrites a native tool call;
- after the native turn, BGS validates the completed file and reports the actual provider or validation error.

## Prompt and Context Flow

The initial authoring request contains:

1. the confirmed brief;
2. target path, language, discipline, ownership, required section IDs, and required production materials;
3. upstream document paths and allowed section IDs;
4. the single-final-verification rule and the explicit statement that BGS does not control native file operations.

Claude Code reads only the upstream ranges it needs using native tools. A replacement or semantic repair request contains the target path and structured findings, not the old target body. Claude Code may read the affected ranges from disk.

Service protocol errors such as localized service-owned headings or marker whitespace are normalized and revalidated by BGS without redispatching the model. Semantic omissions may trigger one focused repair dispatch containing only structured findings and file authority, never another full-document inline prompt.

## Stop and Usage Semantics

The Stop endpoint resolves the active persisted `dispatchId` and terminates that exact live workflow worker through the shared session manager. It waits for confirmed worker closure before returning a stopped state.

Usage events remain attributable to the matching dispatch after cancellation. Late terminal usage is added to the run's usage total even when the run is stopped, while stale usage from a different dispatch remains rejected. No new workflow phase starts after Stop.

The UI and API expose the underlying API/transport error, dispatch ID, last activity, model-round count, tool-call count, and complete usage instead of reporting a generic hang.

## Abnormal-Usage Guard

The guard observes rather than controls Claude Code reasoning:

- record prompt characters, model rounds, native tool-call input bytes, and token deltas per dispatch;
- observe streamed native tool-input growth and byte-gap timing without interrupting or changing the native call;
- stop a dispatch when cumulative rounds or usage crosses an explicitly configured abnormal ceiling;
- surface the reason and preserve the partial file and complete usage record.

The ceiling is a safety limit, not a document-content target. Document completeness is determined by the contract and quality audit, not by truncating content to fit a token quota.

## Validation and Retry

After Claude Code exits normally:

1. normalize only service-owned protocol metadata;
2. validate exact required sections, production materials, acceptance criteria, ownership boundaries, and nonempty content;
3. accept the file when valid;
4. otherwise emit structured findings for one focused repair;
5. fail visibly after the bounded repair attempt instead of silently starting another full rewrite.

## Verification

Implementation begins with failing tests for:

- prompt projection excludes complete target and upstream bodies;
- authoring instructions reject both whole-document payloads and per-section operation loops;
- BGS does not prescribe, resize or interrupt native write payloads;
- protocol-only normalization avoids model redispatch;
- Stop terminates the exact live dispatch and waits for closure;
- matching stopped-tail usage is persisted while stale-dispatch usage is rejected;
- API/transport failures retain their detailed cause.

After focused and regression tests pass, validation must use Chrome against the fixed local service ports:

1. start a new idea-to-documents workflow through the real UI;
2. confirm eight documents are accepted and physically present on disk;
3. capture per-document prompt size, model rounds, tool calls, native argument sizes, and tokens;
4. perform a separate Stop test and confirm the worker process closes and usage stops growing;
5. audit the produced documents themselves for completeness, discipline ownership, redundancy, human readability, and implementation usefulness;
6. combine runtime evidence, source-code inspection, and document-quality evidence before declaring completion.

## Acceptance Criteria

- All eight complete documents are generated through Claude Code and accepted by the existing workflow.
- No full previous document or full upstream body is injected into the initial prompt.
- BGS does not impose a native write ceiling or operation-count policy.
- A normal document does not degrade into one model round per contract section.
- Stop closes the exact worker before reporting completion.
- Usage includes cancellation-tail tokens and matches dispatch logs.
- Validation errors and provider/API errors are visible and actionable.
- The final decision is based on both Chrome production output and code-level verification.
