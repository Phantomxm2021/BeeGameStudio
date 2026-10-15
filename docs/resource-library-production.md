# Resource library production checklist

The resource library is administered through the resource service. Project
workflows browse its catalog and fetch selected files through the short-lived
resource bridge and `assets.mjs`; structured requirement matching is a separate
capability. Workflows never receive Supabase service-role credentials or direct
Storage permissions.

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

1. Use an authorized account and a published Pack. For discovery/download checks,
   use existing library data and an isolated temporary output directory; do not
   create a game project or start generation/semantic processing.
2. Browse Packs and elements with structured filters and returned cursors.
   Responses use `items`, `total`, `facets` and optional `nextCursor`.
   Confirm missing usage tags do not hide technically browsable files, while
   failed/hidden files, invalid hashes, unavailable dependencies and explicit
   `manual-only` exclusions remain blocked from catalog browsing. Check Pack
   totals, filtered results and element lists on the same data. The service
   derives these from the existing element-readiness check; the legacy SQL
   aggregate is not an authoritative availability count because it omits
   unresolved external-reference checks. This removes the summary shortcut,
   not the dependency check. Measure catalog latency against the current library
   before adding any replacement optimization.
3. Inspect the selected file's license and dependency metadata. Download through
   the actual bridge/CLI and verify its SHA-256 against the stored content hash;
   decode or preview it with existing tools. A single-file `fetch` does not fetch
   dependencies. For a multi-file resource, retrieve and verify the required
   files and their relative bindings before claiming the bundle is usable.
4. Keep semantic matching strict: an unclassified file may be browsed but is not
   a confirmed role match. AI visual curation is optional, separately authorized
   work, not a browsing prerequisite; it does not classify audio. Never fill tags
   merely to make a count or test pass.
5. Actual game reuse is a separate, user-authorized acceptance check. Record the
   source and selected files in the existing resource plan/Manifest, verify
   applicable saved Scene/UI bindings and observe the resource in its reachable
   game state. Download/decode success does not establish suitability, aesthetics
   or runtime consumption. Do not claim this check from an isolated download.
6. Use offline permission tests or separately authorized accounts to confirm
   unauthorized access/mutations are rejected. Do not weaken RLS, ownership or
   signing boundaries to make discovery succeed.

## Development cutover evidence

The current development cutover removes the obsolete semantic-suggestion
column. The durable AI processing job writes supported visual semantic decisions;
authorized manual element editing remains available.
Each successful visual decision is persisted directly to the element row;
failed items remain retryable and are never represented as a second pending
semantic state. New-project end-to-end acceptance remains a separate check and
has not been marked complete.

## Operational notes

- Pack contents are global, immutable inputs for AI selection once published;
  authoring is restricted by Pack ownership and platform-owner policy.
- Element selection readiness is evaluated per logical root and its dependency
  closure. Pack publication metadata remains a lifecycle gate, but an
  unrelated invalid root cannot suppress a valid root from matching.
- Catalog browsing and semantic matching answer different questions. Catalog
  `readyElementCount` counts technically browsable files, not confirmed matches.
  Missing tags remain empty; inspect or audition before assigning a game role.
  Matching returns `matched` bundles or `no-match` plus diagnostics. A no-match
  is not an empty-library claim, and an access failure is neither result.
  Browse relevant facets and paginate as needed, without downloading the whole
  catalog or starting another discovery framework.
- The curation queue is a read-only projection of ready elements without
  element-owned semantic tags. AI writes element-owned usage tags with
  `usage_tags_mode = override`; manual-only elements are excluded. Pack/folder
  semantic defaults are removed, so unclassified elements have no effective
  usage tags and never enter semantic matching, but can appear in the catalog
  when technical checks pass. Do not launch paid curation merely to browse them.
- Honor the user's chosen source. For common sounds, icons and environment
  resources, first consider suitable supplied/library files; for continuous
  motion, prefer a suitable complete animation. Consider AI for distinctive
  artwork when existing candidates do not fit. Focus web sourcing on a concrete
  gap and verify rights/formats; stop at a suitable candidate. These are choices,
  not a compulsory library/web/AI sequence. Keep actual source evidence and
  consequential rejection reasons in the existing resource plan. Judge success
  by usable integrated assets, quality, total cost and time, not query counts.
- The browser upload queue persists resumable task metadata locally. A refresh
  requires the user to resume the task, rather than silently uploading files.
- Storage reconciliation is evaluated during the publish gate. Missing objects
  block publication and unreferenced objects are reported as warnings for an
  explicit administrator cleanup workflow.
