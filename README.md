# BeeGameStudio

BeeGameStudio (BGS) is a game creation application with editable Scene/UI content, a resource library, previews, verification and publishing. Its coding agent runs through the BGS runtime, based on upstream **Codex app-server**. The embedded Claude Code fork is no longer part of the application.

## Development

Requirements: Bun 1.3+, Node.js/npm, Rust (version pinned by the source), and an OS that enforces the runtime permission profiles.

The coding runtime is maintained in `vendor/bgs` from
`Phantomxm2021/codex`. The current upstream baseline is
`rust-v0.167.0`; the BGS branch is `bgs/0.167.0`. Internal protocol names remain
compatible, while product entry points use BGS branding.

```sh
git submodule update --init vendor/bgs
bun run bgs:build
bun run bgs:verify
bun run beegame:dev
```

The offline build requires cached Cargo dependencies (`cargo fetch --locked` from
`vendor/bgs/codex-rs` on the first connected setup). It packages the binary,
source provenance and original LICENSE/NOTICE in `dist/bgs-runtime`. This is the
default executable for agent, auth and sandbox operations. Missing builds fail;
there is no automatic fallback to the official npm executable. The existing
`BEEGAME_BGS_PATH` override and `bgs:build` alias remain compatible.

See [the BGS runtime upgrade guide](docs/bgs-runtime-upgrades.md) for merging
upstream releases, retaining branding, local verification, Docker packaging and
rollback. Publish the submodule branch before committing its updated gitlink.

```sh
bun install
bun run typecheck
bun run build
```

Set the existing BGS service configuration in `.env.local`, including `AGENT_WORKFLOW_WORKSPACE_PATH` and the deployment's authentication, storage and billing settings. Keep credentials outside version control.

```sh
bun run beegame:dev
```

The launcher checks the packaged BGS executable instead of building a bundled agent CLI. Local ports remain frontend `62173`, runtime `62174`, billing `62175`, skills `62176`, and resources `62177`. The backend runs directly on Bun. The frontend build is in `apps/frontend/dist`.

## Model connections

Model connections support four explicit API protocols:

| Protocol | Connections |
| --- | --- |
| Responses | OpenAI and gateways implementing `/responses` |
| Chat Completions | OpenAI-compatible gateways, Grok and OpenCode Go |
| Anthropic Messages | Anthropic-compatible gateways and OpenCode Go |
| Gemini | Native Gemini `streamGenerateContent` |

Choose the actual protocol in Settings; model names never determine the wire format. Existing OpenAI-compatible records without `apiProtocol` keep their original Chat Completions behavior. New platform model forms default to Responses; personal BYOK uses its provider default unless an explicit protocol is selected. Programmatic `OPENAI_*` runtime environments without `BEEGAME_API_PROTOCOL` also default to Responses; set the protocol explicitly for gateways.

Bgs still owns the agent loop. A private per-turn adapter translates Responses requests to the other protocols, preserving tool results, images, reasoning signatures, cancellation and reported token/cache usage. Converted providers must support streaming, function tools and final usage. Unsupported responses fail explicitly, without retries or switching credentials. Native Bgs web search is disabled for converted providers; use the configured MCP tools. Bgs chooses optional tools from its model metadata; arbitrary third-party model IDs may not advertise `apply_patch`. Native shell-based file editing is verified with the actual Bgs process, while custom-tool conversion is covered separately. Protocol compatibility does not guarantee equivalent model capabilities or live gateway availability. For missing or null generation output budgets, all four bridge protocols use the selected service's advertised model output limit when available, preserving explicit request values. Metadata is read lazily through the same approved transport and reused within that connection; missing limits keep the existing provider behavior and appear in the existing request diagnostics. This does not change reasoning effort, compaction or ChatGPT subscription transport, and a sent budget does not prove a remote gateway enforced it.

Tool names in Bgs's default `functions` namespace retain their original spelling when the protocol permits it, keeping Skill references consistent with the advertised tools. Other namespaces and long/unsupported names use a readable prefix plus a stable identity hash; collisions fail before making a provider request. Existing signed/private history is not renamed. An unknown provider tool name is rejected through Bgs's normal tool-error feedback path, using the reserved, unregistered `bgs_provider_errors` namespace. It never resolves to a guessed real tool. The provider's original call remains in private conversation history; only a safe classification is exposed to Bgs diagnostics. One-shot requests without tool definitions still fail on unsolicited tool calls. Broken streams and missing usage remain terminal `response.failed` events, with no automatic replay. Pre-stream HTTP failures retain the upstream status in a fixed diagnostic; transport failures are identified separately, without exposing upstream bodies. For Chat Completions, tool-returned images are attached after the complete consecutive tool-result block, preserving parallel call/result ordering.

