# Bounded Native Write Design

## Problem

A complete game document can exceed 30 KB. The native model currently emits the whole document as one JSON `Write.content` value. The API stream may stop after `file_path` but before `content_block_stop`. Core accumulates `input_json_delta` in memory and does not execute the tool until the JSON block is complete, so the failure leaves zero durable bytes and a retry must regenerate the entire document.

The failure reproduces without Bee Game Studio. Bee Game Studio must not choose document chunks or write document content.

## Decision

Extend the existing native `Write` tool rather than introducing a second file-writing track.

- Limit `content` to 16,384 characters in the tool's JSON Schema. This limit must be visible to the model before generation; a late runtime-only check is insufficient.
- Preserve the current overwrite behavior when append fields are absent.
- Add `mode: "append"` with mandatory `expected_bytes`.
- Reject append when the target does not exist, is not a regular file, or its current byte length differs from `expected_bytes`.
- Build the new complete content in memory and pass it through the existing atomic write, history, diagnostics, hooks, permissions and diff pipeline.
- Keep the existing `Write` name so existing allowlists and permission behavior remain authoritative.
- Do not add document-specific branching, extension checks, BGS checkpoints, prompt-authored chunks or retry recovery.

## Native Agent Behavior

For a file larger than the per-call limit, the native agent creates it with a bounded overwrite and continues with a small number of bounded appends. The model owns all content and boundaries. `expected_bytes` provides optimistic concurrency and idempotency protection: a replay against an already-appended file is rejected instead of duplicating content.

## Safety and Compatibility

- Existing `{ file_path, content }` calls remain valid overwrites.
- A write larger than 16,384 characters is rejected by schema before tool execution.
- Append follows the same path permission and PreToolUse/PostToolUse hooks as Write.
- Secret scanning evaluates the resulting complete content.
- Existing-file read-before-write and modification-time guards continue to apply.
- The final document remains incomplete until the normal document validator accepts it.

## Verification

1. Schema rejects oversized content and exposes a JSON Schema `maxLength`.
2. Legacy overwrite behavior remains byte-for-byte unchanged.
3. Three bounded calls reproduce the exact bytes of a larger reference document.
4. Wrong `expected_bytes` rejects without modifying the file.
5. Replaying the same append rejects without duplicating content.
6. Existing FileWrite tests, typecheck and distribution build pass.
7. A real equal-size GDD run completes through Chrome, with tool-call sizes, time and tokens recorded.

