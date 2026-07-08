# BeeGame Project Lifecycle Operations

Use this runbook for production generated-project storage under
`/srv/beegame/projects`.

## Storage Model

- Supabase stores durable product metadata: users, projects, sessions, previews,
  deployments, assets, audit events, credits, and runtime settings.
- The runtime host stores generated workspace files under
  `BEEGAME_WORKSPACE_ROOT`, normally `/srv/beegame/projects`.
- Uploaded project assets and published deployments may also live in Supabase
  Storage when the related bucket environment variables are configured.
- Do not store generated projects inside the source repository or container
  image filesystem.

## Quota

Set the per-user project quota on the runtime host:

```env
BEEGAME_MAX_PROJECTS_PER_USER=100
```

Rules:

- The default limit is 100 projects per user.
- New project creation is rejected with HTTP 429 after the user reaches the
  limit.
- Updating an existing project does not consume a new quota slot.
- Set `BEEGAME_MAX_PROJECTS_PER_USER=0` only for a deliberate unlimited
  environment.

## Backup

Back up both Supabase metadata and runtime workspace files. A workspace-only
backup is not enough to reconstruct dashboard history, credit state, or public
deployment records.

Recommended schedule:

- Supabase database: use Supabase scheduled backups or point-in-time recovery.
- Supabase Storage: enable bucket-level backup/export according to the hosting
  plan.
- Runtime workspace: take at least daily snapshots of `/srv/beegame/projects`.

Example workspace snapshot:

```bash
sudo mkdir -p /srv/beegame/backups
sudo tar -C /srv/beegame -czf \
  /srv/beegame/backups/projects-$(date -u +%Y%m%dT%H%M%SZ).tar.gz \
  projects
```

For large installations, prefer filesystem or volume snapshots over long
running archive jobs.

## Restore

Restore metadata and files as a matched pair from the same recovery point.

Order:

1. Stop the runtime host so no generation writes occur during restore.
2. Restore Supabase database and Storage to the selected recovery point.
3. Restore `/srv/beegame/projects` from the matching workspace snapshot.
4. Start the runtime host.
5. Run a smoke check: sign in, open project history, open a recent preview or
   deployment, create a small project, restart the stack, and confirm history
   remains.

Example workspace restore:

```bash
sudo systemctl stop beegame-runtime
sudo rm -rf /srv/beegame/projects
sudo tar -C /srv/beegame -xzf /srv/beegame/backups/projects-YYYYMMDDTHHMMSSZ.tar.gz
sudo systemctl start beegame-runtime
```

If BeeGame is running through Docker Compose, stop and start the compose stack
instead of using `systemctl`.

## Deletion

Project deletion removes project metadata and safely removes the generated local
workspace directory when the saved project root is inside the dashboard data
root. The safe-delete guard refuses to delete the data root itself or paths
outside that root.

After deleting a project, verify:

- The project no longer appears in project history.
- The generated local workspace directory is gone when it was managed by
  BeeGame.
- Manually bound external directories remain untouched.
- Supabase Storage asset and deployment object prefixes are removed for
  Supabase-backed projects.

## Retention

Recommended starting policy:

- Active projects: retain while the user account is active and under quota.
- Deleted projects: remove local workspace files immediately.
- Deployment artifacts: retain the latest successful deployment and the last 5
  rollback candidates per project.
- Preview artifacts and logs: retain for 14 days.
- Runtime transcripts and project logs: retain for 30 days after the project is
  deleted, unless the account deletion policy requires immediate removal.
- Backups: retain daily backups for 14 days, weekly backups for 8 weeks, and
  monthly backups for 12 months.

Retention jobs must be owner/project scoped and must not rely on game titles,
prompt text, or platform-specific keywords.

## Manual Retention Runs

BeeGame includes an operator-triggered retention path under
Settings > Platform > Project.

Use it in this order:

1. Run `Retention dry run`.
2. Review the planned deployment record deletion count.
3. Run `Run retention` only after the dry-run output looks correct.
4. Re-open the project lifecycle view and confirm the last retention run appears.

The current retention implementation:

- keeps the latest successful deployment plus the last 5 rollback candidates per
  project/session group;
- removes older local deployment records and their local deployment artifact
  directories when they are inside BeeGame's deployment data root;
- records real runs as `project.retention_run` audit events;
- reports preview and log retention as skipped until those resources have a
  persisted index that can be cleaned without guessing.

You can also test through the HTTP API:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "$BEEGAME_URL/api/admin/projects/retention/plan"

curl -X POST -H "Authorization: Bearer $TOKEN" \
  "$BEEGAME_URL/api/admin/projects/retention/run"
```

Both endpoints require an account with `audit.read`.

## Current Gaps

- Retention runs are operator-triggered, not scheduled. A future scheduler can
  call the same retention service after production dry-run behavior is trusted.
- Preview and log cleanup need a persisted index before automated deletion is
  enabled.
- Server backup directories are intentionally not deleted by BeeGame runtime
  retention.
