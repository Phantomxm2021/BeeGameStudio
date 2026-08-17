# Foundation Review v3 Contract Design

## Problem

The remediation clean-slate refactor removed verification execution but retained
the obsolete `priorConflictStatus` root field. The field is currently expressed
as `z.array(z.never()).max(0)`, which compiles to the following JSON Schema:

```json
{
  "maxItems": 0,
  "type": "array",
  "items": { "not": {} }
}
```

In two Reviewer-only Chrome runs, the three specialist lanes completed while
the final synthesis repeatedly stopped at `priorConflictStatus`. Restoring
Credit did not change the failure. The contract is therefore the primary
functional defect; document writing, project files, and remediation execution
are outside this repair.

## Decision

Replace Foundation Review v2 with a strict v3 contract. Remove the obsolete
verification fields instead of preserving their shape or adding compatibility.

The v3 root object contains exactly:

```text
version
scope
revision
verdict
conflicts
```

`FOUNDATION_REVIEW_VERSION` becomes `3`. Existing v2 review artifacts are not
migrated or accepted. A workflow encountering one must perform a fresh review
for the current document revision.

## Scope

The change includes:

- the canonical Foundation Review schema and TypeScript type;
- the final Reviewer output example and contract instruction;
- the final Reviewer prompt root-field instruction;
- fixtures and tests that construct or assert Foundation Review reports;
- schema-boundary tests for the JSON Schema sent to the native Reviewer;
- focused Reviewer-only Chrome acceptance after automated verification.

The change excludes:

- document authoring and remediation;
- changes to the native core or provider protocol;
- retry policy, stream watchdogs, or model configuration;
- migration or fallback parsing for v2 reports;
- the independently observed stop/cancellation latency.

## Contract and Data Flow

The BGS delivery worker converts the canonical Zod schema to Draft 7 JSON
Schema and supplies it as the final Reviewer's `StructuredOutput` contract.
The final Reviewer reads accepted specialist lane packets, emits one v3 object,
and BGS validates and persists that object only after the current-revision
checks already required by the review stage.

No component may synthesize, ignore, or strip legacy verification fields.
Strict parsing rejects extra root fields, including `priorConflictStatus` and
`priorReviewDigest`.

## Failure Semantics

- A v2 report is rejected as a contract-version mismatch.
- A report with legacy verification fields is rejected as an extra-field
  violation.
- `READY` with conflicts and `NEEDS_REVISION` without conflicts remain invalid.
- Invalid output remains a Reviewer failure; BGS does not repair model output.
- The Reviewer workflow does not advance to remediation during acceptance.

## Tests

Implementation follows red-green-refactor.

The first failing tests must prove that the current code still:

1. emits `priorConflictStatus` and `items: { not: {} }` in the workflow JSON
   Schema;
2. accepts version 2 rather than version 3;
3. includes the legacy field in the final Reviewer prompt.

The completed tests must prove:

- emitted JSON Schema has exactly the five v3 root properties;
- the emitted schema contains no `not` keyword and no legacy verification
  field;
- v3 valid reports parse and v2/legacy reports fail;
- final Reviewer prompts describe only the v3 fields;
- report acceptance, recovery, session-port, and UI projection focused suites
  remain green.

After automated verification, Chrome acceptance runs only the Reviewer stage
against an unchanged copy of the previously accepted eight documents. It must
complete all specialist and final tasks, persist the final report, preserve all
eight source-document hashes, and stop before remediation.

## Separate Follow-up

The UI stop action persisted a stopped workflow before the upstream request
fully ceased. That observation is not part of the causal chain for the final
Reviewer failure. It requires an independent reproduction covering dispatch
identity, managed-session disposal, abort propagation, and process termination.
No cancellation code is changed as part of the v3 contract repair.

