import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import { currentResourceContractIssues } from './resource-stage'

describe('resource delivery', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('returns manifest-level diagnostics to a retrying resource worker', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'resource-contract-issues-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets/asset-manifest.json'), '{}', 'utf8')

    const issues = currentResourceContractIssues(workspace)
    expect(issues.length).toBeGreaterThan(0)
    expect(new Set(issues).size).toBe(issues.length)
  })
})
