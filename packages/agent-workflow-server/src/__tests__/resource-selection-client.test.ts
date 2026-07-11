import { expect, test } from 'bun:test'
import { createResourceSelectionClient } from '../beegame/resource-selection-client'

test('sends the service token and returns validated selections', async () => {
  const client = createResourceSelectionClient({ baseUrl: 'http://resource.test/', serviceToken: 'token', fetchImpl: async (_url, init) => {
    expect(new Headers(init?.headers).get('x-beegame-resource-service-token')).toBe('token')
    return Response.json({ selections: [{ slotId: 'tree', packId: 'pack', packVersion: '1', elementId: 'oak', elementPath: 'oak.glb', sourceUrl: 'https://signed', score: 1, reasons: ['category:models'] }] })
  } })
  await expect(client.select([{ slotId: 'tree' }])).resolves.toEqual([expect.objectContaining({ elementId: 'oak' })])
})
