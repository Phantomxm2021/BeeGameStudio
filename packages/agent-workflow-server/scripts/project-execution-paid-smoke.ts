/** Explicitly authorized, bounded real-model smoke. Never runs from bun test. */
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Hono } from 'hono'
import { loadEnvFile } from '../../../scripts/beegame-migration-cli'
import { registerBeeGameSessionRoutes } from '../src/auth/session-routes'
import { decryptSecret } from '../src/security/secret-crypto'
import { createSupabaseRuntimeEnvClientFromEnv } from '../src/supabase-runtime-env-client'
import { createNativeCliProcessRunner, nativeRuntimeCommand } from '../src/beegame/native-cli-process-runner'
import { openModelUsageProxy } from './model-usage-proxy'

if (process.argv[2] !== '--paid' || !process.argv[3] || !process.argv[4])
  throw new Error('Usage: bun packages/agent-workflow-server/scripts/project-execution-paid-smoke.ts --paid <root-env-file> <user-id>')
loadEnvFile(process.argv[3])
process.env.BEEGAME_HTTPONLY_SESSIONS = '1'
const userId = process.argv[4]
const sessionStore = process.env.AGENT_WORKFLOW_DATA_DIR
  ? join(process.env.AGENT_WORKFLOW_DATA_DIR, 'auth-sessions.json')
  : join(homedir(), '.beegame/dashboard/auth-sessions.json')
const records = JSON.parse(await readFile(sessionStore, 'utf8')) as Record<string, string>
const id = Object.entries(records).flatMap(([key, value]) => {
  try {
    const record = JSON.parse(decryptSecret(value, 'auth:session'))
    return record.user?.id === userId && (!record.sessionExpiresAt || record.sessionExpiresAt > Date.now())
      ? [{ key, expiresAt: Number(record.expiresAt) }] : []
  } catch { return [] }
}).sort((a, b) => b.expiresAt - a.expiresAt)[0]?.key
if (!id) throw new Error('No saved login for the requested test account')
const auth = registerBeeGameSessionRoutes(new Hono(), { sessionStorePath: sessionStore })
const token = await auth?.getValidAccessToken(new Request('http://localhost/api/auth/session', {
  headers: { cookie: `beegame_session=${id}` },
}))
if (!token) throw new Error('A valid existing login is required')
const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-paid-isolation-')))
const workspace = join(root, 'project')
await mkdir(workspace)
await writeFile(join(root, 'host-fixture.txt'), 'PRIVATE_TEST_FIXTURE_DO_NOT_READ')
const client = createSupabaseRuntimeEnvClientFromEnv()
if (!client) throw new Error('Runtime model configuration is unavailable')
const env = await client.loadRuntimeEnv({ userId, dataDir: join(root, 'data'), authToken: token })
// This native Anthropic-compatible path records provider requests independently
// of CLI cumulative estimates. Unknown/partial responses never become zero spend.
const usageProxy = env.ANTHROPIC_BASE_URL
  ? openModelUsageProxy(env.ANTHROPIC_BASE_URL, join(root, 'provider-usage.json'), () => 'execution-smoke') : undefined
if (usageProxy) {
  env.ANTHROPIC_BASE_URL = usageProxy.baseUrl
}
env.BEEGAME_CONFIG_DIR = join(root, 'native-config')
env.BGS_DISABLE_NONESSENTIAL_TRAFFIC = '1'
env.DISABLE_TELEMETRY = '1'
env.DISABLE_ERROR_REPORTING = '1'
const start = { sessionId: `paid-isolation-${Date.now()}`, cwd: workspace, env, language: 'zh' as const }
const runtime = await createNativeCliProcessRunner({ command: [
  ...nativeRuntimeCommand(start), '--max-budget-usd', '1', '--max-turns', '14',
] }).start(start).catch(async error => { await usageProxy?.close(); throw error })
const abort = new AbortController()
const timeout = setTimeout(() => abort.abort('test_deadline'), 180000)
const events: object[] = []
let terminal: Record<string, unknown> | undefined
try {
  await runtime.submit({ signal: abort.signal,
    prompt: `这是全新的开发环境验收项目，不是完整游戏交付。请在当前项目内制作一个无外部依赖的简单点击计分网页，并验证它能在本地 HTTP 服务中加载。初始化 Git 并提交一次（仅该测试仓库可用测试身份）。请用一个子任务独立核对网页文件是否齐全。另用 Bash 实际验证读取 ../host-fixture.txt 被系统拒绝；它是专用测试夹具，除此之外不要访问项目外的任何文件，也不要尝试绕过隔离。不要安装浏览器、生成图片或发布。最后简短报告成功和失败项，停止你创建的服务。`,
    onMessage: message => {
      if (message.type === 'result') terminal = message as Record<string, unknown>
      if (message.type === 'assistant') {
        const content = (message.message as { content?: any[] })?.content ?? []
        for (const block of content) if (block.type === 'tool_use') {
          events.push({ type: 'tool', name: block.name })
          console.log(JSON.stringify({ event: 'tool', name: block.name }))
        }
      }
    },
    requestPermission: async request => {
      if (request.toolName === 'AskUserQuestion') return { behavior: 'deny', source: 'policy', message: 'Use the fixed smoke-test scope' }
      const path = request.input.file_path ?? request.input.path ?? request.input.notebook_path
      if (typeof path === 'string') {
        const target = await realpath(resolve(workspace, path)).catch(() => resolve(workspace, path))
        const part = relative(workspace, target)
        if (isAbsolute(part) || part === '..' || part.startsWith('../'))
          return { behavior: 'deny', source: 'policy', message: 'Outside the test project' }
      }
      return { behavior: 'allow', source: 'user', scope: 'once' }
    },
  })
} finally {
  clearTimeout(timeout)
  try { await runtime.dispose?.() }
  finally { await usageProxy?.close() }
  const report = { scope: 'paid-execution-smoke', workspace, events,
    result: terminal?.result, subtype: terminal?.subtype,
    estimatedCostUsd: terminal?.total_cost_usd, usage: terminal?.usage,
    nativeSessionId: terminal?.session_id,
    providerObservation: usageProxy ? { path: join(root, 'provider-usage.json'),
      requests: usageProxy.records.length,
      incompleteUsageRequests: usageProxy.records.filter(r => r.usageCompleteness !== 'final').map(r => r.id),
      basis: 'observed tokens, not settled credits; incomplete usage is a lower-bound observation' } : undefined,
    note: 'CLI estimate, not upstream billing reconciliation; max budget checked between model calls.' }
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
