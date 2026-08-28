import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  auditDocumentReadiness,
  REQUIRED_PROJECT_DOCUMENTS,
} from './document-readiness-audit'
import { writeBeeGameAssetManifest } from './asset-contracts'
import {
  renderTestCompleteGameDocument,
  type CompleteGameDocumentSubmission,
} from '../__tests__/complete-game-document-fixture'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'

function completeSubmission(
  path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
): CompleteGameDocumentSubmission {
  const contract = getGameDocumentContract(path)
  return {
    title: contract.discipline,
    executiveSummary: `Complete ${contract.discipline} production authority.`,
    sections: contract.sections.map((section, index) => ({
      sectionId: section.sectionId,
      title: section.title,
      body: `Implementation-ready authority ${index + 1}.`,
    })),
    productionMaterials: contract.productionMaterials.map(material =>
      material.format === 'evidence_register'
        ? {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            entries: [
              {
                evidenceId: `${material.materialId}.pending`,
                category: 'search_direction' as const,
                displayName: 'Pending reference direction',
                purpose: 'Record a production need before source selection.',
                state: 'source_not_selected' as const,
                evidenceRefs: [],
              },
            ],
          }
        : {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            body:
              material.format === 'markdown_table'
                ? '| Field | Value |\n| --- | --- |\n| Owner | Authority |'
                : material.format === 'mermaid'
                  ? '```mermaid\ngraph TD\n  A --> B\n```'
                  : '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
          },
    ),
    auditAppendix: {
      acceptanceCriteria: ['All owned requirements and materials are complete and inspectable.'],
      upstreamReferences: [],
      risks: [],
      openDecisions: [],
    },
  }
}

function completeDocument(path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]): string {
  return renderTestCompleteGameDocument(path, completeSubmission(path))
}

async function writeMinimalContent(workspace: string): Promise<void> {
  await mkdir(join(workspace, 'assets', 'content'), { recursive: true })
  await writeFile(
    join(workspace, 'assets', 'content', 'project.json'),
    JSON.stringify({
      schema: 'beegame-content-v1',
      id: 'project-content',
      kind: 'resource-registry',
      fulfills: [],
      resources: [],
      data: { bindings: [] },
    }),
  )
}

