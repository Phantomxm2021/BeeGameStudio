import { readFile } from 'node:fs/promises'

/** Explicit Agent conclusion, not a quality judgment inferred from chat text. */
export type MilestoneResult = {
  phase: 'review' | 'implementation'
  status: 'complete' | 'blocked'
  summary: string
}

export async function readMilestoneResult(path: string, phase: MilestoneResult['phase']): Promise<MilestoneResult | undefined> {
  try {
    const [status, ...lines] = (await readFile(path, 'utf8')).trim().split(/\r?\n/)
    if (status !== 'complete' && status !== 'blocked') return undefined
    const summary = lines.join('\n').trim()
    if (status === 'blocked' && !summary) return undefined
    return { phase, status, summary }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
