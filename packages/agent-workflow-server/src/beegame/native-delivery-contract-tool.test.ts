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
      getConfirmedBriefContext: () => JSON.stringify({
        kind: 'confirmed_build_brief',
        resource_library_usage: 'preferred',
        document_language: 'zh',
      }),
      buildTool(value) {
        definition = value
        return value
      },
    })

    const call = definition?.call as ((input?: { action: 'inspect' | 'describe_schema' }) => Promise<{ data: {
      contractShapeValid: boolean
      documentPlanReady: boolean
      resourceIntegrationReady: boolean
      issues: string[]
      integration_issues: string[]
      confirmed_brief: Record<string, unknown>
      resource_contract: { resourcePlanReady: boolean; confirmedPolicy?: string; importCount: number }
      current_coverage: Record<string, unknown>
      canonical_contract_digest: string
      canonical_contract?: Record<string, unknown>
    } }>) | undefined
    expect(call).toBeDefined()
    const result = await call!()
    expect(result.data).not.toHaveProperty('valid')
    expect(result.data.documentPlanReady).toBe(false)
    expect(result.data.resourceIntegrationReady).toBe(false)
    expect(result.data.issues.join(' ')).toContain('requirements must be an array')
    expect(result.data.issues.join(' ')).toContain('preferred Resource Library usage has no imported resource artifacts')
    expect(result.data.confirmed_brief).toEqual(expect.objectContaining({
      kind: 'confirmed_build_brief',
      resource_library_usage: 'preferred',
      document_language: 'zh',
    }))
    expect(result.data).not.toHaveProperty('canonical_contract')
    expect(result.data.current_coverage).toEqual(expect.objectContaining({
      required_document_paths: expect.any(Array),
      checklist_ids: [],
      import_ids: [],
      composition_ids: [],
    }))
    expect(result.data.canonical_contract_digest).toHaveLength(64)
    expect(result.data.resource_contract).toMatchObject({
      resourcePlanReady: false,
      integrationReady: false,
      confirmedPolicy: 'preferred',
      importCount: 0,
    })
    expect(result.data.resource_contract).not.toHaveProperty('valid')

    const schema = await call!({ action: 'describe_schema' })
    expect(schema.data.canonical_contract).toHaveProperty('asset_manifest_example.requirements')
    expect(schema.data.canonical_contract).toHaveProperty('asset_manifest_example.imports')
    expect(schema.data.canonical_contract).toHaveProperty('asset_manifest_example.compositions')
    expect(schema.data.canonical_contract).not.toHaveProperty('asset_manifest_example.slots')
  })

  test('does not present a copied but entirely planned resource contract as integrated', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'delivery-contract-stages-'))
    await mkdir(join(workspace, 'assets', 'library'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'library', 'module.glb'), 'glTF')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: {
        resource_library_usage: 'preferred',
        asset_format_capabilities: ['glb'],
      },
      requirements: [{
        id: 'world-module',
        required: false,
        status: 'planned',
        resource_requirement: { accepted_formats: ['glb'] },
      }],
      imports: [{
        id: 'module',
        source: {
          type: 'resource-library',
          pack_id: 'pack',
          pack_version: '1',
          element_id: 'module',
          element_path: 'module.glb',
        },
        status: 'available',
        root_path: 'assets/library/module.glb',
        local_files: ['assets/library/module.glb'],
        selection_reason: ['Selected for target-native composition'],
      }],
      compositions: [{
        id: 'world',
        kind: 'scene',
        status: 'planned',
        members: [{ import_id: 'module', role: 'world-module' }],
      }],
    }))
    for (const path of [
      'docs/GDD.md',
      'docs/TECHNICAL_DESIGN.md',
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
      'docs/AUDIO_DESIGN.md',
      'docs/ASSET_PLAN.md',
    ]) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), '# Ready plan')
    }
    await mkdir(join(workspace, 'docs', 'acceptance'), { recursive: true })
    await writeFile(
      join(workspace, 'docs', 'acceptance', 'gameplay-checklist.md'),
      '- [ ] PATH-001 observable player path',
    )
    let definition: Record<string, unknown> | undefined
    createNativeDeliveryContractTool({
      workspacePath: workspace,
      getConfirmedBriefContext: () => JSON.stringify({ resource_library_usage: 'preferred' }),
      buildTool(value) {
        definition = value
        return value
      },
    })
    const call = definition?.call as (() => Promise<{ data: {
      documentPlanReady: boolean
      resourceIntegrationReady: boolean
      integration_issues: string[]
    } }>)
    const result = await call()
    expect(result.data.documentPlanReady).toBe(true)
    expect(result.data.resourceIntegrationReady).toBe(false)
    expect(result.data.integration_issues.join(' ')).toContain('still planned')
    expect(result.data.integration_issues.join(' ')).toContain('no import or composition has target-runtime integration evidence')
  })
})
