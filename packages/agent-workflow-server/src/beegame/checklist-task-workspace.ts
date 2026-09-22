import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checklistCandidatePath } from './checklist-candidate'
import { buildWorkerPrompt } from './delivery-workflow/worker-prompts'
import type { WorkerDispatchRequest } from './delivery-workflow/types'

/** Checklist is a file-producing task, not a restricted set of editing tools. */
export async function prepareChecklistTask(request: WorkerDispatchRequest, authority: string) {
  if (!request.dispatchId || /[\\/]/.test(request.dispatchId) || request.allowedPaths?.length !== 1 ||
      request.allowedPaths[0] !== checklistCandidatePath(request.dispatchId))
    throw new Error('Checklist candidate must belong to this dispatch')
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'bgs-checklist-')))
  try {
    await writeFile(join(workspacePath, 'authority.md'), authority, { flag: 'wx', mode: 0o400 })
  } catch (error) { await rm(workspacePath, { recursive: true, force: true }); throw error }
  const { checklistAuthority: _authority, ...contract } = request.contract
  return {
    workspacePath,
    readOnlyPaths: ['authority.md'],
    prompt: [
      'Read authority.md for the frozen Checklist inputs. Choose tools, local checks and delegation as needed. Intermediate files may be created in this task workspace. Only checklist.md is collected as the candidate; BGS validates it before publication.',
      buildWorkerPrompt({ ...request, workspacePath, allowedPaths: ['checklist.md'],
        contract: { ...contract, checklistCandidatePath: 'checklist.md' } }),
    ].join('\n\n'),
  }
}

export async function collectChecklistTask(request: WorkerDispatchRequest, task: { workspacePath: string }) {
  if (!request.dispatchId || /[\\/]/.test(request.dispatchId) || request.allowedPaths?.[0] !== checklistCandidatePath(request.dispatchId))
    throw new Error('Checklist candidate must belong to this dispatch')
  const source = join(task.workspacePath, 'checklist.md')
  const stat = await lstat(source)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw new Error('Checklist output must be a regular task file')
  const content = await readFile(source, 'utf8')
  if (!content.trim()) throw new Error('Checklist output is empty')
  const root = await realpath(request.workspacePath)
  const target = join(root, checklistCandidatePath(request.dispatchId))
  await mkdir(dirname(target), { recursive: true })
  if (await realpath(dirname(target)) !== dirname(target))
    throw new Error('Checklist candidate directory must not use symbolic links')
  // Unique dispatch candidate, never the canonical accepted checklist.
  await writeFile(target, content, { flag: 'wx', mode: 0o600 })
}
