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

  test('records canonical catalog exploration without semantic policy', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    observe({
      toolUseID: 'catalog',
      input: { action: 'browse_catalog', filters: { dimensions: ['3D'] } },
      output: JSON.stringify({ data: { items: [], total: 0 } }),
    })

    const line = JSON.parse(
      await readFile(
        join(dataRoot, 'beegame-resource-library-evidence/session-a.jsonl'),
        'utf8',
      ),
    )
    expect(line).toEqual(
      expect.objectContaining({
        version: 1,
        phase: 'completed',
        action: 'browse_catalog',
        outcome: 'succeeded',
      }),
    )
    expect(line).not.toHaveProperty('selection')
    expect(line).not.toHaveProperty('policy')
  })

  test('records exactly which requested resources were acquired or failed', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    observe({
      toolUseID: 'acquire',
      input: {
        action: 'import_resources',
        selections: [
          { resource_id: 'resource-a' },
          { resource_id: 'resource-b' },
        ],
      },
      output: JSON.stringify({
        data: {
          verified_count: 1,
          resources: [{ resource_id: 'resource-a' }],
          failures: [{ resource_id: 'resource-b', error: 'download failed' }],
        },
      }),
    })

    expect(evidence()).toMatchObject({
      state: 'current',
      actions: ['import_resources'],
      failedActions: ['import_resources'],
      successfulResourceCount: 1,
      failedResourceCount: 1,
    })
  })

  test('keeps a failed acquisition as unresolved evidence', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    observe({
      eventType: 'tool.failed',
      toolUseID: 'failed-acquire',
      input: {
        action: 'import_resources',
        selections: [{ resource_id: 'resource-a' }],
      },
    })

    expect(evidence()).toMatchObject({
      state: 'current',
      actions: [],
      failedActions: ['import_resources'],
      successfulResourceCount: 0,
      failedResourceCount: 1,
    })
  })

  test('clears a resource failure only after that exact resource succeeds', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    observe({
      toolUseID: 'partial',
      input: {
        action: 'import_resources',
        selections: [
          { resource_id: 'resource-a' },
          { resource_id: 'resource-b' },
        ],
      },
      output: acquisitionOutput(['resource-a'], ['resource-b']),
    })
    observe({
      toolUseID: 'retry',
      input: {
        action: 'import_resources',
        selections: [{ resource_id: 'resource-b' }],
      },
      output: acquisitionOutput(['resource-b'], []),
      createdAt: '2026-07-31T00:01:00.000Z',
    })

    expect(evidence()).toMatchObject({
      actions: ['import_resources'],
      failedActions: [],
      successfulResourceCount: 2,
      failedResourceCount: 0,
    })
  })

  test('ignores unsupported tool actions', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    observe({ toolName: 'Bash', toolUseID: 'shell', input: {} })

    await expect(
      readFile(
        join(dataRoot, 'beegame-resource-library-evidence/session-a.jsonl'),
        'utf8',
      ),
    ).rejects.toThrow()
  })

  test('marks catalog evidence stale when design or target context changes', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'resource-evidence-'))
    const workspace = await mkdtemp(join(tmpdir(), 'resource-workspace-'))
    try {
      await mkdir(join(workspace, 'docs'), { recursive: true })
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(join(workspace, 'docs/BALANCE_DESIGN.md'), '# Balance\n')
      await writeFile(
        join(workspace, 'docs/LEVEL_SCENE_DESIGN.md'),
        '# Level and scene\n',
      )
      await writeFile(join(workspace, 'docs/ART_DIRECTION.md'), '# Art\n')
      await writeFile(join(workspace, 'docs/ASSET_PLAN.md'), '# Assets\n')
      await writeFile(
        join(workspace, 'assets/asset-manifest.json'),
        JSON.stringify({
          version: 7,
          project_target: {
            asset_format_capabilities: ['portable-model'],
            resource_library_usage: 'preferred',
            runtime_asset_root: 'assets/runtime',
            content_root: 'assets/content',
            generated_asset_root: 'assets/generated',
          },
          requirements: [],
          resources: [],
        }),
      )
      observe({
        workspacePath: workspace,
        toolUseID: 'catalog',
        input: { action: 'browse_catalog' },
        output: JSON.stringify({ data: { items: [] } }),
      })

      expect(evidence(workspace)).toMatchObject({
        state: 'current',
        actions: ['browse_catalog'],
      })
      await writeFile(
        join(workspace, 'docs/LEVEL_SCENE_DESIGN.md'),
        '# Changed level and scene\n',
      )
      expect(evidence(workspace)).toMatchObject({ state: 'stale' })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  function observe(input: {
    toolName?: string
    toolUseID: string
    input: Record<string, unknown>
    output?: string
    eventType?: string
    workspacePath?: string
    createdAt?: string
  }): void {
    observeNativeResourceLibraryToolEvent({
      dataRoot,
      sessionId: 'session-a',
      workspacePath: input.workspacePath ?? '/workspace',
      eventType: input.eventType ?? 'tool.completed',
      payload: {
        toolName: input.toolName ?? 'ResourceLibrary',
        toolUseID: input.toolUseID,
        input: input.input,
        ...(input.output ? { output: input.output } : {}),
      },
      createdAt: new Date(input.createdAt ?? '2026-07-31T00:00:00.000Z'),
    })
  }

  function evidence(workspacePath = '/workspace') {
    return getObservedNativeResourceLibraryEvidence({
      dataRoot,
      sessionId: 'session-a',
      workspacePath,
    })
  }
})

function acquisitionOutput(acquired: string[], failed: string[]): string {
  return JSON.stringify({
    data: {
      verified_count: acquired.length,
      resources: acquired.map(resource_id => ({ resource_id })),
      failures: failed.map(resource_id => ({
        resource_id,
        error: 'download failed',
      })),
    },
  })
}
