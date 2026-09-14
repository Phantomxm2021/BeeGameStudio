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
  test('projects native review progress without exposing payloads', () => {
    for (const value of ['模型响应 6 · Read docs/GDD.md', '模型响应 6 · 正在接收模型响应（流事件 123）', '模型响应 7 · StructuredOutput'])
      expect(projectWorkflowCurrentMessage({ value, phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW' })).toBe(value)
    for (const value of ['模型响应 6 · Read /Users/private/file', '模型响应 6 · Read ../secret', '模型响应 6 · arbitrary prose', '模型响应 6 · Read docs/GDD.md\nsecret'])
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
  test.each([
    ['Author reached its active-time limit.', '运行时间上限'],
    ['Author reached its no-document-progress limit.', '未发生内容变化'],
    ['Author reached its output-token limit.', '输出 token 上限'],
  ])('explains preserved Author budget pauses: %s', (reason, detail) => {
    const projection = projectWorkflowDisplayReason(reason + ' Working files and usage are preserved.')!
    expect(projection.code).toBe('workflow_blocked')
    expect(projection.message).toContain(detail)
    expect(projection.message).toContain('草稿和用量已保留')
    expect(projection.message).toContain('不会自动重试')
    expect(projectWorkflowDisplayReason(projection)).toEqual(projection)
  })
  test('does not treat arbitrary worker text as an Author budget pause', () => {
    expect(projectWorkflowDisplayReason('worker says Author reached its active-time limit.')?.message)
      .not.toContain('草稿和用量已保留')
  })
  test.each([
    ['user stopped workflow', 'user_stopped'],
    [
      'foundation audit derivation failed: missing document',
      'derivation_failed',
    ],
    ['dispatch failed: worker transport unavailable', 'dispatch_failed'],
    ['provider request failed: upstream unavailable', 'provider_failed'],
  ] as const)('projects %s with a safe technical detail', (reason, code) => {
    const projection = projectWorkflowDisplayReason(reason)

    expect(projection?.code).toBe(code)
    expect(projection?.message).toBeTruthy()
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

  test('preserves an existing diagnostic id outside the user-facing summary', () => {
    const projection = projectWorkflowDisplayReason(
      '当前项目的工作流状态无效。诊断编号：trace-12345678',
    )

    expect(projection).toMatchObject({ diagnosticId: 'trace-12345678' })
    expect(projection?.message).not.toContain('trace-12345678')
  })

  test('projects a revision scope failure with actionable structured context', () => {
    const raw =
      'foundation revision validation failed: admitted issue fix target is outside the authorized patch scope'
    const projection = projectWorkflowDisplayReason(raw, {
      stage: 'DOCUMENT_REVIEW',
      taskId: 'revision:docs/ASSET_PLAN.md',
      documentPath: 'docs/ASSET_PLAN.md',
      retryable: true,
    })

    expect(projection).toMatchObject({
      code: 'revision_validation_failed',
      message:
        'Foundation revision validation failed: the document changed outside the authorized scope.',
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
