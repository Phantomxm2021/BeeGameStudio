---
name: game-design-check
description: Review saved game-design decisions for an assigned design review or a concrete consistency, implementability or evidence question. Routine author self-check alone does not require this Skill. Not runtime acceptance. 中文：受托设计审查、具体设计矛盾与可实施性问题、定向修订核对。
---

# Game Design Check

Check whether the assigned design determines the required player behavior and can be used by its downstream team while leaving ordinary implementation choices to that work. Take the original confirmed requirements, current assignment and actual consumer dependencies as inputs. This Skill supplies checking methods, not a second definition of ownership, release scope or phase authority.

## Select the applicable checks

For an assigned design review or a concrete unresolved consistency question, select the applicable checks below. Read the relevant sections of [GDD chapter checks](references/document-checks.md) only when that question needs a discipline-specific method, reusing guidance already in context. Its headings identify topics, not a required chapter outline. Review the assigned scope and actual dependencies; verify revisions through affected clauses and consumers.

Apply checks only to the confirmed game and current assignment. A check does not require adding its subject to the game, creating a new chapter, matrix or report, or executing a new review stage. A pending decision is not an omission while no current consumer needs it. A decision needed now is not optional merely because more work remains.

## Common checks

- **Scope:** Trace required, optional and excluded content to the confirmed brief or a legitimate choice, including constraints in tables/examples rather than prose alone.
- **Implementability:** Follow the required player actions, information, outcomes and agreed recovery. Report a missing product decision when the source leaves one of these undetermined; downstream choices of implementation, provisional presentation or tuning remain open when they preserve the design.
- **Consistency:** Compare decisions governing the same player situation under their applicable local and global conditions. Establish a conflict from incompatible meanings or outcomes, preserving the stated meaning and precision of quantities. Shared IDs, terminology or citations are not semantic agreement.
- **Dependencies/ownership:** Read current decisions, distinguish facts, alternatives and pending inputs, and check consequential choices/prohibitions against actual responsibilities. Do not close a missing dependency with a non-owner default.
- **Evidence/delivery:** Compare original requirements with source decisions and implementable tasks before trusting output indexes. Match claims to actual checks and their preconditions; foundational tasks need not each cover a whole journey. Uncertain appearance, feel and balance remain hypotheses, not guaranteed quality.

## Findings and corrections

Keep findings concise in the existing review record or response: source locations, missing/conflicting decision and concrete downstream impact. Record each issue once, without repeating background. For a necessary deferred decision, identify its owner and when it is needed. Polish, stale labels and equally valid preferences are not blockers without a concrete execution conflict.

Read-only review does not edit. Group authorized corrections, then verify changed definitions, exceptions and consumers against the situation that exposed the finding. Retain unchanged valid evidence and unresolved findings; do not reopen unrelated prose or require another review stage or report.

Read related source clauses together; sharing a GDD chapter does not require rereading all requirements.

For supplied BGS geometry or legacy handoff inputs, use the applicable [saved-content checks](references/saved-content-checks.md), actual current sources and supplied entry. Do not create legacy indexes/batches/receipts or BGS data for native-engine/DOM tasks.

Inspect supplied visual references and compare relevant treatment with source clauses; markup alone does not establish appearance. Reference inspection differs from produced Scene/UI or runtime observation, and an old capture does not verify a changed source. Missing required observation remains unverified.

State the checked scope and remaining gaps alongside findings; optional improvements cannot block work.
