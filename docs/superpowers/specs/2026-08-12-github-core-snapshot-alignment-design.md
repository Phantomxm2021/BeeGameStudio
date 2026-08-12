# GitHub Core Snapshot Alignment Design

## Objective

Restore the Bee Game Studio shared runtime core to a known-good upstream state and prevent Bee Game Studio business behavior from silently modifying that core again.

The authority is the `claude-code-best/claude-code` GitHub repository at pinned commit:

```text
3bb6b5746238c418138eb96d57765d79012edd96
```

After the explicitly allowed branding transform, every synchronized core file must be byte-for-byte equivalent to that pinned snapshot.

## Decision

Use a pinned snapshot replacement, not a manual merge and not another series of local bug fixes.

The alternatives were rejected for these reasons:

1. **Continue repairing individual defects:** rejected because local core changes interact, previous fixes have repeatedly reintroduced older failures, and the current core already contains duplicate declarations that fail TypeScript compilation.
2. **Overwrite the entire Bee Game Studio repository:** rejected because it would delete Bee Game Studio applications, workflow services, project storage, and product-specific packages that do not belong to the upstream core.
3. **Synchronize the shared core and adapt Bee Game Studio outside it:** selected because it establishes one runtime authority while preserving Bee Game Studio as a separate product and orchestration layer.

## Synchronized Core Boundary

The following trees are governed by the pinned upstream snapshot:

- `src/`;
- every package that also exists in the pinned upstream `packages/` directory:
  - `packages/@ant`;
  - `packages/acp-link`;
  - `packages/agent-tools`;
  - `packages/audio-capture-napi`;
  - `packages/builtin-tools`;
  - `packages/cloud-artifacts`;
  - `packages/color-diff-napi`;
  - `packages/image-processor-napi`;
  - `packages/mcp-client`;
  - `packages/modifiers-napi`;
  - `packages/remote-control-server`;
  - `packages/url-handler-napi`;
  - `packages/weixin`;
  - `packages/workflow-engine`;
- shared root source, build, test, and script files that exist in both repositories, except where Bee Game Studio workspace composition requires a root integration wrapper.

Within these paths, upstream additions are added, upstream deletions are deleted, and locally added core files are deleted unless they are an allowed branding-only file.

## Bee Game Studio Boundary

The following product-owned areas are not overwritten by the upstream snapshot:

- `apps/frontend`;
- `packages/agent-workflow`;
- `packages/agent-workflow-server`;
- all `packages/beegame-*` packages;
- Bee Game Studio database migrations, product documentation, evidence, and project data;
- root workspace composition needed to include Bee Game Studio-only packages and applications.

These areas may depend on public upstream core APIs. If synchronization breaks a Bee Game Studio caller, compatibility is implemented in the Bee Game Studio-owned caller or a Bee Game Studio adapter. The synchronized core is not patched to preserve the old caller.

## Only Allowed Core Differences

The branding transform is intentionally narrow and deterministic. It may change only:

- the displayed product name;
- package publication names and import namespace where the local monorepo requires `@bee-game-studio/*`;
- copyright owner text;
- product repository or documentation links whose only purpose is product identity;
- CLI executable/product identifiers where required to publish Bee Game Studio.
- the upstream configuration-directory environment key, mechanically renamed from
  `CLAUDE_CONFIG_DIR` to the single product key `BEEGAME_CONFIG_DIR`.

The following are behavioral differences and are therefore forbidden inside synchronized core, even if their names contain `BEEGAME`:

- provider or model selection environment overrides;
- configuration-directory discovery behavior, fallback behavior, or an additional
  compatibility key beyond the exact `CLAUDE_CONFIG_DIR` to `BEEGAME_CONFIG_DIR`
  lexical substitution;
- injected skills, prompts, system context, or native tool changes;
- context-collapse or token-management policy;
- session identity, cache-key, storage, retry, watchdog, stream, or terminal semantics;
- permission, network, security, endpoint, or sandbox policy;
- workflow validation or delivery rules;
- special handling added for Bee Game Studio workers.

