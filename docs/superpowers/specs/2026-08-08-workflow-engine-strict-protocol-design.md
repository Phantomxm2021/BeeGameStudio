# Workflow Engine Strict Protocol Design

## Goal

Remove the remaining Workflow Engine compatibility paths so execution, persistence, and recovery use one strict protocol. A malformed durable journal must stop safely at the current run instead of being treated as an empty history and replaying completed work.

## Scope

This change is limited to `packages/workflow-engine` and its root CLI wiring under `src/workflow`. It does not change BeeGame Delivery workflow snapshots, project artifacts, resource documents, or any example project generated under `Projects/users`.

## Considered approaches

### A. Strict protocol cutover — selected

Require one adapter registry, validate every journal entry, propagate journal failures, preserve Workflow arguments exactly as supplied, and require every dead result to carry an explicit reason.

This removes the old paths instead of wrapping or migrating them. The cost is that tests and standalone examples must be updated to the current protocol.

### B. Fail closed while retaining old types — rejected

The reader could reject malformed journals while `agentRunner`, stringified arguments, missing sequence values, and missing death reasons remain legal. This would reduce one immediate risk but preserve several competing contracts.

### C. Add a journal migration layer — rejected

A migration layer would parse old entries and rewrite them into the current representation. That is a second interpretation path and would make corrupted state indistinguishable from intentionally migrated state.

## Canonical execution boundary

`WorkflowPorts` requires exactly one `AgentAdapterRegistry`. `agentRunner` is removed from the port contract. Every agent call resolves exactly one adapter and executes through that adapter. A missing route or default adapter is a configuration error and fails before model execution.

The obsolete `AgentRunner` type is removed rather than retained as an unused public export. Required port behavior is explicit: `Logger.warn` is required, so engine failures cannot silently lose their warning channel through an old partial port implementation.

The root CLI wiring registers its Claude backend as the registry default. It no longer supplies an unreachable `agentRunner` implementation. Standalone examples must create and populate a registry in the same way; examples do not receive a special execution path.

## Canonical journal boundary

`createFileJournalStore.read` distinguishes only two outcomes:

- The journal file does not exist: return an empty journal.
- The journal file exists: every non-empty line must parse and satisfy the current `JournalEntry` contract, otherwise throw a journal error.

A valid entry requires:

- a non-empty `key`;
- a non-negative integer `seq`;
- one exact result variant;
- `ok` usage with a finite, non-negative `outputTokens` value;
- a supported, explicit reason for every `dead` result;
- correctly typed optional display metadata and detail.

Unknown fields, malformed JSON, invalid result payloads, permission failures, and other I/O failures are not converted to an empty journal. `runWorkflow` converts a journal-read failure into one failed run result and emits one failed terminal event. It does not truncate, migrate, or replay the journal.

Journal ordering uses the required `seq` directly. There is no missing-sequence default.

## Workflow arguments

The Workflow tool forwards `input.args` without parsing or normalization. A string remains a string, including a string that happens to contain JSON text. Objects and arrays remain their original structured values. The old stringified-object interpretation is deleted.

## Agent terminal results

The `dead` result variant requires one of the current concrete reasons:

- `no-structured-output`
- `invalid-structured-output`
- `runagent-threw`
- `worktree-failed`

The unclassified `unknown` reason is removed. Every adapter, example, and test must choose the reason that describes the actual terminal boundary. This makes persisted terminal state auditable and prevents callers from manufacturing an incomplete result.

## Recovery behavior

A valid journal resumes from its stable sequence without re-running accepted entries. A missing journal starts a new run. An invalid or unreadable journal stops as failed at the recovery boundary and leaves the journal untouched. Recovery never guesses, silently empties state, or invokes a compatibility parser.

## Testing

Implementation follows test-first changes:

1. Prove a malformed JSON line, invalid entry, missing `seq`, missing dead reason, unknown field, and non-ENOENT read failure are rejected.
2. Prove a missing journal remains the only empty-history case.
3. Prove `runWorkflow` emits a failed terminal result and performs no agent dispatch when journal loading fails.
4. Prove WorkflowTool preserves JSON-looking string arguments as strings.
5. Prove ports cannot be constructed without the registry and runtime calls only its selected adapter.
6. Update all adapters, examples, and fixtures to produce explicit terminal reasons.
7. Run the complete Workflow Engine suite, root workflow tests, TypeScript checking, formatting checks, and existing BeeGame Workflow recovery tests.

## Non-goals

- No old journal migration.
- No fallback parser or fallback agent runner.
- No retry based on parsing errors.
- No changes to BeeGame Delivery snapshot versions.
- No project-specific values, platform-specific routing, keyword matching, or generated-project edits.

## Acceptance criteria

- Production code contains no `AgentRunner`, optional warning port, `agentRunner` fallback, stringified Workflow argument normalization, missing journal sequence fallback, optional dead reason, or `unknown` dead reason.
- Journal corruption cannot cause completed calls to execute again.
- One adapter registry is the only execution authority.
- Existing valid current-protocol journals resume deterministically.
- All scoped tests and static checks pass.