Platform credentials and personal BYOK remain separate. New OpenAI-compatible and Grok connections default to Responses in both the administrator's model configuration and personal BYOK; OpenCode Go also defaults to Responses. An explicitly selected Chat Completions connection and saved legacy records keep their chosen protocol. Anthropic and Gemini retain their native protocols. OpenCode Go also offers Responses alongside Chat Completions and Anthropic, with model choices grouped by the registry's protocol metadata (`@ai-sdk/openai` for Responses). The selected protocol is preserved when saving, reopening or reactivating a connection; existing Go connections without a protocol keep their previous Chat Completions/Anthropic behavior. Go requests retain their configured subscription route and include BGS's user agent and a stable conversation ID, including native Responses and compaction requests. Responses input/history, tool events and usage remain native; no Chat Completions conversion or retry is inserted. Go keeps its encrypted personal connection. See the [OpenAI Responses streaming documentation](https://developers.openai.com/api/docs/guides/streaming-responses) and [OpenCode Go protocol and client requirements](https://opencode.ai/docs/go/). ChatGPT subscription login uses Bgs's device-code flow and an owner-private BGS home under `<user-data>/.runtime/app/bgs`; it never borrows the operator's personal login. Claude Code and Claude subscription login remain removed; Anthropic API support uses the same BGS runtime.

Before deploying the backend/resource service with Supabase, apply `supabase/migrations/20261020010000_model_api_protocol.sql`. It adds the nullable `api_protocol` column and updates the existing RLS-protected runtime RPC; legacy rows retain their provider defaults. Configure the deployment's outbound host allowlist for each selected provider. Go additionally needs `opencode.ai` and `models.dev` for its model catalog. Go inference calls carry BGS’s own User-Agent and a stable `X-Opencode-Session` identifier for the agent conversation or bounded model call. No production migration or paid-provider request is run by the source tests.

Also apply `supabase/migrations/20261020020000_model_request_usage.sql` before deploying the updated backend. Auxiliary model usage is billed per physical request; agent usage remains cumulative snapshots. This migration preserves existing ledger rows and balances; it does not reconcile historical underbilling.

Then apply `supabase/migrations/20261020030000_usage_wallet_initialization.sql`. First-use wallets are created in the debit transaction, amounts come from the recorded usage event, and image reservations reduce available credit. Failed direct debits roll back their usage registration. Back up the prior source and the target database's function definitions before migration; restoring the source alone does not restore database behavior. Existing ledger rows and balances are not rewritten.

Deploy the updated billing service before the runtime host. Remote billing now exposes the service-token-protected `/api/internal/usage/authorize` endpoint; an older or unavailable billing service blocks new model work rather than allowing unbilled requests. This endpoint requires no additional database migration.

Before deploying the resource server, apply [the resource folder rename migration](supabase/migrations/20261025010000_resource_folder_rename_transaction.sql) after the existing Resource authoring and R2 storage schema. Folder renames now update folder, element, and storage logical paths in one database transaction. A missing RPC fails explicitly; there is no fallback to separate writes. Physical R2 object keys are unchanged.

Before deploying the project-deletion fix, apply [the publication retention migration](supabase/migrations/20261101010000_preserve_published_games_on_project_delete.sql) after the Portal and R2 storage schema, then load the matching runtime. Do not delete projects while upgrading the database/runtime pair. Project deletion retains successful Portal-published versions, historical links and delivery files; unpublished deployments and development data are still removed. The new runtime refuses destructive cleanup if the retention RPC is missing or denies ownership. This migration does not recover previously deleted releases. Also apply [retained delivery authorization](supabase/migrations/20261103010000_retained_publication_delivery_authorization.sql): the delivery RPC must accept the deployment-scoped manifests created by retention. This fixes access to retained bytes without republishing; it cannot recover physically deleted objects.

## Adding an HTTP MCP server

Model/provider and remote MCP endpoints accept public HTTPS without a deployment domain allowlist. `BEEGAME_TRUSTED_DEVELOPMENT_PROXY_HOSTS` only identifies explicitly trusted local-development proxy mappings; it does not restrict public provider domains. The MCP policy rejects embedded credentials, private/local/metadata IPs and nonstandard ports (the existing 443/80 port policy), checks every DNS answer and pins the connection to the approved IP. Redirects remain disabled. If local DNS returns only proxy Fake-IP addresses in `198.18.0.0/15`, BGS obtains real IPv4 addresses through [Cloudflare DNS over HTTPS](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/), bootstrapped at `1.1.1.1` with TLS hostname verification, then applies the same public-IP checks. An unavailable or invalid fallback never permits the synthetic address. Other private DNS answers are rejected without fallback. Saving, imported configuration discovery, connection testing and the native MCP relay share this policy. Host-authorized bounded loopback discovery remains separate.

