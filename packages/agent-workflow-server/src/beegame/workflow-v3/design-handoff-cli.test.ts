import { test, expect } from 'bun:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openAgentTools } from './agent-tools'
import { projectPreviewCapabilityPath } from '../project-preview-capability'
import { writeDesignDocumentsFixture } from '../fixtures/layout-fixture'
import { designHandoffPath } from '../design-handoff'

test('baseline CLI summarizes integrity without hiding failures or certifying absent layouts', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-baseline-cli-')))
  const sessionId = 'baseline-fixture'
  const inspected: boolean[] = []
  const sourceRequests: { paths: string[]; details: boolean }[] = []
  const unexpected = async () => { throw Error('Baseline must not execute other measurement operations') }
  const measurement: NonNullable<Parameters<typeof openAgentTools>[0]['measurement']> = {
    async assertActive(write = false) { inspected.push(write) },
    async close() {},
    designFileChanges: () => ({scope: 'design-revision-files',attemptId: 'fixture',requestKey: 'fixture',status: 'unverified',files: []}),
    lockDesignBaseline: unexpected,
    async handoff(paths = [], details = false) {
      sourceRequests.push({ paths, details })
      throw Error('Synthetic source inspection failure')
    },
    measure: unexpected,
    executionInputs: unexpected,
    context: unexpected,
    inspect: unexpected,
  }
  await writeDesignDocumentsFixture(root)
  const tools = await openAgentTools({ workspacePath: root, sessionId, measurement, getAuthToken: () => undefined })
  const command = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, join(root, tools.directory, 'handoff.mjs'), ...args], {
      cwd: root,
      env: { ...process.env, BEEGAME_MEASUREMENT_CAPABILITY_FILE: projectPreviewCapabilityPath(root, sessionId, 'measurement') },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    return { stdout, stderr, code }
  }
  try {
    const original = await readFile(join(root, 'docs/GDD.md'), 'utf8')
    const compact = await command('--design', 'baseline')
    expect(compact.code, compact.stderr).toBe(0)
    expect(JSON.parse(compact.stdout)).toMatchObject({
      scope: 'design-index-integrity', valid: true, issues: [], requirementCount: 8,
      layoutVerified: false, runtimeVerified: false,
    })
    expect(JSON.parse(compact.stdout)).not.toHaveProperty('requirements')
    const detailed = await command('--design', 'baseline', '--details')
    expect(detailed.code, detailed.stderr).toBe(0)
    const full = JSON.parse(detailed.stdout)
    expect(full.requirements).toHaveLength(8)
    expect(full.snapshots['GDD.md']).toBeString()
    expect(JSON.parse(compact.stdout).revision).toBe(full.revision)
    expect(compact.stdout.length).toBeLessThan(detailed.stdout.length)
    expect(await readFile(join(root, 'docs/GDD.md'), 'utf8')).toBe(original)

    const help = JSON.parse((await command('--design', 'help')).stdout)
    expect(help.acceptanceInstruction).toContain('An existing measurement is immutable')
    expect(help.acceptanceInstruction).not.toContain('attach the report to the existing measurement')
    expect(help.acceptanceInstruction).toContain('verification.contentChecks')
    const technicalPath = join(root, designHandoffPath('TECHNICAL_DESIGN.md'))
    const technical = await readFile(technicalPath, 'utf8'), broken = JSON.parse(technical)
    broken.implementationItems[0].requirementRefs = []
    await writeFile(technicalPath, JSON.stringify(broken))
    const draft = await command('--design', 'draft', 'TECHNICAL_DESIGN.md')
    expect(draft.code, draft.stderr).toBe(1)
    const diagnostic = JSON.parse(draft.stdout)
    expect(diagnostic.availableRequirements).toContainEqual(expect.objectContaining({ document: 'GDD.md' }))
    expect(diagnostic.issues.join(' ')).toContain('--design draft TECHNICAL_DESIGN.md')
    expect(diagnostic.issues.join(' ')).not.toContain('--check-handoff-drafts')
    expect(await readFile(technicalPath, 'utf8')).toBe(JSON.stringify(broken))
    await writeFile(technicalPath, technical)

    // Details are a fresh read, not a cached success after input changes.
    await writeFile(join(root, 'docs/GDD.md'), 'Invalid fixture: required sections removed')
    const failed = await command('--design', 'baseline')
    const failedDetails = await command('--design', 'baseline', '--details')
    expect(failed.code).toBe(1)
    expect(failedDetails.code).toBe(1)
    expect(JSON.parse(failed.stdout)).toMatchObject({ valid: false, requirementCount: 0 })
    expect(JSON.parse(failed.stdout).issues.length).toBeGreaterThan(0)
    expect(JSON.parse(failed.stdout).issues).toEqual(JSON.parse(failedDetails.stdout).issues)

    const source = await command('docs/GDD.md', '--details')
    expect(source.code).toBe(1)
    expect(sourceRequests).toEqual([{ paths: ['docs/GDD.md'], details: true }])
    expect(JSON.parse(source.stdout)).toEqual({ error: 'Synthetic source inspection failure' })
    expect((await command('--design', 'draft', '../GDD.md')).code).toBe(1)
    const beforeInvalid = inspected.length
    for (const args of [
      ['--design', 'baseline', '--details', '--details'],
      ['--design', 'finalize', '--details'],
      ['--design', 'baseline', 'docs/GDD.md'],
      ['--design', 'draft'],
      ['--design', 'draft', 'GDD.md', 'TECHNICAL_DESIGN.md'],
    ]) expect((await command(...args)).code).toBe(1)
    expect(inspected).toHaveLength(beforeInvalid)
    expect(inspected.every(write => write === false)).toBe(true)
  } finally {
    await tools.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
