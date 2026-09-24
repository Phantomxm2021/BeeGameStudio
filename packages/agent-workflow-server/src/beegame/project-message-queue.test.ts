import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectMessageQueue } from './project-message-queue'

test('queued project input is durable, ordered, idempotent and removable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-project-queue-'))
  const workspace = join(root, 'game')
  try {
    const queue = createProjectMessageQueue(root)
    const first = await queue.enqueue('owner', workspace, { text: 'First', attachments: [], clientMessageId: 'one' })
    expect((await queue.enqueue('owner', workspace, { text: 'First', attachments: [], clientMessageId: 'one' })).id).toBe(first.id)
    const second = await queue.enqueue('owner', workspace, { text: 'Second', attachments: [], clientMessageId: 'two' })
    expect((await createProjectMessageQueue(root).list('owner', workspace)).map(item => item.text)).toEqual(['First', 'Second'])
    expect((await queue.claimNext('owner', workspace))?.id).toBe(first.id)
    expect(await queue.update('owner', workspace, first.id, 'remove')).toBeUndefined()
    await queue.update('owner', workspace, first.id, 'complete')
    await queue.update('owner', workspace, second.id, 'remove')
    expect(await queue.list('owner', workspace)).toEqual([])
    expect(await queue.list('other-owner', workspace)).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})
