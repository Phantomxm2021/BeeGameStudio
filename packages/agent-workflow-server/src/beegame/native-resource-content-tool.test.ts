import { afterEach, describe, expect, test } from 'bun:test'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBeeGameAssetManifest } from './asset-contracts'
import {
  computeResourceContentRootDigest,
  createNativeResourceContentTool,
  readResourceContentCommitReceipt,
  reconcileResourceContentCommitReceipt,
} from './native-resource-content-tool'
import {
  computeResourceInventoryRevision,
  computeResourceRevision,
} from './delivery-workflow/revision'

type Tool = {
  call(input: unknown): Promise<{ data: Record<string, unknown> }>
  isReadOnly(input: unknown): boolean
  mapToolResultToToolResultBlockParam(
    output: unknown,
    toolUseID: string,
  ): Record<string, unknown>
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  )
})

async function createWorkspace(options?: {
  includeMissingAudio?: boolean
}): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'resource-content-commit-'))
  roots.push(workspace)
  await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
  await writeFile(join(workspace, 'assets/runtime/model.glb'), 'model')
  await writeBeeGameAssetManifest(workspace, {
    version: 8,
    project_target: {
      asset_format_capabilities: ['glb', 'json', 'yaml'],
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [
      { id: 'req-model', required: true },
      ...(options?.includeMissingAudio
        ? [{ id: 'req-audio', required: true }]
        : []),
    ],
    resources: [
      {
        id: 'res-model',
        source: {
          type: 'agent-authored',
          created_at: '2026-08-05T00:00:00.000Z',
          reason: 'canonical resource',
        },
        root_path: 'assets/runtime/model.glb',
        file_paths: ['assets/runtime/model.glb'],
        provisional: true,
        status: 'verified',
        selected_at: '2026-08-05T00:00:00.000Z',
        selection_reason: ['Canonical resource.'],
      },
    ],
  })
  return workspace
}

async function createTool(workspacePath: string): Promise<Tool> {
  return createNativeResourceContentTool({
    buildTool: definition => definition,
    workspacePath,
    contract: {
      dispatchId: 'dispatch-content-test',
      inventoryRevision: await computeResourceInventoryRevision(workspacePath),
      baselineResourceRevision: await computeResourceRevision(
        workspacePath,
        '',
      ),
      requiredRequirementIds: ['req-model'],
      verifiedResourceIds: ['res-model'],
      inventoryBindings: [
        { requirementId: 'req-model', resourceIds: ['res-model'] },
      ],
      protectedPaths: [],
    },
    assertMutationAuthority: () => undefined,
  }) as Tool
}

async function commitRegistryOnly(workspacePath: string): Promise<void> {
  const tool = await createTool(workspacePath)
  await tool.call({
    action: 'commit',
    documents: [
      {
        path: 'assets/content/resource-registry.json',
        schema: 'beegame-content-v1',
        id: 'registry',
        kind: 'resource-registry',
        fulfills: ['req-model'],
        resources: ['res-model'],
        data: {
          bindings: [
            { requirementId: 'req-model', resourceIds: ['res-model'] },
          ],
        },
      },
    ],
  })
}

