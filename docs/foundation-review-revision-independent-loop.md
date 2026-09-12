# Reviewer / Revision independent loop

The delivery workflow owns the loop. Reviewer and Revision own separate public ports, execution, journals and billing. Neither stage imports or starts the other. The workflow exchanges immutable public document/report snapshots, not private state or worker handles belonging to the other module.

Normal path:

1. Reviewer audits all eight documents and the confirmed requirements.
2. After the result is complete and billing is settled, the workflow gives the issue report and frozen documents to Revision.
3. One Revision execution reads the entire frozen eight-document set, independently assesses every issue, decides the necessary cross-document repair scope, and returns one coherent candidate set.
4. After settlement, the workflow starts a fresh Reviewer invocation with all eight candidate documents and the original requirements. It does not restrict the audit to previous findings or include Revision's repair claims as instructions.
5. Newly found or remaining issues start another repair round. A clean review is accepted only for the exact reviewed bytes, then the existing downstream acceptance boundary applies.

## Disputed or unsafe repairs

New requests explicitly use `document-set-v1`. Each original issue receives exactly one `repaired`, `unsupported` or `needs_decision` assessment with a reason. Repaired assessments name the documents changed for that issue; issue locations do not prescribe writable targets. Different findings in the same document can have different outcomes. The candidate retains supported repairs even when another finding is disputed, but it is not published as an accepted design.

Assessments and complete changed Markdown documents are submitted through StructuredOutput, separately from visible explanation. The host copies unchanged originals, advances service metadata and derives byte-bound changes. It validates format and binding, not semantic truth. During structural correction, individually valid documents remain in the same owned process and only corrections need resubmitting. Missing labels are restored only at uniquely matching exact headings. Repeated identical rejected output or more than three correction requests pauses; a failed document-set execution is not automatically restarted.

Reasons are preserved in `issueAssessments` and the existing `unresolvedIssues` result, outside document content. Historical requests lacking the mode retain their original per-document receipt and request digest behavior; stored data is never rewritten into the new mode.

The workflow pauses on unresolved assessments and exposes their reasons. It does not decide which module is right, silently dismiss a finding, or repeatedly send the same dispute through paid rounds. Explicit adjudication/new input is required; ordinary resume does not erase the safety stop.

## Bounded convergence

- Unchanged candidate bytes stop even on the first repair round.
- The existing six automatic repair-round limit remains in the workflow, not either module.
- Stop controls, settlement barriers and idempotent restart behavior remain in effect.
- Stop intent keeps observation active until the owned process closes and billing settles; it never resumes or dispatches a successor. Unknown/stale ownership remains an explicit recovery condition.
- Reviewer-only mode remains an explicit opt-out of the loop; it is not silently converted into a full pipeline.

Revision's model instructions are the same regardless of the upstream audit strategy. Public protocol validation remains at the consumer boundary; this is data-contract compatibility, not access to Reviewer internals.

Offline coverage includes a two-repair-round chain with a later-discovered issue, one-child four-document correction/replay, mixed same-document assessments, independent public bundles, delayed stop settlement, unchanged candidates and budget stops. These tests verify orchestration, data contracts and isolation, not real-model recall or precision. The frozen semantic cases must also be checked against the separately recorded live acceptance; citations and a declining issue count alone are not evidence of semantic convergence.
