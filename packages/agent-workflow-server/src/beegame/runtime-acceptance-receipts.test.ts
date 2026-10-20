import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { artifactDigest, inspectDesignAcceptance, readRuntimeAcceptanceReport, runtimeEvidenceIsCurrent } from './runtime-acceptance'
import { projectFiles, projectDependencies, AGENT_EVIDENCE_DIRECTORY } from './workflow-v3/editable-project'
import { designRequirementChecksFixture, writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { DESIGN_ACCEPTANCE_PATH } from './design-handoff'
import { bundleAcceptanceChecker } from './acceptance-check-bundle'

let root: string
const directory = '.beegame/tmp/preview-test-fixture'
const receiptPath = directory + '/execution.json', stdout = directory + '/stdout.txt', stderr = directory + '/stderr.txt'
const identity = { runId: 'run', requirementsRevision: 'requirements' }

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-acceptance-receipts-')))
  await writeDesignDocumentsFixture(root, ['GDD.md', 'AUDIO_DESIGN.md'])
  for (const dir of ['tests', 'dist', 'reports', directory, '.beegame/delivery']) await mkdir(join(root, dir), { recursive: true })
  await writeFile(join(root, 'package.json'), '{}')
  await writeFile(join(root, 'game.js'), 'Synthetic source')
  await writeFile(join(root, 'dist/game.js'), 'Synthetic build')
  await writeFile(join(root, 'tests/check.mjs'), 'console.log("synthetic observation")')
  await writeFile(join(root, stdout), 'Synthetic passed assertion')
  await writeFile(join(root, stderr), '')
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

async function inputs() {
  return { ...identity, attemptId: 'attempt', files: await projectFiles(root, '', [AGENT_EVIDENCE_DIRECTORY]),
    dependencySha256: await projectDependencies(root) }
}
async function receipt() {
  const snapshot = { status: 'observed', scriptSha256: await artifactDigest(root, 'tests/check.mjs'), inputs: await inputs() }
  return { script: 'tests/check.mjs', runtime: 'node', status: 'exited', exitCode: 0, signal: null,
    startedAt: '2026-10-20T00:00:00Z', finishedAt: '2026-10-20T00:00:01Z', inputIdentity: 'unchanged-at-boundaries',
    before: snapshot, after: structuredClone(snapshot), stdoutPath: stdout, stderrPath: stderr, reportPath: receiptPath,
    quality: 'unverified' }
}
async function saveReceipt(value: unknown) { await writeFile(join(root, receiptPath), JSON.stringify(value)) }
async function saveReport(support = receiptPath, extra: string[] = [], status = 'passed') {
  await writeFile(join(root, DESIGN_ACCEPTANCE_PATH), JSON.stringify({ scope: 'delivery', status,
    summary: 'Synthetic author verdict; not a game-quality observation', environment: 'Offline fixture',
    artifactPaths: ['dist'], evidencePaths: [support, ...extra], verification: {
      target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [],
      requirementChecks: designRequirementChecksFixture(root, [support]),
    } }))
}
const inspect = () => readRuntimeAcceptanceReport(root, DESIGN_ACCEPTANCE_PATH, { executionIdentity: identity })

test.each([
  { status: 'exited', exitCode: 1 }, { status: 'timed-out', exitCode: null },
  { status: 'interrupted', exitCode: null }, { status: 'started', exitCode: null },
  { status: 'launch-failed', exitCode: null }, { status: 'exited', exitCode: 0, signal: 'SIGTERM' },
])('failed or unfinished execution cannot support PASS: %j', async outcome => {
  await saveReceipt({ ...await receipt(), ...outcome }); await saveReport()
  const result = (await inspect())!
  expect(result).toMatchObject({ status: 'blocked', diagnostic: { category: 'verification-incomplete' } })
  expect(result.summary).toContain('execution did not succeed')
  expect(await runtimeEvidenceIsCurrent(root, [result], identity)).toBe(false)
  // Also reject an old saved PASS, without relying on the report reader having run first.
  expect(await runtimeEvidenceIsCurrent(root, [{ ...result, status: 'passed' }], identity)).toBe(false)
})

test.each(['source', 'script', 'build', 'added', 'removed', 'dependencies'] as const)('expired %s invalidates both fresh and saved acceptance', async change => {
  await saveReceipt(await receipt()); await saveReport()
  const accepted = (await inspect())!
  expect(accepted.status).toBe('passed')
  expect(await runtimeEvidenceIsCurrent(root, [accepted], identity)).toBe(true)
  if (change === 'removed') await rm(join(root, 'game.js'))
  else if (change === 'dependencies') {
    await mkdir(join(root, 'node_modules/test'), { recursive: true })
    await writeFile(join(root, 'node_modules/test/index.js'), 'Synthetic changed dependency')
  } else await writeFile(join(root, { source: 'game.js', script: 'tests/check.mjs', build: 'dist/game.js', added: 'extra.js' }[change]), 'Changed')
  expect((await inspect())!.summary).toContain('Tested inputs changed')
  expect(await runtimeEvidenceIsCurrent(root, [accepted], identity)).toBe(false)
})

test('missing snapshots and changed boundaries remain unverified even if the summary flag says unchanged', async () => {
  const valid = await receipt(); await saveReport()
  for (const value of [
    { ...valid, before: undefined }, { ...valid, after: { status: 'unverified' } },
    { ...valid, after: { ...valid.after, scriptSha256: 'a'.repeat(64) } },
    { ...valid, inputIdentity: 'changed' }, { ...valid, finishedAt: undefined },
  ]) {
    await saveReceipt(value)
    expect((await inspect())!.status).toBe('blocked')
  }
  await saveReceipt(valid)
  for (const changed of [{ ...identity, runId: 'another-run' }, { ...identity, requirementsRevision: 'new-request' }]) {
    const accepted = (await inspect())!
    expect((await readRuntimeAcceptanceReport(root, DESIGN_ACCEPTANCE_PATH, { executionIdentity: changed }))!.summary).toContain('Run or requirements identity changed')
    expect(await runtimeEvidenceIsCurrent(root, [accepted], changed)).toBe(false)
  }
})

test.each([receiptPath, stdout, stderr, './' + stdout])('receipt and log citations share validation and retained evidence: %s', async support => {
  await saveReceipt(await receipt()); await saveReport(support)
  const accepted = (await inspect())!
  expect(accepted.status).toBe('passed')
  expect(accepted.evidence.map(file => file.path)).toEqual(expect.arrayContaining([receiptPath, stdout, stderr]))
  expect(await runtimeEvidenceIsCurrent(root, [accepted], identity)).toBe(true)
  expect(await inspectDesignAcceptance(root, false, false, identity)).toMatchObject({ valid: true, quality: 'unverified' })
  await writeFile(join(root, stderr), 'Rewritten output')
  expect(await runtimeEvidenceIsCurrent(root, [accepted], identity)).toBe(false)
  await saveReceipt({ ...await receipt(), status: 'timed-out', exitCode: null })
  expect((await inspect())!.status).toBe('blocked')
})

test('diagnostic failed history and honest failed reports remain retainable without becoming positive evidence', async () => {
  await saveReceipt(await receipt())
  const historical = '.beegame/tmp/preview-test-failed/execution.json'
  await mkdir(join(root, '.beegame/tmp/preview-test-failed'))
  await writeFile(join(root, historical), JSON.stringify({ status: 'timed-out', exitCode: null }))
  await saveReport(receiptPath, [historical])
  const accepted = (await inspect())!
  expect(accepted.status).toBe('passed')
  expect(await runtimeEvidenceIsCurrent(root, [accepted], identity)).toBe(true)
  await saveReport(historical, [], 'failed')
  expect((await inspect())!.status).toBe('failed')
})

test('missing or aliased receipt/log cannot be used as a successful observation', async () => {
  const valid = await receipt(); await saveReceipt(valid); await saveReport(stdout)
  await rm(join(root, receiptPath))
  expect((await inspect())!.status).toBe('blocked')
  await saveReceipt(valid)
  await rm(join(root, stderr))
  await symlink(join(root, stdout), join(root, stderr))
  expect((await inspect())!.summary).toContain('alias')
  await rm(join(root, stderr)); await writeFile(join(root, stderr), '')
  await saveReceipt({ ...valid, stdoutPath: 'game.js' })
  expect((await inspect())!.summary).toContain('paths do not match')
})

test('a real local test receipt is accepted read-only after execution stops; bundled CLI rejects stale inputs', async () => {
  const script = 'tests/check.mjs'
  await writeFile(join(root, script), `import {appendFileSync} from 'node:fs'; appendFileSync('reports/calls.txt','once'); console.log('Synthetic assertion');`)
  const snapshot = await inputs(), capability = join(root, '.beegame/test-capability.json')
  await writeFile(capability, JSON.stringify({ version: 1, workspace: root, executionId: 'fixture', sessionId: 'fixture', apiUrl: 'http://127.0.0.1:1' }))
  const child = Bun.spawn([Bun.which('node')!, '--input-type=module', '-e', `
    globalThis.fetch=async(url)=>Response.json(new URL(url).pathname==='/status'?{}:${JSON.stringify(snapshot)});
    const {runPreviewTest}=await import(${JSON.stringify(new URL('./preview-test-command.mjs', import.meta.url).href)});
    console.log(JSON.stringify(await runPreviewTest(${JSON.stringify(script)})));
  `], { cwd: root, env: { PATH: process.env.PATH!, BEEGAME_PREVIEW_CAPABILITY_FILE: capability, BEEGAME_MEASUREMENT_CAPABILITY_FILE: capability }, stdout: 'pipe', stderr: 'pipe' })
  const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(code, errors).toBe(0)
  const result = JSON.parse(output)
  expect(result).toMatchObject({ status: 'exited', exitCode: 0, inputIdentity: 'unchanged-at-boundaries', quality: 'unverified' })
  await rm(capability)
  await saveReport(result.reportPath)
  const accepted = (await inspect())!
  expect(accepted.status).toBe('passed')
  expect(await runtimeEvidenceIsCurrent(root, [accepted], identity)).toBe(true)
  const cli = join(root, '.beegame/check-acceptance.mjs')
  await writeFile(cli, await bundleAcceptanceChecker())
  const read = () => Bun.spawnSync([process.execPath, cli, DESIGN_ACCEPTANCE_PATH], { cwd: root })
  const initial = read()
  expect(initial.exitCode, initial.stderr.toString() + initial.stdout.toString()).toBe(0)
  await writeFile(join(root, 'game.js'), 'changed source')
  const stale = read()
  expect(stale.exitCode).toBe(1)
  expect(JSON.parse(stale.stdout.toString()).diagnostic.message).toContain('Tested inputs changed')
  expect(await readFile(join(root, 'reports/calls.txt'), 'utf8')).toBe('once')
})


test.each([receiptPath,stdout,stderr])('an evidence alias still checks the actual Preview receipt: %s',async target=>{
  await saveReceipt({...await receipt(),status:'timed-out',exitCode:null})
  const alias='reports/aliased-observation.txt'
  await symlink(join(root,target),join(root,alias))
  await saveReport(alias)
  expect((await inspect())!.status).toBe('blocked')
  expect((await inspect())!.summary).toContain('execution did not succeed')
  await saveReceipt(await receipt())
  const result=(await inspect())!
  expect(result.status).toBe('passed')
  expect(result.evidence.map(file=>file.path)).toEqual(expect.arrayContaining([alias,receiptPath,stdout,stderr]))
  expect(await runtimeEvidenceIsCurrent(root,[result],identity)).toBe(true)
  await saveReceipt({...await receipt(),exitCode:1})
  expect(await runtimeEvidenceIsCurrent(root,[result],identity)).toBe(false)
})
