import { relative, resolve } from 'node:path'
import { readFileSync, realpathSync } from 'node:fs'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
import { checkDesignHandoff, PROJECT_DESIGN_PATHS } from '../design-handoff'
import { readVersion, versionsMatch } from './checks'
import { parseBeeGameContentIndex } from '../game-content-schema'
import { digest, WorkflowError, type Run, type SourceEdit } from './state'

function registryRevision(workspace: string) {
  try {
    const file=resolve(realpathSync(workspace),'content/index.json')
    if(realpathSync(file)!==file)throw new WorkflowError('invalid-content-path','Content registry cannot be an alias')
    const {documentRevision:_documents,assetManifestRevision:_assets,...routing}=parseBeeGameContentIndex(JSON.parse(readFileSync(file,'utf8')))
    return digest(JSON.stringify(routing))
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
}

export async function captureDesignBaseline(run: Run): Promise<NonNullable<Run['designBaseline']>> {
  const check = checkDesignHandoff(run.workspacePath, PROJECT_DOCUMENTS)
  if (!check.valid) throw new WorkflowError('design-handoff-invalid', check.issues.join('; '))
  const protectedFiles = (await Promise.all(PROJECT_DESIGN_PATHS.map(async path => {
    try { return [await readVersion(run.workspacePath, path)] }
    catch (error) {
      // Plain design records have no sidecar. The before/after revision still
      // detects a sidecar added or removed during capture. Documents are required.
      if (path.startsWith('.beegame/design-handoffs/') && (error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }))).flat()
  const after = checkDesignHandoff(run.workspacePath, PROJECT_DOCUMENTS)
  if (!after.valid || after.revision !== check.revision || !await versionsMatch(run.workspacePath, protectedFiles))
    throw new WorkflowError('design-baseline-changed', 'Design changed while recording its implementation baseline')
  return { revision: check.revision, digestVersion: check.digestVersion, protectedFiles, supportingFiles: check.evidenceHashes,
    registryRevision:registryRevision(run.workspacePath),
    capturedAt: new Date().toISOString(), attemptId: run.writer!.attemptId, requirementsRevision: run.requirements.revision }
}

export function designBaselineIssue(run: Run, required = false): string | undefined {
  if (!run.designBaseline) return required ? 'Implementation design baseline is missing; complete the existing implementation handoff before delivery.' : undefined
  const check = checkDesignHandoff(run.workspacePath, PROJECT_DOCUMENTS, { digestVersion: run.designBaseline.digestVersion })
  try {
    if(registryRevision(run.workspacePath)!==run.designBaseline.registryRevision)
      return 'Content registry routing differs from the locked implementation baseline; an explicit user design change is required.'
  }catch{return 'Content registry routing is unreadable; the implementation baseline is not current.'}
  if (!check.valid || check.revision !== run.designBaseline.revision)
    return 'Design differs from the locked implementation baseline; only an explicit user design change can authorize replanning.' +
      (check.issues.length ? ' ' + check.issues.join('; ') : '')
}

/** A visual editor save is exact user authorization, not permission for the
 * Agent to rewrite prose. Advance only that saved input, retaining every other
 * baseline input and the planning-file locks. Unrelated drift remains blocked. */
export async function baselineAfterSourceEdit(run: Run, edit: SourceEdit): Promise<Run['designBaseline']> {
  const baseline = run.designBaseline
  if (!baseline || edit.sourceEdit.status !== 'saved') return baseline
  if(registryRevision(run.workspacePath)!==baseline.registryRevision)return baseline
  const path = relative(run.workspacePath, resolve(run.workspacePath,edit.sourceEdit.path)).split('\\').join('/')
  if (!Object.hasOwn(baseline.supportingFiles, path) || !await versionsMatch(run.workspacePath, baseline.protectedFiles) ||
      (await readVersion(run.workspacePath, path)).sha256 !== edit.sourceEdit.after) return baseline
  const check = checkDesignHandoff(run.workspacePath, PROJECT_DOCUMENTS, { digestVersion: baseline.digestVersion })
  const changed = [...new Set([...Object.keys(baseline.supportingFiles), ...Object.keys(check.evidenceHashes)])]
    .filter(file => baseline.supportingFiles[file] !== check.evidenceHashes[file])
  if (!check.valid || changed.length !== 1 || changed[0] !== path) return baseline
  return { ...baseline, revision: check.revision, supportingFiles: check.evidenceHashes, sourceEditId: edit.attemptId }
}