In Settings → MCP → Actions, choose **Add MCP (command)** and paste `bgs mcp add my-server --url https://example.com/mcp`, then review the parsed details and save. Choose **Add MCP (manual)** to enter the server fields directly. Names and URLs may be quoted, and `--url=...` is also accepted. The paste field also accepts `codex mcp add` commands copied from upstream documentation. It saves through BGS’s existing account-scoped MCP API and connection-test flow without running a shell. This differs from running the BGS CLI in a terminal, which writes to `$BGS_HOME/config.toml` (by default `~/.bgs/config.toml`); the dashboard passes account-scoped MCP settings to its private BGS runtime. Other CLI options (including authentication flags), stdio commands and shell expansions are not supported by this paste field; the existing manual form remains available.

## Runtime boundary

- BGS owns authorization, the current project writer, resource access, usage settlement and delivery evidence. Bgs owns its agent loop, context, tools and thread history.
- API-key model connections, including native Responses, use the host's outbound approval, pinned DNS and redirect restrictions. Native Responses retains its search, usage events and context compaction; ChatGPT login uses Bgs's fixed first-party transport.
- Host model streams use Undici's request stream with an explicit Web-stream adapter. Undici fetch stalls on live SSE under Bun 1.3.14; regressions cover delivery before EOF, compression and aborting pending reads without changing the approved dispatcher.
- Stdio MCP starts host processes outside the project command sandbox. Saving or testing stdio entries requires `workspace.manage`; auto-start checks the owner's current permission again, including for old entries. Users without this permission can remove an old stdio entry or contact the workspace owner.
- Streamable HTTP MCP uses an owner/session relay with runtime outbound approval, pinned DNS and no redirects. The relay preserves MCP sessions, streaming and cancellation. Remote MCP OAuth is not connected; authentication challenges fail explicitly rather than bypassing the relay. Legacy SSE endpoints cannot be added or tested; existing entries show an unsupported notice and must use a Streamable HTTP endpoint.
- Interrupted converted-provider streams retain acknowledged token counts. Incomplete or missing usage receipts are marked `providerUsageIncomplete` in the persisted usage events and billing metadata; unreported usage requires supplier reconciliation and is never estimated as a final receipt.
- Auxiliary model workers reconstruct pinned DNS from the approved addresses received over IPC. Their failures retain acknowledged usage through IPC and billing, including zero-token unknown receipts; fully reported usage is preserved even when BGS rejects the model result.
- Auxiliary usage shares the agent's durable settlement outbox. Failed registration/debits retain their request IDs for retry and restart recovery without calling the model again. Equal token counts from separate requests are billed separately.
- With remote billing, each auxiliary request (including repair calls) and agent turn first settles the owner's pending usage and checks available credit. Insufficient credit blocks subsequent model work while preserving already generated results. This is a positive-balance check, not a maximum-cost reservation; concurrently authorized work can still finish.
- Subscription account replacement/logout waits for agent turns, native process cleanup, auxiliary workers, image requests, token refresh and model catalog reads to finish. A UI stop alone does not release the credential guard. This coordination is scoped to one BGS host process; do not run separate hosts against the same owner credential directory.
- Shutdown rejects new HTTP work, drains admitted requests and detached intake jobs, then closes sessions and their settlement outbox. Direct session-manager starts and sends are also rejected once its disposal begins.
- `GET /api/admin/runtime-status` requires `lifecycle.admin` and returns read-only host activity counts, cleanup failures, pending usage settlement and unresolved writers in the configured workflow store. It stays readable during drain without counting itself as work. Missing observations are `unknown`; `idle` is a snapshot, not permission to restart. Check external resource-service jobs and independently launched processes separately; remote workflow counts can include other hosts.
- Auxiliary tasks use provider sampling defaults. Explicit API `temperature` values are validated and forwarded unchanged, including zero; provider rejection is surfaced without retries. The subscription transport rejects explicit temperature. Tasks do not force a common temperature across models because [reasoning-model support varies](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.4).
- Bgs runs with an explicit permission profile. Project files are writable; host configuration, other projects and protected design files are outside ordinary write access. Required OS sandbox support must be available; there is no unsandboxed fallback.
- `WriteProjectFile` and `EditProjectFile` route protected design/guide edits through BGS's current permission authority. The design lock cannot be bypassed with a shell or native patch tool. `AskUserQuestion` preserves the existing BGS question and authorization flow.
- User and bundled Skills are projected read-only into the user's private BGS home. Project instructions use `AGENTS.md`; the initial design method uses Bgs native Skill input rather than a legacy slash command. Skill selection alone does not establish application or game quality. Enabled, owner-bound MCP servers connect through Bgs; MCP credentials are passed over private stdio rather than command-line arguments.
- A completed agent turn is followed by background-terminal and process cleanup before BGS releases its writer. Interrupted or failed turns are not successful delivery evidence.
- Deterministic verification builds run the project's `build` script through `npm --prefix <isolated-copy> run build` in Bgs's network-disabled sandbox. The npm launcher itself works within that boundary. Some Bun bundler commands still inspect ancestor directories and fail under the strict filesystem profile; those builds remain unverified and never receive an unsandboxed retry. Node/Vite build paths and synthetic Bun script execution have been verified.

