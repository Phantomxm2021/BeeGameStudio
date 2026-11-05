<!-- Adapted from omer-metin/skills-for-antigravity, revision e8dcf4e8737921a10088bd5c9eb65e81f74c051f. Changed for task-scoped use: removed mandatory branch/commit policies, regex gates and automatic destructive remedies. See ../LICENSE.txt and ../SKILL.md. -->

# Conflicts and recovery

## An operation is already in progress

Use `git status` to identify whether this is a merge, rebase, cherry-pick or
revert, and which paths remain unmerged. Do not start another integration or
reset the tree simply because a command failed.

For a conflicted path, inspect the base and both sides where available:

```bash
git ls-files -u -- <path>
git show :1:<path>
git show :2:<path>
git show :3:<path>
```

The meaning of ours/theirs depends on the operation, especially during rebase.
Resolve the intended combined behavior rather than blindly choosing a side or
using a global `-X theirs` remedy. Removing markers alone does not establish a
correct resolution. Stage the resolved path and use the matching operation's
`--continue`; abort only when abandoning that operation is the intended result
and any work done since its start has been accounted for.

## Recovering a commit

`git reflog` records local reference movements. A commit that lost its branch
name may still be reachable through a reflog entry. Inspect the candidate
before changing the current checkout:

```bash
git reflog -n 30
git show --stat <candidate-commit>
git show <candidate-commit>:<path>
```

When recovery is requested, retaining the candidate with a new branch can
preserve it without replacing current working files. Reflog expiry and garbage
collection depend on configuration and reachability; it is not a permanent
backup and cannot reconstruct arbitrary edits never stored as Git objects.

Detached HEAD allows inspection and commits without a branch pointer. Before
leaving work that should be kept, retain its commit with an appropriate ref.
There is no need to create a branch merely to inspect an old revision.

## Reset and stash change different states

`reset --soft` moves HEAD; mixed reset also resets the index; hard reset also
replaces tracked working-tree content and can remove obstructing untracked
paths. None is a generic recovery instruction for an unexplained failure.
`git restore -- <path>` also discards working changes for that path.

Stash changes the working tree/index and is not read-only inspection. The
ordinary form does not include untracked files; `-u` includes them, and `-a`
also includes ignored files. Inspect a stash with `git stash show -p <stash>`.
`apply` keeps the stash; `pop` drops it only when application succeeds. Applying
or popping can conflict. Do not stash all shared work or clear stashes merely
to make a later command run.

## Ignore rules and submodules

`.gitignore` does not stop tracking a file already in the index. `git check-ignore
-v -- <path>` diagnoses applicable ignore rules for untracked files;
`git ls-files -- <path>` establishes whether it is tracked. Removing an index
entry with `git rm --cached` is a repository change and does not erase old
history or revoke an exposed credential.

A submodule is a separate repository; the parent records its commit ID. Inspect
both its working state and the parent's recorded pointer. Initialization of
recorded commits differs from `submodule update --remote`, which selects a new
remote-tracking revision. Do not upgrade every submodule to solve an empty
checkout or an unrelated conflict.

Source: [upstream git-workflow](https://github.com/omer-metin/skills-for-antigravity/tree/e8dcf4e8737921a10088bd5c9eb65e81f74c051f/skills/git-workflow).
