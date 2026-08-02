import { describe, expect, test } from 'bun:test'
import {
  buildDocumentReviewReferenceIndex,
  checkEvidenceDigests,
  validateDocumentReviewChecks,
  validateDocumentReviewFindingSubjects,
} from './document-review-input'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import {
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
} from './types'

describe('document review exact reference index', () => {
  test('projects only exact frozen headings, semantic IDs and legal owner paths', () => {
    expect(buildDocumentReviewReferenceIndex([
      { path: 'docs/GDD.md', content: '# Game\n## 4.2 Overflow & Armor\n' },
      { path: 'docs/acceptance/gameplay-checklist.md', content: '# Acceptance\n' },
      { path: 'assets/asset-manifest.json', content: JSON.stringify({ requirements: [{ id: 'RES-UI-TYPEFACE' }], resources: [{ id: 'res.ui.iconography' }] }) },
      { path: 'assets/content/world.yaml', content: 'id: content.world\nkind: world-definition\n' },
    ])).toEqual({
      markdownHeadings: {
        'docs/GDD.md': ['# Game', '## 4.2 Overflow & Armor'],
        'docs/acceptance/gameplay-checklist.md': ['# Acceptance'],
      },
      requirementIds: ['RES-UI-TYPEFACE'],
      resourceIds: ['res.ui.iconography'],
      contentIdsByPath: { 'assets/content/world.yaml': 'content.world' },
      subjectPathsByOwner: {
        foundation: expect.arrayContaining(['docs/GDD.md']),
        checklist: ['docs/acceptance/gameplay-checklist.md'],
        resource: ['assets/asset-manifest.json', 'assets/content/world.yaml'],
      },
    })
  })
})

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
        referenceSemantics: {
          fulfills: 'manifest-requirement-ids',
          resources: 'manifest-resource-ids',
          physicalPathsOwnedBy: 'canonical-asset-manifest',
        },
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

  test('validates criterion evidence independently and includes it in check invalidation', () => {
    const projectEvidence = [{ path: 'docs/GDD.md', anchor: 'Gameplay' }]
    const checks = foundationChecks(projectEvidence).map(check =>
      ['cross_document_consistency', 'technical_feasibility'].includes(check.id)
        ? {
            ...check,
            evidence: [
              ...projectEvidence,
              {
                path: 'systemDeliveryContract',
                anchor: '/canonicalAssetManifest/path',
              },
            ],
          }
        : check,
    )
    const strategy = checks.find(
      check => check.id === 'gameplay_strategy_viability',
    )!
    strategy.assessments![0]!.evidence = [
      { path: 'systemDeliveryContract', anchor: '/content/schema' },
    ]
    const issues = validateDocumentReviewChecks({
      scope: 'foundation',
      artifacts,
      checks,
    })
    expect(issues).toEqual([])
    expect(
      checkEvidenceDigests({ checks, artifacts })[
        'gameplay_strategy_viability'
      ],
    ).toHaveProperty('systemDeliveryContract')
  })
})

function foundationChecks(evidence: Array<{ path: string; anchor: string }>) {
  return FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.map(id => ({
    id,
    status: 'pass' as const,
    conclusion: 'Reviewed.',
    evidence,
    findingIds: [],
    assessments:
      id in GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA
        ? GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA[
            id as keyof typeof GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA
          ].map(criterion => ({
            criterion,
            status: 'pass' as const,
            evidence,
            derivation: 'Derived from the supplied design facts.',
            conclusion: 'The fixed criterion passes.',
          }))
        : [],
  }))
}
