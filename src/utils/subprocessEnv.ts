import { isEnvTruthy } from './envUtils.js'
import { normalizeRuntimeEnvironment } from './runtimeEnvironment.js'

/**
 * Env vars to strip from subprocess environments when running inside GitHub
 * Actions. This prevents prompt-injection attacks from exfiltrating secrets
 * via shell expansion (e.g., ${ANTHROPIC_API_KEY}) in Bash tool commands.
 *
 * The parent claude process keeps these vars (needed for API calls, lazy
 * credential reads). Only child processes (bash, shell snapshot, MCP stdio, LSP, hooks) are scrubbed.
 *
 * GITHUB_TOKEN / GH_TOKEN are intentionally NOT scrubbed — wrapper scripts
 * (gh.sh) need them to call the GitHub API. That token is job-scoped and
 * expires when the workflow ends.
 */
const GHA_SUBPROCESS_SCRUB = [
  // Anthropic auth — claude re-reads these per-request, subprocesses don't need them
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',
  // Alternate native model providers use the same parent-only credential boundary.
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROK_API_KEY',
  'XAI_API_KEY',
  'CLAUDE_ARTIFACTS_TOKEN',
  'TAVILY_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  'EXA_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_LOCAL_VAULT_PASSPHRASE',
  'CLAUDE_TRUSTED_DEVICE_TOKEN',
  'LANGFUSE_SECRET_KEY',
  'DATADOG_API_KEY',
  'MCP_CLIENT_SECRET',
  'BRAVE_API_KEY',

  // OTLP exporter headers — documented to carry Authorization=Bearer tokens
  // for monitoring backends; read in-process by OTEL SDK, subprocesses never need them
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',

  // Cloud provider creds — same pattern (lazy SDK reads)
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',

  // GitHub Actions OIDC — consumed by the action's JS before claude spawns;
  // leaking these allows minting an App installation token → repo takeover
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',

  // GitHub Actions artifact/cache API — cache poisoning → supply-chain pivot
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_RUNTIME_URL',

  // claude-code-action-specific duplicates — action JS consumes these during
  // prepare, before spawning claude. ALL_INPUTS contains anthropic_api_key as JSON.
  'ALL_INPUTS',
  'OVERRIDE_GITHUB_TOKEN',
  'DEFAULT_WORKFLOW_TOKEN',
  'SSH_SIGNING_KEY',
] as const

/**
 * Returns a copy of process.env with sensitive secrets stripped, for use when
 * spawning subprocesses (Bash tool, shell snapshot, MCP stdio servers, LSP
 * servers, shell hooks).
 *
 * Gated on BGS_SUBPROCESS_ENV_SCRUB. claude-code-action sets this
 * automatically when `allowed_non_write_users` is configured — the flag that
 * exposes a workflow to untrusted content (prompt injection surface).
 */
// Registered by init.ts after the upstreamproxy module is dynamically imported
// in CCR sessions. Stays undefined in non-CCR startups so we never pull in the
// upstreamproxy module graph (upstreamproxy.ts + relay.ts) via a static import.
let _getUpstreamProxyEnv: (() => Record<string, string>) | undefined

/**
 * Called from init.ts to wire up the proxy env function after the upstreamproxy
 * module has been lazily loaded. Must be called before any subprocess is spawned.
 */
export function registerUpstreamProxyEnvFn(
  fn: () => Record<string, string>,
): void {
  _getUpstreamProxyEnv = fn
}

export function subprocessEnv(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // CCR upstreamproxy: inject HTTPS_PROXY + CA bundle vars so curl/gh/python
  // in agent subprocesses route through the local relay. Returns {} when the
  // proxy is disabled or not registered (non-CCR), so this is a no-op outside
  // CCR containers.
  const proxyEnv = _getUpstreamProxyEnv?.() ?? {}
  const parent = normalizeRuntimeEnvironment(process.env)
  // Normalize each source before merging, so legacy overrides can replace
  // canonical parent values without weakening the parent's credential scrub.
  const inherited = overrides ? { ...parent, ...normalizeRuntimeEnvironment(overrides) } : parent

  if (!isEnvTruthy(parent.BGS_SUBPROCESS_ENV_SCRUB)) {
    return Object.keys(proxyEnv).length > 0
      ? { ...inherited, ...proxyEnv }
      : inherited
  }
  const env = { ...inherited, ...proxyEnv }
  for (const k of GHA_SUBPROCESS_SCRUB) {
    delete env[k]
    // GitHub Actions auto-creates INPUT_<NAME> for `with:` inputs, duplicating
    // secrets like INPUT_ANTHROPIC_API_KEY. No-op for vars that aren't action inputs.
    delete env[`INPUT_${k}`]
  }
  return env
}