Required product policy must live at the Bee Game Studio boundary and be passed through documented upstream interfaces. It must not be hidden in shared runtime internals.

## Root Manifest and Dependency Handling

The upstream root manifest cannot be copied blindly because Bee Game Studio adds workspaces and product packages. Root integration is handled as follows:

1. preserve Bee Game Studio-only workspace entries and product scripts;
2. align versions, resolutions, compiler options, and scripts used by synchronized core with the pinned upstream snapshot;
3. remove local core-only dependencies that exist solely to support forbidden core behavior;
4. keep Bee Game Studio-only dependencies scoped to Bee Game Studio-owned packages whenever possible;
5. fail the core-equivalence check if a root exception changes synchronized runtime behavior rather than workspace composition.

Every root exception must be listed in the alignment manifest with a reason.

## Alignment Manifest and Guard

The repository will contain one machine-readable alignment manifest recording:

- upstream repository URL;
- pinned upstream commit;
- synchronized paths;
- excluded Bee Game Studio paths;
- exact branding substitutions;
- justified root integration exceptions.

A deterministic audit command will compare the local synchronized paths with the pinned upstream snapshot after applying the branding normalization. It must fail on:

- modified file content;
- missing upstream files;
- local-only files inside synchronized paths;
- unexpected branding substitutions;
- changes to the pinned upstream commit without an explicit manifest update.

The acceptable normalized result is zero differences. This guard runs in local verification and CI.

## Migration Sequence

The implementation is separated into reviewable commits:

1. add the alignment manifest, synchronization/audit tooling, and tests for allowed branding normalization;
2. replace synchronized core paths from the pinned snapshot, including additions and deletions;
3. reconcile root build and dependency integration without changing synchronized behavior;
4. repair Bee Game Studio-owned callers and adapters outside the core;
5. remove obsolete Bee Game Studio core hooks and dependencies;
6. run offline verification, then fixed-port service and controlled Chrome acceptance.

No commit may mix unreviewed Bee Game Studio feature work into the snapshot synchronization.

## Verification

### Static authority checks

- normalized core diff against the pinned snapshot is empty;
- all local-only files under synchronized paths are absent;
- the alignment manifest contains no broad or behavior-based exception;
- no Bee Game Studio environment variable or project-config loader remains in synchronized core, except a mechanically renamed upstream product identifier explicitly listed in the manifest.
- synchronized core and Bee Game Studio launch code use only
  `BEEGAME_CONFIG_DIR`; `CLAUDE_CONFIG_DIR` is neither emitted nor accepted as a
  fallback.

### Offline build and tests

- install/lockfile consistency succeeds;
- TypeScript compilation succeeds with no duplicate declarations;
- upstream shared-core test suites pass;
- Bee Game Studio package and application tests pass;
- formatting and `git diff --check` pass.

### Runtime boundary verification

- the user-selected provider/model settings remain authoritative;
- direct runtime and Bee Game Studio launches have the same core tool, thinking, provider-stream, and completion semantics;
- Bee Game Studio adds only business prompt/context, working directory, correlation metadata, and workflow scheduling through public interfaces;
- API and provider errors are preserved and exposed rather than replaced by synthetic timeout guesses.

### Product acceptance

Only after offline verification is green:

- start all services on the fixed Bee Game Studio ports;
- use controlled Chrome to create a new project from an ordinary idea that is not embedded in code or fixtures;
- verify progressive native file writes and normal completion;
- verify the complete document workflow, persisted artifacts, token usage, elapsed time, and document quality;
- compare the observed boundary with a direct runtime launch when diagnosing any remaining failure.

## Completion Criteria

- The synchronized core has zero non-branding differences from pinned upstream commit `3bb6b5746238c418138eb96d57765d79012edd96`.
- Bee Game Studio business packages compile and operate through upstream public interfaces without patching synchronized core.
- A CI guard prevents future silent core modifications.
- Fixed-port Chrome acceptance completes the Idea-to-document workflow and verifies that documents are persisted and usable.
- Any remaining limitation is outside the shared core and is identified with direct runtime versus Bee Game Studio evidence.
