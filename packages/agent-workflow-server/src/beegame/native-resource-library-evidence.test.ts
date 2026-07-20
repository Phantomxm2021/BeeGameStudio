import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getObservedNativeResourceLibraryEvidence,
  observeNativeResourceLibraryToolEvent,
} from './native-resource-library-evidence'

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
      version: 3,
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

  test('keeps Pack exploration current only for the same art and target context', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    const workspace = await mkdtemp(join(tmpdir(), 'resource-workspace-'))
    try {
      await mkdir(join(workspace, 'docs'), { recursive: true })
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(join(workspace, 'docs', 'ART_DIRECTION.md'), '# Art\n')
      await writeFile(join(workspace, 'docs', 'ASSET_PLAN.md'), '# Assets\n')
      await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
        project_target: {
          asset_format_capabilities: ['portable-model'],
          resource_library_usage: 'preferred',
        },
        slots: [],
      }))
      observeNativeResourceLibraryToolEvent({
        dataRoot,
        sessionId: 'session-a',
        workspacePath: workspace,
        eventType: 'tool.completed',
        payload: {
          toolName: 'ResourceLibrary',
          toolUseID: 'tool-a',
          input: { action: 'browse_packs' },
          output: JSON.stringify({ items: [] }),
        },
        createdAt: new Date('2026-07-19T00:00:00.000Z'),
      })

      expect(getObservedNativeResourceLibraryEvidence({
        dataRoot,
        sessionId: 'session-a',
        workspacePath: workspace,
      })).toMatchObject({ state: 'current', actions: ['browse_packs'] })

      await writeFile(join(workspace, 'docs', 'ART_DIRECTION.md'), '# Changed art\n')
      expect(getObservedNativeResourceLibraryEvidence({
        dataRoot,
        sessionId: 'session-a',
        workspacePath: workspace,
      })).toMatchObject({ state: 'stale' })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
