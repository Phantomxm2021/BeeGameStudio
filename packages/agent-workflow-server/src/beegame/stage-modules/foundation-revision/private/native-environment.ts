import { isAbsolute, join } from 'node:path'
import { z } from 'zod/v4'
import { revisionCanonicalJson } from './json-digest'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'

// Frozen runtime model forwarding, excluding the four stage-owned bridge keys.
const MODEL_KEYS = new Set([
  'BEEGAME_CONFIG_DIR', 'BEEGAME_MODEL_TYPE',
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
const bridgeSchema = z.object({
  BEEGAME_WORKFLOW_WORKER_TYPE: z.literal('foundation-document-reviser'),
  BEEGAME_WORKSPACE_PATH: envString.optional(),
  BEEGAME_REVISION_STAGED_PATH: envString.optional(),
  BEEGAME_REVISION_CONTRACT: envString.optional(),
}).strict()
const readContractSchema = z.object({
  taskId: z.uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/), round: z.number().int().positive().safe(),
  scope: z.literal('document'), documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
  issueIds: z.array(z.string().min(1)).min(1), sectionIds: z.array(z.string()).length(0),
  stagedPath: z.literal('assigned.md'), baseDocumentDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

/** The caller resolves model configuration through the owner-bound public client.
 * Selected configuration cannot replace the private assignment's read authority.
 * No process-global environment is mutated and no environment is persisted.
 */
export function buildRevisionNativeEnvironment(selected: unknown, assignmentBridge: unknown): Record<string, string> {
  const model = environmentSchema.parse(JSON.parse(revisionCanonicalJson(selected)))
  const bridge = bridgeSchema.parse(JSON.parse(revisionCanonicalJson(assignmentBridge)))
  const hasDocument = bridge.BEEGAME_REVISION_CONTRACT !== undefined
  if (hasDocument) {
    readContractSchema.parse(JSON.parse(bridge.BEEGAME_REVISION_CONTRACT!))
    if (!bridge.BEEGAME_WORKSPACE_PATH || !isAbsolute(bridge.BEEGAME_WORKSPACE_PATH) ||
      bridge.BEEGAME_REVISION_STAGED_PATH !== join(bridge.BEEGAME_WORKSPACE_PATH, 'assigned.md'))
      throw new Error('Revision native read path does not match its assignment')
  } else if (bridge.BEEGAME_WORKSPACE_PATH !== undefined || bridge.BEEGAME_REVISION_STAGED_PATH !== undefined) {
    throw new Error('Revision section assignment cannot provide a document read path')
  }
  return {
    ...Object.fromEntries(SAFE_INHERITED.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]])),
    ...Object.fromEntries(Object.entries(model).filter(([key]) => MODEL_KEYS.has(key))),
    ...bridge,
  }
}