## Game creation and runtime

New complete-game requests first save a GDD with content, structure and depth
chosen for the assignment, then pass the existing review and repair contract.
The saved GDD hands off directly to ordinary native implementation. Visual
design, resources and verification are handled as needed within that task; a
concept atlas, separate resource stage or native Goal is not a prerequisite.
Explicit document/preparation assignments retain their existing scope and review logic.
The user controls pause and resume; saved historical preparation tasks retain
their stages and targets. Final delivery still requires
its existing acceptance evidence; a completed model turn is not acceptance.

User-facing runtime choices are React (custom Web), Unity, Godot and Unreal.
For new Web/React projects, the agent selects Phaser for 2D gameplay or Three.js
for 3D gameplay internally; these are not additional user choices. Existing
Web/Phaser and Web/Three.js projects retain their saved targets. Web code targets
use project code and assets rather than the BGS Scene/UI editing adapter.

## Existing projects and history

Project Git initialization maintains one marked BGS block at the beginning of
`.gitignore` and Git's local `info/exclude`. Custom rules stay intact after that
block, including negations. The shared `info/exclude` contains only common rules;
engine rules stay in each worktree's `.gitignore`. Bootstrap and cloning pass the confirmed engine;
starting a turn uses the current/recovered confirmed brief. React, Phaser, Three.js, Unity, Godot
and Unreal select small fixed rule lists; an absent/unknown engine gets only
common rules. Existing non-Git sessions remain non-Git. Repeated setup is a
no-op; changing the engine replaces owned rules instead of accumulating them.
The exact previous BGS template is migrated; edited legacy text stays custom.
Commits, configuration, staged changes and working files are not removed.

Common rules cover BGS transcripts, runtime caches and diagnostic records,
Node dependencies, local environment files and OS metadata. Engine rules cover
React/Phaser/Three.js output/Vite/TypeScript caches; Unity Library/Temp/obj/Logs/UserSettings;
Godot .godot/.import/.mono directories; and Unreal Intermediate/Saved/DerivedDataCache
and direct plugin Intermediate directories. Native caches are root-scoped.
Unreal Binaries and Build are deliberately retained: compiled distributions and
platform build inputs can be required. Custom export folders are not guessed.
Source, assets, reports, lockfiles, Unity .meta and package/project settings,
Godot .uid and individual .import files, and plugin binaries remain visible
unless the project's own rules exclude them. Already tracked files stay tracked.

