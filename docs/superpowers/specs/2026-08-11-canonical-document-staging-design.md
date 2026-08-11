# Canonical Document Staging Design

## Problem

BeeGame currently requires a document author to submit an entire production document as one `CommitCanonicalDocument({ body })` tool argument. A real GDD produced outside BeeGame was 94,124 bytes and required twelve native file operations. The same prompt inside BeeGame stalls after `content_block_start` because the provider never streams the oversized JSON argument.

## Design

Document authors retain thinking and receive only the native `Read`, `Write`, and `Edit` tools plus `CommitCanonicalDocument`. Native file access is restricted to one service-owned staging path under `.beegame/workflow/staging/<dispatchId>/`. The model may incrementally author and reread that staging file, then calls `CommitCanonicalDocument` with an empty input object.

The commit tool reads the staged Markdown, applies the existing complete-document validator, and uses the existing receipt-backed atomic commit to publish the canonical target. The final `docs/*.md` path is never writable by the model. A failed or interrupted author leaves no partial canonical document.

## Boundaries

- Do not disable or reduce thinking.
- Do not change model selection or provider configuration.
- Do not relax complete document contracts or validation.
- Do not expose Bash, web, nested agents, or arbitrary project files.
- Do not modify shared Claude Code streaming behavior.
- Preserve the existing `CommitCanonicalDocument` durable receipt and terminal event.

## Verification

1. Unit tests prove document authors receive only `Read`, `Write`, `Edit`, and the commit tool.
2. Permission tests prove native file operations are allowed only for the staging path and denied for the final canonical path.
3. Tool tests prove empty-input commit reads staged Markdown, validates it, and atomically publishes the final document.
4. Existing workflow and type tests remain green.
5. A fixed-port Chrome run must generate actual canonical documents and expose them in Deliverables.

