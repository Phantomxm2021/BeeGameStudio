import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { observeNativeResourceLibraryToolEvent } from './native-resource-library-evidence'

describe('native Resource Library evidence', () => {
  let dataRoot = ''

  afterEach(async () => {
    if (dataRoot) await rm(dataRoot, { recursive: true, force: true })
  })

  test('records passive provenance without evaluating or controlling the call', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    observeNativeResourceLibraryToolEvent({
      dataRoot,
      sessionId: 'session-a',
      workspacePath: '/workspace',
      turnId: 'turn-a',
      eventType: 'tool.completed',
      payload: {
        toolName: 'ResourceLibrary',
        toolUseID: 'tool-a',
        input: {
          action: 'browse_packs',
          filters: { dimensions: ['3D'], formats: ['glb'] },
        },
        output: JSON.stringify({ items: [], total: 0 }),
      },
      createdAt: new Date('2026-07-19T00:00:00.000Z'),
    })

    const line = JSON.parse(await readFile(
      join(dataRoot, 'beegame-resource-library-evidence', 'session-a.jsonl'),
      'utf8',
    ))
    expect(line).toEqual(expect.objectContaining({
      version: 2,
      phase: 'completed',
      action: 'browse_packs',
      sessionId: 'session-a',
      turnId: 'turn-a',
    }))
    expect(line).not.toHaveProperty('selection')
    expect(line).not.toHaveProperty('policy')
  })

  test('ignores unsupported tools and does not create an evidence file', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    observeNativeResourceLibraryToolEvent({
      dataRoot,
      sessionId: 'session-a',
      workspacePath: '/workspace',
      eventType: 'tool.completed',
      payload: { toolName: 'Bash', toolUseID: 'tool-a', input: { command: 'true' } },
      createdAt: new Date(),
    })

    await expect(readFile(
      join(dataRoot, 'beegame-resource-library-evidence', 'session-a.jsonl'),
      'utf8',
    )).rejects.toThrow()
  })
})
