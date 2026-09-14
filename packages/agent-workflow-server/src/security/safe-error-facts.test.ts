import { expect, test } from 'bun:test'
import { safeErrorFacts } from './safe-error-facts'

test('error facts retain only numeric status and allowlisted network codes', () => {
  expect(safeErrorFacts(Object.assign(new Error('Bearer secret-token'), {
    status: 503, url: 'https://secret.example', cause: { code: 'ECONNRESET', body: 'secret-body' },
  }))).toEqual({ httpStatus: 503, networkCode: 'ECONNRESET' })
  expect(safeErrorFacts({ status: '401 secret', code: 'secret-key' })).toEqual({})
  expect(safeErrorFacts({ get status() { throw new Error('secret') } })).toEqual({})
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic
  expect(safeErrorFacts(cyclic)).toEqual({})
})
