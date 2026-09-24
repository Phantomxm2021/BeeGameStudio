import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { BeeGameAttachment, BeeGameSessionLanguage } from './session-manager'

export type ProjectQueuedMessage = {
  id: string
  clientMessageId: string
  supersedesMessageId?: string
  text: string
  attachments: BeeGameAttachment[]
  language?: BeeGameSessionLanguage
  createdAt: string
  state: 'pending' | 'dispatching'
}

/** User input lives outside the game workspace so queueing cannot change its release revision. */
export function createProjectMessageQueue(dataRoot: string) {
  const tails = new Map<string, Promise<void>>()
  const pathFor = (ownerId: string, workspacePath: string) => join(dataRoot, 'project-message-queue',
    createHash('sha256').update(`${ownerId}\0${resolve(workspacePath)}`).digest('hex'), 'messages.json')

  async function read(path: string): Promise<ProjectQueuedMessage[]> {
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (!Array.isArray(value)) throw new Error('Invalid project message queue')
      return value as ProjectQueuedMessage[]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  async function save(path: string, messages: ProjectQueuedMessage[]) {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(messages)}\n`, 'utf8')
    await rename(temporary, path)
  }
  function locked<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const previous = tails.get(path) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const tail = result.then(() => undefined, () => undefined)
    tails.set(path, tail)
    void tail.then(() => { if (tails.get(path) === tail) tails.delete(path) })
    return result
  }
  return {
    list(ownerId: string, workspacePath: string) {
      const path = pathFor(ownerId, workspacePath)
      return locked(path, () => read(path))
    },
    enqueue(ownerId: string, workspacePath: string, input: Pick<ProjectQueuedMessage,
      'text' | 'attachments' | 'language' | 'supersedesMessageId'> & { clientMessageId?: string }) {
      const path = pathFor(ownerId, workspacePath)
      return locked(path, async () => {
        const messages = await read(path)
        const clientMessageId = input.clientMessageId?.trim() || randomUUID()
        const existing = messages.find(message => message.clientMessageId === clientMessageId)
        if (existing) {
          if (existing.text !== input.text) throw new Error('Client message ID already belongs to another request')
          return existing
        }
        if (messages.length >= 20) throw new Error('Project message queue is full')
        const item: ProjectQueuedMessage = { id: randomUUID(), clientMessageId,
          text: input.text, attachments: input.attachments,
          ...(input.language ? { language: input.language } : {}),
          ...(input.supersedesMessageId ? { supersedesMessageId: input.supersedesMessageId } : {}),
          createdAt: new Date().toISOString(), state: 'pending' }
        await save(path, [...messages, item])
        return item
      })
    },
    claimNext(ownerId: string, workspacePath: string) {
      const path = pathFor(ownerId, workspacePath)
      return locked(path, async () => {
        const messages = await read(path)
        const item = messages[0]
        if (!item) return undefined
        messages[0] = { ...item, state: 'dispatching' }
        await save(path, messages)
        return messages[0]
      })
    },
    update(ownerId: string, workspacePath: string, id: string,
      change: 'claim' | 'restore' | 'remove' | 'complete') {
      const path = pathFor(ownerId, workspacePath)
      return locked(path, async () => {
        const messages = await read(path)
        const index = messages.findIndex(message => message.id === id)
        if (index < 0) return undefined
        const item = messages[index]!
        if ((change === 'claim' || change === 'remove') && item.state !== 'pending') return undefined
        if ((change === 'restore' || change === 'complete') && item.state !== 'dispatching') return undefined
        if (change === 'remove' || change === 'complete') messages.splice(index, 1)
        else messages[index] = { ...item, state: change === 'claim' ? 'dispatching' : 'pending' }
        await save(path, messages)
        return item
      })
    },
  }
}
