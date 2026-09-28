import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readBeeGameAssetManifestSync } from './asset-contracts'
import type { BeeGameContentAuthority } from './game-content-package'

export const PROJECT_DOCUMENTS = [
  'GDD.md', 'LEVEL_SCENE_DESIGN.md', 'BALANCE_DESIGN.md', 'TECHNICAL_DESIGN.md',
  'ART_DIRECTION.md', 'UI_UX_SPEC.md', 'AUDIO_DESIGN.md', 'ASSET_PLAN.md',
] as const

/** One implementation shared by the host and the standalone project checker. */
export function projectContentAuthority(workspacePath: string): BeeGameContentAuthority {
  const documents = createHash('sha256')
  for (const name of PROJECT_DOCUMENTS)
    documents.update(name).update('\0').update(readFileSync(join(workspacePath, 'docs', name))).update('\0')
  const manifest = readBeeGameAssetManifestSync(workspacePath)
  return {
    documentRevision: documents.digest('hex'),
    assetManifestRevision: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    manifest,
  }
}
