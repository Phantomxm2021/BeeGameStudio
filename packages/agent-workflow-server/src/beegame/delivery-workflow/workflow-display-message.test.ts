import { describe, expect, test } from 'bun:test'
import {
  projectWorkflowCurrentMessage,
  projectWorkflowDisplayReason,
  sanitizeWorkflowDisplayMessage,
} from './workflow-display-message'

describe('sanitizeWorkflowDisplayMessage', () => {
  test('keeps human-readable workflow progress', () => {
    expect(sanitizeWorkflowDisplayMessage('正在审计资源清单。')).toBe(
      '正在审计资源清单。',
    )
  })

  test('removes a complete structured worker payload', () => {
    expect(
      sanitizeWorkflowDisplayMessage(
        JSON.stringify({
          workerType: 'resource-curator',
          status: 'completed',
          revision: 'resource-revision',
        }),
      ),
    ).toBe('')
  })

  test('keeps prose while removing a fenced protocol payload', () => {
    expect(
      sanitizeWorkflowDisplayMessage(
        '资源审计完成。\n```json\n{"status":"completed"}\n```',
      ),
    ).toBe('资源审计完成。')
  })
})

describe('projectWorkflowCurrentMessage', () => {
  test('hides raw reviewer and reviser prose from the foundation review card', () => {
    expect(
      projectWorkflowCurrentMessage({
        value: 'I have what I need. Now I will rewrite it.',
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
      }),
    ).toBe('')
  })

  test('keeps sanitized progress outside the foundation review boundary', () => {
    expect(
      projectWorkflowCurrentMessage({
        value: '正在编写验收清单。',
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'CHECKLIST_DRAFTING',
      }),
    ).toBe('正在编写验收清单。')
  })
})

describe('projectWorkflowDisplayReason', () => {
  test.each([
    ['user stopped workflow', 'user_stopped'],
    [
      'foundation audit derivation failed: missing document',
      'derivation_failed',
    ],
    ['dispatch failed: worker transport unavailable', 'dispatch_failed'],
    ['provider request failed: upstream unavailable', 'provider_failed'],
  ] as const)('projects %s without exposing the internal reason', (reason, code) => {
    const projection = projectWorkflowDisplayReason(reason)

    expect(projection?.code).toBe(code)
    expect(projection?.message).toBeTruthy()
    expect(projection?.message).not.toContain(reason)
    expect(projection?.diagnosticId).toMatch(/^workflow-[0-9a-f]{12}$/)
  })

  test('uses a stable diagnostic id for an internal reason', () => {
    expect(projectWorkflowDisplayReason('provider request failed')).toEqual(
      projectWorkflowDisplayReason('provider request failed'),
    )
  })

  test('preserves an already projected reason instead of classifying its message again', () => {
    const projected = {
      message: 'Workflow stopped by user.',
      code: 'user_stopped' as const,
      diagnosticId: 'workflow-stop-1234',
    }
    expect(projectWorkflowDisplayReason(projected)).toEqual(projected)
  })

  test('preserves an existing diagnostic id without exposing the detail', () => {
    const projection = projectWorkflowDisplayReason(
      '当前项目的工作流状态无效。诊断编号：trace-12345678',
    )

    expect(projection).toMatchObject({ diagnosticId: 'trace-12345678' })
    expect(projection?.message).not.toContain('trace-12345678')
  })

  test('projects Game IR attention with its diagnostic id', () => {
    const projection = projectWorkflowDisplayReason(
      'game_ir_compilation_failed diagnostic game-ir-12345678',
    )
    expect(projection).toEqual({
      code: 'game_ir_compilation',
      message: 'Game IR compilation needs attention.',
      diagnosticId: 'game-ir-12345678',
    })
  })

  test('projects typed durable diagnostics without exposing expected or actual', () => {
    const projection = projectWorkflowDisplayReason({
      phase: 'GAME_IR_COMPILATION',
      step: 'publication',
      taskId: 'task-1',
      workerType: 'game-ir-compiler',
      reasonCode: 'publication',
      expected: 'reader-valid committed Game IR',
      actual: 'tampered checkpoint',
      diagnosticRef: 'game-ir-typed-1234',
      recoveryAction: 'retry',
    })
    expect(projection).toEqual({
      code: 'game_ir_publication',
      message: 'Game IR publication needs attention.',
      diagnosticId: 'game-ir-typed-1234',
    })
    expect(projection?.message).not.toContain('tampered')
  })
})
