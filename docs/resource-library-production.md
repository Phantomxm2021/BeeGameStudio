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
