# Resource library production checklist

The resource library is administered through the resource service. Project
workflows consume only the service's selection API; they never receive
Supabase service-role credentials or direct Storage permissions.

## Apply database changes

Apply these migrations to the target Supabase project, in order:

1. `docs/beegame-supabase-schema.sql`
2. `docs/beegame-resource-pack-primary-category-migration.sql`
3. `docs/beegame-resource-authoring-migration.sql`
4. `docs/beegame-resource-metadata-migration.sql`
5. `docs/beegame-resource-ownership-rls-migration.sql`
6. `docs/beegame-resource-governance-migration.sql`

For an existing database that was created before the R2 storage foundation,
also apply:

7. `docs/beegame-storage-r2-foundation-migration.sql`
8. `docs/beegame-storage-r2-rls-hardening-migration.sql`

The latest `beegame-supabase-schema.sql` already contains the foundation for a
new installation. The hardening migration is intentionally separate so an
existing installation can replace the earlier broad insert/update policies.

The ownership and governance migrations create Pack ownership, RLS policies,
and the server-only audit table. Do not expose the Supabase service-role key to
the browser or workflow runtime.

## Configure services

The resource service needs its Supabase configuration and the shared selection
token:

```text
BEEGAME_SUPABASE_URL=https://<project>.supabase.co
BEEGAME_SUPABASE_SERVICE_ROLE_KEY=<server-only-secret>
BEEGAME_RESOURCE_SERVICE_TOKEN=<random-server-to-server-secret>
```

To opt new Pack files into R2, add the server-only R2 variables documented in
`.env.example` and set `BEEGAME_PROJECT_STORAGE_PROVIDER=r2`. Existing Pack
rows remain readable from Supabase Storage until they are migrated.

Preview the legacy Resource Library migration before making changes:

```bash
bun run r2:migrate:resources
```

After reviewing the list, apply the copy-and-cutover pass:

```bash
bun run r2:migrate:resources --apply
```

The command verifies each R2 object before updating the Pack or element row;
it does not delete the Supabase source object. Run `bun run r2:reconcile`
periodically, and add `--apply` only when invalid R2 metadata should be marked
failed.

Resource objects share one private Bucket but are physically partitioned as
`packs/{packId}/objects/{storageObjectId}/payload`. Pack folders and filenames
remain in `logical_path`; renaming an authoring folder does not copy R2 data.
Installations that previously wrote flat `objects/{storageObjectId}/payload`
keys can preview and apply the verified rekey pass with:

```bash
bun run r2:rekey:resources
bun run r2:rekey:resources --apply
```

Both migration commands are resumable and leave incomplete work in the next
plan. Reconciliation reads every Supabase REST page, supports bounded request
timeouts, and can restore a missing migrated object from its checksum-verified
Supabase source without deleting that source:

```bash
bun run r2:reconcile --deep-limit=100 --request-timeout-ms=60000
bun run r2:reconcile --repair-missing --deep-limit=100 --request-timeout-ms=60000
```

The workflow service must use the resource service URL and the *same* selection
token:

```text
BEEGAME_RESOURCE_SERVER_URL=https://resource.<your-domain>
BEEGAME_RESOURCE_SERVICE_TOKEN=<same-random-server-to-server-secret>
```

In production, the workflow server intentionally fails startup if either of its
resource-selection variables is missing or if only one is set. This prevents
an Agent from producing a project that cannot select and integrate approved
assets.

## Acceptance checks

1. Sign in as an authorized resource administrator and create a draft Pack.
2. Upload a file, record source/license metadata, and confirm the publish gate
   blocks missing required artifacts.
3. Publish a ready Pack and request a project asset candidate through the
   workflow API. The response must contain a signed element URL, Pack version,
   and selection reasons.
4. Bind and integrate a `filesystem` asset. Confirm the project's
   `assets/asset-manifest.json` records the Pack, element, fixed version,
   selection reason, and `integrated` status.
5. Archive a referenced Pack. Confirm the impact dialog lists affected project
   bindings and that already copied project assets remain unchanged.
6. Repeat steps 1–4 as a non-administrator and a different Pack owner; RLS and
   service-layer ownership checks must reject unauthorized mutations.

## Operational notes

- Pack contents are global, immutable inputs for AI selection once published;
  authoring is restricted by Pack ownership and platform-owner policy.
- The browser upload queue persists resumable task metadata locally. A refresh
  requires the user to resume the task, rather than silently uploading files.
- Storage reconciliation is evaluated during the publish gate. Missing objects
  block publication and unreferenced objects are reported as warnings for an
  explicit administrator cleanup workflow.
