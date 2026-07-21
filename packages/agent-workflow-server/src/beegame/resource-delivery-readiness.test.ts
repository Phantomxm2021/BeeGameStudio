import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditResourceDeliveryReadiness } from './resource-delivery-readiness'

describe('resource delivery readiness', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('does not call an integrated manifest ready without current native provenance', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'resource-readiness-'))
    await mkdir(join(workspace, 'assets', 'library'), { recursive: true })
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'library', 'module.glb'), 'glTF')
    await writeFile(join(workspace, 'src', 'world.ts'), 'export const world = true\n')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: {
        resource_library_usage: 'preferred',
        asset_format_capabilities: ['glb'],
        runtime_asset_root: 'assets/library',
      },
      requirements: [],
      imports: [{
        id: 'module',
        source: {
          type: 'resource-library',
          pack_id: 'pack',
          pack_version: '1',
          element_id: 'module',
          element_path: 'module.glb',
        },
        status: 'referenced',
        root_path: 'assets/library/module.glb',
        local_files: ['assets/library/module.glb'],
        selection_reason: ['Selected by the native agent'],
        usage_evidence: { references: ['src/world.ts'] },
      }],
      compositions: [],
    }))

    const readiness = auditResourceDeliveryReadiness({
      workspacePath: workspace,
      confirmedPolicy: 'preferred',
      resourceEvidence: { state: 'missing' },
    })
    expect(readiness.valid).toBe(true)
    expect(readiness.integrationReady).toBe(false)
    expect(readiness.integrationIssues.join(' ')).toContain('no current native ResourceLibrary provenance')
  })

  test('blocks integration while a partial native import has unresolved ids', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'resource-readiness-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: {
        resource_library_usage: 'preferred',
        asset_format_capabilities: ['glb'],
        runtime_asset_root: 'assets/library',
      },
      requirements: [],
      imports: [],
      compositions: [],
    }))

    const readiness = auditResourceDeliveryReadiness({
      workspacePath: workspace,
      confirmedPolicy: 'preferred',
      resourceEvidence: {
        state: 'current',
        actions: ['import_elements'],
        failedActions: ['import_elements'],
        successfulImportCount: 1,
        failedImportCount: 1,
        observedAt: new Date().toISOString(),
      },
    })
    expect(readiness.integrationReady).toBe(false)
    expect(readiness.issues.join(' ')).toContain('unresolved failed native actions')
    expect(readiness.integrationIssues.join(' ')).toContain('1 explicitly requested imports remain unresolved')
  })

  test('does not let a preferred library plan proceed without a target-native asset root', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'resource-readiness-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: {
        resource_library_usage: 'preferred',
        asset_format_capabilities: ['glb'],
      },
      requirements: [],
      imports: [],
      compositions: [],
    }))

    const readiness = auditResourceDeliveryReadiness({
      workspacePath: workspace,
      confirmedPolicy: 'preferred',
      resourceEvidence: { state: 'missing' },
    })
    expect(readiness.valid).toBe(false)
    expect(readiness.integrationReady).toBe(false)
    expect(readiness.issues.join(' ')).toContain('project_target.runtime_asset_root')
  })
})
