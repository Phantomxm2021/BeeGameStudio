import type { Message } from 'src/types/message.js'

export type CommittedCollapse = {
  collapseId: string
  summaryUuid: string
  summaryContent: string
  summary: string
  firstArchivedUuid: string
  lastArchivedUuid: string
}

export function createCollapsePlaceholder(commit: CommittedCollapse): Message {
  return {
    uuid: commit.summaryUuid,
    type: 'system',
    subtype: 'context_collapse',
    timestamp: new Date().toISOString(),
    message: {
      role: 'system',
      content: commit.summaryContent,
    },
    isMeta: true,
  } as Message
}

export function projectView(
  messages: Message[],
  commits: readonly CommittedCollapse[] = [],
): Message[] {
  if (commits.length === 0) return messages
  const byStart = new Map(
    commits.map(commit => [commit.firstArchivedUuid, commit]),
  )
  const projected: Message[] = []
  let skippingUntil: string | null = null

  for (const message of messages) {
    if (skippingUntil) {
      if (message.uuid === skippingUntil) skippingUntil = null
      continue
    }
    const commit = byStart.get(message.uuid)
    if (commit) {
      projected.push(createCollapsePlaceholder(commit))
      if (commit.lastArchivedUuid !== message.uuid) {
        skippingUntil = commit.lastArchivedUuid
      }
      continue
    }
    projected.push(message)
  }

  return projected
}
