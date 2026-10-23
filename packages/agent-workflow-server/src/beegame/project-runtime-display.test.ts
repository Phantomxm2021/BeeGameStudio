import { expect, test } from 'bun:test'
import { projectRuntimeDisplayReason } from './project-runtime-display'

test('runtime failures preserve a stable public reason without leaking paths or credentials', () => {
  const reason = projectRuntimeDisplayReason('Failed at /Users/example/project/game.ts; Bearer private-token')
  expect(reason).toMatchObject({ code: 'runtime_failed', message: 'The project task failed and needs attention.' })
  expect(reason?.detail).not.toContain('/Users/example')
  expect(reason?.detail).toContain('game.ts')
  expect(reason?.detail).not.toContain('private-token')
  expect(reason?.diagnosticId).toStartWith('runtime-')
})

test('already projected runtime reasons keep their public identity', () => {
  expect(projectRuntimeDisplayReason({
    message: 'Action required', detail: 'Secret token: abc123', code: 'provider_failed', diagnosticId: 'failure-1',
  })).toMatchObject({ message: 'Action required', code: 'provider_failed', diagnosticId: 'failure-1' })
})
