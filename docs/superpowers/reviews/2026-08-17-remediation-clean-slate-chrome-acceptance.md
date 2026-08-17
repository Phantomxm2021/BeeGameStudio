# Remediation Clean-Slate Chrome Acceptance

Date: 2026-08-17

Branch: `codex/remediation-clean-slate`

Verdict: **BLOCKED — NOT ACCEPTED**

## Scope

The required acceptance is Reviewer-only through the Web/React Dashboard in
Chrome on fixed ports `62173`–`62177`. It must create a fresh review copy of the
accepted eight-document source project and prove that an accepted
`NEEDS_REVISION` report ends in `needs_action` without any later repair or
verification dispatch and without changing a source-document digest.

No replacement repair flow is in scope.

## Verified Non-Browser Closure

The exact production static scan returned no matches for removed Foundation
post-report state, task IDs, authoring mode, creation events, or Dashboard
labels.

The complete affected test command passed with 233 tests passing, 1 intentional
skip, and 0 failures. TypeScript typecheck and `git diff --check` also passed.

During that verification, the persisted-schema fingerprint test correctly
detected that removal had structurally changed the strict delivery-run schema
without changing its version. The current schema version is now 26 with the new
fingerprint registered. Version 25 remains unsupported; no migration or
projection was added.

## Chrome Blocker

The local fixed-port launcher requires `AGENT_WORKFLOW_WORKSPACE_PATH` and the
configured remote service/model credentials. The non-exported environment was
first rejected before starting any service because the workspace path was not
available to the launcher.

The corrected remote-enabled launch was then denied by the execution approval
boundary because loading local credentials could transmit private project data
to an unverified remote model endpoint without a separate explicit approval.
The denial explicitly prohibited indirect execution or another workaround.

Consequently:

- no fixed-port service was started;
- Chrome was not opened against the application;
- no review copy or workflow run was created;
- no Reviewer task, report, token, credit, tool-call, or wall-time evidence was
  observed;
- no pre/post source digest comparison was performed for this branch;
- this document does not reuse the earlier branch's runtime evidence as proof
  for the clean-slate tree.

## Required Evidence Still Outstanding

Acceptance remains blocked until an authorized fixed-port run records:

- project and workflow run IDs;
- the four completed Reviewer task states;
- report path, revision, SHA-256, schema result, and verdict;
- every native tool call and zero mutation/Agent tools;
- pre/post SHA-256 for all eight source documents;
- input, cache input, output, credit, and wall time;
- every dispatch created after report acceptance;
- `workflow.status = needs_action` for `NEEDS_REVISION`;
- zero post-report repair dispatches;
- zero post-report verification dispatches;
- zero source-document digest changes.

## Conclusion

Static and automated closure are green, but Chrome acceptance is not complete.
This record must not be marked accepted until the missing live evidence is
captured on this branch with authorized credentials and project-data handling.
