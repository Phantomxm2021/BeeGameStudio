import { constants } from 'node:fs'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export type AgentResultReceipt = {
  version: 1
  task_id: string
  task_type: 'local_agent'
  status: 'running' | 'completed' | 'failed' | 'killed'
  description: string
  output: string
  error?: string
}
const MAX_BYTES = 2 * 1024 * 1024
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id)
const queues = new Map<string, Promise<void>>()

export async function flushAgentResultReceipts(): Promise<void> {
  while (queues.size) await Promise.allSettled([...queues.values()])
}

/** Final answers, not conversation transcripts. Session-scoped, bounded, and
 * atomically published before terminal tasks become eligible for eviction. */
export function writeAgentResultReceipt(directory: string, receipt: AgentResultReceipt,
  standaloneOutput: boolean): Promise<void> {
  if (!validId(receipt.task_id)) return Promise.reject(new Error('Invalid task receipt ID'))
  const key = join(directory, receipt.task_id)
  const operation = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const bounded = { ...receipt, description: receipt.description.slice(0, 2000),
      // JSON control-character escaping can use six bytes per UTF-16 unit.
      // Keep even that worst case (plus metadata) below the reader's disk cap.
      output: receipt.output.length > 250_000 ? receipt.output.slice(0, 250_000) + '\n[task result truncated]' : receipt.output,
      ...(receipt.error ? { error: receipt.error.slice(0, 16000) } : {}) }
    const body = JSON.stringify(bounded) + '\n'
    for (const suffix of standaloneOutput ? ['.result.json', '.output'] : ['.result.json']) {
      const target = key + suffix
      const temporary = target + '.' + randomUUID() + '.tmp'
      try {
        const file = await open(temporary, 'wx', 0o600)
        try { await file.writeFile(body); await file.sync() } finally { await file.close() }
        // rename replaces a link itself; never follow a user-created output link.
        await rename(temporary, target)
      } finally { await unlink(temporary).catch(() => {}) }
    }
  })
  queues.set(key, operation)
  void operation.finally(() => { if (queues.get(key) === operation) queues.delete(key) }).catch(() => {})
  return operation
}

export async function readAgentResultReceipt(directory: string, taskId: string): Promise<AgentResultReceipt | undefined> {
  if (!validId(taskId)) return undefined
  try {
    const file = await open(join(directory, taskId + '.result.json'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) return undefined
      const value = JSON.parse(await file.readFile('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          value.version !== 1 || value.task_id !== taskId || value.task_type !== 'local_agent' ||
          !['completed', 'failed', 'killed'].includes(value.status) || typeof value.description !== 'string' ||
          typeof value.output !== 'string' || (value.error !== undefined && typeof value.error !== 'string')) return undefined
      return { version: 1, task_id: taskId, task_type: 'local_agent', status: value.status,
        description: value.description, output: value.output, ...(value.error ? { error: value.error } : {}) }
    } finally { await file.close() }
  } catch (error) {
    if (['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '') || error instanceof SyntaxError) return undefined
    throw error
  }
}
