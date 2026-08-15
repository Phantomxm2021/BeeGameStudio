# Review Acceptance Copy Design

## Goal

Provide one Web/React action that creates an isolated, current-schema project from an owned project's confirmed Brief and eight canonical foundation documents. The action exists so a completed document set can enter the rebuilt Reviewer without mutating its source project or restoring legacy workflow compatibility.

## Chosen approach

Add **Create review copy** to the project-history row menu. The frontend calls one authenticated project route. The server verifies ownership and reads the source workspace, but treats the source workflow snapshot only as an import source for the plain `confirmedBriefContext` field. It does not parse, migrate, resume, or copy the old workflow state.

The server then:

1. Requires all eight canonical foundation documents to exist as regular files within the owned source workspace.
2. Requires a non-empty confirmed Brief from the source snapshot.
3. Creates a new project identity and workspace under the normal user project root.
4. Copies only the eight documents, preserving their exact bytes and relative paths.
5. Creates a fresh current-schema delivery run at `DOCUMENT_REVIEW / FOUNDATION_REVIEW`, with all eight document paths marked complete and no inherited approvals, reports, resources, sessions, usage, or runtime state.
6. Persists the new project metadata only after the workspace and fresh run are durable.
7. Returns the new project metadata so Web/React can select it immediately.

## Boundaries

- The source project is read-only.
- No Reviewer report, decision, finding, resource, accepted-unit journal, session transcript, model setting, usage total, or old workflow field is copied.
- This is an explicit import into a new current-schema project, not a legacy parser or recovery fallback.
- Bee Game Studio does not author, summarize, or repair document content.
- The normal Reviewer remains the only semantic review path after copy creation.
- A failed copy removes its incomplete destination and does not register project metadata.

## Interface

Backend:

```text
POST /api/projects/:projectId/review-copy
-> { project: BeeGameProjectMetadata }
```

Frontend:

- Add `createReviewCopy(projectId)` to the existing API/store boundary.
- Add one non-destructive menu item beside project deletion.
- While copying, disable repeat submission and show a row-local pending state.
- On success, refresh history, close the dialog, and select the new project.
- On failure, retain the source row and show the original API error.

## Validation and failure behavior

- Reject projects not owned by the authenticated user.
- Resolve every source and destination path below its corresponding workspace root.
- Reject missing, symlinked, non-file, or oversized foundation documents.
- Reject missing or blank confirmed Brief authority.
- Use a collision-resistant project ID and a deterministic safe folder suffix.
- Write the destination into a temporary sibling directory, initialize the fresh run there, then atomically rename it to the final workspace before metadata registration.

## Tests

1. Backend RED/GREEN: owned source with Brief and eight documents produces an isolated current-schema review project with byte-identical documents.
2. Backend rejection: missing document, missing Brief, foreign project, or path escape creates no registered destination.
3. Source immutability: source document and workflow hashes are unchanged.
4. Frontend RED/GREEN: history menu calls the route once, shows pending state, selects the returned project, and preserves the row on failure.
5. Regression: existing delete/select behavior remains unchanged.
6. Chrome acceptance on fixed ports `62173` and `62174`: create the copy through project history, enter it, observe Foundation Reviewer roles, wait for the final report, verify project-local report paths and UI verdict/error visibility.

