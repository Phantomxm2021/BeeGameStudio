# Foundation Review JSON Convergence Design

## Status

Approved design. This document supersedes the earlier 2026-08-16 Foundation Reviewer designs that used Markdown reports, separate decision files, specialist consolidation, per-document remediation, or repeated automatic semantic review cycles.

## Goal

Make the eight-document Foundation Reviewer converge in one review, one coordinated remediation, and one verification review. Its only durable output is an actionable machine contract for the next remediation Agent.

## Scope

This design changes only the review and remediation of the eight canonical Foundation documents:

- `docs/GDD.md`
- `docs/LEVEL_SCENE_DESIGN.md`
- `docs/BALANCE_DESIGN.md`
- `docs/TECHNICAL_DESIGN.md`
- `docs/ART_DIRECTION.md`
- `docs/UI_UX_SPEC.md`
- `docs/AUDIO_DESIGN.md`
- `docs/ASSET_PLAN.md`

It does not change document generation, model configuration, native Agent tools, resource review, implementation audit, or acceptance review.

## Reviewer Responsibility

The Reviewer finds only blocking conflicts that prevent implementation or acceptance. A blocking conflict must do at least one of the following:

- permit incompatible implementations;
- contradict an authoritative state, formula, budget, enumeration, or ownership boundary;
- omit information required to implement or accept delivery;
- leave an externally required dependency unresolved.

The Reviewer must not persist audit prose, correct-item summaries, non-blocking advice, preservation lists, coverage narratives, introductions, conclusions, or replacement document prose.

The Reviewer internally performs the same ordered pass on every review:

1. authority, enumeration, and cardinality;
2. state, outcome, and transition totality;
3. arithmetic, units, formulas, and budgets;
4. owner-to-consumer consistency and duplicated authority;
5. runtime, production, asset, and acceptance closure;
6. art, UI, audio, and accessibility mappings;
7. unresolved assumptions and external dependencies;
8. duplicated facts that can drift independently.

The protocol does not persist a `completedChecks` self-attestation because listing check names does not prove that the checks occurred.

## Single Durable Artifact

Each immutable document revision has exactly one review artifact:

```text
.beegame/reviews/foundation/<document-revision>/review.json
```

There is no `review.md` and no separate `decision.json`.

The JSON contract is:

```ts
type FoundationReview = {
  version: 2
  scope: 'foundation'
  revision: string
  verdict: 'READY' | 'NEEDS_REVISION'
  priorReviewDigest?: string
  priorConflictStatus: Array<{
    id: string
    status: 'closed' | 'open'
  }>
  conflicts: Array<{
    id: string
    title: string
    problem: string
    evidence: Array<{
      path: FoundationDocumentPath
      location: string
      observed: string
    }>
    requiredOutcome: string
    changes: Array<{
      path: FoundationDocumentPath
      action: string
    }>
    acceptance: string[]
  }>
}
```

Every conflict must tell the remediation Agent what is wrong, where the evidence is, which files must change, what each file must change, and how completion is verified. Instructions state required outcomes rather than drafting replacement prose.

## Validation

The server validates the JSON without deciding document correctness:

- `revision` equals the current byte-derived Foundation revision;
- `READY` requires an empty `conflicts` array;
- `NEEDS_REVISION` requires at least one conflict;
- conflict IDs are unique;
- evidence and change paths are canonical Foundation paths;
- every conflict has non-empty problem, evidence, required outcome, changes, and acceptance criteria;
- the remediation path set is derived only from the union of `conflicts[].changes[].path`;
- when a prior review exists, `priorReviewDigest` must match it;
- every prior conflict appears exactly once in `priorConflictStatus`;
- an `open` prior conflict remains in `conflicts` with the same ID;
- a `closed` prior conflict does not remain in `conflicts`.

The server never adds, removes, rewrites, or reclassifies conflicts.

## Workflow

The semantic workflow has exactly three steps:

1. The Reviewer reads the current eight documents and commits one `review.json`.
2. If revision is needed, one coordinated remediation Agent receives the complete accepted JSON and write access only to the derived remediation path set.
3. A verification Reviewer receives the new eight documents and the previous byte-bound `review.json`, accounts for every prior conflict, repeats the full ordered pass, and commits the new revision's `review.json`.

If verification still returns `NEEDS_REVISION`, the workflow stops at `needs_action`. It does not automatically start a third semantic review cycle. Transport or process interruptions may replay the same idempotent work; semantic failure may not be disguised as a transport retry.

One coordinated remediation Agent replaces per-document parallel remediation. Cross-document conflicts therefore have one interpretation and one required outcome. The Agent may edit only paths named by accepted conflict changes and must preserve unrelated content.

## Atomicity and Recovery

`review.json` is staged, schema-validated, revision-validated, fsynced, and atomically committed. Workflow state stores its project-relative path and SHA-256 digest.

If the artifact commit succeeds but workflow-state persistence is interrupted, recovery rereads the single committed file, revalidates its digest and current document revision, and resumes routing. A conflicting second artifact for the same revision is rejected.

## Dashboard

The Dashboard reads the digest-validated JSON projection. It shows:

- verdict;
- conflict count;
- affected document paths derived from changes;
- an expandable list of problem, evidence, required changes, and acceptance criteria;
- prior conflict status during verification;
- current state: reviewing, repairing, verifying, ready, or needs action.

It does not render raw JSON by default and does not persist a Markdown projection.

## BGS Boundary

BGS may validate schemas and paths, derive permissions, persist immutable artifacts, recover interrupted state, route work, and render UI. BGS may not decide whether content is correct, generate conflicts, author document changes, rewrite Reviewer findings, or infer READY from keywords.

## Removal of Superseded Behavior

Implementation removes, rather than retains behind compatibility branches:

- Markdown Foundation review reports;
- separate Foundation decision files;
- Foundation specialist report consolidation;
- Foundation coverage, non-blocking, and preservation prose;
- per-document parallel Foundation remediation;
- repeated automatic semantic review loops;
- Markdown prior-review handoff;
- Dashboard Markdown review rendering;
- dual report/decision commit and recovery logic.

Historical files remain recoverable through Git or existing project directories, but the new runtime does not read or produce the obsolete Foundation protocol. An active old-protocol review must be restarted under version 2; it is not silently translated.

## Acceptance

Implementation is accepted only when:

- schema tests reject incomplete, inconsistent, stale, or out-of-scope review JSON;
- transition tests prove one remediation and one verification only;
- recovery tests prove crash-after-commit replay from the single artifact;
- remediation tests prove one coordinated Agent receives all and only derived change paths;
- Dashboard tests render the JSON conflict list and never require Markdown;
- legacy Foundation Markdown/decision code and tests are absent;
- backend, frontend, typecheck, and diff checks pass;
- a Web/React Chrome run uses an existing completed eight-document project, reaches review, remediation, and verification, and records duration and token usage without creating a new generation case.

## Design Self-Review

- No placeholder or deferred implementation remains in scope.
- JSON is the only authority; there is no dual track.
- The prior-review link prevents silent conflict loss without adding user-facing history prose.
- The server validates structure and routing only, preserving the BGS boundary.
- A single remediation Agent trades parallel speed for cross-document consistency; this is deliberate and bounded to conflict paths.
- One automatic remediation prevents unbounded token consumption. Remaining semantic failure becomes visible instead of triggering another hidden loop.
- The design does not claim that a model-provided checklist proves coverage; quality is verified with the fixed protocol and real eight-document Chrome acceptance.
