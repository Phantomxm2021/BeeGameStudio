import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { auditAssetContract } from './asset-contract-audit'
import {
  type BeeGameAssetManifest,
  writeBeeGameAssetManifest,
} from './asset-contracts'
import { validateBeeGameContentDocuments } from './content-contracts'

const canonicalContentManifest: BeeGameAssetManifest = {
  version: 8,
  project_target: {
    asset_format_capabilities: ['json', 'yaml'],
    runtime_asset_root: 'assets/runtime',
    content_root: 'assets/content',
    generated_asset_root: 'assets/generated',
  },
  requirements: [{ id: 'req-model', required: true }],
  resources: [
    {
      id: 'res-model',
      source: {
        type: 'agent-authored',
        created_at: '2026-08-05T00:00:00.000Z',
        reason: 'canonical test resource',
      },
      root_path: 'assets/runtime/model.glb',
      file_paths: ['assets/runtime/model.glb'],
      provisional: true,
      status: 'verified',
      selected_at: '2026-08-05T00:00:00.000Z',
      selection_reason: ['Canonical test resource.'],
    },
  ],
}

describe('modular v8 asset and content audit', () => {
  test('rejects the malformed content envelope and invented registry identities before mutation', () => {
    const audit = validateBeeGameContentDocuments(
      [
        {
          path: 'assets/content/resource-registry.json',
          value: {
            id: 'beegame-content-v1-resource-registry',
            kind: 'resource-registry',
            fulfills: [],
            resources: [],
            data: {
              bindings: [
                {
                  requirementId: 'REQ_RUNTIME_ENTITY_COMMANDER',
                  resourceIds: ['res-model'],
                },
              ],
            },
          },
        },
      ],
      canonicalContentManifest,
    )

    expect(audit.issues).toEqual(
      expect.arrayContaining([
        'assets/content/resource-registry.json: schema must be beegame-content-v1.',
        'assets/content/resource-registry.json: unknown registry requirement: REQ_RUNTIME_ENTITY_COMMANDER.',
        'Required requirement is not covered: req-model.',
      ]),
    )
  })

  test('accepts a project-required mixed content set with canonical bindings', () => {
    const audit = validateBeeGameContentDocuments(
      [
        {
          path: 'assets/content/resource-registry.json',
          value: {
            schema: 'beegame-content-v1',
            id: 'registry',
            kind: 'resource-registry',
            fulfills: ['req-model'],
            resources: ['res-model'],
            data: {
              bindings: [
                {
                  requirementId: 'req-model',
                  resourceIds: ['res-model'],
                },
              ],
            },
          },
        },
        {
          path: 'assets/content/world.yaml',
          value: {
            schema: 'beegame-content-v1',
            id: 'world',
            kind: 'world-definition',
            fulfills: [],
            resources: [],
            data: { worlds: {} },
          },
        },
      ],
      canonicalContentManifest,
    )

    expect(audit.valid).toBe(true)
    expect(audit.files.map(file => file.id)).toEqual(['registry', 'world'])
  })

  test('audits JSON and YAML references without an assembly graph', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-audit-'))
    try {
      await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
      await mkdir(join(workspace, 'assets', 'content'), { recursive: true })
      await writeFile(join(workspace, 'assets/runtime/world.svg'), '<svg/>')
      await writeBeeGameAssetManifest(workspace, {
        version: 8,
        project_target: {
          asset_format_capabilities: ['svg', 'yaml'],
          runtime_asset_root: 'assets/runtime',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
        requirements: [{ id: 'world.layout', required: true }],
        resources: [
          {
            id: 'world-art',
            source: {
              type: 'agent-authored',
              created_at: new Date().toISOString(),
              reason: 'placeholder',
            },
            root_path: 'assets/runtime/world.svg',
            file_paths: ['assets/runtime/world.svg'],
            provisional: true,
            status: 'verified',
            selected_at: new Date().toISOString(),
            selection_reason: ['Project-authored material.'],
          },
        ],
      })
      await writeFile(
        join(workspace, 'assets/content/resource-registry.json'),
        JSON.stringify({
          schema: 'beegame-content-v1',
          id: 'registry',
          kind: 'resource-registry',
          fulfills: ['world.layout'],
          resources: ['world-art'],
          data: {
            bindings: [
              {
                requirementId: 'world.layout',
                resourceIds: ['world-art'],
              },
            ],
          },
        }),
      )
      await writeFile(
        join(workspace, 'assets/content/world.yaml'),
        'schema: beegame-content-v1\nid: world\nkind: scene-definitions\nfulfills: []\nresources: []\ndata:\n  objects: []\n',
      )
      const audit = auditAssetContract(workspace)
      expect(audit.valid).toBe(true)
      expect(
        audit.content.files.find(
          file => file.path === 'assets/content/world.yaml',
        ),
      ).toMatchObject({
        id: 'world',
        kind: 'scene-definitions',
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('enforces JSON ownership for events and waves and YAML ownership for scenes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-audit-'))
    try {
      await mkdir(join(workspace, 'assets/content'), { recursive: true })
      await writeBeeGameAssetManifest(workspace, {
        version: 8,
        project_target: {
          asset_format_capabilities: ['json', 'yaml'],
          runtime_asset_root: 'assets/runtime',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
        requirements: [],
        resources: [],
      })
      const header = {
        schema: 'beegame-content-v1',
        fulfills: [],
        resources: [],
        data: {},
      }
      await writeFile(
        join(workspace, 'assets/content/events.yaml'),
        'schema: beegame-content-v1\nid: events\nkind: event-definitions\nfulfills: []\nresources: []\ndata: {}\n',
      )
      await writeFile(
        join(workspace, 'assets/content/scene.json'),
        JSON.stringify({ ...header, id: 'scene', kind: 'scene-definitions' }),
      )

      expect(auditAssetContract(workspace).issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('events.yaml: YAML kind must be one of'),
          expect.stringContaining('scene.json: JSON kind must be one of'),
        ]),
      )

      await rm(join(workspace, 'assets/content/events.yaml'))
      await rm(join(workspace, 'assets/content/scene.json'))
      await writeFile(
        join(workspace, 'assets/content/events.json'),
        JSON.stringify({ ...header, id: 'events', kind: 'event-definitions' }),
      )
      await writeFile(
        join(workspace, 'assets/content/waves.json'),
        JSON.stringify({ ...header, id: 'waves', kind: 'wave-definitions' }),
      )
      await writeFile(
        join(workspace, 'assets/content/scene.yaml'),
        'schema: beegame-content-v1\nid: scene\nkind: scene-definitions\nfulfills: []\nresources: []\ndata: {}\n',
      )
      expect(auditAssetContract(workspace).valid).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects unregistered manifest modules instead of creating a second inventory', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-audit-'))
    try {
      await mkdir(join(workspace, 'assets/content'), { recursive: true })
      await writeBeeGameAssetManifest(workspace, {
        version: 8,
        project_target: {
          asset_format_capabilities: ['json'],
          runtime_asset_root: 'assets/runtime',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
        requirements: [],
        resources: [],
      })
      await writeFile(
        join(workspace, 'assets/content/project.json'),
        JSON.stringify({
          schema: 'beegame-content-v1',
          id: 'project',
          kind: 'resource-registry',
          fulfills: [],
          resources: [],
          data: {},
        }),
      )
      await mkdir(join(workspace, 'assets/manifest/resources'), {
        recursive: true,
      })
      await writeFile(
        join(workspace, 'assets/manifest/resources/orphan.json'),
        '{}',
      )
      expect(auditAssetContract(workspace).issues).toContain(
        'Unregistered manifest module: assets/manifest/resources/orphan.json',
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
