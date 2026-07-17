import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluatePersistedDeliveryAcceptance } from './delivery-acceptance-audit'
import {
  getObservedNativeAcceptance,
  observeNativeAcceptanceToolEvent,
  recordNativeAcceptanceReportForTest,
} from './native-acceptance-evidence'
import { recordNativeDocumentReviewForTest } from './native-document-review-evidence'

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

  test('binds acceptance to the revision observed when the validator starts', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const payload = {
      toolName: 'Agent',
      toolUseID: 'validator-on-old-revision',
      input: { subagent_type: 'beegame-acceptance-validator' },
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload,
      createdAt: new Date(),
    })
    await writeFile(join(workspace, 'src', 'entry.ts'), 'export const ready = false\n')
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: { ...payload, output: JSON.stringify(passingReport()) },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    }).state).toBe('stale')
  })

  test('captures an exact terminal result from the native foreground Agent lifecycle', async () => {
    workspace = await createWorkspace()
    recordForegroundResult(workspace, passingReport())

    expect(evaluate(workspace)).toEqual({
      allowed: true,
      outcome: 'passed',
      issues: [],
    })
  })

  test('binds a foreground result to the revision at its original Agent dispatch', async () => {
    workspace = await createWorkspace()
    const pending = startForegroundValidator(workspace)
    await writeFile(join(workspace, 'src', 'entry.ts'), 'export const ready = false\n')
    completeForegroundValidator(workspace, pending, passingReport())

    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    }).state).toBe('stale')
  })

  test('captures the terminal result of a native Validator moved to the background', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'background-validator-tool'
    const taskId = 'background-validator-task'
    const outputFile = join(dataRoot, 'validator-output.jsonl')
    const agentPayload = {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload: agentPayload,
      createdAt: new Date(),
    })
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'system.status',
      payload: {
        subtype: 'task_started',
        task_id: taskId,
        tool_use_id: toolUseID,
      },
      createdAt: new Date(),
    })
    await writeFile(outputFile, `${JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: JSON.stringify(passingReport()) }],
      },
    })}\n`)
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'system.status',
      payload: {
        subtype: 'task_notification',
        status: 'completed',
        task_id: taskId,
        tool_use_id: toolUseID,
        output_file: outputFile,
      },
      createdAt: new Date(),
    })

    expect(evaluate(workspace)).toEqual({
      allowed: true,
      outcome: 'passed',
      issues: [],
    })
  })

  test('uses the native Agent launch output when the terminal notification omits output_file', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'background-validator-empty-notification-path'
    const taskId = 'background-validator-empty-notification-task'
    const outputFile = join(dataRoot, 'validator-native-output.jsonl')
    const agentPayload = {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload: agentPayload,
      createdAt: new Date(),
    })
    await mkdir(dataRoot, { recursive: true })
    await writeFile(outputFile, `${JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: JSON.stringify(passingReport()) }],
      },
    })}\n`)
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        ...agentPayload,
        output: nativeAsyncAgentLaunch(taskId, outputFile),
      },
      createdAt: new Date(),
    })
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'system.status',
      payload: {
        subtype: 'task_notification',
        status: 'completed',
        task_id: taskId,
        tool_use_id: toolUseID,
        output_file: '',
      },
      createdAt: new Date(),
    })

    expect(evaluate(workspace)).toEqual({
      allowed: true,
      outcome: 'passed',
      issues: [],
    })
  })

  test('captures a completed background Validator when native resume emits init without task_notification', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'background-validator-init-resume'
    const taskId = 'background-validator-init-task'
    const outputFile = join(dataRoot, 'validator-init-output.jsonl')
    const agentPayload = {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
    }
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload: agentPayload,
      createdAt: new Date(),
    })
    await mkdir(dataRoot, { recursive: true })
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        ...agentPayload,
        output: nativeAsyncAgentLaunch(taskId, outputFile),
      },
      createdAt: new Date(),
    })
    await writeFile(outputFile, `${JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: JSON.stringify(passingReport()) }],
      },
    })}\n`)
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'system.status',
      payload: { subtype: 'init' },
      createdAt: new Date(),
    })

    expect(evaluate(workspace)).toEqual({
      allowed: true,
      outcome: 'passed',
      issues: [],
    })
  })

  test('binds a background result to the revision at its original Agent dispatch', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'background-validator-stale-tool'
    const taskId = 'background-validator-stale-task'
    const outputFile = join(dataRoot, 'stale-validator-output.jsonl')
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.started',
      payload: {
        toolName: 'Agent',
        toolUseID,
        input: { subagent_type: 'beegame-acceptance-validator' },
      },
      createdAt: new Date(),
    })
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'system.status',
      payload: {
        subtype: 'task_started',
        task_id: taskId,
        tool_use_id: toolUseID,
      },
      createdAt: new Date(),
    })
    await writeFile(join(workspace, 'src', 'entry.ts'), 'export const ready = false\n')
    await writeFile(outputFile, `${JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: JSON.stringify(passingReport()) }],
      },
    })}\n`)
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'system.status',
      payload: {
        subtype: 'task_notification',
        status: 'completed',
        task_id: taskId,
        tool_use_id: toolUseID,
        output_file: outputFile,
      },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    }).state).toBe('stale')
  })

  test('ignores a background completion without a linked native dispatch', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const outputFile = join(dataRoot, 'unlinked-validator-output.jsonl')
    await mkdir(dataRoot, { recursive: true })
    await writeFile(outputFile, `${JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: JSON.stringify(passingReport()) }],
      },
    })}\n`)
    observeNativeAcceptanceToolEvent({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'system.status',
      payload: {
        subtype: 'task_notification',
        status: 'completed',
        task_id: 'unlinked-task',
        tool_use_id: 'unlinked-tool',
        output_file: outputFile,
      },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot,
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
  })

  test('ignores TaskOutput without an observed native background task link', async () => {
    workspace = await createWorkspace()
    observeNativeAcceptanceToolEvent({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        toolName: 'TaskOutput',
        toolUseID: 'unlinked-task-output',
        input: { task_id: 'unknown-task' },
        output: nativeTaskOutput(passingReport()),
      },
      createdAt: new Date(),
    })

    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
  })

  test('rejects prose-wrapped JSON from the foreground Validator result', async () => {
    workspace = await createWorkspace()
    recordForegroundResult(workspace, `Validation complete. ${JSON.stringify(passingReport())}`)

    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
  })

  test('rejects a passing claim without complete native evidence', async () => {
    workspace = await createWorkspace()
    recordNativeAcceptanceReportForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      report: {
        validatorId: 'beegame-acceptance-validator',
        status: 'passed',
        summary: 'Source inspection looked plausible.',
        evidence: [],
        findings: [],
      },
    })

    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
  })

  test('does not accept a completion that has no matching native dispatch', async () => {
    workspace = await createWorkspace()
    observeNativeAcceptanceToolEvent({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      eventType: 'tool.completed',
      payload: {
        toolName: 'Agent',
        toolUseID: 'unobserved-validator',
        input: { subagent_type: 'beegame-acceptance-validator' },
        output: JSON.stringify(passingReport()),
      },
      createdAt: new Date(),
    })
    expect(getObservedNativeAcceptance({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
    })).toEqual({ state: 'missing' })
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

  test('never treats a blocked document review as deliverable', async () => {
    workspace = await createWorkspace()
    recordNativeDocumentReviewForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      report: {
        reviewerId: 'beegame-document-reviewer',
        verdict: 'BLOCKED',
        summary: 'The confirmed brief is unavailable.',
        findings: [{
          source: 'confirmed brief',
          detail: 'The reviewer cannot compare the documents without the approved brief.',
        }],
      },
    })
    record(workspace, 'passed', 'A validator result cannot override document review.')

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'blocked',
      issues: ['The confirmed brief is unavailable.'],
    })
  })

  test('does not accept a passing validator result without runtime evidence', async () => {
    workspace = await createWorkspace()
    const report = passingReport() as {
      evidence: Array<{ kind: string }>
    }
    report.evidence = report.evidence.filter(item => item.kind !== 'runtime')
    recordNativeAcceptanceReportForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: TEST_SESSION_ID,
      workspacePath: workspace,
      report,
    })

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['Deployment requires an observed native acceptance Validator result.'],
    })
  })

  test('invalidates acceptance when implementation or approved documents change', async () => {
    workspace = await createWorkspace()
    record(workspace, 'passed', 'Accepted current revision.')
    await writeFile(join(workspace, 'docs', 'GDD.md'), '# Changed requirement\n')

    expect(evaluate(workspace)).toEqual({
      allowed: false,
      outcome: 'rejected',
      issues: ['Project documents changed after review; review the current document revision before deployment.'],
    })
  })

  test('does not inspect or require BeeGame-specific checklist schemas', async () => {
    workspace = await createWorkspace()
    await writeFile(
      join(workspace, 'docs', 'acceptance.md'),
      '# Project-native acceptance\n\nThe player can finish and restart a run.\n',
    )
    recordReadyDocumentReview(workspace)
    record(workspace, 'passed', 'The native validator observed the documented flow.')

    expect(evaluate(workspace).allowed).toBe(true)
  })

  test('does not accept prose-wrapped or malformed Agent output as terminal evidence', async () => {
    workspace = await createWorkspace()
    observeNativeAcceptanceToolEvent({
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
    observeNativeAcceptanceToolEvent({
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
  recordReadyDocumentReview(root)
  return root
}

function recordReadyDocumentReview(workspace: string): void {
  recordNativeDocumentReviewForTest({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    workspacePath: workspace,
    report: {
      reviewerId: 'beegame-document-reviewer',
      verdict: 'READY',
      summary: 'The current project documents are implementation-ready.',
      findings: [],
    },
  })
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
    report: status === 'passed'
      ? passingReport(summary)
      : {
          validatorId: 'beegame-acceptance-validator',
          status,
          summary,
          evidence: [{
            kind: 'runtime',
            source: 'project-native acceptance path',
            result: status,
            detail: summary,
          }],
          findings: [{ source: 'project-native acceptance path', detail: summary }],
        },
  })
}

function startForegroundValidator(workspace: string): {
  toolUseID: string
} {
  const toolUseID = 'native-validator-agent-tool'
  observeNativeAcceptanceToolEvent({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    workspacePath: workspace,
    eventType: 'tool.started',
    payload: {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
    },
    createdAt: new Date(),
  })
  return { toolUseID }
}

function completeForegroundValidator(
  workspace: string,
  pending: { toolUseID: string },
  report: unknown,
): void {
  observeNativeAcceptanceToolEvent({
    dataRoot: dataRootFor(workspace),
    sessionId: TEST_SESSION_ID,
    workspacePath: workspace,
    eventType: 'tool.completed',
    payload: {
      toolName: 'Agent',
      toolUseID: pending.toolUseID,
      input: { subagent_type: 'beegame-acceptance-validator' },
      output: typeof report === 'string' ? report : JSON.stringify(report),
    },
    createdAt: new Date(),
  })
}

function recordForegroundResult(workspace: string, report: unknown): void {
  completeForegroundValidator(workspace, startForegroundValidator(workspace), report)
}

function nativeTaskOutput(report: unknown): string {
  const output = typeof report === 'string' ? report : JSON.stringify(report)
  return [
    '<retrieval_status>success</retrieval_status>',
    '<task_id>native-validator-task</task_id>',
    '<task_type>local_agent</task_type>',
    '<status>completed</status>',
    '<output>',
    output,
    '</output>',
  ].join('\n')
}

function nativeAsyncAgentLaunch(taskId: string, outputFile: string): string {
  return [
    'Async agent launched successfully.',
    `agentId: ${taskId}`,
    'The agent is working in the background.',
    `output_file: ${outputFile}`,
  ].join('\n')
}

function passingReport(summary = 'Observed every documented player path.'): object {
  return {
    validatorId: 'beegame-acceptance-validator',
    status: 'passed',
    summary,
    evidence: [
      { kind: 'document', source: 'docs/', result: 'passed', detail: 'Approved documents were reviewed.' },
      { kind: 'build', source: 'project build', result: 'passed', detail: 'The native build completed successfully.' },
      { kind: 'test', source: 'project tests', result: 'passed', detail: 'Project-native assertions passed.' },
      { kind: 'runtime', source: 'player paths', result: 'passed', detail: 'Every required player path was observed.' },
      { kind: 'asset', source: 'packaged assets', result: 'passed', detail: 'Required assets loaded from the packaged result.' },
      { kind: 'skill', source: 'beegame-game-acceptance', result: 'passed', detail: 'The native acceptance Skill was invoked.' },
    ],
    findings: [],
  }
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
