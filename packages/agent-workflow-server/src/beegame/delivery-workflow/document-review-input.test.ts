import { describe, expect, test } from 'bun:test'
import {
  buildDocumentReviewReferenceIndex,
  buildDocumentReviewWireReferenceIndex,
  checkEvidenceDigests,
  projectDocumentReviewReference,
  validateDocumentReviewSubmission,
} from './document-review-input'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import {
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
} from './types'

describe('document review exact reference index', () => {
  test('projects only exact frozen headings, semantic IDs and legal owner paths', () => {
    expect(
      buildDocumentReviewReferenceIndex([
        { path: 'docs/GDD.md', content: '# Game\n## 4.2 Overflow & Armor\n' },
        {
          path: 'docs/acceptance/gameplay-checklist.md',
          content: '# Acceptance\n',
        },
        {
          path: 'assets/asset-manifest.json',
          content: JSON.stringify({
            requirements: [{ id: 'RES-UI-TYPEFACE' }],
            resources: [{ id: 'res.ui.iconography' }],
          }),
        },
        {
          path: 'assets/content/world.yaml',
          content: 'id: content.world\nkind: world-definition\n',
        },
      ]),
    ).toMatchObject({
      references: expect.arrayContaining([
        expect.objectContaining({
          path: 'docs/GDD.md',
          anchor: '# Game',
          subjectOwner: 'foundation',
        }),
        expect.objectContaining({
          path: 'docs/GDD.md',
          anchor: '## 4.2 Overflow & Armor',
          subjectOwner: 'foundation',
        }),
        expect.objectContaining({
          path: 'docs/acceptance/gameplay-checklist.md',
          anchor: '# Acceptance',
          subjectOwner: 'checklist',
        }),
      ]),
      requirementIds: ['RES-UI-TYPEFACE'],
      resourceIds: ['res.ui.iconography'],
      contentIdsByPath: { 'assets/content/world.yaml': 'content.world' },
    })
  })

  test('uses one artifact dictionary and projects only the accepted authority section', () => {
    const artifacts = [
      {
        path: 'docs/GDD.md',
        content: '# Game\n## Rules\nKeep this.\n### Detail\nKeep detail.\n## Economy\nDo not include.\n',
      },
    ]
    const wire = buildDocumentReviewWireReferenceIndex(artifacts)
    expect(wire.artifacts).toEqual([
      { artifactId: 'a0', path: 'docs/GDD.md' },
    ])
    expect(wire.references.every(reference => !('path' in reference))).toBe(
      true,
    )
    expect(
      projectDocumentReviewReference(
        artifacts[0]!.content,
        artifacts[0]!.path,
        '## Rules',
      ),
    ).toBe('## Rules\nKeep this.\n### Detail\nKeep detail.')
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
        requiredFields: [
          'schema',
          'id',
          'kind',
          'fulfills',
          'resources',
          'data',
        ],
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
    const artifacts = [
      {
        path: 'assets/asset-manifest.json',
        content: JSON.stringify({
          requirements: [{ id: 'world.layout' }],
          resources: [{ id: 'world-art' }],
        }),
      },
      {
        path: 'assets/content/world.json',
        content: JSON.stringify({ id: 'world' }),
      },
    ]
    const findings = [
      {
        findingId: 'RESOURCE_CONTENT',
        checkId: 'implementation_readiness' as const,
        evidence: [
          { path: 'assets/asset-manifest.json', anchor: '/requirements/0' },
        ],
        subjects: [
          {
            path: 'assets/asset-manifest.json',
            anchor: '/requirements/0',
            requirementId: 'world.layout',
          },
          {
            path: 'assets/asset-manifest.json',
            anchor: '/resources/0',
            resourceId: 'world-art',
          },
          {
            path: 'assets/content/world.json',
            anchor: '$',
            contentId: 'world',
          },
        ],
        observation: 'Mismatch.',
        blockingImpact: 'The resource contract is inconsistent.',
        requiredOutcome: 'All cited identities agree.',
      },
    ]
    const issues = validateDocumentReviewSubmission({
      contract: {
        scope: 'complete',
        mode: 'initial',
        requiredCheckIds: ['implementation_readiness'],
        currentCheckIds: ['implementation_readiness'],
        artifacts,
      },
      checks: [
        {
          id: 'implementation_readiness',
          status: 'block',
          conclusion: 'The resource contract is inconsistent.',
          evidence: [
            { path: 'assets/asset-manifest.json', anchor: '/requirements/0' },
          ],
          findingIds: ['RESOURCE_CONTENT'],
          assessments: [],
        },
      ],
      findings,
    })
    expect(issues).toEqual([])
  })
})

