// Opt-in acceptance host. Normal BGS auth/model/store/CLI; no fake runner,
// authored game fixtures, acceptance injection or automatic model dispatch.
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadEnvFile } from './beegame-migration-cli'
import { getMacroDefines } from './defines'
import { createManagedProjectWorkspacePath } from '../packages/agent-workflow-server/src/local-runtime-service'
import { paidDebugRuntimeConfig } from './workflow-v3-paid-debug-config'

const args = process.argv.slice(2)
if ((args.length !== 2 && args.length !== 4) || args[0] !== '--env-file' ||
    args.length === 4 && (args[2] !== '--name' || !args[3]?.trim()))
  throw Error('Usage: bun scripts/serve-workflow-v3-paid-debug.ts --env-file PATH [--name ACCEPTANCE_NAME]')
loadEnvFile(args[1]!)
if (process.env.BEEGAME_HTTPONLY_SESSIONS !== '1' || !process.env.BEEGAME_SUPABASE_URL ||
    !process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY || !process.env.AGENT_WORKFLOW_WORKSPACE_PATH)
  throw Error('Normal HttpOnly auth, real database and configured workspace required')
Object.assign(globalThis, { MACRO: Object.fromEntries(Object.entries(getMacroDefines())
  .map(([key, value]) => [key.replace('MACRO.', ''), JSON.parse(value)])) })
process.env.NODE_ENV = 'development'
process.env.BEEGAME_ALLOW_DEV_AUTH_TOKENS = '0'
process.env.BEEGAME_WORKFLOW_V3_DEBUG = '1'
// Root env alone lacks the local launcher's service wiring. Reuse it without
// starting/restarting services or dispatching any model/image request.
const runtimeConfig = paidDebugRuntimeConfig(process.env)
Object.assign(process.env, runtimeConfig.env)
const { createAgentWorkflowApp } = await import('../packages/agent-workflow-server/src/app')
let app: ReturnType<typeof createAgentWorkflowApp> | undefined
const cleanups: (() => void | Promise<void>)[] = []
const server = Bun.serve({hostname: '127.0.0.1', port: 0, idleTimeout: 30,
  fetch: request => app ? app.fetch(request) : new Response('Initializing', {status: 503})})
const origin = server.url.origin
process.env.BEEGAME_API_CORS_ORIGINS = [process.env.BEEGAME_API_CORS_ORIGINS, origin].filter(Boolean).join(',')
app = createAgentWorkflowApp({defaultWorkspacePath: resolve(process.env.AGENT_WORKFLOW_WORKSPACE_PATH!),
  modelConfigStore: {}, workflowV3PreviewOrigin: 'http://localhost:' + server.port,
  resourceSelectionRuntimeConfig: runtimeConfig.resources,
  registerCleanup: fn => cleanups.push(fn)})
const projectId = 'v3-paid-' + randomUUID(), name = args[3]?.trim() ?? 'V3 自主验收'
let provisioned: {id: string; root_path: string} | undefined, provisionedOwner: string | undefined, creating = false
app.get('/debug/paid-acceptance', c => {
  c.header('Cache-Control', 'no-store')
  c.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
  return c.html('<!doctype html><meta charset="utf-8"><title>V3真实验收准备</title><h1>V3真实验收准备</h1><p>使用已有正常登录态，创建一个空工程。这里不调用模型、不生成游戏文件、不填写计划或通过记录。</p><button id="create">创建本轮唯一空工程（不执行）</button><pre id="result"></pre><a href="/debug/workflow-v3">打开独立 V3 Debug</a><script src="/debug/paid-acceptance.js"></script>')
})
app.get('/debug/paid-acceptance.js', c => c.body("document.querySelector('#create').onclick=async()=>{const b=document.querySelector('#create');b.disabled=true;try{const r=await fetch('/api/debug/paid-project',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});const v=await r.json();document.querySelector('#result').textContent=JSON.stringify(v,null,2);if(!r.ok)b.disabled=false;}catch(e){document.querySelector('#result').textContent=e.message;b.disabled=false;}};",200,{'Content-Type':'text/javascript'}))
app.post('/api/debug/paid-project', async c => {
  // No special identity, tokens or admin writes. Forward the authenticated
  // request to normal user/project APIs, and only provision an empty directory.
  if (c.req.header('origin') !== origin || !c.req.header('content-type')?.startsWith('application/json'))
    return c.json({error: 'Same-origin JSON request required'}, 403)
  const identity = await app!.fetch(new Request(origin + '/api/current-user', {headers: c.req.raw.headers}))
  if (!identity.ok) return identity
  const user = await identity.json() as {id: string; permissions: string[]}
  if (!user.permissions.includes('project.create')) return c.json({error: 'Project creation forbidden'}, 403)
  if (creating) return c.json({error: 'Creation already in progress; do not replay'}, 409)
  if (provisioned) return provisionedOwner === user.id
    ? c.json({...provisioned, dispatched: false}) : c.json({error: 'This acceptance project belongs to another user'}, 403)
  creating = true
  try {
    const root_path = await createManagedProjectWorkspacePath({defaultWorkspacePath: process.env.AGENT_WORKFLOW_WORKSPACE_PATH,
      userId: user.id, projectName: 'v3-agent-acceptance', projectId})
    const headers = new Headers(c.req.raw.headers); headers.set('content-type', 'application/json')
    const response = await app!.fetch(new Request(origin + '/api/projects', {method: 'POST', headers,
      body: JSON.stringify({id: projectId, name, root_path, created_at: Date.now()})}))
    if (!response.ok) return response
    provisioned = {id: projectId, root_path}
    provisionedOwner = user.id
    console.log(JSON.stringify({projectCreated: true, ...provisioned, dispatched: false}))
    return c.json({...provisioned, name, dispatched: false})
  } finally { creating = false }
})
console.log(JSON.stringify({ready: true, origin, debugUrl: origin + '/debug/paid-acceptance',
  realDatabase: true, normalAuth: true, runner: 'normal-native-cli', automaticDispatch: false}))
let closing = false
const stop = async () => {
  if (closing) return
  closing = true
  for (const cleanup of cleanups) await cleanup()
  server.stop(true); process.exit(0)
}
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop())
await new Promise(() => {})
