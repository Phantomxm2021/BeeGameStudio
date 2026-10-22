import { readDesignHandoff } from '../workflow-read-tools'
import { test, expect } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openAgentTools } from './agent-tools'
import { readImplementationTask } from '../workflow-read-tools'
import { projectPreviewCapabilityPath } from '../project-preview-capability'
import { writeDesignDocumentsFixture } from '../fixtures/layout-fixture'
import { designHandoffPath, readDesignImplementationChecklist, readDesignAcceptanceRequirements } from '../design-handoff'

test('baseline and implementation CLI summarize inputs, expose existing execution entries and retain failures', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-baseline-cli-')))
  const sessionId = 'baseline-fixture'
  const inspected: boolean[] = []
  let implementationCalls = 0
  const sourceRequests: { paths: string[]; details: boolean }[] = []
  const unexpected = async () => { throw Error('Baseline must not execute other measurement operations') }
  const measurement: NonNullable<Parameters<typeof openAgentTools>[0]['measurement']> = {
    async assertActive(write = false) { inspected.push(write); return { runId: 'fixture', requirementsRevision: 'fixture' } },
    async close() {},
    authorizeDesignChange: unexpected,
    designFileChanges: () => ({scope: 'design-revision-files',attemptId: 'fixture',requestKey: 'fixture',status: 'unverified',files: []}),
    async lockDesignBaseline() {
      implementationCalls++
      return { valid: true, ...readDesignImplementationChecklist(root), requirements: readDesignAcceptanceRequirements(root),
        designBaseline: { revision: 'fixture', capturedAt: '2026-01-01T00:00:00Z', scope: 'Fixture only' } }
    },
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
      scope: 'design-source-integrity', valid: true, issues: [], requirementCount: 8,
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

    expect(implementationCalls).toBe(0)
    const implementationHelp = await command('--design', 'implementation', '--help')
    expect(implementationHelp.code, implementationHelp.stderr).toBe(0)
    expect(JSON.parse(implementationHelp.stdout).instruction).toContain('Use --design implementation only when entering authorized implementation')
    expect(JSON.parse(implementationHelp.stdout).help).toContain('locks planning records')
    expect(implementationCalls).toBe(0)
    expect(inspected.every(write => write === false)).toBe(true)
    expect(await readFile(join(root, 'docs/GDD.md'), 'utf8')).toBe(original)
    const implementation = await command('--design', 'implementation')
    expect(implementation.code, implementation.stderr).toBe(0)
    const entry = JSON.parse(implementation.stdout)
    const implementationDetails = await command('--design', 'implementation', '--details')
    expect(implementationDetails.code, implementationDetails.stderr).toBe(0)
    const complete = JSON.parse(implementationDetails.stdout)
    expect(entry).toMatchObject({ scope: 'implementation-handoff', valid: true,
      execution: { sources: expect.stringContaining('ReadDesignHandoff') } })
    expect(entry).not.toHaveProperty('requirements')
    expect(entry.items).toEqual(complete.items.map((item: any) => ({
      id: item.id, dependsOn: item.dependsOn, section: item.taskSource.section,
    })))
    expect(complete.requirements).toHaveLength(8)
    expect(complete.items[0].requirements.length).toBeGreaterThan(0)
    expect(complete.requirements[0].documentSha256).toBeString()
    expect(entry.designRevision).toBe(complete.designRevision)
    expect(entry.resultPath).toBe(complete.resultPath)
    expect(entry.limitation).toBe(complete.limitation)
    expect(implementation.stdout.length).toBeLessThan(implementationDetails.stdout.length / 2)
    expect(implementationCalls).toBe(2)
    const task = readImplementationTask(root, { id: entry.items[0].id })
    expect(task.valid, task.issues.join(' ')).toBe(true)
    expect('sources' in task && task.sources.length).toBeGreaterThan(0)
    expect(await readFile(join(root, 'docs/GDD.md'), 'utf8')).toBe(original)

    const shortHelp = await command('--design', 'help')
    const fullHelp = await command('--design', 'help', '--details')
    expect(shortHelp.code, shortHelp.stderr).toBe(0)
    expect(fullHelp.code, fullHelp.stderr).toBe(0)
    expect(shortHelp.stdout.length).toBeLessThan(fullHelp.stdout.length)
    expect(JSON.parse(shortHelp.stdout)).not.toHaveProperty('acceptanceExample')
    expect(JSON.parse(shortHelp.stdout).details).toContain('--design help --details')
    expect(JSON.parse(shortHelp.stdout).help).toContain('Plain documents need no index or finalization')
    expect(JSON.parse(shortHelp.stdout).help).toContain('ReadDesignHandoff')
    expect(JSON.parse(shortHelp.stdout).help).not.toContain('--design finalize')
    expect(tools.systemContext).toContain('Document navigation: ReadDesignHandoff')
    expect(tools.systemContext).not.toContain('Document authoring contract:')
    const help = JSON.parse(fullHelp.stdout)
    expect(help.writingOrder).toEqual(['GDD.md','LEVEL_SCENE_DESIGN.md','BALANCE_DESIGN.md',
      'ART_DIRECTION.md','UI_UX_SPEC.md','AUDIO_DESIGN.md','ASSET_PLAN.md','TECHNICAL_DESIGN.md'])
    expect(help.instruction).toContain('BGS does not require output indexes, task graphs or coverage mappings')
    expect(help.help).toContain('--design finalize')
    expect(help).not.toHaveProperty('acceptanceExample')
    expect(help).not.toHaveProperty('acceptanceInstruction')
    expect(help.instruction).not.toContain('Use --design implementation only when entering authorized implementation')
    expect(help.relatedHelp).toContain('--design acceptance --help')
    expect(help.relatedHelp).toContain('--design implementation --help')
    const acceptanceHelp = await command('--design', 'acceptance', '--help')
    expect(acceptanceHelp.code, acceptanceHelp.stderr).toBe(0)
    const runtimeHelp = JSON.parse(acceptanceHelp.stdout)
    expect(implementationCalls).toBe(2)
    expect(inspected.every(write=>write===false)).toBe(true)
    expect(JSON.parse((await command('--design','baseline')).stdout)).toEqual(JSON.parse(compact.stdout))
    expect(runtimeHelp.acceptanceInstruction).toContain('verification.designRevision (64 lowercase hexadecimal characters)')
    expect(runtimeHelp.acceptanceInstruction).toContain('not a top-level designRevision')
    expect(runtimeHelp.acceptanceInstruction).toContain('--design baseline (read-only)')
    expect(runtimeHelp.acceptanceInstruction).toContain('do not invoke it merely to read a revision')
    expect(runtimeHelp.acceptanceInstruction).toContain('blocked/failed report may omit verification.designRevision')
    expect(runtimeHelp.acceptanceExample.verification).not.toHaveProperty('designRevision')
    expect(runtimeHelp.acceptanceInstruction).toContain('An existing measurement is immutable')
    expect(runtimeHelp.acceptanceInstruction).not.toContain('attach the report to the existing measurement')
    expect(runtimeHelp.acceptanceInstruction).toContain('verification.contentChecks')
    // The actual CLI example must parse with the existing report reader while
    // remaining incomplete, even if its status is changed to passed.
    const acceptancePath = join(root, '.beegame/delivery/acceptance.json')
    await mkdir(join(root, '.beegame/delivery'), { recursive: true })
    await writeFile(acceptancePath, JSON.stringify(runtimeHelp.acceptanceExample))
    const example = JSON.parse((await command('--design', 'acceptance')).stdout)
    expect(example).toMatchObject({ valid: false, status: 'blocked',
      diagnostic: { category: 'verification-incomplete' } })
    expect(await readFile(acceptancePath, 'utf8')).toBe(JSON.stringify(runtimeHelp.acceptanceExample))
    await writeFile(acceptancePath, JSON.stringify({ ...runtimeHelp.acceptanceExample, status: 'passed' }))
    expect(JSON.parse((await command('--design', 'acceptance')).stdout)).toMatchObject({
      valid: false, status: 'blocked',
    })
    await writeFile(acceptancePath, JSON.stringify({ ...runtimeHelp.acceptanceExample, environment: { browser: 'fixture' } }))
    const malformed = JSON.parse((await command('--design', 'acceptance')).stdout)
    expect(malformed.diagnostic).toMatchObject({ category: 'report-invalid', message: expect.stringContaining('environment') })
    // One batch finalizes all changed owners; an unchanged second batch is
    // byte-stable and leaves the existing task and acceptance readers usable.
    expect(inspected.every(write => write === false)).toBe(true)
    for (const name of help.writingOrder) {
      const path = join(root, 'docs', name)
      await writeFile(path, (await readFile(path, 'utf8')) + '\nRevised fixture decision.\n')
    }
    const batch = await command('--design', 'finalize')
    expect(batch.code, batch.stderr).toBe(0)
    expect(JSON.parse(batch.stdout).finalized).toHaveLength(8)
    const versioned = JSON.parse((await command('--design', 'baseline')).stdout)
    expect(Object.values(versioned.documentVersions)).toEqual(Array(8).fill('1.1'))
    const finalizedPaths = help.writingOrder.flatMap((name: string) => [join(root, 'docs', name), join(root, designHandoffPath(name))])
    const bytes = await Promise.all(finalizedPaths.map((path: string) => readFile(path, 'utf8')))
    expect((await command('--design', 'finalize')).code).toBe(0)
    expect(await Promise.all(finalizedPaths.map((path: string) => readFile(path, 'utf8')))).toEqual(bytes)
    expect(readDesignAcceptanceRequirements(root)).toHaveLength(8)
    expect(readImplementationTask(root, { id: entry.items[0].id }).valid).toBe(true)

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

    // The real CLI must distinguish pending writing from errors, and still
    // check supplied task references once all owner inputs are saved.
    const artPath = join(root, 'docs/ART_DIRECTION.md')
    const art = await readFile(artPath, 'utf8')
    await rm(artPath)
    const pending = await command('--design', 'draft', 'TECHNICAL_DESIGN.md')
    expect(pending.code, pending.stderr).toBe(0)
    expect(JSON.parse(pending.stdout)).toMatchObject({
      valid: true, issues: [], pendingDocuments: ['ART_DIRECTION.md'], taskReferencesChecked: false,
    })
    const wrongRef = JSON.parse(technical)
    wrongRef.implementationItems[0].requirementRefs[0].id = 'invented'
    await writeFile(technicalPath, JSON.stringify(wrongRef))
    const invalidPending = await command('--design', 'draft', 'TECHNICAL_DESIGN.md')
    expect(invalidPending.code).toBe(1)
    expect(JSON.parse(invalidPending.stdout).issues.join(' ')).toContain('references missing requirement GDD.md#invented')
    await writeFile(artPath, art)
    const uncovered = JSON.parse(technical)
    uncovered.implementationItems.shift()
    await writeFile(technicalPath, JSON.stringify(uncovered))
    const completeInputs = await command('--design', 'draft', 'TECHNICAL_DESIGN.md')
    expect(completeInputs.code).toBe(0)
    expect(JSON.parse(completeInputs.stdout)).toMatchObject({
      valid: true, pendingDocuments: [], taskReferencesChecked: true, issues: [],
    })
    await writeFile(technicalPath, technical)

    // Details are a fresh read, not a cached success after input changes.
    await writeFile(join(root, 'docs/GDD.md'), 'Invalid fixture: required sections removed')
    const failed = await command('--design', 'baseline')
    const failedDetails = await command('--design', 'baseline', '--details')
    expect(failed.code).toBe(1)
    expect(failedDetails.code).toBe(1)
    expect(JSON.parse(failed.stdout)).toMatchObject({ valid: false, requirementCount: 7 })
    expect(JSON.parse(failed.stdout).issues.length).toBeGreaterThan(0)
    expect(JSON.parse(failed.stdout).issues).toEqual(JSON.parse(failedDetails.stdout).issues)

    for (const args of [ ['--design', 'implementation'], ['--design', 'implementation', '--details'] ]) {
      const blocked = await command(...args)
      expect(blocked.code).toBe(1)
      const failure = JSON.parse(blocked.stdout)
      expect(failure.error).toContain('GDD.md')
      expect(failure).not.toHaveProperty('execution')
    }

    // Help remains readable even when the actual implementation handoff is blocked.
    const blockedCalls = implementationCalls
    expect((await command('--design', 'implementation', '--help')).code).toBe(0)
    expect((await command('--design', 'acceptance', '--help')).code).toBe(0)
    expect(implementationCalls).toBe(blockedCalls)

    const source = await command('docs/GDD.md', '--details')
    expect(source.code).toBe(1)
    expect(sourceRequests).toEqual([{ paths: ['docs/GDD.md'], details: true }])
    expect(JSON.parse(source.stdout)).toEqual({ error: 'Synthetic source inspection failure' })
    expect((await command('--design', 'draft', '../GDD.md')).code).toBe(1)
    // Plain documents have no index metadata to finalize or indexed requirements to count.
    for (const name of help.writingOrder) {
      await rm(join(root, designHandoffPath(name)))
      await writeFile(join(root, 'docs', name), '# Fixture\n\nPlain design decisions.\n')
    }
    const plainBefore = await Promise.all(help.writingOrder.map((name: string) => readFile(join(root, 'docs', name), 'utf8')))
    const plain = await command('--design', 'finalize')
    expect(plain.code, plain.stderr).toBe(0)
    expect(JSON.parse(plain.stdout)).toMatchObject({ valid: true, finalized: [], skipped: expect.arrayContaining(help.writingOrder) })
    expect(JSON.parse(plain.stdout).skipped).toHaveLength(8)
    const plainBaseline = await command('--design', 'baseline')
    expect(plainBaseline.code, plainBaseline.stderr).toBe(0)
    expect(JSON.parse(plainBaseline.stdout)).not.toHaveProperty('requirementCount')
    const plainImplementation = await command('--design', 'implementation')
    expect(plainImplementation.code, plainImplementation.stderr).toBe(0)
    const navigation = JSON.parse(plainImplementation.stdout)
    expect(navigation.items).toEqual([])
    expect(navigation.documents).toHaveLength(1)
    expect(navigation.documents[0]).toMatchObject({ document: 'TECHNICAL_DESIGN.md' })
    const section = navigation.documents[0].sections[0].heading
    expect(section).toBe('Fixture')
    const plainSource = readDesignHandoff(root, { read: [{ document: 'TECHNICAL_DESIGN.md', sections: [section] }] })
    expect(plainSource.valid).toBe(true)
    expect(plainSource.sources[0]!.reads[0]!.text).toContain('Plain design decisions.')

    expect(await Promise.all(help.writingOrder.map((name: string) => readFile(join(root, 'docs', name), 'utf8')))).toEqual(plainBefore)
    for (const name of help.writingOrder) expect(await Bun.file(join(root, designHandoffPath(name))).exists()).toBe(false)
    const beforeInvalid = inspected.length
    for (const args of [
      ['--design', 'baseline', '--details', '--details'],
      ['--design', 'baseline', '--help'],
      ['--design', 'implementation', '--help', '--details'],
      ['--design', 'acceptance', '--help', '--details'],
      ['--design', 'implementation', 'GDD.md', '--help'],
      ['--design', 'implementation', '--details', '--details'],
      ['--design', 'implementation', 'docs/GDD.md'],
      ['--design', 'finalize', '--details'],
      ['--design', 'baseline', 'docs/GDD.md'],
      ['--design', 'draft'],
      ['--design', 'draft', 'GDD.md', 'TECHNICAL_DESIGN.md'],
    ]) expect((await command(...args)).code).toBe(1)
    expect(inspected).toHaveLength(beforeInvalid)
    expect(inspected.filter(Boolean)).toHaveLength(3)
  } finally {
    await tools.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
