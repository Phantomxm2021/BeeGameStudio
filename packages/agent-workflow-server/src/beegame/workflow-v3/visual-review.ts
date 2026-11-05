// Stored history only. Current visual production does not execute an image reviewer.
import type { DesignReviewDisposition } from './design-review'

export type VisualReviewFinding = {
  category: 'coverage' | 'function' | 'mutual-exclusion' | 'presentation'
  state: string
  issue: string
  evidence: string
}
export type VisualReviewReport = {
  summary: string
  coverage: Array<{ state: string; source: string; representation: string }>
  findings: VisualReviewFinding[]
  resolutions?: DesignReviewDisposition[]
}
export type VisualReviewFile = { path: string; sha256: string }
export type VisualReviewBaseline = { path: 'docs/GDD.md'; sha256: string; text: string }
export type VisualReviewReceipt = {
  source: { path: 'docs/GDD.md'; sha256: string }
  baseline: { path: 'docs/GDD.md'; sha256: string }
  files: VisualReviewFile[]
  nativeThreadId: string
  nativeTurnId: string
  startedAt: string
  finishedAt: string
  summary: string
  authorResponses?: DesignReviewDisposition[]
  report: VisualReviewReport
}
