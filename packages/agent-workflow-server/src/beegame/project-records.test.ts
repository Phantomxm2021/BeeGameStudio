import { afterEach, describe, expect, test } from 'bun:test'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendChatTranscript, appendRuntimeDiagnostic } from './project-records'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

const transcriptEvent = (type: string, id = 1, text = 'BGS_TRANSCRIPT_TOKEN') => ({
  id, sessionId: 'session-1', turnId: 'turn-1', type, text,
  createdAt: new Date('2026-09-17T00:00:00.000Z'),
})

const search = (directory: string, args: string[]) => execFileSync('rg', args, { cwd: directory, encoding: 'utf8' })

describe('project records', () => {
  test('keeps user-visible transcript events separate from bounded diagnostics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'project-records-'))
    directories.push(directory)
    const transcript = join(directory, 'transcripts', 'chat.jsonl')
    const diagnostics = join(directory, 'logs', 'runtime-diagnostics.jsonl')

    appendChatTranscript(transcript, {
      id: 1, sessionId: 'session-1', turnId: 'turn-1', type: 'assistant.thinking',
      text: 'Checking scene data.', createdAt: new Date('2026-09-17T00:00:00.000Z'),
    })
    appendRuntimeDiagnostic({
      path: diagnostics,
      record: { type: 'agent.transport', sessionId: 'session-1', messageType: 'stream_event' },
      maxBytes: 256,
      archiveCount: 1,
    })

    expect(JSON.parse((await readFile(transcript, 'utf8')).trim())).toMatchObject({
      type: 'assistant.thinking', text: 'Checking scene data.',
    })
    expect(JSON.parse((await readFile(diagnostics, 'utf8')).trim())).toEqual({
      type: 'agent.transport', sessionId: 'session-1', messageType: 'stream_event',
    })
  })

  test.skipIf(!Bun.which('rg'))('maintains a local transcript ignore boundary without hiding source JSONL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'project-records-rg-'))
    directories.push(directory)
    const transcript = join(directory, 'transcripts', 'chat.jsonl')
    const source = join(directory, 'src', 'source.jsonl')
    await mkdir(join(directory, 'src'), { recursive: true })
    await writeFile(source, 'BGS_TRANSCRIPT_TOKEN\n')

    appendChatTranscript(transcript, transcriptEvent('session.started'))
    appendChatTranscript(transcript, transcriptEvent('assistant.message', 2))

    expect(await readFile(join(directory, 'transcripts', '.ignore'), 'utf8')).toBe('/*.jsonl\n')
    const normal = search(directory, ['-n', 'BGS_TRANSCRIPT_TOKEN', '.'])
    expect(normal).toContain('src/source.jsonl')
    expect(normal).not.toContain('transcripts/chat.jsonl')
    expect(search(directory, ['-n', 'BGS_TRANSCRIPT_TOKEN', 'transcripts/chat.jsonl']))
      .toContain('BGS_TRANSCRIPT_TOKEN')
    const noIgnore = search(directory, ['-n', '--no-ignore', 'BGS_TRANSCRIPT_TOKEN', '.'])
    expect(noIgnore).toContain('src/source.jsonl')
    expect(noIgnore).toContain('transcripts/chat.jsonl')
    expect((await readFile(transcript, 'utf8')).trim().split('\n')).toHaveLength(2)

    const ordinary = join(directory, 'records', 'chat.jsonl')
    appendChatTranscript(ordinary, transcriptEvent('session.started', 3))
    await expect(readFile(join(directory, 'records', '.ignore'), 'utf8')).rejects.toThrow()
  })

  test('adds the marker when resuming an old transcript and preserves an existing marker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'project-records-resume-'))
    directories.push(directory)
    const transcript = join(directory, 'transcripts', 'chat.jsonl')
    await mkdir(join(directory, 'transcripts'), { recursive: true })
    await writeFile(transcript, '{"type":"old.event"}\n')

    appendChatTranscript(transcript, transcriptEvent('session.resumed'))

    expect(await readFile(join(directory, 'transcripts', '.ignore'), 'utf8')).toBe('/*.jsonl\n')
    expect((await readFile(transcript, 'utf8')).trim().split('\n')).toHaveLength(2)

    const existingDirectory = join(directory, 'existing', 'transcripts')
    const existingTranscript = join(existingDirectory, 'chat.jsonl')
    await mkdir(existingDirectory, { recursive: true })
    await writeFile(join(existingDirectory, '.ignore'), '# keep project rules\n')
    appendChatTranscript(existingTranscript, transcriptEvent('session.started'))
    expect(await readFile(join(existingDirectory, '.ignore'), 'utf8')).toBe('# keep project rules\n')
    expect(JSON.parse((await readFile(existingTranscript, 'utf8')).trim())).toMatchObject({ type: 'session.started' })
  })

  test('does not follow transcript marker or directory symlinks and never drops the event', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'project-records-symlink-'))
    directories.push(directory)

    const blockedDirectory = join(directory, 'blocked', 'transcripts')
    await mkdir(join(blockedDirectory, '.ignore'), { recursive: true })
    const blockedTranscript = join(blockedDirectory, 'chat.jsonl')
    appendChatTranscript(blockedTranscript, transcriptEvent('session.started'))
    expect(JSON.parse((await readFile(blockedTranscript, 'utf8')).trim())).toMatchObject({ type: 'session.started' })

    const markerDirectory = join(directory, 'marker', 'transcripts')
    const markerTarget = join(directory, 'marker-target.ignore')
    await mkdir(markerDirectory, { recursive: true })
    await writeFile(markerTarget, '# preserve\n')
    await symlink('../../marker-target.ignore', join(markerDirectory, '.ignore'))
    const markerTranscript = join(markerDirectory, 'chat.jsonl')
    appendChatTranscript(markerTranscript, transcriptEvent('session.resumed'))
    expect(await readFile(markerTarget, 'utf8')).toBe('# preserve\n')
    expect((await lstat(join(markerDirectory, '.ignore'))).isSymbolicLink()).toBe(true)
    expect(JSON.parse((await readFile(markerTranscript, 'utf8')).trim())).toMatchObject({ type: 'session.resumed' })

    const linkedDirectory = join(directory, 'linked')
    const linkedTarget = join(directory, 'linked-target')
    await mkdir(linkedDirectory, { recursive: true })
    await mkdir(linkedTarget, { recursive: true })
    await symlink('../linked-target', join(linkedDirectory, 'transcripts'))
    const linkedTranscript = join(linkedDirectory, 'transcripts', 'chat.jsonl')
    appendChatTranscript(linkedTranscript, transcriptEvent('session.started'))
    expect(JSON.parse((await readFile(join(linkedTarget, 'chat.jsonl'), 'utf8')).trim()))
      .toMatchObject({ type: 'session.started' })
    await expect(readFile(join(linkedTarget, '.ignore'), 'utf8')).rejects.toThrow()
  })
})