describe('system delivery contract review evidence', () => {
  const artifacts = [
    {
      path: 'systemDeliveryContract',
      content: JSON.stringify(buildSystemDeliveryContract()),
    },
    { path: 'docs/GDD.md', content: '# Gameplay\n' },
  ]

  test('rejects a delivery-boundary check that ignores system authority', () => {
    const checks = foundationChecks([
      { path: 'docs/GDD.md', anchor: 'Gameplay' },
    ]).filter(check => check.id === 'technical_feasibility')
    const issues = validateDocumentReviewSubmission({
      contract: {
        scope: 'foundation',
        mode: 'initial',
        requiredCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
        currentCheckIds: ['technical_feasibility'],
        artifacts,
      },
      checks,
      findings: [],
    })
    expect(issues).toContain(
      'document review check technical_feasibility does not cite the system delivery contract',
    )
  })

  test('accepts exact system authority pointers for delivery-boundary checks', () => {
    const projectEvidence = [{ path: 'docs/GDD.md', anchor: 'Gameplay' }]
    const systemEvidence = [
      ...projectEvidence,
      {
        path: 'systemDeliveryContract',
        anchor: '/canonicalAssetManifest/path',
      },
    ]
    expect(
      validateDocumentReviewSubmission({
        contract: {
          scope: 'foundation',
          mode: 'initial',
          requiredCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
          currentCheckIds: ['technical_feasibility'],
          artifacts,
        },
        checks: foundationChecks(projectEvidence)
          .filter(check => check.id === 'technical_feasibility')
          .map(check => ({ ...check, evidence: systemEvidence })),
        findings: [],
      }),
    ).toEqual([])
  })

  test('rejects criterion evidence outside the active check dependency', () => {
    const projectEvidence = [{ path: 'docs/GDD.md', anchor: 'Gameplay' }]
    const checks = foundationChecks(projectEvidence).filter(
      check => check.id === 'gameplay_strategy_viability',
    )
    const strategy = checks.find(
      check => check.id === 'gameplay_strategy_viability',
    )!
    strategy.assessments![0]!.evidence = [
      { path: 'systemDeliveryContract', anchor: '/content/schema' },
    ]
    const issues = validateDocumentReviewSubmission({
      contract: {
        scope: 'foundation',
        mode: 'initial',
        requiredCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
        currentCheckIds: ['gameplay_strategy_viability'],
        artifacts,
      },
      checks,
      findings: [],
    })
    expect(issues).toContain(
      'document review criterion meaningful_choices references an unavailable artifact',
    )
  })

  test('invalidates a check when an uncited dependency changes', () => {
    const projectEvidence = [{ path: 'docs/GDD.md', anchor: 'Gameplay' }]
    const checks = foundationChecks(projectEvidence).filter(
      check => check.id === 'gameplay_strategy_viability',
    )
    const dependencyArtifacts = [
      ...artifacts,
      { path: 'docs/BALANCE_DESIGN.md', content: '# Balance\n' },
    ]
    expect(
      checkEvidenceDigests({ checks, artifacts: dependencyArtifacts })[
        'gameplay_strategy_viability'
      ],
    ).toHaveProperty(['docs/BALANCE_DESIGN.md'])
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
