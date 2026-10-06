import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECT_DOCUMENTS } from '../project-content-authority'
import { checkDesignHandoff, designHandoffPath, readDesignAcceptanceRequirements, type DesignDocument, type DesignHandoff } from '../design-handoff'

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

export function designHandoffFixture(name: DesignDocument): DesignHandoff {
  return { version: 2, documentVersion: '1.0',
    outputs: [{ id: name === 'GDD.md' ? 'play' : 'ready', section: 'Design',
      ...(name === 'GDD.md' ? { acceptance: { section: 'Design', method: 'test' as 'test' | 'target-runtime' | 'inspection' } } : {}) }],
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
    (name === 'UI_UX_SPEC.md' ? '\n[Reviewed UI constraints](../content/ui/menu.json)\n' : '')
}
export async function writeDesignDocumentFixture(workspace: string, name: DesignDocument, handoff: unknown = designHandoffFixture(name), body = designDocumentFixture(name, handoff)) {
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await mkdir(join(workspace, '.beegame/design-handoffs'), { recursive: true })
  if (name === 'UI_UX_SPEC.md' && !await Bun.file(join(workspace, 'content/ui/menu.json')).exists()) {
    await mkdir(join(workspace, 'content/ui'), { recursive: true })
    await writeFile(join(workspace, 'content/ui/menu.json'), JSON.stringify(uiLayoutFixture()))
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
  return { batch: 4, revision: check.revision, snapshots: check.snapshots, documentVersions: check.documentVersions, evidenceHashes: check.evidenceHashes, followUps: [] }
}

export async function writeUiLayoutFixture(workspace: string, height = 52) {
  await mkdir(join(workspace, 'content/ui'), { recursive: true })
  await writeFile(join(workspace, 'content/ui/menu.json'), JSON.stringify(uiLayoutFixture(height)))
}
