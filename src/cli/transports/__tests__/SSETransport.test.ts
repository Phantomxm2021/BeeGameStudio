import { describe, expect, test } from 'bun:test'
import { parseSSEFrames, SSETransport } from '../SSETransport.js'

describe('parseSSEFrames', () => {
  test('parses LF-delimited frames', () => {
    const input = 'event: client_event\ndata: {"ok":true}\n\n'
    const { frames, remaining } = parseSSEFrames(input)

    expect(remaining).toBe('')
    expect(frames).toEqual([
      {
        event: 'client_event',
        data: '{"ok":true}',
      },
    ])
  })

  test('parses CRLF-delimited frames and strips trailing carriage returns', () => {
    const input =
      'event: client_event\r\ndata: {"ok":true}\r\nid: 7\r\n\r\nevent: keepalive\r\ndata: ping\r\n\r\n'
    const { frames, remaining } = parseSSEFrames(input)

    expect(remaining).toBe('')
    expect(frames).toEqual([
      {
        event: 'client_event',
        data: '{"ok":true}',
        id: '7',
      },
      {
        event: 'keepalive',
        data: 'ping',
      },
    ])
  })

  test('keeps incomplete trailing frame in remaining buffer for CRLF streams', () => {
    const input =
      'event: client_event\r\ndata: {"ok":true}\r\n\r\ndata: {"tail":1}\r\n'
    const { frames, remaining } = parseSSEFrames(input)

    expect(frames).toEqual([
      {
        event: 'client_event',
        data: '{"ok":true}',
      },
    ])
    expect(remaining).toBe('data: {"tail":1}\r\n')
  })
})

test('SSE replay suppresses duplicate delivery and acknowledgement, not distinct events', async () => {
  const transport = new SSETransport(
    new URL('http://127.0.0.1:1/v1/code/sessions/test/worker/events/stream'),
    {},
    'test',
    undefined,
    undefined,
    () => ({}),
  )
  const data: string[] = []
  const acknowledged: number[] = []
  transport.setOnData(value => data.push(value))
  transport.setOnEvent(event => acknowledged.push(event.sequence_num))
  // Exercise the actual reader across two reconnect streams, without network IO.
  const reader = transport as unknown as {
    state: string
    readStream(body: ReadableStream<Uint8Array>): Promise<void>
  }
  reader.state = 'closed'
  const frame = (seq: number) =>
    `id: ${seq}\nevent: client_event\ndata: ${JSON.stringify({
      event_id: `event-${seq}`,
      sequence_num: seq,
      event_type: 'user',
      source: 'client',
      payload: { type: 'user', uuid: `message-${seq}` },
    })}\n\n`
  async function read(text: string) {
    await reader.readStream(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text))
          controller.close()
        },
      }),
    )
  }
  try {
    await read(frame(1) + frame(1) + frame(3))
    await read(frame(3) + frame(2) + frame(4))
    expect(data).toHaveLength(4)
    expect(acknowledged).toEqual([1, 3, 2, 4])
    expect(transport.getLastSequenceNum()).toBe(4)
  } finally {
    transport.close()
  }
})
