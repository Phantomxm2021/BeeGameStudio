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

## Round 1 closure

The round-1 review required canonical paths to reject sections-only documents. Production callers were audited: controller revision flows read committed/normalized complete documents, and artifact/publication paths consume normalized canonical bytes. No real production intermediate caller was found. Sections-only test fixtures were migrated to include the summary, production-materials heading, and every ordered material marker.

The index now unconditionally requires exactly one executive-summary marker and the exact ordered material marker set for canonical paths. It validates derived headings and boundaries through the same parser. The revision-batch ordering now directly reuses the canonical block-order map.

## Final concerns

None. The previous sections-only compatibility concern is closed.

## Round 1 final verification

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-section-index.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-batches.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-publication.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.test.ts
76 pass
0 fail

bun test packages/agent-workflow-server/src/beegame
539 pass
0 fail

bun run typecheck
$ tsc --noEmit

git diff --check
```

The final full-suite run was clean; typecheck and whitespace validation also exited successfully.
