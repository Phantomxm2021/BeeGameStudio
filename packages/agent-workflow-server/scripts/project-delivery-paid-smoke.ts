/** Opt-in production-entry smoke. No fixture game files or automatic retries. */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { decryptSecret } from '../src/security/secret-crypto'
import { loadEnvFile } from '../../../scripts/beegame-migration-cli'
import { observeDeliverySmoke } from './delivery-smoke-observation'

const [mode, envFile, userId, budget, resumeReport] = process.argv.slice(2)
const maxCredits = Number(budget)
if (mode !== '--paid' || !envFile || !userId || !Number.isFinite(maxCredits) || maxCredits <= 0)
  throw new Error('Usage: --paid <root-env-file> <user-id> <authorized-credits> [resume-report]')
loadEnvFile(envFile)
const records = JSON.parse(await readFile(join(process.env.AGENT_WORKFLOW_DATA_DIR ??
  join(homedir(), '.beegame/dashboard'), 'auth-sessions.json'), 'utf8'))
const login = Object.entries(records).flatMap(([id, value]) => {
  try {
    const record = JSON.parse(decryptSecret(String(value), 'auth:session'))
    return record.user?.id === userId && (!record.sessionExpiresAt || record.sessionExpiresAt > Date.now())
      ? [{ id, expires: Number(record.expiresAt) }] : []
  } catch { return [] }
}).sort((a, b) => b.expires - a.expires)[0]
if (!login) throw new Error('No saved login for the test account')
const origin = 'http://127.0.0.1:62174'
async function api(path: string, body?: unknown): Promise<any> {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie: `beegame_session=${login!.id}`, 'content-type': 'application/json', origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  }).catch(error => { throw new Error(`${path}: ${error instanceof Error ? error.name : 'transport failure'}`) })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.json()
}
const wallet = await api('/api/usage-wallet')
const initial = Number(wallet.consumedCreditsMicro) + Number(wallet.reservedCreditsMicro)
if (![wallet.consumedCreditsMicro, wallet.reservedCreditsMicro, wallet.balanceCreditsMicro]
    .every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) ||
    wallet.balanceCreditsMicro < maxCredits * 1e6)
  throw new Error('Cannot confirm enough available credits')
const reportRoot = await mkdtemp(join(tmpdir(), 'bgs-delivery-paid-'))
const prior = resumeReport ? JSON.parse(await readFile(resumeReport, 'utf8')) : undefined
if (prior && (!String(prior.projectId).startsWith('delivery-smoke-') || !prior.sessionId))
  throw new Error('Resume is limited to a saved delivery smoke project')
if (prior && maxCredits > prior.authorizedCredits) throw new Error('Resume cannot increase the saved authorization')
const projectId = prior?.projectId ?? `delivery-smoke-${crypto.randomUUID()}`
const priorUsageMicro = prior ? (await api(`/api/usage/summary?projectId=${projectId}`)).creditsMicro : 0
if (typeof priorUsageMicro !== 'number' || !Number.isFinite(priorUsageMicro) || priorUsageMicro < 0)
  throw new Error('Cannot confirm prior project spend')
const baselineProjectCredits = Math.max(priorUsageMicro / 1e6, prior?.accountExposureDeltaCredits ?? 0)
if (!Number.isFinite(baselineProjectCredits)) throw new Error('Cannot confirm prior project spend')
const report: Record<string, any> = { projectId, authorizedCredits: maxCredits,
  // Billing is asynchronous: stop well before the authorization ceiling,
  // leaving 750 credits for in-flight work. This is a watchdog, not an atomic
  // provider spend reservation. Do not claim an exact hard billing cap.
  stopThresholdCredits: Math.min(250, maxCredits / 4), startedAt: new Date().toISOString(),
  baselineProjectCredits, initialWalletMicro: initial, checkpoints: [], outcome: 'starting' }
