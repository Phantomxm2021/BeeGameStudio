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
          action: 'query_candidates',
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
      version: 4,
      phase: 'completed',
      action: 'query_candidates',
      outcome: 'succeeded',
      sessionId: 'session-a',
      turnId: 'turn-a',
    }))
    expect(line).not.toHaveProperty('selection')
    expect(line).not.toHaveProperty('policy')
  })

  test('does not count a completed import call when every requested artifact failed', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    observeNativeResourceLibraryToolEvent({
      dataRoot,
      sessionId: 'session-a',
      workspacePath: '/workspace',
      eventType: 'tool.completed',
      payload: {
        toolName: 'ResourceLibrary',
        toolUseID: 'tool-import',
        input: { action: 'import_elements', selections: [{ import_id: 'asset-a' }] },
        output: JSON.stringify({
          data: {
            result: 'failed',
            requested_count: 1,
            imported_count: 0,
            failed_count: 1,
            imported: [],
            failures: [{ error: 'download failed', import_ids: ['asset-a'] }],
          },
        }),
      },
      createdAt: new Date('2026-07-19T00:00:00.000Z'),
    })

    expect(getObservedNativeResourceLibraryEvidence({
      dataRoot,
      sessionId: 'session-a',
      workspacePath: '/workspace',
    })).toMatchObject({
      state: 'current',
      actions: [],
      failedActions: ['import_elements'],
      successfulImportCount: 0,
      failedImportCount: 1,
    })
  })

  test('keeps a native failed import call as persistent failed evidence', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    observeNativeResourceLibraryToolEvent({
      dataRoot,
      sessionId: 'session-a',
      workspacePath: '/workspace',
      eventType: 'tool.failed',
      payload: {
        toolName: 'ResourceLibrary',
        toolUseID: 'tool-import',
        input: { action: 'import_elements', selections: [{ import_id: 'asset-a' }] },
      },
      createdAt: new Date('2026-07-19T00:00:00.000Z'),
    })

    expect(getObservedNativeResourceLibraryEvidence({
      dataRoot,
      sessionId: 'session-a',
      workspacePath: '/workspace',
    })).toMatchObject({
      state: 'current',
      actions: [],
      failedActions: ['import_elements'],
      successfulImportCount: 0,
    })
  })

  test('clears an unresolved action failure after a later native retry succeeds', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    observeNativeResourceLibraryToolEvent({
      dataRoot, sessionId: 'session-a', workspacePath: '/workspace',
      eventType: 'tool.failed',
      payload: { toolName: 'ResourceLibrary', toolUseID: 'failed-import', input: { action: 'import_elements' } },
      createdAt: new Date('2026-07-19T00:00:00.000Z'),
    })
    observeNativeResourceLibraryToolEvent({
      dataRoot, sessionId: 'session-a', workspacePath: '/workspace',
      eventType: 'tool.completed',
      payload: {
        toolName: 'ResourceLibrary', toolUseID: 'successful-import',
        input: { action: 'import_elements' },
        output: JSON.stringify({ data: {
          result: 'imported', requested_count: 1, imported_count: 1, failed_count: 0,
          imported: [{ import_id: 'asset-a', local_files: ['assets/library/a.glb'] }], failures: [],
        } }),
      },
      createdAt: new Date('2026-07-19T00:01:00.000Z'),
    })

    expect(getObservedNativeResourceLibraryEvidence({
      dataRoot, sessionId: 'session-a', workspacePath: '/workspace',
    })).toMatchObject({
      state: 'current', actions: ['import_elements'], failedActions: [], successfulImportCount: 1,
    })
  })

  test('records only the artifacts actually copied by a partial import', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    observeNativeResourceLibraryToolEvent({
      dataRoot,
      sessionId: 'session-a',
      workspacePath: '/workspace',
      eventType: 'tool.completed',
      payload: {
        toolName: 'ResourceLibrary',
        toolUseID: 'tool-import',
        input: { action: 'import_elements', selections: [{ import_id: 'asset-a' }, { import_id: 'asset-b' }] },
        output: JSON.stringify({ data: {
          result: 'partially_imported',
          requested_count: 2,
          imported_count: 1,
          failed_count: 1,
          imported: [{ import_id: 'asset-a', local_files: ['assets/library/a.glb'] }],
          failures: [{ error: 'download failed', import_ids: ['asset-b'] }],
        } }),
      },
      createdAt: new Date('2026-07-19T00:00:00.000Z'),
    })

    expect(getObservedNativeResourceLibraryEvidence({
      dataRoot,
      sessionId: 'session-a',
      workspacePath: '/workspace',
    })).toMatchObject({
      actions: ['import_elements'],
      failedActions: ['import_elements'],
      successfulImportCount: 1,
      failedImportCount: 1,
    })
  })

  test('clears only the failed import ids that a later retry actually imports', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    const observeImport = (toolUseID: string, data: Record<string, unknown>, createdAt: string) =>
      observeNativeResourceLibraryToolEvent({
        dataRoot,
        sessionId: 'session-a',
        workspacePath: '/workspace',
        eventType: 'tool.completed',
        payload: {
          toolName: 'ResourceLibrary',
          toolUseID,
          input: { action: 'import_elements', selections: [{ import_id: 'asset-a' }, { import_id: 'asset-b' }] },
          output: JSON.stringify({ data }),
        },
        createdAt: new Date(createdAt),
      })
    observeImport('partial-import', {
      imported_count: 1,
      failed_count: 1,
      imported: [{ import_id: 'asset-a' }],
      failures: [{ import_ids: ['asset-b'] }],
    }, '2026-07-19T00:00:00.000Z')
    observeImport('retry-import', {
      imported_count: 1,
      failed_count: 0,
      imported: [{ import_id: 'asset-b' }],
      failures: [],
    }, '2026-07-19T00:01:00.000Z')

    expect(getObservedNativeResourceLibraryEvidence({
      dataRoot,
      sessionId: 'session-a',
      workspacePath: '/workspace',
    })).toMatchObject({
      actions: ['import_elements'],
      failedActions: [],
      successfulImportCount: 2,
      failedImportCount: 0,
    })
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
        version: 5,
        project_target: {
          asset_format_capabilities: ['portable-model'],
          resource_library_usage: 'preferred',
        },
        requirements: [],
        imports: [],
        compositions: [],
      }))
      observeNativeResourceLibraryToolEvent({
        dataRoot,
        sessionId: 'session-a',
        workspacePath: workspace,
        eventType: 'tool.completed',
        payload: {
          toolName: 'ResourceLibrary',
          toolUseID: 'tool-a',
          input: { action: 'query_candidates' },
          output: JSON.stringify({ items: [] }),
        },
        createdAt: new Date('2026-07-19T00:00:00.000Z'),
      })

      expect(getObservedNativeResourceLibraryEvidence({
        dataRoot,
        sessionId: 'session-a',
        workspacePath: workspace,
      })).toMatchObject({ state: 'current', actions: ['query_candidates'] })

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
