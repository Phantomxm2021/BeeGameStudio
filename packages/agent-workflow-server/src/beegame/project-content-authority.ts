import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { readBeeGameAssetManifestSync } from './asset-contracts'
import type { BeeGameContentAuthority } from './game-content-package'
import { designHandoffPath } from './design-handoff'
import { parseBeeGameContentIndex } from './game-content-schema'

import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
export { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'

/** One implementation shared by the host and the standalone project checker. */
export function projectContentAuthority(workspacePath: string): BeeGameContentAuthority {
  return computeContentAuthority(workspacePath).authority
}

function computeContentAuthority(workspacePath: string, inspectInputs = false) {
  const documents = createHash('sha256')
  const inputs: {path:string;status:'present'|'missing';bytes?:number;sha256?:string}[] = []
  const observe = (path:string, bytes?:Buffer) => {
    if(inspectInputs)inputs.push(bytes === undefined ? {path,status:'missing'} :
      {path,status:'present',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
  }
  for (const name of PROJECT_DOCUMENTS) {
    const path='docs/'+name,bytes=readFileSync(join(workspacePath,path))
    documents.update(name).update('\0').update(bytes).update('\0')
    observe(path,bytes)
    // Runtime acceptance consumes the small output/acceptance index. Bind its
    // bytes as well as the authoritative prose, including legacy indexes read
    // by the compatibility parser. This computes identity, not a semantic PASS;
    // legacy consumers may still require their own release gate.
    const handoff=designHandoffPath(name)
    try { const bytes=readFileSync(join(workspacePath,handoff));documents.update(bytes);observe(handoff,bytes) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; documents.update('missing-handoff');observe(handoff) }
    documents.update('\0')
  }
  const manifest = readBeeGameAssetManifestSync(workspacePath)
  const authority:BeeGameContentAuthority = {
    documentRevision: documents.digest('hex'),
    assetManifestRevision: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    manifest,
  }
  return {authority,inputs}
}

/** Compatibility identity comparison, not a design release. Expose the saved
 * operand as well as the computed identity so callers need not guess hash
 * algorithms or treat identical bytes as semantic coverage. */
export function inspectProjectContentAuthority(workspacePath: string, includeInputs = false) {
  const computed=computeContentAuthority(workspacePath,includeInputs)
  const {manifest:_manifest,...authority}=computed.authority
  let registry
  try {
    const path=join(realpathSync(workspacePath),'content','index.json')
    if(realpathSync(path)!==path)throw Error('Content registry cannot contain symlinks')
    const index=parseBeeGameContentIndex(JSON.parse(readFileSync(path,'utf8')))
    const matches={documentRevision:index.documentRevision===authority.documentRevision,
      assetManifestRevision:index.assetManifestRevision===authority.assetManifestRevision}
    registry={path:'content/index.json',status:Object.values(matches).every(Boolean)?'current':'changed',
      documentRevision:index.documentRevision,assetManifestRevision:index.assetManifestRevision,matches}
  } catch(error) {
    registry={path:'content/index.json',status:(error as NodeJS.ErrnoException).code==='ENOENT'?'unregistered':'unverified',
      reason:error instanceof Error?error.message:String(error)}
  }
  return {ok:true,scope:'content-authority',...authority,registry,designVerified:false,runtimeVerified:false,
    requiredForAutonomousCurrent:false,
    ...(includeInputs?{identityInputs:{documents:computed.inputs,assetManifest:{indexPath:'assets/asset-manifest.json',
      encoding:'JSON.stringify(parsed manifest including registered modules)',sha256:authority.assetManifestRevision},runtimeSourcesIncluded:false}}:{}),
    note:'Computed legacy document/Manifest identity and saved registry comparison only. Matching hashes do not validate design decisions, test expectations, runtime consumption or quality. Autonomous --current does not require this legacy document tag to match; do not edit unrelated sources to satisfy it.'}
}