if (baselineProjectCredits >= report.stopThresholdCredits) throw new Error('Saved test has reached the smoke budget threshold')
let started = false
let done = false
let stopping: Promise<void> | undefined
async function stop() {
  if (!started || done) return
  report.stopRequestedBy = 'test_monitor'
  stopping ??= api(`/api/projects/${projectId}/stop`, { reason: 'test_monitor_stop' }).then(() => undefined)
  await stopping
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => { void stop().finally(() => process.exit(1)) })
try {
  started = true // A bootstrap timeout may still have created a running project.
  const created = prior ? { project: { root_path: prior.workspace }, session: { id: prior.sessionId } } : await api('/api/projects/bootstrap', {
    project: { id: projectId, name: 'Maze Snake Delivery Check', created_at: Date.now() },
    projectName: 'maze-snake-delivery-check', language: 'zh',
    brief: { idea: '我要做一个有三个关卡的迷宫贪吃蛇，能在浏览器里玩。', creationMode: 'blueprint',
      resourceLibraryUsage: 'optional', document_language: 'zh', game_user_visible_language: 'zh', agent_response_language: 'zh' },
  })
  report.sessionId = created.session.id
  report.workspace = created.project.root_path
  if (prior) {
    report.resumedFrom = resumeReport
    const restored = await api(`/api/projects/${projectId}/session/ensure`, {})
    if (restored.session?.id !== report.sessionId)
      throw new Error('Resume did not recover the same project session; refusing to start another')
    await api(`/api/beegame-sessions/${report.sessionId}/continue`, {})
  }
  console.log(JSON.stringify({ event: 'started', projectId, sessionId: report.sessionId, reportRoot }))
  const deadline = Date.now() + 60 * 60 * 1000
  while (Date.now() < deadline) {
    const { wallet: currentWallet, usage, session, gate, errors, billingAvailable } =
      await observeDeliverySmoke(api, projectId, report.sessionId)
    if (errors.length) {
      report.observationErrors ??= []
      report.observationErrors.push({ time: new Date().toISOString(), errors })
      console.log(JSON.stringify({ event: 'observation-error', errors }))
    }
    if (!billingAvailable) throw new Error('Billing observations unavailable; stopped for budget protection')
    const exposure = baselineProjectCredits + (Number(currentWallet.consumedCreditsMicro) + Number(currentWallet.reservedCreditsMicro) - initial) / 1e6
    const charged = Number(usage.creditsMicro) / 1e6
    if (![exposure, charged].every(Number.isFinite)) throw new Error('Billing observations unavailable')
    report.usage = usage
    report.accountExposureDeltaCredits = exposure
    const checkpoint = { time: new Date().toISOString(), credits: charged, exposure,
      status: session?.status, turnStatus: session?.turnStatus, releaseReady: gate?.allowed }
    report.checkpoints.push(checkpoint)
    console.log(JSON.stringify(checkpoint))
    await writeFile(join(reportRoot, 'report.json'), JSON.stringify(report, null, 2))
    if (Math.max(charged, exposure) >= report.stopThresholdCredits) { report.outcome = 'budget-watchdog'; break }
    if (gate?.allowed && session?.turnStatus === 'idle') {
      report.outcome = 'release-ready-needs-independent-inspection'; done = true; break
    }
    if (session && session.status !== 'running') { report.outcome = session.status; break }
    // Idle can be phase settlement or background work. It is not a stop command.
    await Bun.sleep(10000)
  }
  if (report.outcome === 'starting') report.outcome = 'test-deadline'
} catch (error) {
  report.outcome = 'test-error'
  report.error = error instanceof Error ? error.message : 'unknown'
} finally {
  try { await stop() } catch (error) { report.stopError = error instanceof Error ? error.message : 'unknown' }
  report.finishedAt = new Date().toISOString()
  await writeFile(join(reportRoot, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ event: 'finished', outcome: report.outcome, reportRoot, projectId, stopError: report.stopError }))
  if (!done || report.stopError) process.exitCode = 1
}
