import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractNativeToolImages, materializeBeeGameAttachments, prepareBeeGamePromptInput } from './session-manager'
import { readChatAttachment } from './chat-attachments'

test('captures actual tool image bytes, not arbitrary paths or another tool result', () => {
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } }
  const message = { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'screenshot', content: [image, { type: 'text', text: '/private/secret.png' }] },
    { type: 'tool_result', tool_use_id: 'other', content: [image] },
  ] } }
  expect(extractNativeToolImages(message, 'screenshot')).toEqual([{ type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=' }])
  expect(extractNativeToolImages(message, 'missing')).toEqual([])
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
