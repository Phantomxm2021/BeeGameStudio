<!-- Adapted from omer-metin/skills-for-antigravity, revision e8dcf4e8737921a10088bd5c9eb65e81f74c051f. Changed for task-scoped use: removed mandatory branch/commit policies, regex gates and automatic destructive remedies. See ../LICENSE.txt and ../SKILL.md. -->

# Inspect the intended Git result

Use the checks that answer the requested Git operation. These are observations,
not regex-enforced policies, automatic fixes or a new review stage.

## Before a requested commit

```bash
git status --short --branch
git diff --stat
git diff --cached --stat
git diff --cached
git diff --cached --check
```

The working-tree diff and staged diff describe different inputs. Verify that
the index contains the intended change and preserves unrelated work. Existing
project checks can establish affected behavior; Git diff checks establish
neither gameplay correctness nor visual quality. Follow the repository's
message convention instead of a universal message-length rule.

## After an integration or recovery

Inspect the resulting commit/ref and affected diff. For a conflict resolution,
`git ls-files -u` identifies remaining unmerged entries; a clean index alone
does not establish that both sides' required behavior survived. Read the
resolved source and run the relevant existing checks when applicable.

A recovered commit should be reachable through the intended ref, and current
unrelated working changes should remain intact. A read-only diagnosis should
not be reported as a completed recovery operation.

## Before an authorized remote update

Check the destination remote/ref and the commits to be sent. Remote-tracking
refs can be stale; a successful local commit does not prove a successful push.
Inspect the actual push result and report a rejection or unknown outcome
without silently changing the operation to a force update. Do not print remote
URLs containing credentials or repository configuration containing secrets.

Source: [upstream git-workflow](https://github.com/omer-metin/skills-for-antigravity/tree/e8dcf4e8737921a10088bd5c9eb65e81f74c051f/skills/git-workflow).
