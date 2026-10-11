import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { ProjectDeliveryState } from './state'

function statePath(workspacePath: string, dataRoot: string): string {
  const absolute = resolve(workspacePath)
  const canonical = realpathSync.native(absolute)
  const identity = createHash('sha256').update(canonical).digest('hex')
  return join(dataRoot, 'project-delivery', identity, 'state.json')
}

export const projectDeliveryStatePath = statePath

const stateMutations = new Map<string, Promise<void>>()
export async function withStateMutation<T>(workspacePath: string, dataRoot: string, mutate: () => Promise<T>): Promise<T> {
  const key = statePath(workspacePath, dataRoot)
  const previous = stateMutations.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  const tail = previous.then(() => current)
  stateMutations.set(key, tail)
  await previous
  try { return await mutate() }
  finally {
    release()
    if (stateMutations.get(key) === tail) stateMutations.delete(key)
  }
}

export async function save(workspacePath: string, dataRoot: string, state: ProjectDeliveryState): Promise<void> {
  const path = statePath(workspacePath, dataRoot)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

export async function readProjectDelivery(workspacePath: string, dataRoot: string): Promise<ProjectDeliveryState | undefined> {
  let raw: string
  try { raw = await readFile(statePath(workspacePath, dataRoot), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value: unknown = JSON.parse(raw)
  if (value && typeof value === 'object' && (value as { version?: unknown }).version === 2)
    throw new Error('The Brief/playable production workflow was withdrawn. This project is preserved; no automatic migration or production restart is allowed.')
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (value as ProjectDeliveryState).version !== 1 ||
      typeof (value as ProjectDeliveryState).objective !== 'string' ||
      !['active', 'paused'].includes((value as ProjectDeliveryState).status))
    throw new Error('Invalid project delivery state')
  // One-time normalization for projects that were paused at the removed milestone.
  if ((value as { phase?: unknown }).phase === 'visual-review') {
    const { visualReviewApprovedDigest: _oldApproval, ...previous } = value as ProjectDeliveryState & { visualReviewApprovedDigest?: string }
    return { ...previous, phase: 'resources' }
  }
  return value as ProjectDeliveryState
}


