<!-- Adapted from omer-metin/skills-for-antigravity, revision e8dcf4e8737921a10088bd5c9eb65e81f74c051f. Changed for task-scoped use: removed mandatory branch/commit policies, regex gates and automatic destructive remedies. See ../LICENSE.txt and ../SKILL.md. -->

# Branching, commits and integration

## Choose the history operation

Follow the repository's existing collaboration model. Trunk-based development,
GitHub Flow and release branches serve different integration/release needs;
none is a reason to create a new workflow for an ordinary local code change.
A branch name can follow an existing ticket/type convention without inventing
one or requiring a ticket before work can proceed.

| Intended result | Operation and consequence |
|---|---|
| Integrate both histories without rewriting existing commits | Merge; a fast-forward may simply advance the branch pointer |
| Replay a private/local series onto another base | Rebase; replayed commits receive new identities |
| Apply a particular existing change to another line | Cherry-pick; it creates a new commit and can conflict with later integration |
| Undo a published change while retaining its history | Revert; it records the inverse as a new commit |
| Change local branch/index/worktree state | Reset; select its mode only after identifying which state should change |

Inspect divergence before choosing:

```bash
git status --short --branch
git log --oneline --graph --decorate -n 20
git log --left-right --oneline HEAD...<target-ref>
```

Fetching changes local remote-tracking refs but does not merge them into the
current branch. `pull` also integrates, according to its options/configuration;
it is not a substitute for understanding a divergence. Do not assume the base
branch is named `main` or that `origin` is the intended remote.

## Stage and commit the requested change

Review both the working-tree diff and the index. A pre-existing staged change
will enter the next commit unless deliberately excluded. Stage intended paths
or hunks rather than all repository changes. `git add -p -- <path>` can select
hunks; `git restore --staged -- <path>` changes the index while keeping working
files, but can also undo someone else's deliberate staging.

A useful commit describes the concrete change and reason. Use Conventional
Commits when the project already uses its tooling/conventions; its type/scope
format and commit frequency are not universal requirements. A coherent commit
need not split one dependent fix into several temporarily broken commits.

Amend and interactive rebase replace commit identities. Use them when that
history edit is actually requested and compatible with ownership, not as an
automatic polishing step. Published/shared history has downstream consumers;
a new correction commit can preserve those identities.

## Remote updates

A normal push can be rejected when the target has diverged. Inspect the target
and local history rather than automatically changing to force push. If an
explicitly authorized history rewrite is appropriate, `--force-with-lease` can
check the expected remote value; it does not grant permission or prove that
nobody depends on the old history. An explicit expected old object ID makes
that condition clearer than relying on a tracking ref that background fetches
may update. Confirm the actual source ref, destination ref and remote.

Source: [upstream git-workflow](https://github.com/omer-metin/skills-for-antigravity/tree/e8dcf4e8737921a10088bd5c9eb65e81f74c051f/skills/git-workflow).
