# Continuous Bounded Document Turn Design

## Problem

Chrome acceptance produced a valid 61,554-byte GDD in 15m24s, but the raw model counter reached 1,660,669 tokens. Event-level attribution found 1,520,013 cache-read tokens and only 41,873 output tokens. Twelve intermediate end-of-group replies alone consumed 627,413 tokens because each reply reread the native session context before saying that one section had completed.

The durable section checkpoints are correct and must remain. The waste comes from ending the native model turn after every checkpoint and starting another model turn for the next section.

## Decision

One foundation document uses one continuous native authoring turn. Within that turn, the native worker performs the remaining ordered checkpoint calls one at a time:

1. generate one bounded section or production material;
2. call native `Write` or `Edit`;
3. wait for BGS mechanical permission and the native tool result;
4. immediately generate the next bounded checkpoint;
5. emit one short completion message only after the entire document is complete.

This changes turn scheduling, not file mutation authority. It does not permit one-shot document generation.

## Prompt contract

The first or resumed prompt contains a compact ordered list of every remaining group. Each item identifies its current cursor, canonical marker and heading, next cursor, section ownership, and production-material format. The complete confirmed brief remains available only as the already established document authority. The prompt must not copy completed document content.

The worker is explicitly required to execute one native file call at a time. It may not compose two sections in one tool argument, precompute the whole document, reread the completed prefix, or author another project file. Every `content` or `new_string` remains subject to the existing measured target and hard byte limit.

## Mechanical authority and recovery

`authorizeFoundationDocumentDraftMutation` remains the sole file-mutation gate. It simulates the proposed mutation against the current on-disk document and permits exactly one cursor transition. Therefore a continuous turn cannot skip, combine, reorder, or rewrite checkpoints.

If the process or user interrupts the turn, already accepted checkpoints remain on disk. Workflow recovery inspects the cursor and starts a new continuous turn containing only the remaining groups. If the native worker voluntarily returns a terminal result before the document is complete, BGS fails closed with an incomplete-document error; it does not silently create another per-group turn path.

## BGS boundary

BGS may:

- select and serialize the remaining canonical checkpoint contracts;
- authorize or deny each proposed native mutation mechanically;
- inspect the on-disk cursor after the native turn ends;
- commit the complete validated document.

BGS may not author, summarize, repair, rewrite, or render the human document body. The native runtime's reasoning, model configuration, tools, streaming behavior, permission protocol, and context management remain unchanged. No local runtime-core files are modified.

## Validation

Automated tests must prove:

- the prompt contains all remaining groups in canonical order;
- each normal section still has one independent `Edit` checkpoint;
- production materials remain independent checkpoints;
- a complete GDD requires one BGS `sendWithDisplay` call rather than thirteen;
- a prematurely ended native turn is rejected instead of continued through a hidden second path;
- resume prompts omit completed groups and begin at the durable current cursor;
- existing mutation, complete-document, delivery-port, and type checks stay green.

Chrome acceptance remains the final efficiency gate: generate a fresh non-tower-defense Web React GDD, stop before the second document writes, verify complete quality, and compare total/fresh/cache/output tokens against the prior 1,660,669-token evidence.
