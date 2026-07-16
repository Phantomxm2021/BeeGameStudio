import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluatePersistedDeliveryAcceptance } from './delivery-acceptance-audit'
import {
  getObservedNativeAcceptance,
  observeNativeAcceptanceToolCompletion,
  recordNativeAcceptanceReportForTest,
} from './native-acceptance-evidence'

const TEST_SESSION_ID = 'native-acceptance-test-session'

describe('native delivery acceptance gate', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
    if (workspace) await rm(dataRootFor(workspace), { recursive: true, force: true })
  })

  test('accepts a native passing result for the exact workspace revision', async () => {
    workspace = await createWorkspace()
    record(workspace, 'passed', 'Observed the documented player paths.')

    expect(evaluate(workspace)).toEqual({
      allowed: true,
      outcome: 'passed',
      issues: [],
    })
  })

  test('rejects a workspace without an observed native validator result', async () => {
    workspace = await createWorkspace()

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['Deployment requires an observed native acceptance Validator result.'],
    })
  })

  test('passes through the native failed or blocked terminal outcome', async () => {
    workspace = await createWorkspace()
    record(workspace, 'failed', 'The documented restart path failed.')
    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['The documented restart path failed.'],
    })

    record(workspace, 'blocked', 'A required device is unavailable.')
    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'blocked',
      issues: ['A required device is unavailable.'],
    })
  })

  test('invalidates acceptance when implementation or approved documents change', async () => {
    workspace = await createWorkspace()
    record(workspace, 'passed', 'Accepted current revision.')
    await writeFile(join(workspace, 'docs', 'GDD.md'), '# Changed requirement\n')

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['The project changed after native acceptance; validate the current revision before deployment.'],
    })
  })

  test('does not inspect or require BeeGame-specific checklist schemas', async () => {
    workspace = await createWorkspace()
    await writeFile(
      join(workspace, 'docs', 'acceptance.md'),
      '# Project-native acceptance\n\nThe player can finish and restart a run.\n',
    )
    record(workspace, 'passed', 'The native validator observed the documented flow.')

    expect(evaluate(workspace).allowed).toBe(true)
  })

  test('does not accept prose-wrapped or malformed Agent output as terminal evidence', async () => {
    workspace = await createWorkspace()
    observeNativeAcceptanceToolCompletion({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        toolName: 'Agent',
        toolUseID: 'validator-prose-output',
        input: { subagent_type: 'beegame-acceptance-validator' },
        output: 'Looks good. {"validatorId":"beegame-acceptance-validator","status":"passed","summary":"claimed"}',
      },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
  })

  test('does not accept an assistant completion claim as native validator evidence', async () => {
    workspace = await createWorkspace()
    observeNativeAcceptanceToolCompletion({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'assistant.message',
      payload: {
        type: 'assistant',
        text: JSON.stringify({
          validatorId: 'beegame-acceptance-validator',
          status: 'passed',
          summary: 'The implementation agent claimed delivery was complete.',
        }),
      },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['Deployment requires an observed native acceptance Validator result.'],
    })
  })
})

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'beegame-delivery-audit-'))
  await mkdir(join(root, 'docs'), { recursive: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'docs', 'GDD.md'), '# Approved game\n')
  await writeFile(join(root, 'src', 'entry.ts'), 'export const ready = true\n')
  return root
}

function record(
  workspace: string,
  status: 'passed' | 'failed' | 'blocked',
  summary: string,
): void {
  recordNativeAcceptanceReportForTest({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    workspacePath: workspace,
    report: {
      validatorId: 'beegame-acceptance-validator',
      status,
      summary,
      evidence: [],
      findings: [],
    },
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