describe('document readiness audit', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('accepts the eight foundation documents before checklist and manifest creation', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-foundation-'))
    for (const path of REQUIRED_PROJECT_DOCUMENTS.slice(0, -1)) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `# ${path}\n`)
    }

    expect(
      auditDocumentReadiness(workspace, {
        includeChecklist: false,
        includeAssetManifest: false,
      }),
    ).toEqual({ valid: true, issues: [] })
  })

  test('rejects skeleton foundation documents when complete contracts are required', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-complete-'))
    for (const path of REQUIRED_PROJECT_DOCUMENTS.slice(0, -1)) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `# ${path}\n`)
    }

    const audit = auditDocumentReadiness(workspace, {
      includeChecklist: false,
      includeAssetManifest: false,
      requireCompleteFoundation: true,
    })
    expect(audit.valid).toBe(false)
    expect(audit.issues.some(issue => issue.startsWith('docs/GDD.md:'))).toBe(true)
  })

  test('requires every compact production material at the durable readiness gate', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-materials-'))
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      const content = completeDocument(path)
      await writeFile(
        join(workspace, path),
        path === 'docs/GDD.md'
          ? content.replace('<!-- beegame-material:core-loop-diagram -->', '')
          : content,
      )
    }
    const audit = auditDocumentReadiness(workspace, {
      includeChecklist: false,
      includeAssetManifest: false,
      requireCompleteFoundation: true,
    })
    expect(audit.valid).toBe(false)
    expect(audit.issues.some(issue => issue.includes('production materials'))).toBe(true)
  })

  test('rejects a seven-document foundation missing either new fact owner', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-eight-'))
    for (const path of REQUIRED_PROJECT_DOCUMENTS.slice(0, -1)) {
      if (path === 'docs/LEVEL_SCENE_DESIGN.md') continue
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `# ${path}\n`)
    }

    expect(
      auditDocumentReadiness(workspace, {
        includeChecklist: false,
        includeAssetManifest: false,
      }).issues,
    ).toEqual([
      'Required project document is missing: docs/LEVEL_SCENE_DESIGN.md',
    ])
  })

  test('accepts an approved checklist before resource preparation creates the manifest', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-checklist-'))
    for (const path of REQUIRED_PROJECT_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(
        join(workspace, path),
        path.endsWith('gameplay-checklist.md')
          ? '# Acceptance\n- [ ] PATH-001 [docs/GDD.md#core_loop] Launch the game and observe the playable state with runtime evidence.\n'
          : `# ${path}\n`,
      )
    }

    expect(
      auditDocumentReadiness(workspace, {
        includeChecklist: true,
        includeAssetManifest: false,
      }),
    ).toEqual({ valid: true, issues: [] })
  })

  test('accepts a large checklist when every task remains mechanically valid', async () => {
    workspace = await mkdtemp(
      join(tmpdir(), 'beegame-document-checklist-size-'),
    )
    for (const path of REQUIRED_PROJECT_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(
        join(workspace, path),
        path.endsWith('gameplay-checklist.md')
          ? [
              '# Acceptance',
              ...Array.from(
                { length: 179 },
                (_, index) =>
                  `- [ ] CHECK-${index + 1} [docs/GDD.md#core_loop] Observe scenario ${index + 1} with runtime evidence.`,
              ),
            ].join('\n')
          : `# ${path}\n`,
      )
    }

    expect(
      auditDocumentReadiness(workspace, {
        includeChecklist: true,
        includeAssetManifest: false,
      }),
    ).toEqual({ valid: true, issues: [] })
  })

  test('requires the complete non-empty document baseline and canonical asset contract', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-readiness-'))
    expect(auditDocumentReadiness(workspace)).toMatchObject({ valid: false })

    for (const path of REQUIRED_PROJECT_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(
        join(workspace, path),
        path.endsWith('gameplay-checklist.md')
          ? '# Acceptance\n- [ ] PATH-001 [docs/GDD.md#core_loop] Launch the game and observe the initial playable state with runtime evidence.\n'
          : `# ${path}\n`,
      )
    }
    await writeMinimalContent(workspace)
    await writeBeeGameAssetManifest(workspace, {
      version: 8,
      project_target: {
        platform: 'selected-target',
        runtime: 'project-native',
        asset_format_capabilities: ['glb'],
        runtime_asset_root: 'assets/runtime',
        content_root: 'assets/content',
        generated_asset_root: 'assets/generated',
      },
      requirements: [],
      resources: [],
    })

    expect(auditDocumentReadiness(workspace)).toEqual({
      valid: true,
      issues: [],
    })
  })

  test('rejects an invented asset manifest root shape', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-readiness-'))
    for (const path of REQUIRED_PROJECT_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(
        join(workspace, path),
        path.endsWith('gameplay-checklist.md')
          ? '# Acceptance\n- [ ] PATH-001 [docs/GDD.md#core_loop] Launch the game and observe the playable state with runtime evidence.\n'
          : `# ${path}\n`,
      )
    }
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeMinimalContent(workspace)
    await writeFile(
      join(workspace, 'assets', 'asset-manifest.json'),
      JSON.stringify({
        version: 1,
        project: { platform: 'selected-target' },
        assets: [],
      }),
    )

    const audit = auditDocumentReadiness(workspace)
    expect(audit.valid).toBe(false)
    expect(audit.issues).toContain(
      'assets/asset-manifest.json: manifest index modules must be an object.',
    )
  })

  test('requires identified acceptance tasks without interpreting game semantics', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-readiness-'))
    for (const path of REQUIRED_PROJECT_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(
        join(workspace, path),
        path.endsWith('gameplay-checklist.md')
          ? '# Acceptance\n- [ ] Launch the game.\n- [ ] `PATH-002`\n- [ ] PATH-003 [docs/GDD.md#core_loop] Observe a result with runtime evidence.\n- [ ] PATH-003 [docs/GDD.md#core_loop] Observe the duplicate with runtime evidence.\n'
          : `# ${path}\n`,
      )
    }
    await writeMinimalContent(workspace)
    await writeBeeGameAssetManifest(workspace, {
      version: 8,
      project_target: {
        platform: 'selected-target',
        runtime: 'project-native',
        asset_format_capabilities: ['glb'],
        runtime_asset_root: 'assets/runtime',
        content_root: 'assets/content',
        generated_asset_root: 'assets/generated',
      },
      requirements: [],
      resources: [],
    })

    expect(auditDocumentReadiness(workspace).issues).toEqual([
      'docs/acceptance/gameplay-checklist.md: Checklist task 1 has no stable identifier.',
      'docs/acceptance/gameplay-checklist.md: Checklist task PATH-002 has no Checklist authority source tag.',
      'docs/acceptance/gameplay-checklist.md: Checklist stable identifier is duplicated: PATH-003',
    ])
  })

  test('accepts bracketed stable identifiers without matching business keywords', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-readiness-'))
    for (const path of REQUIRED_PROJECT_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(
        join(workspace, path),
        path.endsWith('gameplay-checklist.md')
          ? '# Acceptance\n- [ ] [contract:item-primary] [docs/GDD.md#core_loop] Observe the committed behavior with runtime evidence.\n'
          : `# ${path}\n`,
      )
    }
    await writeMinimalContent(workspace)
    await writeBeeGameAssetManifest(workspace, {
      version: 8,
      project_target: {
        asset_format_capabilities: ['glb'],
        runtime_asset_root: 'assets/runtime',
        content_root: 'assets/content',
        generated_asset_root: 'assets/generated',
      },
      requirements: [],
      resources: [],
    })

    expect(auditDocumentReadiness(workspace)).toEqual({
      valid: true,
      issues: [],
    })
  })
})
