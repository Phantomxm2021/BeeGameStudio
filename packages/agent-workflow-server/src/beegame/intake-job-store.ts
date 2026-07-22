import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export type PersistedBeeGameIntakeJob = {
  ownerId: string
  runtimeId: string
  status: 'running' | 'completed' | 'failed'
  result?: unknown
  error?: string
  errorStatus?: number
  createdAt: number
  updatedAt: number
}

const JOB_TTL_MS = 30 * 60 * 1000

export async function saveBeeGameIntakeJob(
  dataRoot: string,
  jobId: string,
  job: PersistedBeeGameIntakeJob,
): Promise<void> {
  const path = resolveJobPath(dataRoot, jobId)
  await mkdir(join(dataRoot, 'intake-jobs'), { recursive: true })
  await writeFile(path, `${JSON.stringify(job)}\n`, 'utf8')
}

export async function loadBeeGameIntakeJob(
  dataRoot: string,
  jobId: string,
): Promise<PersistedBeeGameIntakeJob | undefined> {
  const path = resolveJobPath(dataRoot, jobId)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as PersistedBeeGameIntakeJob
    if (!parsed || typeof parsed !== 'object' || Date.now() - Number(parsed.updatedAt) > JOB_TTL_MS) {
      await rm(path, { force: true })
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

export async function deleteBeeGameIntakeJob(dataRoot: string, jobId: string): Promise<void> {
  await rm(resolveJobPath(dataRoot, jobId), { force: true })
}

function resolveJobPath(dataRoot: string, jobId: string): string {
  if (!jobId || basename(jobId) !== jobId || !jobId.startsWith('intake_')) {
    throw new Error('Invalid intake job id')
  }
  return join(dataRoot, 'intake-jobs', `${jobId}.json`)
}
