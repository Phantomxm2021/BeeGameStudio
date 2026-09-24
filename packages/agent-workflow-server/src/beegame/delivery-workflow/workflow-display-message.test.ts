import { describe, expect, test } from 'bun:test'
import {
  projectWorkflowCurrentMessage,
  projectWorkflowDisplayReason,
  sanitizeWorkflowDisplayDetail,
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
  test('does not guess reviewer status from localized prose', () => {
    for (const value of ['模型响应 6 · Read docs/GDD.md', 'Reading', '읽는 중', 'モデルの応答'])
      expect(projectWorkflowCurrentMessage({ value, phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW' })).toBe('')
  })
  test('hides raw reviewer and reviser prose from the foundation review card', () => {
    expect(projectWorkflowCurrentMessage({ value: 'I have what I need. Now I will rewrite it.', phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW' })).toBe('')
  })

  test('keeps sanitized progress outside the foundation review boundary', () => {
    expect(projectWorkflowCurrentMessage({ value: '正在编写验收清单。', phase: 'DOCUMENT_REVIEW', documentStep: 'CHECKLIST_DRAFTING' })).toBe('正在编写验收清单。')
  })
})

describe('projectWorkflowDisplayReason', () => {
  test.each(['user stopped workflow', 'provider request failed', '작업 실패', '処理に失敗'])('does not classify free-text reason: %s', reason => {
    const projection = projectWorkflowDisplayReason(reason)
    expect(projection?.code).toBe('workflow_blocked')
    expect(projection?.message).toBe('Workflow is blocked and needs attention.')
    expect(projection?.message).not.toContain(reason)
    expect(projection?.detail).toBe(reason)
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
      detail: 'user stopped workflow',
      code: 'user_stopped' as const,
      diagnosticId: 'workflow-stop-1234',
    }
    expect(projectWorkflowDisplayReason(projected)).toEqual(projected)
  })

  test('preserves structured diagnostic context through display reprojection', () => {
    const projected = {
      message: 'Foundation revision validation failed.',
      detail: 'revision validation failed: stale receipt',
      code: 'revision_validation_failed' as const,
      diagnosticId: 'workflow-context-1234',
      stage: 'DOCUMENT_REVIEW',
      taskId: 'revision:docs/GDD.md',
      documentPath: 'docs/GDD.md',
      retryable: true,
    }
    expect(projectWorkflowDisplayReason(projected)).toEqual(projected)
  })

  test('does not infer a diagnostic id from prose', () => {
    const projection = projectWorkflowDisplayReason(
      '当前项目的工作流状态无效。诊断编号：trace-12345678',
    )

    expect(projection?.diagnosticId).toMatch(/^workflow-[0-9a-f]{12}$/)
    expect(projection?.message).not.toContain('trace-12345678')
  })

  test('preserves structured context without classifying raw failure prose', () => {
    const raw =
      'foundation revision validation failed: admitted issue fix target is outside the authorized patch scope'
    const projection = projectWorkflowDisplayReason(raw, {
      stage: 'DOCUMENT_REVIEW',
      taskId: 'revision:docs/ASSET_PLAN.md',
      documentPath: 'docs/ASSET_PLAN.md',
      retryable: true,
    })

    expect(projection).toMatchObject({
      code: 'workflow_blocked',
      message: 'Workflow is blocked and needs attention.',
      stage: 'DOCUMENT_REVIEW',
      taskId: 'revision:docs/ASSET_PLAN.md',
      documentPath: 'docs/ASSET_PLAN.md',
      retryable: true,
    })
    expect(projection?.message).not.toContain(raw)
  })
})

describe('sanitizeWorkflowDisplayDetail', () => {
  test('redacts credentials and host paths while preserving the cause', () => {
    expect(
      sanitizeWorkflowDisplayDetail(
        'receipt digest mismatch at /Users/example/project/run.json; api_key=secret-value',
      ),
    ).toBe('receipt digest mismatch at [host path redacted]; api_key: [redacted]')
  })

  test('bounds unexpected protocol payloads', () => {
    const detail = sanitizeWorkflowDisplayDetail(`invalid terminal ${'x'.repeat(1_000)}`)
    expect(detail.length).toBe(800)
    expect(detail.endsWith('…')).toBe(true)
  })
})
