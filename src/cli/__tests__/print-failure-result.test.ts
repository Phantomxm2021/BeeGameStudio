import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('headless terminal failure reports its cause, not recovered session-wide tool errors', async () => {
  // Exercise the actual result emission without booting auth/plugins/model IO.
  const source = readFileSync(new URL('../print.ts', import.meta.url), 'utf8')
  const marker = source.indexOf("subtype: 'error_during_execution'")
  const start = source.lastIndexOf('await structuredIO.write({', marker)
  const end = source.indexOf('\n      } catch', marker)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const emit = new AsyncFunction('structuredIO', 'executingRequestId', 'getSessionId', 'EMPTY_USAGE',
    'randomUUID', 'errorMessage', 'error', 'getInMemoryErrors', source.slice(start, end))
  let result: any, historyReads = 0
  const error = new Error('Invalid BGS revision file scope: "content/index.json"')
  await emit({ write(value: unknown) { result = value } }, 'current-request', () => 'session', {},
    () => 'result-id', (value: Error) => value.message, error, () => {
      historyReads++
      return [{ error: 'Recovered FileTooLargeError' }, { error: 'Recovered write conflict' }]
    })
  expect(result).toMatchObject({ type: 'result', request_id: 'current-request', is_error: true,
    errors: [error.message] })
  expect(historyReads).toBe(0)
})
