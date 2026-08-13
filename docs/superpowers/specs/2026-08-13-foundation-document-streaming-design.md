# Foundation Document Streaming Design

## Goal

Make the existing idea-to-document workflow produce a complete, production-usable GDD through the Web React path without native-session stalls or multi-million-token rework.

This change is deliberately narrow. It does not introduce a second document pipeline, edit the native coding runtime, hard-code an example game, or move authorship into Bee Game Studio (BGS).

## Evidence and root cause

The 2026-08-13 Chrome run completed a valid 70,844-byte GDD in about 14.5 minutes, but consumed 2,972,107 model tokens. The completed document passed the full Markdown validator and contained all 12 semantic sections and three production materials.

The run reused one native session for 13 authoring turns. Each turn added two fixed-size document parts, while later turns repeatedly cache-read the entire accumulated conversation. Cache reads grew from roughly 125k to 226k per normal group. The final material group also reread and repaired earlier sections because the validator treated repeated headings in different sections as global duplicates. That produced avoidable retries, forbidden-prefix edits, and extra tool calls.

The confirmed brief and authority projection were small and were not the source of the cost. The root cause is the combination of an ever-growing session, two authoring checkpoints per semantic section, and validation that incorrectly turns valid cross-section heading reuse into historical rework.

## Single-lane design

The existing delivery workflow remains the only path.

1. One native session is kept for the complete GDD so terminology, mechanics, and production assumptions remain coherent.
2. The preamble is written once with `Write`. Every semantic section and production material is then appended with exactly one `Edit` checkpoint.
3. A checkpoint targets about 3,600 UTF-8 bytes and has a 4,800-byte mechanical hard limit. The section contract must request dense, production-useful content rather than a long narrative. It may not omit required decisions, tables, acceptance criteria, risks, dependencies, or implementation facts to meet the target. The hard limit is measured from Chrome evidence: natural first drafts up to 4,632 bytes streamed within the 45-second response-gap limit, while rejecting them caused a full second generation and 86k–95k avoidable tokens per section. It remains below the previously unstable 5,200-byte range.
4. After a checkpoint succeeds, BGS advances the durable cursor to the next semantic group. It never asks the author to reread or rewrite the completed prefix.
5. Heading uniqueness is validated inside the current section. Reusing a structural heading such as `验收标准` in a different section is valid. Duplicate headings inside one section remain invalid.
6. Final validation remains global and fail-closed for section order, required section and material coverage, unfinished markers, malformed tables or diagrams, unresolved placeholders, missing acceptance criteria, and cursor/package identity.
7. BGS only routes prompts, enforces byte/cursor/path/shape constraints, records performance evidence, and commits accepted filesystem changes. Native reasoning, tool selection, model configuration, and document authorship remain outside BGS control.

There is no batch-authoring fallback, whole-document replacement path, prompt-only workaround, legacy compatibility lane, or BGS-owned streaming writer.

## Failure and resume behavior

- Oversized, empty, out-of-order, multi-group, or prefix-rewriting mutations are rejected before the cursor advances.
- A rejected checkpoint stays on the same group and returns the concrete validation error to the same native session.
- A stopped or restarted workflow resumes from the last accepted group; it does not regenerate accepted content.
- Repeated failures are visible in logs with group ID, byte count, cursor, validation code, native session ID, elapsed time, and token usage. They are not reported as generic stalls.

## Test strategy

Implementation starts with failing tests and keeps the current production path:

- Unit tests prove one checkpoint per normal section/material, the 3,600-byte target and 4,800-byte hard bound, cursor advancement, prefix immutability, and no fixed half-section markers.
- Validator tests prove a repeated heading is allowed across sections but rejected inside the same section.
- Session tests prove accepted groups resume without regeneration and validation errors preserve the current cursor.
- A fixed-port Chrome Web React acceptance creates a new non-example project, requests only the GDD, and stops before the next document is authored.

Chrome acceptance requires all of the following:

- GDD reaches the completed state without a response gap above 45 seconds.
- The final file passes the complete-document validator and a human quality audit.
- All required sections, production materials, tables, diagrams, decisions, risks, dependencies, and acceptance criteria remain usable by humans and implementation agents.
- No completed-prefix rewrite, Bash-based document mutation, legacy lane, or native-core modification occurs.
- Raw GDD model usage is no more than 1.8 million total tokens. If this threshold is missed, the run is stopped and diagnosed from the captured per-turn/tool logs before any further document is generated.

## Non-goals

- Generating or reviewing the other seven documents in this change.
- Changing the native coding runtime or its permission/model configuration.
- Reducing content quality to hit a token target.
- Resolving project-specific design conflicts discovered in the test document.
