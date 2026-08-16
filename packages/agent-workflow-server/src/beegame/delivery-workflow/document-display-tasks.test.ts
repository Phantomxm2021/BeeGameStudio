import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  projectAssetDisplayTasks,
  projectDocumentDisplayTasks,
} from './document-display-tasks'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  )
})

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'display-tasks-'))
  roots.push(root)
  return root
}

describe('workflow display tasks', () => {
  test('projects the four resource tasks from the durable cursor', async () => {
    const tasks = projectAssetDisplayTasks({
      workspacePath: await workspace(),
      phase: 'RESOURCE_PREPARATION',
      workflowStatus: 'running',
      thinking: 'working',
      activeDispatch: {
        workerType: 'resource-content-author',
        status: 'running',
      },
      resourceProductionTask: 'RESOURCE_CONTENT',
    })
    expect(tasks.map(task => task.status)).toEqual([
      'completed',
      'completed',
      'running',
      'pending',
    ])
  })

  test('projects parallel foundation authoring from durable document states', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_DRAFTING',
      workflowStatus: 'running',
      thinking: 'working',
      foundationDocuments: [
        { path: 'docs/GDD.md', status: 'committed' },
        { path: 'docs/LEVEL_SCENE_DESIGN.md', status: 'drafting' },
      ],
    })
    expect(tasks.slice(0, 2).map(task => task.status)).toEqual([
      'completed',
      'running',
    ])
  })

  test('projects Reviewer roles instead of retired checks and packets', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'running',
      thinking: 'working',
      reviewReports: [
        { role: 'brief-and-gameplay', status: 'completed' },
        { role: 'cross-document-consistency', status: 'running' },
        { role: 'final', status: 'pending' },
      ],
    })
    expect(tasks).toEqual([
      {
        id: 'brief-and-gameplay',
        title: 'brief-and-gameplay',
        status: 'completed',
        attempt: 0,
        operation: 'review',
      },
      {
        id: 'cross-document-consistency',
        title: 'cross-document-consistency',
        status: 'running',
        attempt: 0,
        operation: 'review',
      },
      {
        id: 'final',
        title: 'final',
        status: 'pending',
        attempt: 0,
        operation: 'review',
      },
    ])
  })

})
