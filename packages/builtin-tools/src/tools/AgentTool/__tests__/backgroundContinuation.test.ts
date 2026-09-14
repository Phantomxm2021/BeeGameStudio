import { expect, test } from 'bun:test'
import { continueAgentIterator, linkForegroundAbort } from '../backgroundContinuation'

test('handoff retains history, the pending response and exactly one iterator/cleanup', async () => {
  let release!: () => void, starts = 0, cleanups = 0
  const pendingResponse = new Promise<void>(resolve => { release = resolve })
  async function* agent() {
    starts++
    const history = ['read requirements']
    try {
      yield history[0]!
      await pendingResponse
      history.push('write ASSET_PLAN')
      yield history.join(' → ')
    } finally { cleanups++ }
  }
  const iterator = agent()
  expect((await iterator.next()).value).toBe('read requirements')
  const pending = iterator.next()
  const background = continueAgentIterator(iterator, pending)
  release()
  expect((await background.next()).value).toBe('read requirements → write ASSET_PLAN')
  expect((await background.next()).done).toBe(true)
  expect(starts).toBe(1)
  expect(cleanups).toBe(1)
})

test('pending completion/error is not dropped by a background handoff', async () => {
  async function* complete() { return }
  const done = complete()
  expect((await continueAgentIterator(done, done.next()).next()).done).toBe(true)
  async function* fail(): AsyncGenerator<string, void> { throw new Error('pending request failed') }
  const failed = fail(), next = failed.next()
  await expect(continueAgentIterator(failed, next).next()).rejects.toThrow('pending request failed')
})

test('foreground stop propagates; parent stop after handoff does not; task stop does', () => {
  const parent = new AbortController(), foreground = new AbortController()
  linkForegroundAbort(parent.signal, foreground)
  parent.abort()
  expect(foreground.signal.aborted).toBe(true)
  const anotherParent = new AbortController(), background = new AbortController()
  const detach = linkForegroundAbort(anotherParent.signal, background)
  detach(); anotherParent.abort()
  expect(background.signal.aborted).toBe(false)
  background.abort()
  expect(background.signal.aborted).toBe(true)
})
