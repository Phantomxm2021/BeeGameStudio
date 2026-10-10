import { describe, expect, test } from 'bun:test'
import { SerialBatchEventUploader } from '../SerialBatchEventUploader.js'

async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Uploader stalled')), 300)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function uploader<T>(send: (batch: T[]) => Promise<void>) {
  return new SerialBatchEventUploader<T>({
    maxBatchSize: 2,
    maxQueueSize: 2,
    baseDelayMs: 1,
    maxDelayMs: 2,
    jitterMs: 0,
    send,
  })
}

describe('SerialBatchEventUploader backpressure', () => {
  test('takes an array snapshot before asynchronous admission', async () => {
    const sent: number[] = []
    const subject = uploader<number>(async batch => {
      sent.push(...batch)
    })
    const events = [1, 2, 3]
    try {
      const enqueued = subject.enqueue(events)
      events.splice(0, events.length, 99)
      await deadline(enqueued)
      await deadline(subject.flush())
      expect(sent).toEqual([1, 2, 3])
    } finally {
      subject.close()
    }
  })

  test('splits an oversized enqueue without dropping or reordering events', async () => {
    const sent: number[] = []
    const subject = uploader<number>(async batch => {
      sent.push(...batch)
    })
    try {
      await deadline(subject.enqueue([1, 2, 3, 4, 5]))
      await deadline(subject.flush())
      expect(sent).toEqual([1, 2, 3, 4, 5])
      expect(subject.pendingCount).toBe(0)
    } finally {
      subject.close()
    }
  })

  test('flush waits for callers still admitting events under backpressure', async () => {
    const sent: number[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const subject = uploader<number>(async batch => {
      await gate
      sent.push(...batch)
    })
    let flushed = false
    try {
      const enqueued = subject.enqueue([1, 2, 3, 4, 5])
      const flushedPromise = subject.flush().then(() => {
        flushed = true
      })
      await Bun.sleep(10)
      expect(flushed).toBe(false)
      expect(subject.pendingCount).toBeGreaterThan(0)
      release()
      await deadline(Promise.all([enqueued, flushedPromise]))
      expect(sent).toEqual([1, 2, 3, 4, 5])
    } finally {
      release()
      subject.close()
    }
  })

  test('concurrent enqueue calls retain FIFO order across chunks and retries', async () => {
    const sent: number[] = []
    let calls = 0
    const subject = uploader<number>(async batch => {
      if (calls++ === 0) throw new Error('transient failure')
      sent.push(...batch)
    })
    try {
      await deadline(
        Promise.all([
          subject.enqueue([1, 2, 3, 4, 5]),
          subject.enqueue([6, 7, 8]),
          subject.enqueue(9),
        ]),
      )
      await deadline(subject.flush())
      expect(sent).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    } finally {
      subject.close()
    }
  })

  test('close releases blocked enqueue and flush callers', async () => {
    const subject = uploader<number>(() => new Promise(() => {}))
    const enqueued = subject.enqueue([1, 2, 3, 4, 5])
    const flushed = subject.flush()
    await Bun.sleep(1)
    const pending = subject.pendingCount
    expect(pending).toBeGreaterThan(0)
    subject.close()
    await deadline(Promise.all([enqueued, flushed, subject.flush()]))
    expect(subject.pendingCount).toBe(pending)
  })
})
