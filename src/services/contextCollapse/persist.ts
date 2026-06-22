import type {
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
} from 'src/types/logs.js'
import { restoreContextCollapseState } from './index.js'

export function restoreFromEntries(
  commits: ContextCollapseCommitEntry[],
  _snapshot?: ContextCollapseSnapshotEntry,
): void {
  restoreContextCollapseState(
    commits.map(entry => ({
      collapseId: entry.collapseId,
      summaryUuid: entry.summaryUuid,
      summaryContent: entry.summaryContent,
      summary: entry.summary,
      firstArchivedUuid: entry.firstArchivedUuid,
      lastArchivedUuid: entry.lastArchivedUuid,
    })),
  )
}
