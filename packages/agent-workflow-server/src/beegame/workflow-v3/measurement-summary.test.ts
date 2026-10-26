import { expect, test } from 'bun:test'
import { measurementSummary } from './agent-measurement'
import type { AgentMeasurement, UiNodeBindingCoverage, SceneNodeBindingCoverage } from './state'
import type { AssetContractAudit, AssetResourceAudit } from '../asset-contract-audit'

test('summary omits routine inventories, retains all problems, and details returns each inventory once', () => {
  const ui: UiNodeBindingCoverage[] = Array.from({ length: 300 }, (_, i) => ({
    document: 'content/ui/menu.json', nodeId: `control-${i}`, role: 'button',
    bindings: [{ location: 'node.data.image', assetRef: 'sheet', frame: `frame-${i}` }],
    resolution: i === 299 ? 'invalid' : 'resolved', issues: i === 299 ? ['Missing frame frame-299'] : [],
  }))
  const scene: SceneNodeBindingCoverage[] = Array.from({ length: 300 }, (_, i) => ({
    document: 'content/scenes/level.json', nodeId: `object-${i}`, dimension: '2d',
    bindings: [], components: [{ id: 'visual', type: 'sprite', bindings: [] }], behaviors: [],
  }))
  const assetContract = { present: true, valid: false, manifestPath: 'assets/asset-manifest.json',
    requirements: [], resources: [], bindings: [], issues: ['Required resource missing'] }
  const surface = [{ document: ui[0]!.document, supported: false, issues: [{ nodeId: 'control-1', property: 'visual', reason: 'Unsupported visual' }], projectSemantics: [] }]
  const observation = JSON.stringify({ probes: [{ document: scene[0]!.document, nodeId: scene[299]!.nodeId,
    status: 'failed', reason: 'Sprite was not rendered', viewport: [960, 540] }] })
  const record: AgentMeasurement = { id: 'saved-id', requestKey: 'original-request', startedAt: '2026-10-20',
    runtimeArtifact: 'dist', reports: [], reportPaths: [], requirementsRevision: 'revision', checks: [
      { id: 'content-resources', version: 'test', createdAt: '2026-10-20', status: 'failed', inputs: [],
        observation: 'Missing frame frame-299; Required resource missing', coverage: {
          files: [ui[0]!.document, scene[0]!.document], limitations: ['Static structure only'],
          uiNodeBindings: ui, sceneNodeBindings: scene, assetContract, uiSurfaceCompatibility: surface,
        } },
      { id: 'scene-data-consumption', version: 'test', createdAt: '2026-10-20', status: 'failed', inputs: [], observation },
    ] }
  const before = JSON.stringify(record)
  const compact = measurementSummary(record, false), detailed = measurementSummary(record, true)
  expect(compact).toMatchObject({ id: 'saved-id', requestKey: 'original-request', deliveryEligible: false, quality: 'unverified',
    uiBindingCoverage: { nodeCount: 300, unobservedNodeCount: 300, nodesScope: 'issues-only' },
    sceneBindingCoverage: { nodeCount: 300, unobservedNodeCount: 299, nodesScope: 'issues-only' } })
  expect(compact.uiBindingCoverage.nodes).toEqual([{ ...ui[299]!, observations: [] }])
  expect(compact.sceneBindingCoverage.nodes).toHaveLength(1)
  expect(compact.sceneBindingCoverage.nodes![0]).toMatchObject({ nodeId: 'object-299', observations: [{
    status: 'failed', reason: 'Sprite was not rendered', checkId: 'scene-data-consumption' }] })
  expect('observation' in compact.checks[1]! ? compact.checks[1].observation : undefined).toBe(observation)
  expect(compact.detailsHint).toContain('details:true')
  for (const summary of [compact, detailed]) {
    const expectedResources=summary===compact ? {...assetContract,resourcesScope:'issues-only',routineVerifiedResourceCount:0} : assetContract
    expect(summary.resourceStructureCoverage).toEqual(expectedResources)
    expect(summary.checks[0]!.coverage).toEqual({ files: [ui[0]!.document, scene[0]!.document],
      limitations: ['Static structure only'], uiSurfaceCompatibility: surface })
    expect('observation' in summary.checks[0]! ? summary.checks[0].observation : undefined).toBe(record.checks[0]!.observation)
  }
  expect(detailed.uiBindingCoverage.nodesScope).toBe('all')
  expect(detailed.uiBindingCoverage.nodes!.map(({ observations, ...node }) => node)).toEqual(ui)
  expect(detailed.sceneBindingCoverage.nodes!.map(({ observations, ...node }) => node)).toEqual(scene)
  expect('observation' in detailed.checks[1]! ? detailed.checks[1].observation : undefined).toBe(observation)
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(detailed).length / 10)
  expect(JSON.stringify(record)).toBe(before)
})

