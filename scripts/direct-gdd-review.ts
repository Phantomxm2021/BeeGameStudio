// Observer-only manual runner; never edits product documents or calls BGS delivery.
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { loadEnvFile } from './beegame-migration-cli.ts'
import { createSupabaseDashboardStoreFromEnv } from '../packages/agent-workflow-server/src/supabase-dashboard-store.ts'
import { openModelUsageProxy, summarizeModelRequests } from '../packages/agent-workflow-server/scripts/model-usage-proxy.ts'
import { authorDocumentResponsibility } from '../packages/agent-workflow-server/src/beegame/project-author.ts'

let documentPath = '/private/tmp/bgs-scheduled-review-accept-20261004-AtjTBHgW/projects/users/spatial-test/scheduled-review-museum-20261004-AtjTBHgW/docs/GDD.md'
let cli = '/private/tmp/bgs-scheduled-review-accept-20261004-AtjTBHgW/cli/cli.js'
const responsibilitySource = resolve(import.meta.dir, '../packages/agent-workflow-server/src/beegame/project-author.ts')
const question = '这份 GDD 文档里面是否存在问题？请简明指出问题及对应章节。'
// Defaults deliberately reproduce the current acceptance case; they are not product settings.
let modelConfigId = 'llm_ac40e5d1be394ffe925e3f2532dedd34'
let dryRun = false
const envFiles: string[] = []
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index++) {
  const flag = args[index]
  if (flag === '--help') {
    console.log(`Usage: bun scripts/direct-gdd-review.ts [options]

Each invocation starts ONE paid direct CLI review using a fresh isolated session.
Default inputs reproduce the current GDD acceptance case with the existing GDD role.
No BGS workflow, tools, checking Skills, previous answers or known findings are sent.
The GDD is read-only. Answers and usage evidence go to a fresh temporary directory.

  --gdd PATH          Override saved GDD file
  --cli PATH          Override built BGS/Claude CLI entry file
  --model-config ID   Override BGS model configuration
  --env-file PATH     Load credentials from this file; repeatable (replaces defaults)
  --dry-run           Validate files and show input hash; NO network or paid request
  --help              Show this help; NO network or paid request

Defaults:
  GDD: ${documentPath}
  CLI: ${cli}
  Model configuration: ${modelConfigId}

Actual credits are not available; recorded Tokens include provider-reported cache usage.
A successful process exit means the review ran, NOT that the GDD passed review.`)
    process.exit(0)
  }
  if (flag === '--dry-run') { dryRun = true; continue }
  if (!['--gdd', '--cli', '--model-config', '--env-file'].includes(flag))
    throw Error('Unknown option: ' + flag)
  const value = args[++index]
  if (!value?.trim() || value.startsWith('--')) throw Error('Missing value for ' + flag)
  if (flag === '--gdd') documentPath = resolve(value)
  if (flag === '--cli') cli = resolve(value)
  if (flag === '--model-config') modelConfigId = value
  if (flag === '--env-file') envFiles.push(resolve(value))
}
await access(cli)
const body = await readFile(documentPath, 'utf8')
const role = authorDocumentResponsibility(0, 'GDD.md')
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const prompt = question + '\n\n职责要求（现有 GDD 角色 Prompt 原文）：\n\n' + role + '\n\n以下是文档全文：\n\n' + body
if (dryRun) {
  console.log(JSON.stringify({ paid: false, modelConfigId, documentPath, cli, question,
    documentSha256: hash(body), responsibilitySha256: hash(role), promptSha256: hash(prompt),
    promptCharacters: prompt.length, responsibilitySource, tools: [], bgsWorkflow: false }, null, 2))
  process.exit(0)
}
if (!envFiles.length) envFiles.push(
  '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.env.local',
  '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.env.billing',
)
for (const path of envFiles) { await access(path); loadEnvFile(path) }
const root = await mkdtemp(join(tmpdir(), 'gdd-direct-cli-manual-'))
console.log('本次结果目录：' + root)
console.log('即将执行一次付费直接 CLI 审查；不自动追加运行。')
for (const key of ['BEEGAME_SUPABASE_URL', 'BEEGAME_SUPABASE_ANON_KEY', 'BEEGAME_SMOKE_EMAIL', 'BEEGAME_SMOKE_PASSWORD'])
  if (!process.env[key]) throw Error('Missing test configuration: ' + key)
const authenticated = await fetch(process.env.BEEGAME_SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { apikey: process.env.BEEGAME_SUPABASE_ANON_KEY!, 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.BEEGAME_SMOKE_EMAIL, password: process.env.BEEGAME_SMOKE_PASSWORD }),
  signal: AbortSignal.timeout(20000),
})
if (!authenticated.ok) throw Error('Test authentication failed: ' + authenticated.status)
const auth = await authenticated.json()
const dashboard = createSupabaseDashboardStoreFromEnv()
if (!dashboard) throw Error('Missing dashboard configuration')
const selected = await dashboard.withAuthToken(auth.access_token)
  .loadRlsVisibleModelRuntimeEnv(modelConfigId)
if (!selected.ANTHROPIC_BASE_URL || !selected.ANTHROPIC_DEFAULT_SONNET_MODEL)
  throw Error('Selected model configuration has no endpoint or model')
