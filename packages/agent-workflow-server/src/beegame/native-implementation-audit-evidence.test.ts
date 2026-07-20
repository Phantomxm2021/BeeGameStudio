import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getObservedNativeImplementationAudit,
  observeNativeImplementationAuditTaskNotification,
  observeNativeImplementationAuditToolEvent,
  recordNativeImplementationAuditReportForTest,
} from './native-implementation-audit-evidence'

const SESSION_ID = 'native-implementation-audit-session'

describe('native implementation audit evidence', () => {
  test('records a native terminal result and invalidates it after workspace changes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-auditor-evidence-'))
    const dataRoot = `${workspace}-runtime`
    try {
      await writeFile(join(workspace, 'game.ts'), 'export const playable = true\n')
      recordNativeImplementationAuditReportForTest({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
        report: passedReport(),
      })
      const current = getObservedNativeImplementationAudit({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
      })
      expect(current.state).toBe('current')
      if (current.state === 'current') {
        expect(current.evidence.status).toBe('passed')
        expect(current.evidence.evidence).toHaveLength(1)
      }

      await writeFile(join(workspace, 'game.ts'), 'export const playable = false\n')
      expect(getObservedNativeImplementationAudit({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
      }).state).toBe('stale')
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('accepts a native background terminal notification without polling it', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-auditor-background-'))
    const dataRoot = `${workspace}-runtime`
    const toolUseID = 'auditor-tool-use'
    try {
      await writeFile(join(workspace, 'game.ts'), 'export const playable = true\n')
      observeNativeImplementationAuditToolEvent({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
        eventType: 'tool.started',
        payload: auditorPayload(toolUseID),
        createdAt: new Date(),
      })
      observeNativeImplementationAuditToolEvent({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
        eventType: 'tool.completed',
        payload: {
          ...auditorPayload(toolUseID),
          output: 'Async agent launched successfully.\nagentId: audit-task\noutput_file: /opaque/native-output',
        },
        createdAt: new Date(),
      })
      observeNativeImplementationAuditToolEvent({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
        eventType: 'system.status',
        payload: {
          subtype: 'task_started',
          task_id: 'audit-task',
          tool_use_id: toolUseID,
        },
        createdAt: new Date(),
      })
      expect(getObservedNativeImplementationAudit({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
      }).state).toBe('running')

      observeNativeImplementationAuditTaskNotification({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
        notification: {
          value: [
            '<task-notification>',
            '<task-id>audit-task</task-id>',
            `<tool-use-id>${toolUseID}</tool-use-id>`,
            '<status>completed</status>',
            `<result>${JSON.stringify(passedReport())}</result>`,
            '</task-notification>',
          ].join(''),
        },
        createdAt: new Date(),
      })
      expect(getObservedNativeImplementationAudit({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
      }).state).toBe('current')
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('rejects prose-wrapped and structurally invalid reports', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-auditor-invalid-'))
    const dataRoot = `${workspace}-runtime`
    try {
      await writeFile(join(workspace, 'game.ts'), 'export const playable = true\n')
      const payload = auditorPayload('invalid-auditor-result')
      observeNativeImplementationAuditToolEvent({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
        eventType: 'tool.started',
        payload,
        createdAt: new Date(),
      })
      observeNativeImplementationAuditToolEvent({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
        eventType: 'tool.completed',
        payload: { ...payload, output: `Done: ${JSON.stringify(passedReport())}` },
        createdAt: new Date(),
      })
      expect(getObservedNativeImplementationAudit({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
      }).state).toBe('missing')
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(dataRoot, { recursive: true, force: true })
    }
  })
})

function passedReport(): object {
  return {
    auditorId: 'beegame-implementation-auditor',
    status: 'passed',
    summary: 'The implementation and asset references agree with the approved contract.',
    evidence: [{ source: 'game.ts', detail: 'The documented implementation symbol exists.' }],
    findings: [],
  }
}

function auditorPayload(toolUseID: string): Record<string, unknown> {
  return {
    toolName: 'Agent',
    toolUseID,
    input: { subagent_type: 'beegame-implementation-auditor' },
  }
}
