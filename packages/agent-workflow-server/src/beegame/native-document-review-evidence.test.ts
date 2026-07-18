import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getObservedNativeDocumentReview,
  observeNativeDocumentReviewTaskNotification,
  observeNativeDocumentReviewToolEvent,
  recordNativeDocumentReviewForTest,
} from './native-document-review-evidence'
import { REQUIRED_PROJECT_DOCUMENTS } from './document-readiness-audit'

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

  test('does not make document review stale when only asset integration state changes', async () => {
    workspace = await createWorkspace()
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(
      join(workspace, 'assets', 'asset-manifest.json'),
      JSON.stringify({
        version: 1,
        project_target: { asset_format_capabilities: ['portable-model'] },
        slots: [{
          id: 'primary-visual',
          delivery_mode: 'managed-file',
          target: { path: 'assets/primary.portable-model' },
          resource_requirement: { accepted_formats: ['portable-model'] },
          status: 'missing',
        }],
      }),
    )
    recordReady(workspace)
    await writeFile(
      join(workspace, 'assets', 'asset-manifest.json'),
      JSON.stringify({
        slots: [{
          integration_evidence: {
            references: ['src/game.ts'],
            runtime_event_ids: ['runtime-1'],
          },
          uploaded_files: ['assets/primary.portable-model'],
          status: 'integrated',
          resource_binding: { pack_id: 'pack', element_id: 'element' },
          target: { path: 'assets/primary.portable-model' },
          resource_requirement: { accepted_formats: ['portable-model'] },
          delivery_mode: 'managed-file',
          id: 'primary-visual',
        }],
        project_target: { asset_format_capabilities: ['portable-model'] },
        version: 1,
      }),
    )

    expect(current(workspace).state).toBe('current')
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

  test('downgrades a Reviewer READY result when deterministic contract checks fail', async () => {
    workspace = await createWorkspace()
    await writeFile(
      join(workspace, 'docs', 'acceptance', 'gameplay-checklist.md'),
      '# Acceptance\n## PATH-001 Launch the game\n- Action: Start.\n',
    )

    recordReady(workspace)

    const observation = current(workspace)
    expect(observation.state).toBe('current')
    if (observation.state === 'current') {
      expect(observation.evidence.verdict).toBe('NEEDS_REVISION')
      expect(observation.evidence.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: 'deterministic project-contract audit',
          detail: expect.stringContaining('Acceptance checklist contains no task items'),
        }),
      ]))
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
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(readyReport()) }],
        },
      })}\n`,
    )
    notify(workspace, toolUseID, taskId, readyReport())

    expect(current(workspace).state).toBe('current')
  })

  test('accepts a completed native TaskOutput linked to the observed background reviewer', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'task-output-review'
    const taskId = 'task-output-review-task'
    const payload = reviewerPayload(toolUseID)
    observe('tool.started', workspace, payload)
    observe('tool.completed', workspace, {
      ...payload,
      output: [
        'Async agent launched successfully.',
        `agentId: ${taskId}`,
        'The agent is working in the background.',
        `output_file: ${join(dataRoot, 'review-output.jsonl')}`,
      ].join('\n'),
    })
    observe('tool.completed', workspace, {
      toolName: 'TaskOutput',
      toolUseID: 'task-output-tool-use',
      input: { task_id: taskId },
      nativeTaskResult: {
        taskId,
        status: 'completed',
        result: JSON.stringify(readyReport()),
      },
    })

    expect(current(workspace).state).toBe('current')
  })

  test('uses the native terminal result when SDK metadata omits output_file', async () => {
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
          stop_reason: 'end_turn',
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
    notify(workspace, toolUseID, taskId, readyReport())

    expect(current(workspace).state).toBe('current')
  })

  test('does not inspect a background output file during native resume', async () => {
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
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(readyReport()) }],
        },
      })}\n`,
    )
    observe('system.status', workspace, { subtype: 'init' })

    expect(current(workspace).state).toBe('running')
  })

  test('does not recover an unfinished background reviewer output', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'unfinished-background-review'
    const taskId = 'unfinished-background-review-task'
    const outputFile = join(dataRoot, 'unfinished-review-output.jsonl')
    const payload = reviewerPayload(toolUseID)
    observe('tool.started', workspace, payload)
    observe('tool.completed', workspace, {
      ...payload,
      output: [
        'Async agent launched successfully.',
        `agentId: ${taskId}`,
        `output_file: ${outputFile}`,
      ].join('\n'),
    })
    await writeFile(
      outputFile,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          stop_reason: null,
          content: [{ type: 'text', text: JSON.stringify(readyReport()) }],
        },
      })}\n`,
    )

    observe('system.status', workspace, { subtype: 'init' })

    expect(current(workspace).state).toBe('running')
  })

  test('does not use unrelated results or SendMessage as evidence triggers', async () => {
    workspace = await createWorkspace()
    const dataRoot = dataRootFor(workspace)
    const toolUseID = 'background-review-with-unrelated-result'
    const taskId = 'background-review-with-unrelated-result-task'
    const outputFile = join(dataRoot, 'unrelated-result-review-output.jsonl')
    const payload = reviewerPayload(toolUseID)
    observe('tool.started', workspace, payload)
    observe('tool.completed', workspace, {
      ...payload,
      output: [
        'Async agent launched successfully.',
        `agentId: ${taskId}`,
        `output_file: ${outputFile}`,
      ].join('\n'),
    })
    await writeFile(
      outputFile,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(readyReport()) }],
        },
      })}\n`,
    )

    observe('result', workspace, { result: 'unrelated native turn result' })
    observe('tool.completed', workspace, {
      toolName: 'SendMessage',
      toolUseID: 'send-message-follow-up',
      output: JSON.stringify(readyReport()),
    })

    expect(current(workspace).state).toBe('running')
  })
})

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'beegame-document-review-'))
  await mkdir(join(root, 'src'), { recursive: true })
  for (const path of REQUIRED_PROJECT_DOCUMENTS) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(
      join(root, path),
      path.endsWith('gameplay-checklist.md')
        ? '# Acceptance\n- [ ] PATH-001 Launch the game and observe the initial playable state.\n'
        : `# ${path}\n`,
    )
  }
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'assets', 'asset-manifest.json'), JSON.stringify({
    version: 1,
    project_target: {
      platform: 'selected-target',
      runtime: 'project-native',
      asset_format_capabilities: [],
    },
    slots: [],
  }))
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

function notify(
  workspacePath: string,
  toolUseID: string,
  taskId: string,
  report: object,
): void {
  observeNativeDocumentReviewTaskNotification({
    dataRoot: dataRootFor(workspacePath),
    sessionId: SESSION_ID,
    workspacePath,
    notification: {
      value: [
        '<task-notification>',
        `<task-id>${taskId}</task-id>`,
        `<tool-use-id>${toolUseID}</tool-use-id>`,
        '<status>completed</status>',
        `<result>${JSON.stringify(report)}</result>`,
        '</task-notification>',
      ].join(''),
    },
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
