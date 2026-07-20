import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeDeliveryContractTool } from './native-delivery-contract-tool'

describe('native project delivery contract tool', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('returns deterministic diagnostics without changing the workspace', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'delivery-contract-tool-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), '{}')
    let definition: Record<string, unknown> | undefined
    createNativeDeliveryContractTool({
      workspacePath: workspace,
      buildTool(value) {
        definition = value
        return value
      },
    })

    const call = definition?.call as (() => Promise<{ data: {
      valid: boolean
      issues: string[]
      canonical_contract: Record<string, unknown>
    } }>) | undefined
    expect(call).toBeDefined()
    const result = await call!()
    expect(result.data.valid).toBe(false)
    expect(result.data.issues.join(' ')).toContain('requirements must be an array')
    expect(result.data.canonical_contract).toHaveProperty('asset_manifest_example.requirements')
    expect(result.data.canonical_contract).toHaveProperty('asset_manifest_example.imports')
    expect(result.data.canonical_contract).toHaveProperty('asset_manifest_example.compositions')
    expect(result.data.canonical_contract).not.toHaveProperty('asset_manifest_example.slots')
  })
})
