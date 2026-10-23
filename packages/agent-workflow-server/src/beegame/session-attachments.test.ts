import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { BeeGameSessionManager, materializeBeeGameAttachments, prepareBeeGamePromptInput } from './session-manager'
import { readChatAttachment } from './chat-attachments'

test('BGS image events snapshot project images and reject outside paths, symlinks and oversized files', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-image-preview-test-'))
  const outside = await mkdtemp(join(tmpdir(), 'beegame-image-outside-test-'))
  const original = await sharp({ create: { width: 1536, height: 1024, channels: 4, background: '#17212c' } }).png().toBuffer()
  const source = join(workspace, 'board.png'), outsideSource = join(outside, 'outside.png')
  const manager = new BeeGameSessionManager({ async start() { return { stop() {}, async submit(turn) {
    for (const imagePath of [source, outsideSource, 'outside.png', 'oversized.png'])
      await turn.onMessage({ type: 'runtime_event', eventType: 'tool.completed', text: imagePath, imagePath })
  } } } }, join(workspace, 'sessions'))
  try {
    await writeFile(source, original)
    await writeFile(outsideSource, original)
    await symlink(outsideSource, join(workspace, 'outside.png'))
    await writeFile(join(workspace, 'oversized.png'), Buffer.concat([original, Buffer.alloc(10 * 1024 * 1024)]))
    const session = manager.start({ workspacePath: workspace, userId: 'fixture' })
    await manager.send(session.id, 'Offline image fixture')
    await manager.waitForSessionIdle(session.id)
    const events = manager.events(session.id).filter(event => event.type === 'tool.completed')
    expect(events).toHaveLength(4)
    const attachments = events[0]!.payload?.attachments as Array<{ storageId: string }>
    expect(attachments).toHaveLength(1)
    const response = await readChatAttachment(workspace, attachments[0]!.storageId)
    const saved = Buffer.from(await response.arrayBuffer())
    expect(saved.equals(original)).toBe(true)
    expect(await sharp(saved).metadata()).toMatchObject({ width: 1536, height: 1024 })
    expect(events.slice(1).every(event => !event.payload?.attachments)).toBe(true)
  } finally {
    await manager.dispose()
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('failed uploads roll back only their own files, preserving historical attachments', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-attachment-test-'))
  const directory = join(workspace, '.beegame-attachments')
  try {
    await mkdir(directory)
    await writeFile(join(directory, 'historical.txt'), 'keep this')
    await expect(materializeBeeGameAttachments(workspace, [
      { type: 'file', filename: 'new.txt', mediaType: 'text/plain', data: Buffer.from('new').toString('base64') },
      { type: 'file', filename: 'invalid.exe', mediaType: 'application/octet-stream', data: 'eA==' },
    ])).rejects.toThrow('Unsupported document attachment')
    expect(await readdir(directory)).toEqual(['historical.txt'])
    expect(await readFile(join(directory, 'historical.txt'), 'utf8')).toBe('keep this')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('prompt uses image bytes but durable metadata contains only attachment references', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-attachment-test-'))
  try {
    const prepared = await prepareBeeGamePromptInput({ workspace, text: '', attachments: [
      { type: 'image', filename: 'reference.png', mediaType: 'image/png', data: 'aW1hZ2U=' },
      { type: 'file', filename: 'brief.txt', mediaType: 'text/plain', data: 'YnJpZWY=' },
    ] })
    expect(prepared.attachments).toHaveLength(2)
    expect(JSON.stringify(prepared.attachments)).not.toContain('aW1hZ2U=')
    expect(prepared.attachments[0]).not.toHaveProperty('relativePath')
    expect(prepared.prompt).toContainEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } })
    const response = await readChatAttachment(workspace, prepared.attachments[0]!.storageId)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(await response.text()).toBe('image')
    const document = await readChatAttachment(workspace, prepared.attachments[1]!.storageId)
    expect(document.headers.get('content-disposition')).toStartWith('attachment;')
    expect(await document.text()).toBe('brief')
    await expect(readChatAttachment(workspace, '../secret')).rejects.toThrow()
    const link = '00000000-0000-0000-0000-000000000000-secret.txt'
    await writeFile(join(workspace, 'secret'), 'private')
    await symlink(join(workspace, 'secret'), join(workspace, '.beegame-attachments', link))
    await expect(readChatAttachment(workspace, link)).rejects.toThrow('Attachment not found')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
