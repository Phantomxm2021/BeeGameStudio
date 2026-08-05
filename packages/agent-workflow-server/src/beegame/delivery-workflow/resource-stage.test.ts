import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import { computeResourceContentDigest } from './revision'
import { resourceContentReceiptMatchesWorkspace } from './resource-stage'

describe('resource content receipt', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('proves that canonical content is unchanged before the resource gate', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'resource-content-digest-'))
    await writeBeeGameAssetManifest(workspace, {
      version: 8,
      project_target: {
        asset_format_capabilities: ['json'],
        resource_library_usage: 'optional',
        runtime_asset_root: 'assets/runtime',
        content_root: 'assets/content',
        generated_asset_root: 'assets/generated',
      },
      requirements: [],
      resources: [],
    })
    await mkdir(join(workspace, 'assets/content'), { recursive: true })
    const contentPath = join(workspace, 'assets/content/resource-registry.json')
    await writeFile(contentPath, '{"entries":[]}', 'utf8')
    const receipt = {
      contentDigest: await computeResourceContentDigest(workspace),
      acceptedAt: '2026-08-05T00:00:00.000Z',
    }

    await expect(
      resourceContentReceiptMatchesWorkspace(workspace, receipt),
    ).resolves.toBe(true)
    await writeFile(contentPath, '{"entries":["changed"]}', 'utf8')
    await expect(
      resourceContentReceiptMatchesWorkspace(workspace, receipt),
    ).resolves.toBe(false)
  })
})
