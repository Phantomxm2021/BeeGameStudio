import { expect, test } from 'bun:test'
import worker from '../index'

function fixture(
  options: {
    failWrite?: boolean
    failDelete?: boolean
    maxBytes?: number
  } = {},
) {
  const objects = new Map([
    ['7d/stable.html', 'old-seven'],
    ['30d/stable.html', 'old-thirty'],
  ])
  const operations: string[] = []
  const env = {
    TOKEN: 'offline-test',
    MAX_BYTES: String(options.maxBytes ?? 100),
    DEFAULT_TTL_DAYS: '7',
    BUCKET: {
      async put(key: string, body: ArrayBuffer) {
        operations.push('put:' + key)
        if (options.failWrite) throw new Error('storage write failed')
        objects.set(key, new TextDecoder().decode(body))
      },
      async delete(key: string) {
        operations.push('delete:' + key)
        if (options.failDelete) throw new Error('cleanup failed')
        objects.delete(key)
      },
    },
  } as unknown as Env
  const request = (body: BodyInit = 'new-content', ttl = 7) =>
    new Request('https://offline.invalid/upload?hash=stable&ttl=' + ttl, {
      method: 'POST',
      headers: {
        authorization: 'Bearer offline-test',
        'content-type': 'text/html',
      },
      body,
    })
  return { env, objects, operations, request }
}

test('oversized replacement without Content-Length preserves both old versions', async () => {
  const f = fixture({ maxBytes: 4 })
  const response = await worker.fetch(f.request('12345'), f.env)
  expect(response.status).toBe(413)
  expect(f.operations).toEqual([])
  expect([...f.objects.values()]).toEqual(['old-seven', 'old-thirty'])
})

test('body read failure preserves the previous artifact', async () => {
  const f = fixture()
  const body = new ReadableStream({
    start(controller) {
      controller.error(new Error('body interrupted'))
    },
  })
  await expect(worker.fetch(f.request(body), f.env)).rejects.toThrow(
    'body interrupted',
  )
  expect(f.operations).toEqual([])
  expect([...f.objects.values()]).toEqual(['old-seven', 'old-thirty'])
})

test('failed replacement write does not delete the old artifact', async () => {
  const f = fixture({ failWrite: true })
  await expect(worker.fetch(f.request(), f.env)).rejects.toThrow(
    'storage write failed',
  )
  expect(f.operations).toEqual(['put:7d/stable.html'])
  expect([...f.objects.values()]).toEqual(['old-seven', 'old-thirty'])
})

test.each([7, 30])(
  'successful replacement publishes before removing the other TTL: %d',
  async ttl => {
    const f = fixture()
    const response = await worker.fetch(f.request('new-content', ttl), f.env)
    const otherTtl = ttl === 7 ? 30 : 7
    expect(response.status).toBe(200)
    expect(f.operations).toEqual([
      'put:' + ttl + 'd/stable.html',
      'delete:' + otherTtl + 'd/stable.html',
    ])
    expect([...f.objects.entries()]).toEqual([
      [ttl + 'd/stable.html', 'new-content'],
    ])
  },
)

test('cleanup failure cannot delete the newly published artifact', async () => {
  const f = fixture({ failDelete: true })
  await expect(worker.fetch(f.request(), f.env)).rejects.toThrow(
    'cleanup failed',
  )
  expect(f.objects.get('7d/stable.html')).toBe('new-content')
  expect(f.objects.get('30d/stable.html')).toBe('old-thirty')
})
