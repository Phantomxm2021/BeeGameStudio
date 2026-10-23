import { expect, test } from 'bun:test'
import { checkWorkflowV3Database } from './check-workflow-v3-database'

test('database preflight is read-only, reports missing objects and never claims the replacement RPC migration is verified', async () => {
  const calls: RequestInit[] = []
  const result = await checkWorkflowV3Database({ url: 'https://db.invalid/', serviceKey: 'host-secret',
    fetchImpl: (async (_url, init) => { calls.push(init!); return Response.json({ paths: {} }) }) as typeof fetch })
  expect(calls).toHaveLength(1)
  expect(calls[0]!.method).toBeUndefined()
  expect(calls[0]!.body).toBeUndefined()
  expect(result.missing).toHaveLength(4)
  expect(result.readyForDatabaseAcceptance).toBe(false)
  expect(JSON.stringify(result)).not.toContain('host-secret')
  const present = await checkWorkflowV3Database({ url: 'https://db.invalid', serviceKey: 'host-secret',
    fetchImpl: (async () => Response.json({ paths: Object.fromEntries(result.missing.map(path => [path, {}])) })) as typeof fetch })
  expect(present.readyForDatabaseAcceptance).toBe(true)
  expect(present.authorizedChangesMigration).toBe('unverified')
  expect(present.concurrencyAndPermissions).toBe('unverified')
})

test('failed or non-schema discovery is not reported as an empty legacy database', async () => {
  for (const response of [Response.json({}, { status: 401 }), Response.json({ paths: [] })])
    await expect(checkWorkflowV3Database({ url: 'https://db.invalid', serviceKey: 'secret',
      fetchImpl: (async () => response) as typeof fetch })).rejects.toThrow('Database discovery')
})
