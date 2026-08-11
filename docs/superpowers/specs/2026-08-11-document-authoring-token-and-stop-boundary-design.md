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

## Safe Write Strategy

Neither a whole-document write nor one-operation-per-section is allowed.

Claude Code writes the document as a small number of contiguous, ordered chunks:

- each native write/edit argument remains within a transport-safe byte ceiling;
- the expected normal range is three to eight content writes per document, depending on the complete document's actual size;
- chunk boundaries are transport boundaries, not document or game-design boundaries;
- Claude Code may group adjacent contract sections in one chunk and must not reread the full file after every chunk;
- after the final chunk, Claude Code performs one lightweight structural/file verification and ends the turn.

The exact ceiling will be selected from a focused boundary test below the observed failure size. The implementation must test the ceiling and must not encode a game idea, document text, or project name.

## Prompt and Context Flow

The initial authoring request contains:

1. the confirmed brief;
2. target path, language, discipline, ownership, required section IDs, and required production materials;
3. upstream document paths and allowed section IDs;
4. the bounded-write and single-final-verification rules.

Claude Code reads only the upstream ranges it needs using native tools. A replacement or semantic repair request contains the target path and structured findings, not the old target body. Claude Code may read the affected ranges from disk.

Service protocol errors such as localized service-owned headings or marker whitespace are normalized and revalidated by BGS without redispatching the model. Semantic omissions may trigger one focused repair dispatch containing only structured findings and file authority, never another full-document inline prompt.

## Stop and Usage Semantics

The Stop endpoint resolves the active persisted `dispatchId` and terminates that exact live workflow worker through the shared session manager. It waits for confirmed worker closure before returning a stopped state.

Usage events remain attributable to the matching dispatch after cancellation. Late terminal usage is added to the run's usage total even when the run is stopped, while stale usage from a different dispatch remains rejected. No new workflow phase starts after Stop.

The UI and API expose the underlying API/transport error, dispatch ID, last activity, model-round count, tool-call count, and complete usage instead of reporting a generic hang.

## Abnormal-Usage Guard

The guard observes rather than controls Claude Code reasoning:

- record prompt characters, model rounds, native tool-call input bytes, and token deltas per dispatch;
- observe streamed native tool-input growth and terminate an oversized unfinished tool call with an explicit transport-safety error instead of waiting for a generic timeout;
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
- native write payloads are bounded without splitting by hardcoded headings or keywords;
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
- No native write argument exceeds the tested safe ceiling.
- A normal document does not degrade into one model round per contract section.
- Stop closes the exact worker before reporting completion.
- Usage includes cancellation-tail tokens and matches dispatch logs.
- Validation errors and provider/API errors are visible and actionable.
- The final decision is based on both Chrome production output and code-level verification.
