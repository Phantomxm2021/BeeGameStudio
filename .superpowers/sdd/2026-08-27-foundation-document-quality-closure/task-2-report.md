# Task 2 report: addressable summary and production-material blocks

## Result

Implemented the existing Foundation section index extension and reused it through revision parsing, batch admission, and publication validation.

- Stable derived IDs are `executive_summary` and `material.<materialId>`.
- Existing authoritative section IDs are unchanged.
- Summary and material boundaries use the existing service-owned markers and digest the heading/body bytes only.
- The existing outside-block byte comparison now permits only admitted derived IDs to change; unlisted derived blocks and authoritative sections remain byte-identical.
- No second parser, index, format, queue, compatibility reader, or UI path was added.

## TDD evidence

### RED

Command:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-section-index.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.test.ts
```

Observed output before the implementation:

```text
21 pass
2 fail
```

The expected failures were:

```text
error: revision batch section is not canonical
error: expect(received).toEqual(expected)
  Expected IDs included executive_summary and material.*
```

This confirmed the new tests failed because derived blocks were not indexed or admitted.

### GREEN

Focused command:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-section-index.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-batches.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-publication.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.test.ts
```

Observed output:

```text
75 pass
0 fail
275 expect() calls
```

Full BeeGame suite:

```text
bun test packages/agent-workflow-server/src/beegame
```

Observed output:

```text
538 pass
0 fail
2651 expect() calls
```

Additional verification:

```text
bun run typecheck
$ tsc --noEmit

git diff --check
```

Both exited successfully with no diagnostics.

## Self-review

- The index remains the sole structural parser and produces one ordered index containing summary, authoritative sections, and materials when service markers are present.
- Contract headings, marker ordering, duplicate IDs, marker-without-heading, and material IDs are checked through the existing index path.
- Revision operation ordering uses the canonical block order, and admission is shared by stage, revision batches, and publication.
- Operation objects remain body-free and contain only digests/identity/issue bindings.
- Existing test fixtures and all existing BeeGame tests remain green.

## Concerns

`buildFoundationSectionIndex` continues to accept sections-only intermediate drafts for canonical paths. When a canonical document contains any summary/material marker, it strictly requires the complete ordered derived marker set and validates derived headings. This preserves the existing authoring/fact-review intermediate flow while enabling complete documents to expose derived blocks; if canonical paths must reject every sections-only intermediate draft, the existing draft fixtures and intermediate pipeline contracts would need a separate coordinated migration.
