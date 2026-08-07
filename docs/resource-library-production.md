# Resource library production checklist

The resource library is administered through the resource service. Project
workflows consume only the service's selection API; they never receive
Supabase service-role credentials or direct Storage permissions.

## Apply database changes

For a fresh Supabase project, apply `docs/beegame-supabase-schema.sql`; it is
the canonical full Resource Library metadata schema, including Pack ownership,
RLS, R2 object identities, binding constraints and the server-only audit table.
For an existing project, apply the ordered files in `supabase/migrations/`
with `supabase db push --linked --yes`. That directory is the only incremental
migration source. Do not run an older standalone processing-job SQL script.

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
BEEGAME_CONFIG_ENCRYPTION_KEY=<same-key-used-by-the-Workflow-service>
BEEGAME_RESOURCE_SERVICE_TOKEN=<random-server-to-server-secret>
# The semantic curator reuses the model configuration selected in Workflow
# Settings. It does not have a second provider URL, token, or model setting.
BEEGAME_RUNTIME_SERVER_URL=http://beegame-runtime:62174
BEEGAME_RESOURCE_SEMANTIC_CURATOR_REVISION=semantic-curator-v1
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
2. Upload or re-inspect a file. Confirm technical facts and dependency bindings
   come from the inspector, while searchable usage tags are written to the
   element only after a confirmed curation decision. Pack and folder semantic
   defaults do not exist in the active schema or API. Use the single curation
   workbench for any pending batch; suggestions are not searchable.
3. Publish a ready Pack and call the Agent catalog API. Confirm an unrelated
   invalid element does not hide a valid root, a root with an unavailable
   dependency is excluded, and a multi-file requirement returns one bounded
   bundle with exact element identities.
4. Start a new project that prefers Resource Library usage. Confirm the Agent
   imports useful independent resources from the returned bundle, creates
   standalone provisional files only for a service-proven `no-match`, and
   records all of them in the v8 `assets/asset-manifest.json` inventory.
5. Confirm the Agent writes non-overlapping JSON resource mappings and YAML
   world/scene descriptions, and the resource-content gate validates every
   requirement and resource reference before implementation.
6. Repeat steps 1–4 as a non-administrator and a different Pack owner; RLS and
   service-layer ownership checks must reject unauthorized mutations.

## Development cutover evidence

On 2026-08-06 the configured development database was migrated to the
canonical `semantic_suggestion` column and the existing Resource Library was
reinspected through the durable processing-job path. The run covered 2,955
elements across 25 Packs. The final read-only ledger check found 2,955 unique
elements with successful processing records and no queued or running items.
One transient R2 certificate-verification failure was retained in the original
job history and succeeded on a targeted durable retry; it was not recorded as
a false success. A real catalog match against a published element returned a
matched bundle with one candidate and no diagnostics. The curation audit still
reports 798 ready elements without confirmed semantic usage tags (654 in
published Packs and 144 in the archived Pack); these remain in the one
batch-confirmation workbench and were deliberately not guessed from filenames
or categories. New-project end-to-end acceptance remains a separate check and
has not been marked complete.

## Operational notes

- Pack contents are global, immutable inputs for AI selection once published;
  authoring is restricted by Pack ownership and platform-owner policy.
- Element selection readiness is evaluated per logical root and its dependency
  closure. Pack publication metadata remains a lifecycle gate, but an
  unrelated invalid root cannot suppress a valid root from matching.
- Matching returns only `matched` bundles or `no-match` plus structured
  diagnostics. Workflow must select one returned bundle; it must not rebuild
  candidates, paginate the catalog, or create a second discovery path.
- The curation queue is temporary review state on the canonical element row.
  Confirmation writes element-owned usage tags with `usage_tags_mode =
  override` and clears the suggestion in one batch; rejection clears it without
  changing confirmed metadata. Pack/folder semantic defaults are removed, so
  unclassified elements have no effective usage tags and never enter matching.
- The browser upload queue persists resumable task metadata locally. A refresh
  requires the user to resume the task, rather than silently uploading files.
- Storage reconciliation is evaluated during the publish gate. Missing objects
  block publication and unreferenced objects are reported as warnings for an
  explicit administrator cleanup workflow.
