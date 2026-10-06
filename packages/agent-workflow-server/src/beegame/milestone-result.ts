import { readFile } from 'node:fs/promises'
import { designReviewResultSchema, type DesignReviewResult } from './design-handoff'

/** Explicit Agent conclusion, not a quality judgment inferred from chat text. */
export type MilestoneResult = {
  phase: 'author' | 'review' | 'implementation'
  status: 'complete' | 'blocked'
  summary: string
  review?: DesignReviewResult
  validationIssues?: string[]
}

export async function readMilestoneResult(path: string, phase: MilestoneResult['phase']): Promise<MilestoneResult | undefined> {
  try {
    const [status, ...lines] = (await readFile(path, 'utf8')).trim().split(/\r?\n/)
    if (status !== 'complete' && status !== 'blocked') return undefined
    const summary = lines.join('\n').trim()
    if (status === 'blocked' && !summary) return undefined
    if (phase === 'review') {
      let value: unknown
      try { value = JSON.parse(summary) } catch {
        return { phase, status, summary, validationIssues: ['Review receipt must contain JSON after its status line.'] }
      }
      const parsed = designReviewResultSchema.safeParse(value)
      if (!parsed.success) return { phase, status, summary, validationIssues: parsed.error.issues.map(issue =>
        `Review receipt ${issue.path.join('.') || 'review'}: ${issue.message}`) }
      return { phase, status, summary, review: parsed.data }
    }
    return { phase, status, summary }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined
    throw error
  }
}
