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

  test('leaves public reviewer and revision display to the stage-card projection', async () => {
    for (const documentStep of ['FOUNDATION_REVIEW'] as const) {
      expect(
        projectDocumentDisplayTasks({
          workspacePath: await workspace(),
          documentStep,
          workflowStatus: 'running',
          thinking: 'working',
        }),
      ).toEqual([])
    }
  })

  test('keeps checklist authoring independent of public review state', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'CHECKLIST_DRAFTING',
    })

    expect(tasks.map(task => task.title)).toEqual([
      'docs/acceptance/gameplay-checklist.md',
    ])
  })

})
