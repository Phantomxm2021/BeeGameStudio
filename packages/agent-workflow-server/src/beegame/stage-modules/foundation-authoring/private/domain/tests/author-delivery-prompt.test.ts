import { expect, test } from 'bun:test'
import { buildFoundationAuthoringDeliveryContract } from '../foundation-authoring-delivery-contract'
import { buildFoundationAuthorPrompt as buildWorkerPrompt } from '../foundation-authoring-prompt'

test('gives Technical and Asset authors the actual private delivery contract', () => {
    const contract = buildFoundationAuthoringDeliveryContract()
    expect(contract.programmaticAudio.manifestRule).toContain('For managed programmatic audio resources only')
    expect(contract.programmaticAudio.manifestRule).toContain('no managed JSON audio resource is required')
    expect(contract.placeholderRule).toContain('Code-only runtime synthesis needs no audio-container or managed JSON handoff')
    expect(contract.canonicalAssetManifest.moduleLayout).toMatchObject({
      requirements: {
        root: 'assets/manifest/requirements',
        cardinality: 'exactly_one',
      },
      resources: {
        root: 'assets/manifest/resources',
        cardinality: 'one_per_resource',
      },
    })
    expect(contract.requirements.fields).toContain('acquisition_profile')
    expect(contract.requirements.requiredFields).toEqual([
      'id',
      'acquisition_profile',
    ])
    expect(contract.requirements.optionalFields).toContain('purpose')
    expect(contract.resources.fields).toContain('local_file_hashes')
    expect(contract.resources.requiredFields).not.toContain('asset_kind')
    expect(contract.resources.optionalFields).toContain('asset_kind')
    expect(contract.resources.sourceShapes['agent-authored']).toEqual({
      fields: ['type', 'created_at', 'reason'],
      requiredFields: ['type', 'created_at', 'reason'],
    })
    expect(contract.content.jsonKinds).toContain('resource-registry')
    expect(contract.content.yamlKinds).toContain('world-definition')
    expect(contract.resourceRegistry.bindingFields).toEqual([
      'requirementId',
      'resourceIds',
    ])

    for (const foundationDocumentPath of [
      'docs/TECHNICAL_DESIGN.md',
      'docs/ASSET_PLAN.md',
    ] as const) {
      const prompt = buildWorkerPrompt({
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision',
        allowedPaths: [foundationDocumentPath],
        contract: {
          confirmedBriefDigest: 'a'.repeat(64),
      documentSet: 'foundation',
          authoringMode: 'parallel-draft',
          foundationDocumentPath,
        },
      })

      expect(prompt).toContain('authoringDeliveryContract')
      expect(prompt).toContain('beegame-programmatic-audio-v1')
      expect(prompt).toContain('exactly one cue')
      expect(prompt).toContain('placeholderAdapters')
      expect(prompt).toContain('resource-registry')
      expect(prompt).toContain('requirementId')
      expect(prompt).toContain('resourceIds')
      expect(prompt).toContain('do not invent manifest fields or unsupported content kinds')
      expect(prompt).not.toContain('systemDeliveryContract')
    }
  })