const cwd = join(root, 'workspace')
await mkdir(cwd, { recursive: true })
await mkdir(join(root, 'config'), { recursive: true })
await writeFile(join(root, 'prompt-input.txt'), prompt, { flag: 'wx' })
await writeFile(join(root, 'started.json'), JSON.stringify({ at: new Date().toISOString(),
  model: selected.ANTHROPIC_DEFAULT_SONNET_MODEL, modelConfigId, documentPath, documentSha256: hash(body),
  question, suppliedInputs: ['question', 'existing GDD responsibility verbatim', 'complete saved GDD body'],
  suppliedBgsResponsibilities: true, responsibilitySource, responsibilityFunction: "authorDocumentResponsibility(0, 'GDD.md')",
  responsibilitySha256: hash(role), responsibilitySourceSha256: hash(await readFile(responsibilitySource, 'utf8')),
  suppliedKnownFindings: false, suppliedCheckingSkill: false, bgsWorkflow: false }, null, 2), { flag: 'wx' })
const proxy = openModelUsageProxy(selected.ANTHROPIC_BASE_URL!, join(root, 'provider-usage.json'), () => 'direct-cli-role-gdd-review')
const inherited = Object.fromEntries(['HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'PATH', 'SHELL', 'USER']
  .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]))
const env = { ...inherited, ...selected, BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_BASE_URL: proxy.baseUrl,
  BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_MODEL_OBSERVER_METADATA: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', SKILL_SEARCH_ENABLED: '0' }
const command = [process.execPath, cli, '--print', '--output-format', 'json',
  '--tools', '', '--disable-slash-commands', '--setting-sources', '',
  '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config', '--no-session-persistence', '--no-chrome']
await writeFile(join(root, 'launch.json'), JSON.stringify({ cwd, command, customSystemPrompt: false,
  appendSystemPrompt: false, bgsSessionManager: false, bgsDelivery: false, tools: [], skillsDisabled: true,
  resumedConversation: false, responsibilityPlacement: 'user input, verbatim existing GDD role' }, null, 2), { flag: 'wx' })
const started = Date.now()
let child: ReturnType<typeof Bun.spawn>
try {
  child = Bun.spawn(command, { cwd, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
} catch (error) {
  await proxy.close()
  throw error
}
let stopped = false
let forceStop: ReturnType<typeof setTimeout> | undefined
const stop = () => {
  if (stopped) return
  stopped = true
  child.kill('SIGTERM')
  forceStop = setTimeout(() => child.kill('SIGKILL'), 5000)
}
process.on('SIGTERM', stop); process.on('SIGINT', stop)
const deadline = setTimeout(stop, 10 * 60 * 1000)
console.log(JSON.stringify({ event: 'direct_cli_started', model: selected.ANTHROPIC_DEFAULT_SONNET_MODEL,
  question, existingGddRoleIncluded: true, tools: [], documentUnchangedBeforeRun: true }))
try {
  child.stdin.write(prompt)
  child.stdin.end()
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ])
  await writeFile(join(root, 'stdout.json'), stdout, { flag: 'wx', mode: 0o600 })
  await writeFile(join(root, 'stderr.log'), stderr, { flag: 'wx', mode: 0o600 })
  let result: any
  try { result = JSON.parse(stdout) } catch {}
  const unchanged = hash(await readFile(documentPath, 'utf8')) === hash(body)
  const summary = { elapsedSeconds: (Date.now() - started) / 1000, exitCode, stopped,
    model: selected.ANTHROPIC_DEFAULT_SONNET_MODEL, question, documentPath, documentSha256: hash(body),
    documentUnchanged: unchanged, resultSubtype: result?.subtype, resultIsError: result?.is_error,
    resultText: result?.result, tokenObservation: summarizeModelRequests(proxy.records),
    settledCredits: null, promptSha256: hash(prompt), bgsWorkflow: false, noKnownFindingsSupplied: true, noCheckingSkillSupplied: true,
    suppliedBgsResponsibilities: true, responsibilitySource, responsibilitySha256: hash(role), tools: [], limitations: [
      'Only the existing GDD role was added; full BGS review workflow and checking Skill were not supplied.',
      'One contrast cannot establish causality or guaranteed review reliability.',
      'Observed provider tokens are not settled credits.',
    ] }
  await writeFile(join(root, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx' })
  if (typeof result?.result === 'string')
    await writeFile(join(root, 'answer.txt'), result.result, { flag: 'wx' })
  console.log(JSON.stringify({ event: 'finished', exitCode, elapsedSeconds: summary.elapsedSeconds,
    resultSubtype: result?.subtype, documentUnchanged: unchanged, tokens: summary.tokenObservation.totalObservedTokens }))
  console.log('\n模型回答：\n' + (result?.result ?? '没有收到完整回答，请查看 stderr.log'))
  console.log('\n结果目录：' + root)
  if (exitCode !== 0 || result?.subtype !== 'success' || result?.is_error !== false ||
    typeof result?.result !== 'string' || !unchanged || stopped) process.exitCode = 1
} finally {
  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await child.exited
  }
  if (forceStop) clearTimeout(forceStop)
  clearTimeout(deadline); process.off('SIGTERM', stop); process.off('SIGINT', stop); await proxy.close()
}
