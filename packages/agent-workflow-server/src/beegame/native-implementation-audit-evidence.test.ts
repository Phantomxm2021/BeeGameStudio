import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getObservedNativeImplementationAudit,
  interruptUnfinishedNativeImplementationAudits,
  observeNativeImplementationAuditTaskNotification,
  observeNativeImplementationAuditToolEvent,
  recordNativeImplementationAuditReportForTest,
} from './native-implementation-audit-evidence'
import { recordNativeDeliveryContractForTest } from './native-tool-provenance'

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
      recordNativeDeliveryContractForTest({
        dataRoot,
        sessionId: SESSION_ID,
        agentToolUseID: toolUseID,
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
      })).toEqual(expect.objectContaining({
        state: 'invalid',
        reason: 'terminal_result_invalid',
      }))
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('does not accept an Auditor result when the Auditor never read the native contract', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-auditor-no-contract-'))
    const dataRoot = `${workspace}-runtime`
    try {
      await writeFile(join(workspace, 'game.ts'), 'export const playable = true\n')
      const payload = auditorPayload('auditor-without-contract')
      observeNativeImplementationAuditToolEvent({
        dataRoot, sessionId: SESSION_ID, workspacePath: workspace,
        eventType: 'tool.started', payload, createdAt: new Date(),
      })
      observeNativeImplementationAuditToolEvent({
        dataRoot, sessionId: SESSION_ID, workspacePath: workspace,
        eventType: 'tool.completed',
        payload: { ...payload, output: JSON.stringify(passedReport()) },
        createdAt: new Date(),
      })
      expect(getObservedNativeImplementationAudit({
        dataRoot, sessionId: SESSION_ID, workspacePath: workspace,
      })).toEqual(expect.objectContaining({
        state: 'invalid',
        reason: 'delivery_contract_not_observed',
      }))
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('marks an unfinished audit interrupted on recovery and accepts a fresh dispatch for the same revision', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-auditor-recovery-'))
    const dataRoot = `${workspace}-runtime`
    try {
      await writeFile(join(workspace, 'game.ts'), 'export const playable = true\n')
      observeNativeImplementationAuditToolEvent({
        dataRoot, sessionId: SESSION_ID, workspacePath: workspace,
        eventType: 'tool.started', payload: auditorPayload('orphaned-audit'), createdAt: new Date(),
      })
      expect(getObservedNativeImplementationAudit({
        dataRoot, sessionId: SESSION_ID, workspacePath: workspace,
      }).state).toBe('running')

      interruptUnfinishedNativeImplementationAudits({
        dataRoot,
        sessionId: SESSION_ID,
        reason: 'session_recovered',
        createdAt: new Date(),
      })
      expect(getObservedNativeImplementationAudit({
        dataRoot, sessionId: SESSION_ID, workspacePath: workspace,
      })).toEqual(expect.objectContaining({ state: 'interrupted' }))

      const retryPayload = auditorPayload('fresh-audit')
      observeNativeImplementationAuditToolEvent({
        dataRoot, sessionId: SESSION_ID, workspacePath: workspace,
        eventType: 'tool.started', payload: retryPayload, createdAt: new Date(),
      })
      recordNativeDeliveryContractForTest({
        dataRoot,
        sessionId: SESSION_ID,
        agentToolUseID: 'fresh-audit',
      })
      observeNativeImplementationAuditToolEvent({
        dataRoot, sessionId: SESSION_ID, workspacePath: workspace,
        eventType: 'tool.completed',
        payload: { ...retryPayload, output: JSON.stringify(passedReport()) },
        createdAt: new Date(),
      })
      expect(getObservedNativeImplementationAudit({
        dataRoot, sessionId: SESSION_ID, workspacePath: workspace,
      }).state).toBe('current')
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('requires a passing Auditor to cover every current import and composition id', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-auditor-assets-'))
    const dataRoot = `${workspace}-runtime`
    try {
      await writeFile(join(workspace, 'game.ts'), 'export const playable = true\n')
      await mkdir(join(workspace, 'assets', 'library'), { recursive: true })
      await writeFile(join(workspace, 'assets', 'library', 'module.bin'), 'asset')
      await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
        version: 5,
        project_target: { asset_format_capabilities: ['bin'] },
        requirements: [],
        imports: [{
          id: 'world-module',
          source: { type: 'project-authored' },
          status: 'referenced',
          root_path: 'assets/library/module.bin',
          local_files: ['assets/library/module.bin'],
          selected_at: 'now',
          selection_reason: ['approved composition'],
          usage_evidence: { references: ['game.ts'] },
        }],
        compositions: [{
          id: 'world-scene',
          kind: 'scene',
          status: 'integrated',
          members: [{ import_id: 'world-module', role: 'environment' }],
          recipe: { path: 'game.ts' },
          integration_evidence: { references: ['game.ts'] },
        }],
      }))
      recordNativeImplementationAuditReportForTest({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
        report: passedReport(),
      })
      expect(getObservedNativeImplementationAudit({
        dataRoot, sessionId: SESSION_ID, workspacePath: workspace,
      })).toEqual(expect.objectContaining({
        state: 'invalid',
        reason: 'terminal_result_invalid',
      }))

      recordNativeImplementationAuditReportForTest({
        dataRoot,
        sessionId: SESSION_ID,
        workspacePath: workspace,
        report: {
          ...passedReport(),
          auditedImportIds: ['world-module'],
          auditedCompositionIds: ['world-scene'],
        },
      })
      expect(getObservedNativeImplementationAudit({
        dataRoot, sessionId: SESSION_ID, workspacePath: workspace,
      }).state).toBe('current')
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
    auditedImportIds: [],
    auditedCompositionIds: [],
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