Directory boundaries follow [Unity's project directories](https://docs.unity.com/en-us/engine/6000.7/manual/get-started/project-configuration/default-directories),
[Godot's version-control guidance](https://docs.godotengine.org/en/stable/tutorials/best_practices/version_control_systems.html)
and [Unreal's directory structure](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-directory-structure).
Godot export presets are retained as configuration; legacy Godot 3/4.0 projects
may store credentials there and need their own version-specific rule. BGS does
not infer engine versions or hide all resource/binary extensions.

Ignore rules prevent future indexing; they do not remove existing Git objects.
For a bloated repository, first identify its writer and inspect refs, index,
reflogs and object types. Temporary indexes used by external diff clients can
still write blobs into the original object database. Only prune unreachable
objects after writers are quiescent and recovery needs are checked; use a fixed
cutoff and inspect `git prune --dry-run --expire=<cutoff>` first. BGS does not
rewrite history or prune automatically. A repository without commits is not a
version-history backup.

Live session ingestion accepts only structured BGS `runtime_event` messages; provider usage arrives through the runtime accounting callback. The retired Claude SDK stream/result adapter and output-file polling projection are removed. BGS Chat transcripts and verification evidence remain readable. Bgs threads are marked explicitly in persisted runtime/workflow records. A legacy agent session is continued from existing project files and BGS handoff facts in a new Bgs context; its UUID is never treated as a Bgs resumable thread. No existing game artifacts, credentials or historical evidence are rewritten by this source migration.

Chat tools expand in place with BeUI ToolResult; full details and subagents remain available in a drawer. Complete tool output is retained separately from the short message summary, and native command progress carries only the new text chunk; the final receipt owns the complete result. Confirmed file edits with actual diff data use one FileDiff entry. Native diffs are projected from their structured field, including legacy Bgs file-change receipts that stored it in output; arbitrary shell output is not classified as a file change. Markdown code blocks and file reads use CodeBlock, preserving copied source and any known read-line gutter. Activity follows new output until the user scrolls up or starts inspecting an entry, and inspected results stay expanded when the turn ends. These are presentation changes, not project validation or edits to historical transcripts.

## Verification

`.github/workflows/backend-checks.yml` checks backend types and selected offline
regressions when backend, deployment, or database sources change. It runs the
billing SQL migrations against an isolated PGlite engine; it needs no service
credentials and makes no model calls. A separate Linux browser job checks the
Scene Editor. A macOS native job builds the pinned `vendor/bgs` source and runs
local protocol, sandbox, Skills, file-tool and subagent fixtures. It uses no model
credentials or paid provider calls; fixed loopback responses validate integration,
not autonomous Agent behavior. The source-built binary is cached by source commit,
build script, OS and architecture, so host-only changes do not rebuild Rust.

```sh
bun test packages/agent-workflow-server/src/bgs/runner.test.ts
```

The real-process integration tests use the pinned Bgs binary, local synthetic provider/MCP services and temporary synthetic files. They make no paid model calls:

```sh
BGS_SANDBOX_TESTS=1 bun test \
  packages/agent-workflow-server/src/bgs/integration.test.ts \
  packages/agent-workflow-server/src/model-providers/integration.test.ts \
  packages/agent-workflow-server/src/bgs/goals.native.test.ts \
  packages/agent-workflow-server/src/bgs/preferences.native.test.ts \
  packages/agent-workflow-server/src/bgs/skills.native.test.ts \
  packages/agent-workflow-server/src/bgs/project-file-tools.native.test.ts \
  packages/agent-workflow-server/src/bgs/short-context.native.test.ts
```

Run these with Bun 1.4.3 on a macOS host that permits nested sandbox setup and process inspection.
The legacy-home migration test still needs an explicit legacy binary and is not part of CI. They check real protocol behavior and file isolation; they do not establish game quality, live subscription availability, or production Linux/Windows behavior.

The billing migration regressions execute the actual SQL functions in an isolated in-memory PostgreSQL engine. Install `@electric-sql/pglite@0.5.10` outside this repository and set `BGS_PGLITE_MODULE` to its absolute module path when running `bun test packages/beegame-billing-server/src/__tests__`. Without that variable, SQL checks are skipped locally; backend CI enables them. No production database is contacted.

The broad pre-existing BGS workflow/API suites are not fully green. Selected failures were reproduced in the original checkout; a strict-sandbox Bun HTML bundling limitation also remains. This migration is not a claim of full workflow acceptance.

Historical architecture notes and `docs/verification` retain their original evidence and may describe the previous runtime. They are not the current integration contract. See the [official app-server protocol](https://learn.chatgpt.com/docs/app-server) and [permission profiles](https://learn.chatgpt.com/docs/permissions).

## Notices

BGS is developed by PhantomLab. Retained source and dependencies keep their applicable copyright and license notices; see [NOTICE.md](NOTICE.md). The upstream Codex package is Apache-2.0 licensed. This does not declare a new license for the entire BGS repository.


Project Chat has one event-body store: `.beegame/chat/project-events.jsonl`. Session recovery, status queries, SSE and paged history all read it; no per-session `transcripts/` files or mirrored event journal are created. Event IDs increase across the project, while host recovery filters facts by session. There is no old-directory fallback or automatic log migration. `logs/index.json` only locates sessions, and bounded transport diagnostics remain separate.

History indexes retain byte offsets and small routing metadata. A cold index scans the canonical file in 256 KiB chunks; later reads scan appended bytes only and materialize the selected page. Display reads limit full record bodies to 4 MiB and total full bodies per page to 8 MiB, with explicit omission markers for oversized details; authoritative permission/usage reads fail on an oversized required record rather than treating an omission as evidence. A torn final record blocks resumed appends without rewriting the source. HTTP event batches are capped at 500 rows; transcript endpoints expose cursors instead of loading all bodies before paging. The old duplicate log files are neither read nor automatically deleted.
