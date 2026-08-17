# Foundation Remediation Section Transaction Design

## Goal

Replace the current multi-turn Foundation remediation writers with one canonical, single-request section transaction per affected document. The change must reduce repeated context replay without changing native Bee Game Studio core behavior or moving document authorship into the BGS workflow service.

The existing Foundation review and verification stages remain authoritative. Only the remediation execution path changes.

## Confirmed root cause

The latest Web/React Chrome acceptance used eight independent one-document writers but still consumed about 10.2 million remediation tokens. The writers issued repeated Read, Grep and Edit calls. Every tool turn replayed the prompt, current document and prior tool results. Parallel sessions reduced elapsed time but multiplied total context replay.

One-document ownership alone therefore does not solve the problem. Prompt instructions and tool allowlists also cannot reliably control native Agent behavior and would cross the BGS boundary.

## Single canonical remediation path

Each affected Foundation document receives exactly one independent structured remediation request. The request contains:

- the canonical target path;
- the complete current target document bytes once;
- the target document SHA-256 digest;
- only accepted conflicts whose changes include the target path;
- only the Reviewer-captured evidence excerpts required by those conflicts;
- the canonical body-unit IDs and body digests for the target document.

A body unit is exactly one of `executive-summary`, `section:<sectionId>` or
`material:<materialId>`. Its heading and BGS protocol marker are structural
metadata and are not part of Agent-authored replacement bytes.

It must not contain other complete Foundation documents, chat history, prior remediation transcripts or generic workspace context.

The Agent returns exactly one object:

```json
{
  "version": 1,
  "sourcePath": "docs/GDD.md",
  "sourceDigest": "<sha256>",
  "resolvedConflictIds": ["conflict-id"],
  "patches": [
    {
      "unitId": "section:core-loop",
      "expectedBodyDigest": "<sha256>",
      "replacementBody": "<complete revised body>"
    }
  ]
}
```

The Agent owns every semantic decision and every replacement byte. BGS does not draft, summarize, split or rewrite document prose.

## Atomic application boundary

BGS acts only as the validation and persistence boundary. Before writing, it must verify:

1. the request and response target exactly one authorized canonical document;
2. the current document digest still matches `sourceDigest`;
3. `resolvedConflictIds` exactly equals the assigned conflict set;
4. every patch names an existing unique canonical body unit;
5. every body digest still matches `expectedBodyDigest`;
6. body-unit IDs are unique and in canonical document order;
7. replacement bodies are non-empty and contain neither a document-level title nor a canonical sibling-unit heading or protocol marker;
8. the fully assembled document satisfies the existing canonical document contract.

All replacements are assembled in memory and committed through one durable atomic write. Any failure writes no document bytes and records the original error. There is no hidden retry, partial commit, fuzzy matching or fallback to Edit.

The durable receipt binds review digest, source document digest, patched body-unit IDs, final document digest and commit time. Existing remediation completion barriers and verification review consume this receipt.

## Failure and recovery

- A stale source or section digest fails closed and requires a newly authorized remediation request.
- Invalid or truncated structured output fails visibly and leaves the source untouched.
- A committed receipt is idempotently reusable only when current bytes still match its final digest.
- A stopped or failed request never creates a completion receipt.
- Retry creates the same single-request transaction against freshly captured source bytes; it does not resume a native multi-turn transcript.

## Required removal

Implementation must delete, rather than preserve, all superseded remediation behavior:

- native remediation sessions that rely on Read, Grep, Edit or Write loops;
- remediation-specific tool allowlists, denylists or tool-count instructions;
- prompts instructing an Agent to edit files directly;
- full-document rewrite remediation and any fallback to it;
- grouped multi-document remediation lanes;
- legacy receipt fields that exist only for direct file-tool mutation;
- compatibility branches that select old remediation protocols by schema version, mode or missing fields after persisted-state migration;
- tests that certify any removed path.

Persisted runs are migrated once to the new one-document lane identity and transaction state when their authority can be proven. Ambiguous running legacy remediation fails closed with a clear restart requirement. No runtime dual track remains after migration.

## Unchanged boundaries

- Native Bee Game Studio core code is not modified.
- Initial eight-document authoring is unchanged.
- Reviewer lane review, synthesis and verification semantics are unchanged.
- Dashboard tasks remain one item per document and use the new transaction status and exact failure reason.
- BGS does not choose prose, create checkpoints or decide how a conflict is resolved.

## Verification strategy

Implementation is test-driven.

Unit tests must first prove rejection of stale digests, missing or duplicate conflicts, unknown or duplicate body units, invalid ordering, malformed Markdown, partial application and legacy-path selection. They must prove atomic success, idempotent receipt replay, preservation of structural headings and protocol markers, and exact unchanged bytes outside patched body units.

Integration tests must prove one structured request per affected document, no remediation Read/Grep/Edit/Write tool loop, no alternate remediation terminal and correct transition into the existing verification review.

Final acceptance must use Web/React through Chrome on a fresh copy of the previously accepted eight-document project. It must verify document quality and conflict closure, inspect logs and receipts, and report per-document input, cache-input, output, credit and elapsed time.

The comparison baseline is the stopped run whose remediation consumed about 10.2 million tokens. The performance target is at most 3 million remediation tokens across all eight documents. This target evaluates efficiency only; document correctness is determined by contract validation and verification review, not file size.

## Non-goals

- Changing model compression, retry or streaming behavior.
- Modifying native file tools or native Agent source.
- Introducing a second patch representation.
- Optimizing initial document authoring or Reviewer execution in this change.
- Using document length as a quality metric.