describe('native canonical resource content commit', () => {
  test('reads exact committed proof and current root digest without reconciling it', async () => {
    const workspace = await createWorkspace()
    await commitRegistryOnly(workspace)

    const receipt = readResourceContentCommitReceipt(
      workspace,
      'dispatch-content-test',
    )

    expect(receipt).toMatchObject({
      dispatchId: 'dispatch-content-test',
      status: 'committed',
      action: 'commit',
    })
    if (!receipt || receipt.action !== 'commit')
      throw new Error('expected committed Resource Content proof')
    expect(computeResourceContentRootDigest(workspace)).toBe(
      receipt.finalRootDigest,
    )
  })

  test('maps an accepted runtime result into a tool result block', async () => {
    const workspace = await createWorkspace()
    const tool = await createTool(workspace)

    expect(
      tool.mapToolResultToToolResultBlockParam(
        { accepted: true, status: 'completed' },
        'tool-use-content',
      ),
    ).toEqual({
      tool_use_id: 'tool-use-content',
      type: 'tool_result',
      content: JSON.stringify({ accepted: true, status: 'completed' }),
    })
  })

  test('does not recover a committed receipt when the published root digest changed', async () => {
    const workspace = await createWorkspace()
    await commitRegistryOnly(workspace)
    await writeFile(
      join(workspace, 'assets/content/resource-registry.json'),
      '{"changed":true}\n',
    )

    await expect(
      reconcileResourceContentCommitReceipt({
        workspacePath: workspace,
        dispatchId: 'dispatch-content-test',
        assertMutationAuthority: () => undefined,
      }),
    ).resolves.toBeUndefined()
  })

  test('finishes a prepared receipt only when its published root digest matches', async () => {
    const workspace = await createWorkspace()
    await commitRegistryOnly(workspace)
    const receiptPath = join(
      workspace,
      '.beegame/workflow/resource-content-commits/dispatch-content-test.json',
    )
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    await writeFile(
      receiptPath,
      `${JSON.stringify({ ...receipt, status: 'prepared' }, null, 2)}\n`,
    )

    await expect(
      reconcileResourceContentCommitReceipt({
        workspacePath: workspace,
        dispatchId: 'dispatch-content-test',
        assertMutationAuthority: () => undefined,
      }),
    ).resolves.toMatchObject({ status: 'committed' })
  })

  test('removes the recorded backup after a prepared root was published', async () => {
    const workspace = await createWorkspace()
    await commitRegistryOnly(workspace)
    const receiptPath = join(
      workspace,
      '.beegame/workflow/resource-content-commits/dispatch-content-test.json',
    )
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    await mkdir(receipt.backupRoot, { recursive: true })
    await writeFile(join(receipt.backupRoot, 'previous.json'), 'previous bytes')
    await writeFile(
      receiptPath,
      `${JSON.stringify({ ...receipt, status: 'prepared' }, null, 2)}\n`,
    )

    await expect(
      reconcileResourceContentCommitReceipt({
        workspacePath: workspace,
        dispatchId: 'dispatch-content-test',
        assertMutationAuthority: () => undefined,
      }),
    ).resolves.toMatchObject({ status: 'committed' })
    await expect(access(receipt.backupRoot)).rejects.toThrow()
  })

  test('publishes recorded staging after a crash before the root rename', async () => {
    const workspace = await createWorkspace()
    await mkdir(join(workspace, 'assets/content'), { recursive: true })
    await writeFile(join(workspace, 'assets/content/baseline.txt'), 'baseline')
    await commitRegistryOnly(workspace)
    const receiptPath = join(
      workspace,
      '.beegame/workflow/resource-content-commits/dispatch-content-test.json',
    )
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    await rename(join(workspace, 'assets/content'), receipt.stagingRoot)
    await mkdir(join(workspace, 'assets/content'), { recursive: true })
    await writeFile(join(workspace, 'assets/content/baseline.txt'), 'baseline')
    await writeFile(
      receiptPath,
      `${JSON.stringify({ ...receipt, status: 'prepared' }, null, 2)}\n`,
    )

    await expect(
      reconcileResourceContentCommitReceipt({
        workspacePath: workspace,
        dispatchId: 'dispatch-content-test',
        assertMutationAuthority: () => undefined,
      }),
    ).resolves.toMatchObject({ status: 'committed' })
    expect(
      JSON.parse(
        await readFile(
          join(workspace, 'assets/content/resource-registry.json'),
          'utf8',
        ),
      ),
    ).toMatchObject({ id: 'registry' })
    await expect(access(receipt.stagingRoot)).rejects.toThrow()
    await expect(access(receipt.backupRoot)).rejects.toThrow()
  })

  test('publishes a prepared staging root after a crash removed the canonical root', async () => {
    const workspace = await createWorkspace()
    await commitRegistryOnly(workspace)
    const receiptPath = join(
      workspace,
      '.beegame/workflow/resource-content-commits/dispatch-content-test.json',
    )
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    await rename(join(workspace, 'assets/content'), receipt.stagingRoot)
    await writeFile(
      receiptPath,
      `${JSON.stringify({ ...receipt, status: 'prepared' }, null, 2)}\n`,
    )

    await expect(
      reconcileResourceContentCommitReceipt({
        workspacePath: workspace,
        dispatchId: 'dispatch-content-test',
        assertMutationAuthority: () => undefined,
      }),
    ).resolves.toMatchObject({ status: 'committed' })
    expect(
      JSON.parse(
        await readFile(
          join(workspace, 'assets/content/resource-registry.json'),
          'utf8',
        ),
      ),
    ).toMatchObject({ id: 'registry' })
  })

  test('does not advance a prepared receipt after its exact dispatch authority expired', async () => {
    let authorityChecks = 0
    const workspace = await createWorkspace()
    await mkdir(join(workspace, 'assets/content'), { recursive: true })
    await writeFile(join(workspace, 'assets/content/original.txt'), 'original')
    await commitRegistryOnly(workspace)
    const contentRoot = join(workspace, 'assets/content')
    const receiptPath = join(
      workspace,
      '.beegame/workflow/resource-content-commits/dispatch-content-test.json',
    )
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    await rename(contentRoot, receipt.stagingRoot)
    await mkdir(contentRoot, { recursive: true })
    await writeFile(join(contentRoot, 'current.txt'), 'current')
    await writeFile(
      receiptPath,
      `${JSON.stringify({ ...receipt, status: 'prepared' }, null, 2)}\n`,
    )

    await expect(
      reconcileResourceContentCommitReceipt({
        workspacePath: workspace,
        dispatchId: 'dispatch-content-test',
        assertMutationAuthority() {
          authorityChecks += 1
          if (authorityChecks > 1)
            throw new Error('resource content dispatch authority expired')
        },
      }),
    ).rejects.toThrow('resource content dispatch authority expired')
    expect(authorityChecks).toBe(2)

    expect(await readFile(join(contentRoot, 'current.txt'), 'utf8')).toBe(
      'current',
    )
    expect(
      JSON.parse(
        await readFile(
          join(receipt.stagingRoot, 'resource-registry.json'),
          'utf8',
        ),
      ),
    ).toMatchObject({ id: 'registry' })
    await expect(access(receipt.backupRoot)).rejects.toThrow()
    expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toMatchObject({
      status: 'prepared',
    })
  })

  test('rolls back without discarding prepared authority when staging is unavailable', async () => {
    const workspace = await createWorkspace()
    await commitRegistryOnly(workspace)
    const receiptPath = join(
      workspace,
      '.beegame/workflow/resource-content-commits/dispatch-content-test.json',
    )
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    await rename(join(workspace, 'assets/content'), receipt.backupRoot)
    await writeFile(
      receiptPath,
      `${JSON.stringify({ ...receipt, status: 'prepared' }, null, 2)}\n`,
    )

    await expect(
      reconcileResourceContentCommitReceipt({
        workspacePath: workspace,
        dispatchId: 'dispatch-content-test',
        assertMutationAuthority: () => undefined,
      }),
    ).rejects.toThrow('staged publication is unavailable')
    expect(
      JSON.parse(
        await readFile(
          join(workspace, 'assets/content/resource-registry.json'),
          'utf8',
        ),
      ),
    ).toMatchObject({ id: 'registry' })
    expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toMatchObject({
      status: 'prepared',
    })
  })

  test('rejects prepared receipt roots outside the canonical transaction paths', async () => {
    const workspace = await createWorkspace()
    await commitRegistryOnly(workspace)
    const receiptPath = join(
      workspace,
      '.beegame/workflow/resource-content-commits/dispatch-content-test.json',
    )
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    const unrelatedPath = join(workspace, 'unrelated')
    await mkdir(unrelatedPath)
    await writeFile(join(unrelatedPath, 'sentinel'), 'keep')
    await writeFile(
      receiptPath,
      `${JSON.stringify(
        { ...receipt, status: 'prepared', backupRoot: unrelatedPath },
        null,
        2,
      )}\n`,
    )

    await expect(
      reconcileResourceContentCommitReceipt({
        workspacePath: workspace,
        dispatchId: 'dispatch-content-test',
        assertMutationAuthority: () => undefined,
      }),
    ).rejects.toThrow('transaction paths are invalid')
    expect(await readFile(join(unrelatedPath, 'sentinel'), 'utf8')).toBe('keep')
  })

  test('rejects a receipt whose embedded dispatch identity does not match its path', async () => {
    const workspace = await createWorkspace()
    await commitRegistryOnly(workspace)
    const receiptPath = join(
      workspace,
      '.beegame/workflow/resource-content-commits/dispatch-content-test.json',
    )
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    await writeFile(
      receiptPath,
      `${JSON.stringify({ ...receipt, dispatchId: 'other-dispatch' }, null, 2)}\n`,
    )

    await expect(
      reconcileResourceContentCommitReceipt({
        workspacePath: workspace,
        dispatchId: 'dispatch-content-test',
      }),
    ).rejects.toThrow('identity is invalid')
  })

  test('rejects the complete invalid set before mutating content files', async () => {
    const workspace = await createWorkspace()
    await mkdir(join(workspace, 'assets/content'), { recursive: true })
    await writeFile(join(workspace, 'assets/content/existing.json'), 'stable')
    const tool = await createTool(workspace)

    await expect(
      tool.call({
        action: 'commit',
        documents: [
          {
            path: 'assets/content/resource-registry.json',
            schema: 'beegame-content-v1',
            id: 'registry',
            kind: 'resource-registry',
            fulfills: ['invented-requirement'],
            resources: ['res-model'],
            data: { bindings: [] },
          },
        ],
      }),
    ).rejects.toThrow('unknown requirement')
    expect(
      await readFile(join(workspace, 'assets/content/existing.json'), 'utf8'),
    ).toBe('stable')
  })

  test('serializes and writes one complete valid JSON/YAML set', async () => {
    const workspace = await createWorkspace()
    const tool = await createTool(workspace)

    const result = await tool.call({
      action: 'commit',
      documents: [
        {
          path: 'assets/content/resource-registry.json',
          schema: 'beegame-content-v1',
          id: 'registry',
          kind: 'resource-registry',
          fulfills: ['req-model'],
          resources: ['res-model'],
          data: {
            bindings: [
              { requirementId: 'req-model', resourceIds: ['res-model'] },
            ],
          },
        },
        {
          path: 'assets/content/world.yaml',
          schema: 'beegame-content-v1',
          id: 'world',
          kind: 'world-definition',
          fulfills: [],
          resources: [],
          data: { worlds: { main: { instances: [] } } },
        },
      ],
    })

    expect(result.data).toMatchObject({
      accepted: true,
      status: 'completed',
      contentIds: ['registry', 'world'],
      writtenPaths: [
        'assets/content/resource-registry.json',
        'assets/content/world.yaml',
      ],
    })
    expect(
      JSON.parse(
        await readFile(
          join(workspace, 'assets/content/resource-registry.json'),
          'utf8',
        ),
      ),
    ).toMatchObject({ schema: 'beegame-content-v1', id: 'registry' })
    expect(
      await readFile(join(workspace, 'assets/content/world.yaml'), 'utf8'),
    ).toContain('schema: beegame-content-v1')
    await expect(
      tool.call({
        action: 'commit',
        documents: [
          {
            path: 'assets/content/resource-registry.json',
            schema: 'beegame-content-v1',
            id: 'registry',
            kind: 'resource-registry',
            fulfills: ['req-model'],
            resources: ['res-model'],
            data: {
              bindings: [
                { requirementId: 'req-model', resourceIds: ['res-model'] },
              ],
            },
          },
          {
            path: 'assets/content/world.yaml',
            schema: 'beegame-content-v1',
            id: 'world',
            kind: 'world-definition',
            fulfills: [],
            resources: [],
            data: { worlds: { main: { instances: [] } } },
          },
        ],
      }),
    ).resolves.toMatchObject({ data: { accepted: true } })
    expect(
      JSON.parse(
        await readFile(
          join(
            workspace,
            '.beegame/workflow/resource-content-commits/dispatch-content-test.json',
          ),
          'utf8',
        ),
      ),
    ).toMatchObject({ status: 'committed' })
  })

  test('copies protected content byte-for-byte and excludes it from written paths', async () => {
    const workspace = await createWorkspace()
    await mkdir(join(workspace, 'assets/content'), { recursive: true })
    const protectedYaml =
      '# preserved comment\nschema: beegame-content-v1\nid: world\nkind: world-definition\nfulfills: []\nresources: []\ndata:\n  worlds:\n    main:\n      instances: [] # keep inline comment\n'
    await writeFile(join(workspace, 'assets/content/world.yaml'), protectedYaml)
    const tool = createNativeResourceContentTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      contract: {
        dispatchId: 'dispatch-protected',
        inventoryRevision: await computeResourceInventoryRevision(workspace),
        baselineResourceRevision: await computeResourceRevision(workspace, ''),
        requiredRequirementIds: ['req-model'],
        verifiedResourceIds: ['res-model'],
        inventoryBindings: [
          { requirementId: 'req-model', resourceIds: ['res-model'] },
        ],
        protectedPaths: ['assets/content/world.yaml'],
      },
      assertMutationAuthority: () => undefined,
    }) as Tool

    const result = await tool.call({
      action: 'commit',
      documents: [
        {
          path: 'assets/content/resource-registry.json',
          schema: 'beegame-content-v1',
          id: 'registry',
          kind: 'resource-registry',
          fulfills: ['req-model'],
          resources: ['res-model'],
          data: {
            bindings: [
              { requirementId: 'req-model', resourceIds: ['res-model'] },
            ],
          },
        },
      ],
    })

    expect(
      await readFile(join(workspace, 'assets/content/world.yaml'), 'utf8'),
    ).toBe(protectedYaml)
    expect(result.data.writtenPaths).toEqual([
      'assets/content/resource-registry.json',
    ])
    expect(
      JSON.parse(
        await readFile(
          join(
            workspace,
            '.beegame/workflow/resource-content-commits/dispatch-protected.json',
          ),
          'utf8',
        ),
      ).writtenPaths,
    ).toEqual(['assets/content/resource-registry.json'])
  })

  test('rejects a stale dispatch immediately before publication', async () => {
    const workspace = await createWorkspace()
    let checks = 0
    const tool = createNativeResourceContentTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      contract: {
        dispatchId: 'dispatch-stale',
        inventoryRevision: await computeResourceInventoryRevision(workspace),
        baselineResourceRevision: await computeResourceRevision(workspace, ''),
        requiredRequirementIds: ['req-model'],
        verifiedResourceIds: ['res-model'],
        inventoryBindings: [
          { requirementId: 'req-model', resourceIds: ['res-model'] },
        ],
        protectedPaths: [],
      },
      assertMutationAuthority() {
        checks += 1
        if (checks > 1) throw new Error('no longer active')
      },
    }) as Tool

    await expect(
      tool.call({
        action: 'commit',
        documents: [
          {
            path: 'assets/content/resource-registry.json',
            schema: 'beegame-content-v1',
            id: 'registry',
            kind: 'resource-registry',
            fulfills: ['req-model'],
            resources: ['res-model'],
            data: {
              bindings: [
                { requirementId: 'req-model', resourceIds: ['res-model'] },
              ],
            },
          },
        ],
      }),
    ).rejects.toThrow('no longer active')
    await expect(
      readFile(
        join(workspace, 'assets/content/resource-registry.json'),
        'utf8',
      ),
    ).rejects.toThrow()
  })

  test('rejects a dispatch replaced while canonical content is staging', async () => {
    const workspace = await createWorkspace()
    await mkdir(join(workspace, 'assets/content'), { recursive: true })
    await writeFile(join(workspace, 'assets/content/sentinel.txt'), 'original')
    let active = true
    const tool = createNativeResourceContentTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      contract: {
        dispatchId: 'dispatch-replaced-during-staging',
        inventoryRevision: await computeResourceInventoryRevision(workspace),
        baselineResourceRevision: await computeResourceRevision(workspace, ''),
        requiredRequirementIds: ['req-model'],
        verifiedResourceIds: ['res-model'],
        inventoryBindings: [
          { requirementId: 'req-model', resourceIds: ['res-model'] },
        ],
        protectedPaths: [],
      },
      assertMutationAuthority() {
        if (!active) throw new Error('dispatch was replaced')
      },
    }) as Tool

    const commit = tool.call({
      action: 'commit',
      documents: [
        {
          path: 'assets/content/resource-registry.json',
          schema: 'beegame-content-v1',
          id: 'registry',
          kind: 'resource-registry',
          fulfills: ['req-model'],
          resources: ['res-model'],
          data: {
            bindings: [
              { requirementId: 'req-model', resourceIds: ['res-model'] },
            ],
            stagingPayload: 'x'.repeat(16 * 1024 * 1024),
          },
        },
      ],
    })

    while (
      !(await readdir(join(workspace, 'assets'))).some(name =>
        name.startsWith('content.staging-'),
      )
    )
      await Bun.sleep(1)
    active = false

    await expect(commit).rejects.toThrow('dispatch was replaced')
    expect(
      await readFile(join(workspace, 'assets/content/sentinel.txt'), 'utf8'),
    ).toBe('original')
    await expect(
      readFile(
        join(
          workspace,
          '.beegame/workflow/resource-content-commits/dispatch-replaced-during-staging.json',
        ),
        'utf8',
      ),
    ).rejects.toThrow()
  })

  test('requires registry bindings to equal the frozen inventory receipt', async () => {
    const workspace = await createWorkspace()
    const tool = createNativeResourceContentTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      contract: {
        dispatchId: 'dispatch-binding-mismatch',
        inventoryRevision: await computeResourceInventoryRevision(workspace),
        baselineResourceRevision: await computeResourceRevision(workspace, ''),
        requiredRequirementIds: ['req-model'],
        verifiedResourceIds: ['res-model'],
        inventoryBindings: [],
        protectedPaths: [],
      },
      assertMutationAuthority: () => undefined,
    }) as Tool

    await expect(
      tool.call({
        action: 'commit',
        documents: [
          {
            path: 'assets/content/resource-registry.json',
            schema: 'beegame-content-v1',
            id: 'registry',
            kind: 'resource-registry',
            fulfills: ['req-model'],
            resources: ['res-model'],
            data: {
              bindings: [
                { requirementId: 'req-model', resourceIds: ['res-model'] },
              ],
            },
          },
        ],
      }),
    ).rejects.toThrow('exactly match the frozen inventory receipt')
  })

  test('accepts only the exact requirements missing verified inventory', async () => {
    const workspace = await createWorkspace({ includeMissingAudio: true })
    const tool = createNativeResourceContentTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      contract: {
        dispatchId: 'dispatch-missing-inventory',
        inventoryRevision: await computeResourceInventoryRevision(workspace),
        baselineResourceRevision: await computeResourceRevision(workspace, ''),
        requiredRequirementIds: ['req-model', 'req-audio'],
        verifiedResourceIds: ['res-model'],
        inventoryBindings: [
          { requirementId: 'req-model', resourceIds: ['res-model'] },
        ],
        protectedPaths: [],
      },
      assertMutationAuthority: () => undefined,
    }) as Tool

    await expect(
      tool.call({
        action: 'needs_inventory',
        missingRequirementIds: ['req-model'],
      }),
    ).rejects.toThrow('exact missing requirement IDs')
    await expect(
      tool.call({
        action: 'needs_inventory',
        missingRequirementIds: ['req-audio'],
      }),
    ).resolves.toMatchObject({
      data: {
        accepted: true,
        status: 'needs_inventory',
        missingRequirementIds: ['req-audio'],
      },
    })
  })

  test('checks mutation authority before persisting needs_inventory', async () => {
    const workspace = await createWorkspace({ includeMissingAudio: true })
    const tool = createNativeResourceContentTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      contract: {
        dispatchId: 'dispatch-stale-needs-inventory',
        inventoryRevision: await computeResourceInventoryRevision(workspace),
        baselineResourceRevision: await computeResourceRevision(workspace, ''),
        requiredRequirementIds: ['req-model', 'req-audio'],
        verifiedResourceIds: ['res-model'],
        inventoryBindings: [
          { requirementId: 'req-model', resourceIds: ['res-model'] },
        ],
        protectedPaths: [],
      },
      assertMutationAuthority() {
        throw new Error('dispatch is no longer active')
      },
    }) as Tool

    expect(
      tool.isReadOnly({
        action: 'needs_inventory',
        missingRequirementIds: ['req-audio'],
      }),
    ).toBe(false)
    await expect(
      tool.call({
        action: 'needs_inventory',
        missingRequirementIds: ['req-audio'],
      }),
    ).rejects.toThrow('dispatch is no longer active')
    await expect(
      readFile(
        join(
          workspace,
          '.beegame/workflow/resource-content-commits/dispatch-stale-needs-inventory.json',
        ),
        'utf8',
      ),
    ).rejects.toThrow()
  })
})
