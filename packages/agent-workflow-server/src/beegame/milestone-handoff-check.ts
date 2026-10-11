import { readFile, realpath, open, rename, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import type { NativeProjectTurnInput } from '@bee-game-studio/agent-workflow/native-direction-authors'
import { readMilestoneResult, type MilestoneResult } from './milestone-result'
import { checkProductionDesign } from './delivery/design-protection'

// Receipt-local diagnostic memory, not a new design authority. It survives a
// native restart so malformed issue transport cannot be "fixed" by omission.
async function retainReportedIssueIds(receiptPath: string, reported: string[]) {
  const path = receiptPath + '.reported-issues.json'
  let previous: string[] = []
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      if (!(await file.stat()).isFile() || (await file.stat()).size > 1024 * 1024) throw Error('Invalid receipt issue diagnostic')
      const value = JSON.parse(await file.readFile('utf8'))
      if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id.trim())) throw Error('Invalid receipt issue diagnostic')
      previous = value
    } finally { await file.close() }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const ids = [...new Set([...previous, ...reported])]
  if (ids.length !== previous.length) {
    const temporary = path + '.' + randomUUID(), file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(JSON.stringify(ids)); await file.sync(); await file.close(); await rename(temporary, path) }
    finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}) }
  }
  return ids
}

/** Transport correctness at the BGS host boundary, never semantic acceptance.
 * Only the exact host-assigned file counts; no fuzzy filename/chat fallback. */
export async function checkSavedMilestoneResult(workspace: string, assigned: NativeProjectTurnInput['milestoneResult']): Promise<{
  status?: MilestoneResult['status']; issues: string[]; sourceRevision?: string; key?: string
} | undefined> {
  if (!assigned) return
  const root = await realpath(workspace)
  const directory = await realpath(dirname(assigned.path))
  const inside = (path: string) => {
    const part = relative(root, path)
    return !isAbsolute(part) && part !== '..' && !part.startsWith('../')
  }
  if (!inside(directory)) throw new Error('BGS milestone result must stay inside the current workspace.')
  const canonical = await realpath(assigned.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return resolve(directory, basename(assigned.path))
    throw error
  })
  if (!inside(canonical)) throw new Error('BGS milestone result must stay inside the current workspace.')
  if (canonical !== resolve(directory, basename(assigned.path)))
    throw new Error('BGS milestone result must use the exact assigned file, not a symbolic-link alias.')
  const result = await readMilestoneResult(assigned.path, assigned.phase)
  const issues = result ? result.validationIssues ?? [] : ['Current-turn milestone receipt is missing.']
  if (assigned.phase === 'resources' || assigned.phase === 'content') {
    const ids = await retainReportedIssueIds(canonical, result?.reportedIssueIds ?? [])
    if (!issues.length && result?.status === 'complete') {
      const retained = new Set([...(result.designIssues ?? []).map(issue => issue.id), ...(result.resolved ?? []).map(issue => issue.id)])
      const removed = ids.filter(id => !retained.has(id))
      if (removed.length) issues.push('Previously reported issues disappeared: ' + removed.join(', ') +
        '. Keep them in designIssues, or use resolved:[{id,disposition:"fixed"|"not-applicable",evidence:"concrete reason"}]. Moving an unresolved issue to summary is not resolution.')
    }
  }
  let sourceRevision: string | undefined
  if (!issues.length && result?.status === 'complete' && (assigned.phase === 'content' || assigned.phase === 'resources') && !assigned.designBaseline)
    issues.push(assigned.phase === 'content' ? 'Content handoff requires a reviewed design baseline.'
      : 'Resources handoff requires a reviewed design baseline.')
  if (!issues.length && result?.status === 'complete' && assigned.designBaseline) {
    const baseline = assigned.designBaseline
    if (assigned.phase === 'content') {
      // Layout initialization is async. Keep it behind this async completion
      // boundary rather than making the CLI's synchronous bootstrap async.
      const { checkContentResult } = await import('./delivery/stages/content')
      const checked = checkContentResult(root, { baseline, objective: assigned.objective ?? '' }, result)
      sourceRevision = checked.sourceRevision
      issues.push(...checked.issues)
    } else if (assigned.phase === 'resources') {
      const { checkResourceResult } = await import('./delivery/stages/resources')
      const checked = checkResourceResult(root, { baseline, objective: assigned.objective ?? '' }, result)
      sourceRevision = checked.sourceRevision
      issues.push(...checked.issues)
    } else if (assigned.phase !== 'author') {
      const checked = checkProductionDesign(root, baseline, assigned.phase)
      sourceRevision = checked.revision
      issues.push(...checked.issues)
    }
  }
  if (!issues.length) return { status: result!.status, issues, ...(sourceRevision ? { sourceRevision } : {}) }
  // Once the receipt is valid, progress belongs to saved sources, not its prose.
  // Otherwise rewriting a completion summary can re-arm the same failed check.
  const content = sourceRevision ? '' : await readFile(assigned.path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  return { issues, sourceRevision, key: JSON.stringify([assigned.phase, assigned.path, issues, sourceRevision,
    createHash('sha256').update(content).digest('hex')]) }
}
