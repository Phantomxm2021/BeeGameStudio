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

})
