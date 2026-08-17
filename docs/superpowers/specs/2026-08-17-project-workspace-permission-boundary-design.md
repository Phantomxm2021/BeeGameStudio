# Project Workspace Permission Boundary

## Goal

Bee Game Studio workflow workers must complete ordinary project-local file work
without asking the user to approve each tool call. A worker must never wait for
approval when it requests an out-of-project path: that request is rejected
immediately and the exact error is exposed to the workflow and Dashboard.

This is a sandbox policy only. It does not choose what an Agent writes, split
its work into checkpoints, rewrite prompts, retry model calls, or bypass the
native runtime's security model.

## Confirmed failure

During Chrome acceptance, the technical-assets verification worker first used
the project-local review projection, then constructed a path under the user's
parent directory. The native runtime emitted `permission.requested`; the
workflow remained running and the Dashboard showed only `审计中`.

The current session manager automatically resolves project-local mutation
requests, but has no equivalent project-boundary authority for read/search
requests. Unhandled requests become pending user gates. That mismatch caused
the apparent hang.

## Authority rules

1. `Read`, `Grep`, and `Glob` requests whose resolved filesystem targets remain
   inside the canonical project workspace are automatically allowed once.
2. Project-local mutations continue to obey the workflow worker's assigned
   paths. Assigned mutations are automatically allowed; unassigned mutations
   are automatically denied.
3. Any file request whose resolved target escapes the project workspace,
   including symlink escapes, is automatically denied. It never creates a
   pending permission gate.
4. A request with a missing, ambiguous, or unsupported path shape fails closed.
5. Shell commands, network access, platform mutations, and non-file tools keep
   their existing native or platform-specific permission rules. A project cwd
   is not proof that a shell command is project-confined.
6. Explicit user/project settings remain authoritative where they already
   grant a narrower or stronger native permission, but cannot expand a workflow
   worker beyond the project filesystem or its assigned mutation paths.

## Runtime behavior

The session manager resolves path-bearing file requests before creating a
pending permission:

- `allow`: append `permission.resolved` with `autoApproved: true` and the
  project-boundary reason, then return an allow-once decision.
- `deny`: append `permission.resolved` with `autoDenied: true`, the exact target
  and boundary reason, then return a deny-once decision with a clear message.
- `unhandled`: preserve the existing native permission flow.

Denied workflow requests must be visible in the dispatch failure and projected
Dashboard task error. The workflow must not remain in `running` solely because
a denied file request was waiting for user input.

## UI behavior

No new permission UI is introduced for project-local file work. An automatic
allow remains invisible during normal execution. An automatic boundary denial
uses the existing task failure presentation and shows the original tool/path
error. The UI must not replace it with a generic missing-receipt message.

## Tests

Automated tests must prove:

- project-local `Read`, `Grep`, and `Glob` resolve without a pending gate;
- relative and absolute project-local paths behave identically;
- symlink and `..` escapes are denied without a pending gate;
- assigned writes remain allowed and unassigned writes remain denied;
- unsupported/Bash/network tools do not gain blanket approval;
- an out-of-project Reviewer read produces a visible failed task rather than a
  permanently running workflow.

Chrome acceptance then creates a fresh review copy of the accepted eight
documents, runs initial review, remediation, and verification, and confirms no
project-local permission clicks are required. If a worker requests an external
path, acceptance requires an immediate visible failure, not an approval wait.

## Non-goals

- No changes to the native Agent core.
- No global `bypassPermissions` mode.
- No BGS-authored document content or tool-call scheduling.
- No automatic retry for rejected paths.
- No relaxation of workflow ownership or assigned-path contracts.
