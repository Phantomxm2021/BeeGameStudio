import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECT_DOCUMENTS } from '../project-content-authority'
import { checkDesignHandoff, designHandoffPath, readDesignAcceptanceRequirements, type DesignDocument, type DesignHandoff } from '../design-handoff'

/** A pre-upgrade saved inspection, for compatibility tests only. New flow
 * tests must call prepareProjectDesignReview directly instead. */
export async function prepareLegacyDesignReviewFixture(workspace: string, root: string) {
  const { prepareProjectDesignReview, projectDeliveryStatePath } = await import('../project-delivery')
  const state = (await prepareProjectDesignReview(workspace, root))!
  const { combined, writableDocuments, revisionDocuments, pendingCheckIssues, ...review } = state.designReview!
  const legacy = { ...state, designReview: { ...review, step: 'inspect' as const } }
  await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify(legacy))
  return legacy
}

export function uiLayoutFixture(height = 52) {
  return { schema: 'beegame-content.v1', id: 'menu', kind: 'ui-screen', assetRefs: [], data: {
    rootId: 'root', nodes: [
      { id: 'root', role: 'screen-root', data: { orientation: 'Landscape', referenceResolution: [960, 540],
        targetViewports: [[600, 360]], minimumControlSize: [44, 44] }, layout: { size: [960, 540] } },
      { id: 'play', role: 'button', parentId: 'root', actions: { click: 'start' },
        layout: { anchor: 'middle-center', size: [200, height] } },
    ],
  } }
}

export function sceneLayoutFixture() {
  return { schema: 'beegame-content.v1', id: 'level', kind: 'scene-2d', assetRefs: [], data: {
    cameraNodeId: 'camera', settings: { coordinateSystem: {
      origin: 'top-left', units: 'logical-pixels', width: 960, height: 540, pixelsPerUnit: 100,
    } }, nodes: [
      { id: 'camera', components: [{ id: 'camera-component', type: 'camera', data: {
        orthographic: true, orthographicSize: 2.7, coordinateSpace: 'logical-pixels',
        viewport: { width: 960, height: 540 }, framing: 'expand',
      } }] },
      { id: 'board', transform: { position: [0, 0, 0] }, components: [] },
    ],
  } }
}

export function designHandoffFixture(name: DesignDocument): DesignHandoff {
  return { version: 2, documentVersion: '1.0',
    outputs: [{ id: name === 'GDD.md' ? 'play' : 'ready', section: 'Design',
      acceptance: { section: 'Design', method: name === 'GDD.md' ? 'test' : 'inspection' } }],
    ...(name === 'TECHNICAL_DESIGN.md' ? { implementationItems: PROJECT_DOCUMENTS.map(document => ({
      id: 'fixture-' + document.slice(0, -3), section: 'Design',
      requirementRefs: [{ document, id: document === 'GDD.md' ? 'play' : 'ready' }],
    })) } : {}),
    evidence: [] }
}

/** Synthetic coverage records for unit tests, never actual game acceptance. */
export function designRequirementChecksFixture(workspace: string, evidencePaths: string[]) {
  return readDesignAcceptanceRequirements(workspace).map(({ document, id, method, documentSha256, handoffSha256 }) => ({
    document, id, method, documentSha256, handoffSha256, scenario: 'Synthetic fixture condition/action',
    observed: 'Synthetic fixture outcome', status: 'passed' as const, evidencePaths,
  }))
}
export function designDocumentFixture(name: DesignDocument, handoff: unknown = designHandoffFixture(name)) {
  const version = (handoff as { documentVersion?: string })?.documentVersion ?? '1.0'
  return '# Design\n- Version: v' + version + '\nFixture decision.\n' +
    (name === 'UI_UX_SPEC.md' ? '\n[Reviewed UI constraints](../content/ui/menu.json)\n' : '') +
    (name === 'LEVEL_SCENE_DESIGN.md' ? '\n[Reviewed Scene layout](../content/scenes/level.json)\n' : '')
}
export async function writeDesignDocumentFixture(workspace: string, name: DesignDocument, handoff: unknown = designHandoffFixture(name), body = designDocumentFixture(name, handoff)) {
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await mkdir(join(workspace, '.beegame/design-handoffs'), { recursive: true })
  if (name === 'UI_UX_SPEC.md' && !await Bun.file(join(workspace, 'content/ui/menu.json')).exists()) {
    await mkdir(join(workspace, 'content/ui'), { recursive: true })
    await writeFile(join(workspace, 'content/ui/menu.json'), JSON.stringify(uiLayoutFixture()))
  }
  if (name === 'LEVEL_SCENE_DESIGN.md' && !await Bun.file(join(workspace, 'content/scenes/level.json')).exists()) {
    await mkdir(join(workspace, 'content/scenes'), { recursive: true })
    await writeFile(join(workspace, 'content/scenes/level.json'), JSON.stringify(sceneLayoutFixture()))
  }
  await writeFile(join(workspace, 'docs', name), body)
  await writeFile(join(workspace, designHandoffPath(name)), JSON.stringify(handoff))
}
export async function writeDesignDocumentsFixture(workspace: string, documents: readonly DesignDocument[] = PROJECT_DOCUMENTS) {
  await mkdir(join(workspace, 'docs'), { recursive: true })
  for (const name of documents)
    if (!await Bun.file(join(workspace, 'docs', name)).exists()) await writeDesignDocumentFixture(workspace, name)
}

/** Explicit test double for tests focused on later phases, not an author or real review. */
export function designBaselineFixture(workspace: string) {
  const check = checkDesignHandoff(workspace, PROJECT_DOCUMENTS)
  if (!check.valid) throw new Error(check.issues.join('; '))
  return { batch: 4, revision: check.revision, snapshots: check.snapshots, documentVersions: check.documentVersions, evidenceHashes: check.evidenceHashes, digestVersion: check.digestVersion, followUps: [] }
}

export async function writeUiLayoutFixture(workspace: string, height = 52) {
  await mkdir(join(workspace, 'content/ui'), { recursive: true })
  await writeFile(join(workspace, 'content/ui/menu.json'), JSON.stringify(uiLayoutFixture(height)))
}
