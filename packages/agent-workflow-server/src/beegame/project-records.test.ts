import { projectHostDirectory } from './project-storage-paths'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendChatTranscript, appendRuntimeDiagnostic, projectChatPath } from './project-records'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(async path => { await rm(projectHostDirectory(path), { recursive: true, force: true }); await rm(path, { recursive: true, force: true }) })) })

describe('project records', () => {
  test('keeps user-visible transcript events separate from bounded diagnostics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'project-records-'))
    directories.push(directory)
    const transcript = projectChatPath(directory)
    expect(projectChatPath(await realpath(directory))).toBe(transcript)
    const diagnostics = join(projectHostDirectory(directory), 'logs', 'runtime-diagnostics.jsonl')

    expect(transcript.startsWith(directory + '/')).toBe(false)
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

})
