import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getObservedNativeDocumentReview,
  observeNativeDocumentReviewToolEvent,
  recordNativeDocumentReviewForTest,
} from './native-document-review-evidence'

const SESSION_ID = 'native-document-review-test-session'

describe('native document review evidence', () => {
  let workspace = ''

  afterEach(async () => {
    if (!workspace) return
    await rm(workspace, { recursive: true, force: true })
    await rm(dataRootFor(workspace), { recursive: true, force: true })
  })

  test('does not accept an empty native reviewer result', async () => {
    workspace = await createWorkspace()
    const payload = reviewerPayload('empty-review')
    observe('tool.started', workspace, payload)
    observe('tool.completed', workspace, { ...payload, output: '' })

    expect(current(workspace)).toEqual({ state: 'missing' })
  })

  test('requires an exact structured terminal result', async () => {
    workspace = await createWorkspace()
    const payload = reviewerPayload('wrapped-review')
    observe('tool.started', workspace, payload)
    observe('tool.completed', workspace, {
      ...payload,
      output: `READY ${JSON.stringify(readyReport())}`,
    })

    expect(current(workspace)).toEqual({ state: 'missing' })
  })

  test('makes a review stale when the canonical asset contract changes', async () => {
    workspace = await createWorkspace()
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(
      join(workspace, 'assets', 'asset-manifest.json'),
      '{"version":1,"project_target":{"asset_format_capabilities":[]},"slots":[]}',
    )
    recordNativeDocumentReviewForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: SESSION_ID,
      workspacePath: workspace,
      report: readyReport(),
    })
    await writeFile(
      join(workspace, 'assets', 'asset-manifest.json'),
      '{"version":1,"project_target":{"asset_format_capabilities":[]},"slots":[{"id":"new"}]}',
    )

    expect(current(workspace).state).toBe('stale')
  })

  test('records READY for the exact reviewed document revision', async () => {
    workspace = await createWorkspace()
    recordReady(workspace)

    const observation = current(workspace)
    expect(observation.state).toBe('current')
    if (observation.state === 'current') {
      expect(observation.evidence.verdict).toBe('READY')
    }
  })

  test('becomes stale when project documents change', async () => {
    workspace = await createWorkspace()
    recordReady(workspace)
    await writeFile(
      join(workspace, 'docs', 'GDD.md'),
      '# Revised requirements\n',
    )

    expect(current(workspace).state).toBe('stale')
  })

  test('does not become stale when implementation changes', async () => {
    workspace = await createWorkspace()
    recordReady(workspace)
    await writeFile(
      join(workspace, 'src', 'game.ts'),
      'export const game = true\n',
    )

    expect(current(workspace).state).toBe('current')
  })

  test('rejects a revision verdict without a concrete finding', async () => {
    workspace = await createWorkspace()
    recordNativeDocumentReviewForTest({
      dataRoot: dataRootFor(workspace),
      sessionId: SESSION_ID,
      workspacePath: workspace,
      report: {
        reviewerId: 'beegame-document-reviewer',
        verdict: 'NEEDS_REVISION',
        summary: 'The documents need work.',
        findings: [],
      },
    })

    expect(current(workspace)).toEqual({ state: 'missing' })
  })

  test('records a linked native background reviewer terminal result', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'background-review'
    const taskId = 'background-review-task'
    const outputFile = join(dataRoot, 'review-output.jsonl')
    const payload = reviewerPayload(toolUseID)
    observe('tool.started', workspace, payload)
    observe('system.status', workspace, {
      subtype: 'task_started',
      task_id: taskId,
      tool_use_id: toolUseID,
    })
    await writeFile(
      outputFile,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: JSON.stringify(readyReport()) }],
        },
      })}\n`,
    )
    observe('system.status', workspace, {
      subtype: 'task_notification',
      status: 'completed',
      task_id: taskId,
      tool_use_id: toolUseID,
      output_file: outputFile,
    })

    expect(current(workspace).state).toBe('current')
  })

  test('uses the native Agent launch path when reviewer notification omits output_file', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'background-review-empty-notification-path'
    const taskId = 'background-review-empty-notification-task'
    const outputFile = join(dataRoot, 'review-native-output.jsonl')
    const payload = reviewerPayload(toolUseID)
    observe('tool.started', workspace, payload)
    await writeFile(
      outputFile,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: JSON.stringify(readyReport()) }],
        },
      })}\n`,
    )
    observe('tool.completed', workspace, {
      ...payload,
      output: [
        'Async agent launched successfully.',
        `agentId: ${taskId}`,
        'The agent is working in the background.',
        `output_file: ${outputFile}`,
      ].join('\n'),
    })
    observe('system.status', workspace, {
      subtype: 'task_notification',
      status: 'completed',
      task_id: taskId,
      tool_use_id: toolUseID,
      output_file: '',
    })

    expect(current(workspace).state).toBe('current')
  })

  test('captures a completed reviewer when native resume emits init without task_notification', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'background-review-init-resume'
    const taskId = 'background-review-init-task'
    const outputFile = join(dataRoot, 'review-init-output.jsonl')
    const payload = reviewerPayload(toolUseID)
    observe('tool.started', workspace, payload)
    observe('tool.completed', workspace, {
      ...payload,
      output: [
        'Async agent launched successfully.',
        `agentId: ${taskId}`,
        'The agent is working in the background.',
        `output_file: ${outputFile}`,
      ].join('\n'),
    })
    await writeFile(
      outputFile,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: JSON.stringify(readyReport()) }],
        },
      })}\n`,
    )
    observe('system.status', workspace, { subtype: 'init' })

    expect(current(workspace).state).toBe('current')
  })
})

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'beegame-document-review-'))
  await mkdir(join(root, 'docs'), { recursive: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'docs', 'GDD.md'), '# Approved game\n')
  return root
}

function recordReady(workspace: string): void {
  recordNativeDocumentReviewForTest({
    dataRoot: dataRootFor(workspace),
    sessionId: SESSION_ID,
    workspacePath: workspace,
    report: readyReport(),
  })
}

function readyReport(): object {
  return {
    reviewerId: 'beegame-document-reviewer',
    verdict: 'READY',
    summary: 'The current documents are complete and internally consistent.',
    findings: [],
  }
}

function reviewerPayload(toolUseID: string): Record<string, unknown> {
  return {
    toolName: 'Agent',
    toolUseID,
    input: { subagent_type: 'beegame-document-reviewer' },
  }
}

function observe(
  eventType: string,
  workspacePath: string,
  payload: Record<string, unknown>,
): void {
  observeNativeDocumentReviewToolEvent({
    dataRoot: dataRootFor(workspacePath),
    sessionId: SESSION_ID,
    workspacePath,
    eventType,
    payload,
    createdAt: new Date(),
  })
}

function current(workspacePath: string) {
  return getObservedNativeDocumentReview({
    dataRoot: dataRootFor(workspacePath),
    sessionId: SESSION_ID,
    workspacePath,
  })
}

function dataRootFor(workspacePath: string): string {
  return `${workspacePath}-runtime-data`
}
