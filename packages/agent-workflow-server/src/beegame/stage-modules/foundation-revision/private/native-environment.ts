import { isAbsolute } from 'node:path'
import { z } from 'zod/v4'
import { revisionCanonicalJson } from './json-digest'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'

// Frozen runtime model forwarding, excluding the four stage-owned bridge keys.
const MODEL_KEYS = new Set([
  'BEEGAME_CONFIG_DIR', 'BEEGAME_MODEL_TYPE',
  'ANTHROPIC_API_KEY', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_TELEMETRY', 'DISABLE_ERROR_REPORTING',
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_OPENAI', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_DEFAULT_HAIKU_MODEL', 'OPENAI_DEFAULT_SONNET_MODEL', 'OPENAI_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_GEMINI', 'GEMINI_BASE_URL', 'GEMINI_API_KEY', 'GEMINI_DEFAULT_HAIKU_MODEL', 'GEMINI_DEFAULT_SONNET_MODEL', 'GEMINI_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_GROK', 'GROK_BASE_URL', 'GROK_API_KEY', 'GROK_DEFAULT_HAIKU_MODEL', 'GROK_DEFAULT_SONNET_MODEL', 'GROK_DEFAULT_OPUS_MODEL',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'CLAUDE_CODE_PROXY_RESOLVES_HOSTS', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY', 'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE', 'ANTHROPIC_UNIX_SOCKET',
])
const SAFE_INHERITED = ['CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING', 'HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'NODE_ENV', 'PATH', 'SHELL', 'TMPDIR', 'USER']
const envString = z.string().refine(value => !value.includes('\0'))
const environmentSchema = z.record(z.string(), envString)
const fileBoundarySchema = z.object({
  workspacePath: envString.refine(isAbsolute),
  writablePaths: z.array(z.enum(CANONICAL_FOUNDATION_DOCUMENTS)).length(8),
}).strict().refine(value => new Set(value.writablePaths).size === 8, 'Revision file authority must bind all eight distinct paths')

/** Forward model configuration only; file authority is owned by the stage. */
export function buildRevisionNativeEnvironment(selected: unknown, boundary: unknown): Record<string, string> {
  const model = environmentSchema.parse(JSON.parse(revisionCanonicalJson(selected)))
  fileBoundarySchema.parse(JSON.parse(revisionCanonicalJson(boundary)))
  return {
    ...Object.fromEntries(SAFE_INHERITED.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]])),
    ...Object.fromEntries(Object.entries(model).filter(([key]) => MODEL_KEYS.has(key))),
  }
}
