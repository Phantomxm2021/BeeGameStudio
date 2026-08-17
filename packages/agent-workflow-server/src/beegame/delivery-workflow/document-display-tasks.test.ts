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

  test('projects Foundation review lanes and synthesis as ordinary tasks', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'running',
      thinking: 'working',
      foundationReview: {
        mode: 'initial',
        attempt: 1,
        reports: [
          { role: 'core-design', status: 'completed' },
          { role: 'technical-assets', status: 'running' },
          { role: 'presentation', status: 'running' },
          { role: 'synthesis', status: 'pending' },
        ],
      },
    })
    expect(tasks.map(task => [task.title, task.status])).toEqual([
      ['核心设计', 'completed'],
      ['技术与资产', 'running'],
      ['表现体验', 'running'],
      ['阻塞问题汇总', 'pending'],
    ])
  })

  test('projects repair lanes and targeted verification as ordinary tasks', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'running',
      thinking: 'working',
      foundationReview: {
        mode: 'verification',
        attempt: 2,
        reports: [
          { role: 'core-design', status: 'pending' },
          { role: 'technical-assets', status: 'pending' },
          { role: 'presentation', status: 'pending' },
          { role: 'synthesis', status: 'pending' },
        ],
      },
      foundationRemediationLanes: [
        { id: 'gdd', status: 'completed' },
        { id: 'technical-design', status: 'not_required' },
        {
          id: 'art-direction',
          status: 'failed',
          failureReason: '表现修订失败',
        },
      ],
    })

    expect(tasks.map(task => [task.title, task.status])).toEqual([
      ['修订 GDD', 'completed'],
      ['修订技术设计', 'completed'],
      ['修订美术方向', 'failed'],
      ['修订结果', 'pending'],
    ])
    expect(tasks[2].failureReason).toBe('表现修订失败')
  })
})
