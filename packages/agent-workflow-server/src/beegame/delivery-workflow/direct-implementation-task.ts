import type { ImplementationTask } from './types'

export function directImplementationTask(input: {
  checklistIds: string[]
  resourceIds: string[]
  contentIds: string[]
}): ImplementationTask {
  return {
    id: 'DIRECT_IMPLEMENTATION',
    title: 'Implement the accepted documents, content and resources',
    checklistIds: [...input.checklistIds],
    resourceIds: [...input.resourceIds],
    contentIds: [...input.contentIds],
    allowedPaths: ['./'],
    status: 'pending',
    attempt: 0,
    evidenceRefs: [],
  }
}
