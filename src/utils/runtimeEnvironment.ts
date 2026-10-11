/** Product-owned environment names. Original names are accepted only at
 * configuration/process boundaries for existing launchers and settings.
 * API credentials, service URLs and wire-protocol keys are not renamed. */
export const RUNTIME_ENV_ALIASES: Readonly<Record<string, string>> = {
  "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST": "BGS_PROVIDER_MANAGED_BY_HOST",
  "CLAUDE_CODE_SKIP_CHROME_MCP_SETUP": "BGS_SKIP_CHROME_MCP_SETUP",
  "CLAUDE_CODE_USE_BEDROCK": "BGS_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX": "BGS_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY": "BGS_USE_FOUNDRY",
  "CLAUDE_CODE_USE_OPENAI": "BGS_USE_OPENAI",
  "CLAUDE_CODE_USE_GEMINI": "BGS_USE_GEMINI",
  "CLAUDE_CODE_USE_GROK": "BGS_USE_GROK",
  "CLAUDE_CODE_USE_CCR_V2": "BGS_USE_CCR_V2",
  "CLAUDE_CODE_USE_COWORK_PLUGINS": "BGS_USE_COWORK_PLUGINS",
  "CLAUDE_CODE_USE_NATIVE_FILE_SEARCH": "BGS_USE_NATIVE_FILE_SEARCH",
  "CLAUDE_CODE_USE_POWERSHELL_TOOL": "BGS_USE_POWERSHELL_TOOL",
  "CLAUDE_CODE_SIMPLE": "BGS_SIMPLE",
  "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "BGS_DISABLE_AUTO_MEMORY",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "BGS_DISABLE_NONESSENTIAL_TRAFFIC",
  "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB": "BGS_SUBPROCESS_ENV_SCRUB",
  "ANTHROPIC_UNIX_SOCKET": "BGS_API_UNIX_SOCKET",
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "BGS_DEFAULT_STRONG_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "BGS_DEFAULT_STRONG_MODEL_NAME",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION": "BGS_DEFAULT_STRONG_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES": "BGS_DEFAULT_STRONG_MODEL_SUPPORTED_CAPABILITIES",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "BGS_DEFAULT_BALANCED_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "BGS_DEFAULT_BALANCED_MODEL_NAME",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION": "BGS_DEFAULT_BALANCED_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES": "BGS_DEFAULT_BALANCED_MODEL_SUPPORTED_CAPABILITIES",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL": "BGS_DEFAULT_FAST_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME": "BGS_DEFAULT_FAST_MODEL_NAME",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION": "BGS_DEFAULT_FAST_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES": "BGS_DEFAULT_FAST_MODEL_SUPPORTED_CAPABILITIES"
}

export function normalizeRuntimeEnvironment(environment: Readonly<Record<string, string>>): Record<string, string>
export function normalizeRuntimeEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv
export function normalizeRuntimeEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const normalized = { ...environment }
  // Bun exposes proxy settings through property access without enumerating
  // them. Preserve those transport settings when snapshotting the live env;
  // never supplement an explicitly supplied (isolated) environment.
  if (environment === process.env) {
    for (const key of [
      'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
      'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
      ...Object.keys(RUNTIME_ENV_ALIASES), ...Object.values(RUNTIME_ENV_ALIASES),
    ]) {
      if (environment[key] !== undefined) normalized[key] = environment[key]
    }
  }
  for (const [legacy, product] of Object.entries(RUNTIME_ENV_ALIASES)) {
    // Explicit product values (including empty strings and "0") take priority.
    if (normalized[product] === undefined && normalized[legacy] !== undefined) {
      normalized[product] = normalized[legacy]
    }
    delete normalized[legacy]
  }
  return normalized
}
