/** Transfer the in-flight next() along with the iterator. Starting another
 * runAgent loses history and can leave the old request executing concurrently. */
export async function* continueAgentIterator<T>(iterator: AsyncGenerator<T, void>,
  pending: Promise<IteratorResult<T, void>>): AsyncGenerator<T, void> {
  let done = false
  try {
    let next = await pending
    while (!next.done) {
      yield next.value
      next = await iterator.next()
    }
    done = true
  } finally { if (!done) await iterator.return() }
}

/** The task controller stays stable across the handoff. Parent ESC cancels
 * foreground work only; an explicit task stop/process cleanup still cancels it. */
export function linkForegroundAbort(parent: AbortSignal, task: AbortController) {
  const abort = () => task.abort(parent.reason)
  if (parent.aborted) abort()
  else parent.addEventListener('abort', abort, { once: true })
  return () => parent.removeEventListener('abort', abort)
}