test('absent inventory, empty inventory and unobserved nodes remain distinct from success', () => {
  const record: AgentMeasurement = { id: 'unfinished', requestKey: 'request', startedAt: '2026-10-20',
    runtimeArtifact: 'dist', reports: [], reportPaths: [], requirementsRevision: 'revision', checks: [] }
  const absent = measurementSummary(record, false)
  expect(absent.sceneBindingCoverage).toMatchObject({ nodeCount: null, nodes: null, sourceCheckStatus: 'unverified' })
  expect(absent.uiBindingCoverage).toMatchObject({ nodeCount: null, nodes: null, sourceCheckStatus: 'unverified' })
  record.checks.push({ id: 'content-resources', version: 'test', createdAt: '2026-10-20', status: 'unverified',
    inputs: [], observation: 'Required check input unavailable', coverage: { files: [], limitations: [],
      sceneNodeBindings: [], uiNodeBindings: [{ document: 'content/ui/menu.json', nodeId: 'root',
        role: 'container', resolution: 'not-declared', issues: [], bindings: [] }] } })
  const compact = measurementSummary(record, false)
  expect(compact.sceneBindingCoverage).toMatchObject({ nodeCount: 0, nodes: [], unobservedNodeCount: 0 })
  expect(compact.uiBindingCoverage).toMatchObject({ nodeCount: 1, nodes: [], unobservedNodeCount: 1 })
  expect('observation' in compact.checks[0]! ? compact.checks[0].observation : undefined).toBe('Required check input unavailable')
  expect(compact).toMatchObject({ quality: 'unverified', deliveryEligible: false })
  record.checks[0]!.coverage!.uiNodeBindings![0]!.resolution = 'unverified'
  expect(measurementSummary(record, false).uiBindingCoverage.nodes).toMatchObject([{ nodeId: 'root', resolution: 'unverified' }])
})

test('compact resource evidence preserves problems and provisional resources; details retains the saved evidence', () => {
  const resource = (id: string, extra: Partial<AssetResourceAudit> = {}): AssetResourceAudit => ({
    id, status: 'verified', sourceType: 'resource-library', provisional: false, issues: [],
    rootPath: `assets/${id}.png`, filePaths: [`assets/${id}.png`],
    fileEvidence: [{ path: `assets/${id}.png`, sha256: 'a'.repeat(64), facts: { width: 64, height: 64 } }],
    ...extra,
  })
  const routine = resource('intact')
  const problems = [resource('failed', { status: 'failed', issues: ['File does not exist: assets/failed.png'] }),
    resource('pending', { status: 'available' }), resource('unverified', { status: 'unverified' }),
    resource('hash-mismatch', { issues: ['Local file hash does not match'] }),
    resource('provisional', { provisional: true })]
  const assetContract: AssetContractAudit = { present: true, valid: false, manifestPath: 'assets/asset-manifest.json',
    resources: [routine, ...problems], issues: ['Required resource failed'],
    requirements: [
      { id: 'broken-model', required: true, issues: ['No intact model'],
        structure: { status: 'failed', observations: ['Required animation is missing'] } },
      { id: 'unobserved-atlas', required: true, issues: [],
        structure: { status: 'unverified', observations: ['Named frame coverage remains unverified'] } },
    ], bindings: [{ requirementId: 'unobserved-atlas', resourceIds: ['intact', 'provisional'] }] }
  const record: AgentMeasurement = { id: 'resource-evidence', requestKey: 'resource-request', startedAt: '2026-10-24',
    runtimeArtifact: 'dist', reports: [], reportPaths: [], requirementsRevision: 'revision', checks: [
      { id: 'content-resources', version: 'test', createdAt: '2026-10-24', status: 'failed', inputs: [],
        observation: 'Required resource failed; named frame coverage remains unverified',
        coverage: { files: [assetContract.manifestPath], limitations: ['Static resource evidence only'], assetContract } },
    ] }
  const before = JSON.stringify(record)
  const compact = measurementSummary(record, false), detailed = measurementSummary(record, true)
  const expectedResources={ ...assetContract, resourcesScope:'issues-only',routineVerifiedResourceCount:1, resources:problems }
  expect(compact.resourceStructureCoverage).toEqual(expectedResources)
  expect(compact.checks[0]).toMatchObject({ status: 'failed', observation: record.checks[0]!.observation,
    coverage: { files: [assetContract.manifestPath], limitations: ['Static resource evidence only'] } })
  expect(compact).toMatchObject({ quality: 'unverified', deliveryEligible: false })
  expect(compact.detailsHint).toContain('--inspect ID --details')
  expect(compact.detailsHint).toContain('resource file evidence')
  expect(detailed.resourceStructureCoverage).toEqual(assetContract)
  expect(measurementSummary(record)).toEqual(detailed)
  expect(JSON.stringify(record)).toBe(before)
})
