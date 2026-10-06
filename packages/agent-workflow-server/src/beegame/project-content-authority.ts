import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readBeeGameAssetManifestSync } from './asset-contracts'
import type { BeeGameContentAuthority } from './game-content-package'
import { designHandoffPath } from './design-handoff'

import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
export { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'

/** One implementation shared by the host and the standalone project checker. */
export function projectContentAuthority(workspacePath: string): BeeGameContentAuthority {
  const documents = createHash('sha256')
  for (const name of PROJECT_DOCUMENTS) {
    documents.update(name).update('\0').update(readFileSync(join(workspacePath, 'docs', name))).update('\0')
    // Runtime acceptance consumes the small output/acceptance index. Bind its
    // bytes as well as the authoritative prose, including legacy indexes read
    // by the compatibility parser. This computes identity, not a semantic PASS;
    // incomplete drafts still require the existing design release gate.
    try { documents.update(readFileSync(join(workspacePath, designHandoffPath(name)))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; documents.update('missing-handoff') }
    documents.update('\0')
  }
  const manifest = readBeeGameAssetManifestSync(workspacePath)
  return {
    documentRevision: documents.digest('hex'),
    assetManifestRevision: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    manifest,
  }
}
