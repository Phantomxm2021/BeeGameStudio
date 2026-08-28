import { mkdir, readFile, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const CHECKLIST_PATH = 'docs/acceptance/gameplay-checklist.md'

export function checklistCandidatePath(dispatchId: string): string {
  return `.beegame/workflow/checklist-candidates/${dispatchId}.md`
}

export async function readChecklistCandidate(input: {
  workspacePath: string
  candidatePath: string
}): Promise<string> {
  return readFile(assertChecklistCandidatePath(input.workspacePath, input.candidatePath), 'utf8')
}

export async function commitChecklistCandidate(input: {
  workspacePath: string
  candidatePath: string
}): Promise<void> {
  const candidate = assertChecklistCandidatePath(input.workspacePath, input.candidatePath)
  const canonical = resolve(input.workspacePath, CHECKLIST_PATH)
  await mkdir(dirname(canonical), { recursive: true })
  await rename(candidate, canonical)
}

function assertChecklistCandidatePath(workspacePath: string, candidatePath: string): string {
  const expectedRoot = `${resolve(workspacePath, '.beegame/workflow/checklist-candidates')}/`
  const absolute = resolve(workspacePath, candidatePath)
  if (!absolute.startsWith(expectedRoot) || !absolute.endsWith('.md'))
    throw new Error('checklist candidate path is invalid')
  return absolute
}
