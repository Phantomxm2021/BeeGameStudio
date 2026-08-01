# Resource library production checklist

The resource library is administered through the resource service. Project
workflows consume only the service's selection API; they never receive
Supabase service-role credentials or direct Storage permissions.

## Apply database changes

Apply `docs/beegame-supabase-schema.sql` to the target Supabase project. It is
the canonical Resource Library metadata schema, including Pack ownership, RLS,
R2 object identities, binding constraints and the server-only audit table.
Incremental Resource Library compatibility migrations are not part of the
development installation path.

The schema removes Resource Pack access policies from Supabase Storage. Before
using a development database with this build, discard Resource Library element
rows that do not have canonical R2 object identities. Do not expose the
Supabase service-role key to the browser or workflow runtime.

## Configure services

The resource service needs its Supabase configuration and the shared selection
token:

```text
BEEGAME_SUPABASE_URL=https://<project>.supabase.co
BEEGAME_SUPABASE_SERVICE_ROLE_KEY=<server-only-secret>
BEEGAME_RESOURCE_SERVICE_TOKEN=<random-server-to-server-secret>
```

Set `BEEGAME_PROJECT_STORAGE_PROVIDER=r2` and configure the server-only R2
variables documented in `.env.example`. The resource service refuses to start
with Supabase metadata configured unless the R2 provider is available.

Resource objects share one private Bucket but are physically partitioned as
`packs/{packId}/objects/{storageObjectId}/payload`. Pack folders and filenames
remain in `logical_path`; renaming an authoring folder does not copy R2 data.
Reconciliation reads every metadata page and verifies only the canonical R2
object. It never restores a Resource Library file from another backend:

```bash
bun run r2:reconcile --deep-limit=100 --request-timeout-ms=60000
bun run r2:reconcile --apply --deep-limit=100 --request-timeout-ms=60000
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
3. Publish a ready Pack and browse it through the Agent catalog API. Resolve an
   exact observed element and verify that the response contains an R2 URL,
   Pack version and dependency closure.
4. Start a new project that prefers Resource Library usage. Confirm the Agent
   browses the catalog, imports useful independent resources, creates any
   required standalone provisional files, and records all of them in the v7
   `assets/asset-manifest.json` inventory.
5. Confirm the Agent writes non-overlapping JSON resource mappings and YAML
   scene/event descriptions, and the resource-content gate validates every
   requirement and resource reference before implementation.
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
