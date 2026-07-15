import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluatePersistedDeliveryAcceptance } from './delivery-acceptance-audit'
import { recordNativeAcceptanceReportForTest } from './native-acceptance-evidence'

const TEST_SESSION_ID = 'native-acceptance-test-session'

describe('persisted delivery acceptance audit', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
    if (workspace) await rm(dataRootFor(workspace), { recursive: true, force: true })
  })

  test('accepts a report that covers the identified checklist with observable evidence', async () => {
    workspace = await createWorkspace()
    await writeAcceptance(workspace, validReport())

    expect(evaluate(workspace)).toEqual({
      allowed: true,
      outcome: 'passed',
      issues: [],
    })
  })

  test('rejects unchecked checklist items even when the report claims passed', async () => {
    workspace = await createWorkspace({ checked: false })
    await writeAcceptance(workspace, validReport())

    const result = evaluate(workspace)

    expect(result.allowed).toBe(false)
    expect(result.issues).toContain('path-primary is still unchecked in the acceptance checklist.')
  })

  test('rejects a hand-authored passing report without an observed native validator result', async () => {
    workspace = await createWorkspace()
    await writeFile(
      join(workspace, 'docs', 'acceptance', 'validation-report.json'),
      JSON.stringify(validReport()),
    )

    expect(evaluate(workspace).issues).toContain(
      'The validation report is not the terminal result of an observed native acceptance Validator call.',
    )
  })

  test('rejects reports that omit a document-declared player path', async () => {
    workspace = await createWorkspace()
    const report = validReport()
    report.playerPaths = []
    await writeAcceptance(workspace, report)

    expect(evaluate(workspace).issues).toContain(
      'The report omits player path path-primary.',
    )
  })

  test('rejects runtime claims without an observable action and assertion', async () => {
    workspace = await createWorkspace()
    const report = validReport()
    report.playerPaths = [{
      id: 'path-primary',
      status: 'passed',
      evidence: [{
        id: 'evidence-path-primary',
        kind: 'runtime',
        source: 'path-primary',
        result: 'passed',
        detail: 'Claimed success without an observation contract.',
      }],
    }]
    await writeAcceptance(workspace, report)

    const issues = evaluate(workspace).issues
    expect(issues).toContain('path-primary runtime evidence is missing workingDirectory.')
    expect(issues).toContain('path-primary runtime evidence is missing action.')
    expect(issues).toContain('path-primary runtime evidence is missing assertion.')
  })

  test('requires structural acceptance ids instead of inferring behavior from prose', async () => {
    workspace = await createWorkspace()
    await writeFile(
      join(workspace, 'docs', 'acceptance', 'gameplay-checklist.md'),
      '- [x] A prose-only acceptance item\n',
    )
    await writeAcceptance(workspace, validReport())

    const issues = evaluate(workspace).issues
    expect(issues).toContain(
      'Every acceptance checklist item must start with [requirement:ID] or [player-path:ID].',
    )
  })

  test('rejects a report after the implementation changes', async () => {
    workspace = await createWorkspace()
    await writeAcceptance(workspace, validReport())
    await Bun.sleep(5)
    await writeFile(join(workspace, 'src', 'entry.ts'), 'export const ready = false\n')

    const result = evaluate(workspace)

    expect(result.allowed).toBe(false)
    expect(result.issues.some(issue =>
      issue.includes('validation report is stale') && issue.includes('src/entry.ts'),
    )).toBe(true)
  })

  test('requires asset runtime events to reference observed acceptance evidence', async () => {
    workspace = await createWorkspace()
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: [] },
      slots: [{
        id: 'embedded-primary',
        delivery_mode: 'embedded',
        status: 'integrated',
        target: { path: 'src/entry.ts' },
        integration_evidence: {
          references: ['src/entry.ts'],
          runtime_event_ids: ['unobserved-evidence'],
        },
      }],
    }))
    await writeAcceptance(workspace, validReport())

    expect(evaluate(workspace).issues).toContain(
      'Asset contract: required slot embedded-primary has no runtime_event_id present in the acceptance report.',
    )
  })
})

async function createWorkspace(options: { checked?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'beegame-delivery-audit-'))
  await mkdir(join(root, 'docs', 'acceptance'), { recursive: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'tests'), { recursive: true })
  await writeFile(join(root, 'src', 'entry.ts'), 'export const ready = true\n')
  await writeFile(join(root, 'tests', 'acceptance.test.ts'), 'export const observed = true\n')
  for (const name of ['GDD.md', 'TECHNICAL_DESIGN.md', 'ART_DIRECTION.md', 'UI_UX_SPEC.md', 'AUDIO_DESIGN.md', 'ASSET_PLAN.md']) {
    await writeFile(join(root, 'docs', name), `# ${name}\n`)
  }
  const marker = options.checked === false ? ' ' : 'x'
  await writeFile(
    join(root, 'docs', 'acceptance', 'gameplay-checklist.md'),
    [
      `- [${marker}] [requirement:req-primary] Primary behavior is implemented`,
      `- [${marker}] [player-path:path-primary] Player can complete the primary loop`,
      '',
    ].join('\n'),
  )
  return root
}

async function writeAcceptance(workspace: string, report: unknown): Promise<void> {
  await writeFile(
    join(workspace, 'docs', 'acceptance', 'validation-report.json'),
    JSON.stringify(report),
  )
  recordNativeAcceptanceReportForTest({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    workspacePath: workspace,
    report,
  })
}

function evaluate(workspace: string) {
  return evaluatePersistedDeliveryAcceptance(workspace, {
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
  })
}

function dataRootFor(workspace: string): string {
  return `${workspace}-runtime-data`
}

function validReport(): Record<string, unknown> {
  return {
    validatorId: 'beegame-acceptance-validator',
    status: 'passed',
    summary: 'Observed the declared behavior.',
    assetsRequired: false,
    verifiedCapabilities: ['skill:beegame-game-acceptance'],
    requirements: [{
      id: 'req-primary',
      status: 'passed',
      evidence: [{
        id: 'evidence-implementation-primary',
        kind: 'implementation',
        source: 'src/entry.ts',
        result: 'passed',
        detail: 'Implementation exists and is wired.',
      }],
    }],
    playerPaths: [{
      id: 'path-primary',
      status: 'passed',
      evidence: [{
        id: 'evidence-path-primary',
        kind: 'runtime',
        source: 'path-primary',
        result: 'passed',
        workingDirectory: '.',
        action: 'Run the project-native acceptance test and exercise the primary loop.',
        assertion: 'The observable outcome matches the approved checklist.',
        artifact: 'tests/acceptance.test.ts',
        detail: 'The player path reached its declared outcome.',
      }],
    }],
    findings: [],
  }
}
