# BeeGameStudio

BeeGameStudio (BGS) is a game creation application with editable Scene/UI content, a resource library, previews, verification and publishing. Its coding agent runs through the BGS runtime, based on upstream **BGS app-server**. The embedded Claude Code fork is no longer part of the application.

## Development

Requirements: Bun 1.3+, Node.js/npm, Rust (version pinned by the source), and an OS that enforces the runtime permission profiles.

The coding runtime is maintained in `vendor/bgs` from
`Phantomxm2021/codex`. The current upstream baseline is
`rust-v0.164.0`; the BGS branch is `bgs/0.164.0`. Internal protocol names remain
compatible, while product entry points use BGS branding.

```sh
git submodule update --init vendor/bgs
bun run bgs:build
bun run bgs:verify
bun run beegame:dev
```

The offline build requires cached Cargo dependencies (`cargo fetch --locked` from
`vendor/bgs/bgs-rs` on the first connected setup). It packages the binary,
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

Bgs still owns the agent loop. A private per-turn adapter translates Responses requests to the other protocols, preserving tool results, images, reasoning signatures, cancellation and reported token/cache usage. Converted providers must support streaming, function tools and final usage. Unsupported responses fail explicitly, without retries or switching credentials. Native Bgs web search is disabled for converted providers; use the configured MCP tools. Bgs chooses optional tools from its model metadata; arbitrary third-party model IDs may not advertise `apply_patch`. Native shell-based file editing is verified with the actual Bgs process, while custom-tool conversion is covered separately. Protocol compatibility does not guarantee equivalent model capabilities or live gateway availability.

Tool names in Bgs's default `functions` namespace retain their original spelling when the protocol permits it, keeping Skill references consistent with the advertised tools. Other namespaces and long/unsupported names use a readable prefix plus a stable identity hash; collisions fail before making a provider request. Existing signed/private history is not renamed. An unknown provider tool name is rejected through Bgs's normal tool-error feedback path, using the reserved, unregistered `bgs_provider_errors` namespace. It never resolves to a guessed real tool. The provider's original call remains in private conversation history; only a safe classification is exposed to Bgs diagnostics. One-shot requests without tool definitions still fail on unsolicited tool calls. Broken streams and missing usage remain terminal `response.failed` events, with no automatic replay. Pre-stream HTTP failures retain the upstream status in a fixed diagnostic; transport failures are identified separately, without exposing upstream bodies. For Chat Completions, tool-returned images are attached after the complete consecutive tool-result block, preserving parallel call/result ordering.

Platform credentials and personal BYOK remain separate. OpenCode Go keeps its protocol-specific model catalog and encrypted personal connection. ChatGPT subscription login uses Bgs's device-code flow and an owner-private BGS home under `<user-data>/.runtime/app/bgs`; it never borrows the operator's personal login. Claude Code and Claude subscription login remain removed; Anthropic API support uses the same BGS runtime.

Before deploying the backend/resource service with Supabase, apply `supabase/migrations/20261020010000_model_api_protocol.sql`. It adds the nullable `api_protocol` column and updates the existing RLS-protected runtime RPC; legacy rows retain their provider defaults. Configure the deployment's outbound host allowlist for each selected provider. Go additionally needs `opencode.ai` and `models.dev` for its model catalog. Go inference calls carry BGS’s own User-Agent and a stable `X-Opencode-Session` identifier for the agent conversation or bounded model call. No production migration or paid-provider request is run by the source tests.

Also apply `supabase/migrations/20261020020000_model_request_usage.sql` before deploying the updated backend. Auxiliary model usage is billed per physical request; agent usage remains cumulative snapshots. This migration preserves existing ledger rows and balances; it does not reconcile historical underbilling.

Then apply `supabase/migrations/20261020030000_usage_wallet_initialization.sql`. First-use wallets are created in the debit transaction, amounts come from the recorded usage event, and image reservations reduce available credit. Failed direct debits roll back their usage registration. Back up the prior source and the target database's function definitions before migration; restoring the source alone does not restore database behavior. Existing ledger rows and balances are not rewritten.

Deploy the updated billing service before the runtime host. Remote billing now exposes the service-token-protected `/api/internal/usage/authorize` endpoint; an older or unavailable billing service blocks new model work rather than allowing unbilled requests. This endpoint requires no additional database migration.

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
- Auxiliary tasks use provider sampling defaults. Explicit API `temperature` values are validated and forwarded unchanged, including zero; provider rejection is surfaced without retries. The subscription transport rejects explicit temperature. Tasks do not force a common temperature across models because [reasoning-model support varies](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.4).
- Bgs runs with an explicit permission profile. Project files are writable; host configuration, other projects and protected design files are outside ordinary write access. Required OS sandbox support must be available; there is no unsandboxed fallback.
- `WriteProjectFile` and `EditProjectFile` route protected design/guide edits through BGS's current permission authority. The design lock cannot be bypassed with a shell or native patch tool. `AskUserQuestion` preserves the existing BGS question and authorization flow.
- User and bundled Skills are projected read-only into the user's private BGS home. Project instructions use `AGENTS.md`; the initial design method uses Bgs native Skill input rather than a legacy slash command. Skill selection alone does not establish application or game quality. Enabled, owner-bound MCP servers connect through Bgs; MCP credentials are passed over private stdio rather than command-line arguments.
- A completed agent turn is followed by background-terminal and process cleanup before BGS releases its writer. Interrupted or failed turns are not successful delivery evidence.
- Deterministic verification builds run the project's `build` script through `npm --prefix <isolated-copy> run build` in Bgs's network-disabled sandbox. The npm launcher itself works within that boundary. Some Bun bundler commands still inspect ancestor directories and fail under the strict filesystem profile; those builds remain unverified and never receive an unsandboxed retry. Node/Vite build paths and synthetic Bun script execution have been verified.

## Existing projects and history

Live session ingestion accepts only structured BGS `runtime_event` messages; provider usage arrives through the runtime accounting callback. The retired Claude SDK stream/result adapter and output-file polling projection are removed. BGS Chat transcripts and verification evidence remain readable. Bgs threads are marked explicitly in persisted runtime/workflow records. A legacy agent session is continued from existing project files and BGS handoff facts in a new Bgs context; its UUID is never treated as a Bgs resumable thread. No existing game artifacts, credentials or historical evidence are rewritten by this source migration.

Chat tools expand in place with BeUI ToolResult; full details and subagents remain available in a drawer. Complete tool output is retained separately from the short message summary, and native command progress carries cumulative output. Confirmed file edits with actual diff data use one FileDiff entry. Native diffs are projected from their structured field, including legacy Bgs file-change receipts that stored it in output; arbitrary shell output is not classified as a file change. Markdown code blocks and file reads use CodeBlock, preserving copied source and any known read-line gutter. Activity follows new output until the user scrolls up or starts inspecting an entry, and inspected results stay expanded when the turn ends. These are presentation changes, not project validation or edits to historical transcripts.

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
