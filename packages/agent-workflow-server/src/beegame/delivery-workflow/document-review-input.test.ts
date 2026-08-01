import { describe, expect, test } from 'bun:test'
import {
  validateDocumentReviewChecks,
  validateDocumentReviewFindingSubjects,
} from './document-review-input'
import { buildSystemDeliveryContract } from './system-delivery-contract'

describe('system delivery contract projection', () => {
  test('projects the one canonical engine-neutral delivery boundary', () => {
    expect(buildSystemDeliveryContract()).toEqual({
      canonicalAssetManifest: {
        path: 'assets/asset-manifest.json',
        version: 7,
      },
      roots: {
        runtimeAssets: 'assets/runtime',
        content: 'assets/content',
        generatedAdapters: 'assets/generated',
      },
      content: {
        schema: 'beegame-content-v1',
        requiredFields: ['schema', 'id', 'kind', 'fulfills', 'resources', 'data'],
        jsonKinds: [
          'resource-registry',
          'entity-definitions',
          'ui-configuration',
          'audio-configuration',
          'event-definitions',
          'wave-definitions',
          'numeric-configuration',
        ],
        yamlKinds: [
          'world-definition',
          'scene-definitions',
          'hierarchy-definition',
          'placement-definitions',
        ],
        factOwnership: 'single',
      },
      resourceLoading: {
        manifestCount: 1,
        contentRootCount: 1,
        placeholderUsesCanonicalPath: true,
        runtimeOrSourceMediaSubstituteAllowed: false,
        secondaryLoaderAllowed: false,
      },
    })
  })
})

describe('document review resource-content subjects', () => {
  test('accepts current requirement, resource and content IDs', () => {
    const issues = validateDocumentReviewFindingSubjects({
      artifacts: [
        { path: 'assets/asset-manifest.json', content: JSON.stringify({ requirements: [{ id: 'world.layout' }], resources: [{ id: 'world-art' }] }) },
        { path: 'assets/content/world.json', content: JSON.stringify({ id: 'world' }) },
      ],
      findings: [{
        findingId: 'RESOURCE_CONTENT',
        checkId: 'resource_content_consistency',
        severity: 'blocking',
        owner: 'resource',
        subjects: [
          { path: 'assets/asset-manifest.json', anchor: '/requirements/0', requirementId: 'world.layout' },
          { path: 'assets/asset-manifest.json', anchor: '/resources/0', resourceId: 'world-art' },
          { path: 'assets/content/world.json', anchor: '$', contentId: 'world' },
        ],
        observation: 'Mismatch.',
        blockingReason: 'The resource contract is inconsistent.',
        requiredAction: 'Correct it.',
        closureCondition: 'All cited identities agree.',
      }],
    })
    expect(issues).toEqual([])
  })
})

describe('system delivery contract review evidence', () => {
  const artifacts = [
    { path: 'systemDeliveryContract', content: JSON.stringify(buildSystemDeliveryContract()) },
    { path: 'docs/GDD.md', content: '# Gameplay\n' },
  ]

  test('rejects a delivery-boundary check that ignores system authority', () => {
    const issues = validateDocumentReviewChecks({
      scope: 'foundation',
      artifacts,
      checks: foundationChecks([{ path: 'docs/GDD.md', anchor: 'Gameplay' }]),
    })
    expect(issues).toContain(
      'document review check technical_feasibility does not cite the system delivery contract',
    )
    expect(issues).toContain(
      'document review check cross_document_consistency does not cite the system delivery contract',
    )
  })

  test('accepts exact system authority pointers for delivery-boundary checks', () => {
    const projectEvidence = [{ path: 'docs/GDD.md', anchor: 'Gameplay' }]
    const systemEvidence = [
      ...projectEvidence,
      { path: 'systemDeliveryContract', anchor: '/canonicalAssetManifest/path' },
    ]
    expect(
      validateDocumentReviewChecks({
        scope: 'foundation',
        artifacts,
        checks: foundationChecks(projectEvidence).map(check =>
          ['cross_document_consistency', 'technical_feasibility'].includes(check.id)
            ? { ...check, evidence: systemEvidence }
            : check,
        ),
      }),
    ).toEqual([])
  })
})

function foundationChecks(evidence: Array<{ path: string; anchor: string }>) {
  return [
    'brief_alignment',
    'cross_document_consistency',
    'gameplay_completeness',
    'technical_feasibility',
    'art_direction_coherence',
    'ui_audio_consistency',
    'acceptance_observability',
  ].map(id => ({
    id: id as Parameters<typeof validateDocumentReviewChecks>[0]['checks'][number]['id'],
    status: 'pass' as const,
    conclusion: 'Reviewed.',
    evidence,
    findingIds: [],
  }))
}
