import { expect, test } from 'bun:test'
import { createNativeToolDiagnostics } from '../native-tool-diagnostics'

test('diagnostics correlate parent/delegate/poll and retain bounded metadata only', () => {
  let time = 10
  const diagnostics = createNativeToolDiagnostics(() => time)
  const started = diagnostics.started({ id: 'a', name: 'Agent', input: {
    run_in_background: true, prompt: 'SECRET_PROMPT', resume: 'secret-task',
  } }, 'secret-parent')
  time = 123
  const finished = diagnostics.finished({ tool_use_id: 'a', content: 'agentId: secret-task (resume this agent)\nSECRET_OUTPUT' }, 'secret-parent')
  const poll = diagnostics.started({ id: 'poll', name: 'TaskOutput', input: { task_id: 'secret-task', block: true, timeout: 1000 } }, null)
  const waited = diagnostics.finished({ tool_use_id: 'poll', is_error: false,
    content: '<retrieval_status>timeout</retrieval_status>\n<task_id>secret-task</task_id>\n<status>running</status>' }, null)
  expect(started).toMatchObject({ background: true, resume: true })
  expect(finished.durationMs).toBe(113)
  expect(poll.taskRef).toBe(finished.taskRef)
  expect(waited).toMatchObject({ retrievalStatus: 'timeout', taskStatus: 'running', taskRef: poll.taskRef })
  expect(waited).not.toHaveProperty('errorClass')
  const serialized = JSON.stringify({ started, finished, poll, waited })
  for (const secret of ['secret-task', 'secret-parent', 'SECRET_PROMPT', 'SECRET_OUTPUT']) expect(serialized).not.toContain(secret)
})

test('error classifications never persist error bodies or arbitrary XML states', () => {
  const diagnostics = createNativeToolDiagnostics()
  expect(diagnostics.finished({ tool_use_id: 'none', is_error: true, content: 'SyntaxError: PRIVATE_CODE' }, null).errorClass).toBe('syntax_error')
  expect(diagnostics.finished({ is_error: true, content: [{ type: 'text', text: 'Operation not permitted: SECRET' }] }, null).errorClass).toBe('permission_denied')
  expect(diagnostics.finished({ content: '<status>SECRET_STATE</status>' }, null)).not.toHaveProperty('taskStatus')
})

test('missing task and unknown errors retain safe codes, summaries and fingerprints', () => {
  const diagnostics = createNativeToolDiagnostics()
  for (const [content, code] of [
    ['No task found with ID: SECRET_TASK', 'TASK_RESULT_NOT_FOUND'],
    ['SECRET_UNKNOWN_EXCEPTION', 'TOOL_ERROR_UNCLASSIFIED'],
  ]) {
    const result = diagnostics.finished({ is_error: true, content }, null)
    expect(result.errorCode).toBe(code)
    expect(result.errorSummary?.length).toBeGreaterThan(10)
    expect(result.errorRef).toMatch(/^[a-f0-9]{24}$/)
    expect(JSON.stringify(result)).not.toContain('SECRET')
  }
})

test('successful retrieval still diagnoses a failed delegate and records receipt recovery', () => {
  const result = createNativeToolDiagnostics().finished({ is_error: false, content:
    '<retrieval_status>success</retrieval_status><retrieval_source>receipt</retrieval_source><status>failed</status>' +
    '<error>permission denied: PRIVATE_FILE</error>' }, null)
  expect(result).toMatchObject({ retrievalStatus: 'success', retrievalSource: 'receipt', taskStatus: 'failed',
    errorCode: 'TOOL_PERMISSION_DENIED' })
  expect(JSON.stringify(result)).not.toContain('PRIVATE_FILE')
})
