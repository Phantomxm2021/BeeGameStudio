import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { createNativeAssetManifestTool } from './native-asset-manifest-tool'

type ToolDefinition = {
  call(input: { content: string }): Promise<unknown>
}

function manifestWithDecision(decision: Record<string, unknown>) {
  return {
    version: 5,
    project_target: {
      asset_format_capabilities: ['png'],
      resource_library_usage: 'preferred',
      runtime_asset_root: 'public/assets',
    },
    requirements: [
      {
        id: 'ui-typography',
        required: true,
        source_decision: decision,
        status: 'planned',
      },
    ],
    imports: [],
    compositions: [],
  }
}

describe('SubmitAssetManifest', () => {
  test('rejects an incomplete source decision before persistence', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-tool-'))
    const tool = createNativeAssetManifestTool({
      buildTool: definition => definition,
      workspacePath: workspace,
    }) as ToolDefinition

    await expect(
      tool.call({
        content: JSON.stringify(
          manifestWithDecision({
            type: 'system-provided',
            basis: 'approved-project-plan',
          }),
        ),
      }),
    ).rejects.toThrow(
      'requirements[0].source_decision.reasons must be an array of non-empty strings',
    )
    await expect(
      readFile(join(workspace, 'assets/asset-manifest.json'), 'utf8'),
    ).rejects.toThrow()
  })

  test('records the accepted decision time and persists one canonical manifest', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-tool-'))
    const acceptedAt = new Date('2026-07-31T08:00:00.000Z')
    const tool = createNativeAssetManifestTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      now: () => acceptedAt,
    }) as ToolDefinition

    await tool.call({
      content: JSON.stringify(
        manifestWithDecision({
          type: 'system-provided',
          reasons: [
            'The approved UI specification uses the target font stack.',
          ],
          basis: 'approved-project-plan',
        }),
      ),
    })

    const persisted = JSON.parse(
      await readFile(join(workspace, 'assets/asset-manifest.json'), 'utf8'),
    )
    expect(persisted.requirements[0].source_decision).toEqual({
      type: 'system-provided',
      reasons: ['The approved UI specification uses the target font stack.'],
      basis: 'approved-project-plan',
      decided_at: acceptedAt.toISOString(),
    })
  })
})
