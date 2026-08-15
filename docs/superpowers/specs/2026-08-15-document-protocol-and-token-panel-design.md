# Document Protocol Ownership and Token Panel Design

## Goal

Make eight-document authoring resilient to omitted machine comments without allowing Bee Game Studio to author document content, preserve the original document commit error, and reduce the project token panel to four unambiguous values.

## Boundary

The native author owns the complete human-readable Markdown title, headings, prose, tables, diagrams, and other production content. Bee Game Studio owns only deterministic protocol metadata, validation, persistence, workflow state, and billing presentation.

Bee Game Studio must not invent, rewrite, reorder, summarize, or repair human document content. A document with missing, duplicated, renamed, or reordered canonical headings remains invalid.

## Deterministic Markdown Protocol Metadata

Initial and parallel foundation author prompts provide the exact canonical heading sequence and production-material formats, but do not ask the model to emit `beegame-*` comments.

Before complete-document validation, Bee Game Studio performs one deterministic normalization pass:

1. Parse Markdown headings outside fenced code blocks.
2. Require exactly one document title as the first non-blank line.
3. Require exactly one `## Executive Summary`, every contract section heading, and `## Production Materials` in canonical order.
4. Require every contract production-material `###` heading exactly once and in canonical order beneath Production Materials.
5. Reject unknown, duplicated, missing, renamed, or reordered canonical headings.
6. Remove only recognized Bee Game Studio protocol marker lines and inject the canonical summary, section, production, and material markers immediately before their headings.
7. Pass the normalized body through the existing complete-document validator and persistence transaction.

The normalization is idempotent. An already canonical document produces the same normalized body. It never changes human-readable headings or section bodies.

## Error Propagation

The session manager remains the authority for turn completion and records a commit failure as `turn.failed`.

After waiting for a streamed document worker to become idle, the delivery worker must load a fresh event snapshot before deciding whether the commit receipt exists. If the refreshed events contain `turn.failed`, the worker propagates its original error text. The generic missing-receipt error is used only when neither a committed receipt nor an authoritative failure exists.

The API and Chrome UI continue displaying the workflow failure text without replacing it.

## Token Panel

The project information panel displays exactly four rows:

- Input: fresh input tokens from the live workflow usage snapshot.
- Cached Input: cache-read plus cache-creation tokens from the same live workflow usage snapshot.
- Output: completion/output tokens from the same live workflow usage snapshot.
- Credit: consumed credit from the billing authority.

The panel removes platform, execution status, raw processed total, cache subtypes, and weighted consumption. The frontend does not reproduce the billing weighting formula.

## Testing

Automated regression coverage must prove:

- marker-free Markdown with exact canonical headings normalizes and validates;
- already marked Markdown normalizes idempotently;
- missing, duplicated, renamed, fenced, or reordered canonical headings fail closed;
- a post-stream commit failure surfaces its original `turn.failed` error instead of the generic receipt error;
- the project panel renders only Input, Cached Input, Output, and Credit, with cached input equal to cache-read plus cache-creation;
- relevant backend and frontend suites and type checking pass.

Chrome acceptance must use the Web/React path and fixed service ports. It creates a new non-example project, runs all eight foundation documents, stops before document review, and records elapsed time, fresh input, cached input, output, credit, failures, retries, duplicate dispatches, committed document count, and readiness-audit result.

## Non-Goals

- No native core changes.
- No model retry to repair protocol markers.
- No content rewriting or heading repair by Bee Game Studio.
- No new token or billing metric.
- No review, resource search, implementation, or game-generation acceptance in this change.
