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

  test('projects audit authority as three ordinary review tasks', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'running',
      thinking: 'working',
      foundationAuditState: {
        status: 'semantic_review',
        tasks: [
          { kind: 'semantic', taskId: 'semantic:ui', checkId: 'ui', attempt: 1, status: 'running' },
          { kind: 'semantic', taskId: 'semantic:audio', checkId: 'audio', attempt: 0, status: 'pending' },
        ],
      } as never,
    })

    expect(tasks.map(task => ({
      id: task.id,
      title: task.title,
      operation: task.operation,
      status: task.status,
    }))).toEqual([
      { id: 'audit:deterministic', title: '确定性检查', operation: 'review', status: 'completed' },
      { id: 'semantic:ui', title: '语义检查 · ui', operation: 'review', status: 'running' },
      { id: 'semantic:audio', title: '语义检查 · audio', operation: 'review', status: 'pending' },
      { id: 'audit:issues', title: '问题汇编', operation: 'review', status: 'pending' },
    ])
  })

  test('projects one ordinary revision task per affected document', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'running',
      thinking: 'working',
      foundationRevisionState: {
        tasks: [
          { kind: 'document-revision', documentPath: 'docs/GDD.md', status: 'completed', attempt: 2 },
          { kind: 'document-revision', documentPath: 'docs/ART_DIRECTION.md', status: 'needs_action', attempt: 1, failureReason: 'blocked' },
          { kind: 'document-revision', documentPath: 'docs/AUDIO_DESIGN.md', status: 'pending', attempt: 0 },
          { kind: 'impacted-facts', status: 'completed', attempt: 1 },
        ],
      } as never,
      foundationAuditState: {
        status: 'audit_ready',
        tasks: [],
      } as never,
    })

    expect(tasks.map(task => ({
      id: task.id,
      title: task.title,
      operation: task.operation,
      status: task.status,
      attempt: task.attempt,
      failureReason: task.failureReason,
    }))).toEqual([
      { id: 'audit:deterministic', title: '确定性检查', operation: 'review', status: 'completed', attempt: 0, failureReason: undefined },
      { id: 'audit:semantic', title: '语义检查', operation: 'review', status: 'completed', attempt: 0, failureReason: undefined },
      { id: 'audit:issues', title: '问题汇编', operation: 'review', status: 'completed', attempt: 0, failureReason: undefined },
      { id: 'revision:docs/GDD.md', title: 'docs/GDD.md', operation: 'revise', status: 'completed', attempt: 2, failureReason: undefined },
      { id: 'revision:docs/ART_DIRECTION.md', title: 'docs/ART_DIRECTION.md', operation: 'revise', status: 'failed', attempt: 1, failureReason: 'blocked' },
      { id: 'revision:docs/AUDIO_DESIGN.md', title: 'docs/AUDIO_DESIGN.md', operation: 'revise', status: 'pending', attempt: 0, failureReason: undefined },
      { id: 'impacted-facts:unknown', title: '影响事实验证', operation: 'review', status: 'completed', attempt: 1, failureReason: undefined },
    ])
  })

  test('keeps audit work that has not started pending when stopped', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'stopped',
      foundationAuditState: {
        status: 'index_staged',
        tasks: [],
      } as never,
    })

    expect(tasks.map(task => task.status)).toEqual([
      'pending',
      'pending',
      'pending',
    ])
  })

  test('does not let completed revision state replace checklist work', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'CHECKLIST_DRAFTING',
      foundationRevisionState: { tasks: [] } as never,
    })

    expect(tasks.map(task => task.title)).toEqual([
      'docs/acceptance/gameplay-checklist.md',
    ])
  })

  test('projects fact evidence, round feedback, severity summary, and known issue count without registry bodies', async () => {
    const usage = { input_tokens: 10, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 4, total_tokens: 14 }
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'running',
      foundationAuditState: {
        status: 'audit_ready',
        review: { issueSummary: { total: 4, blocker: 1, high: 1, medium: 1, low: 1 }, knownIssueIds: ['known-1', 'known-2'] },
        tasks: [{ kind: 'document-facts', taskId: 'facts:gdd', status: 'completed', attempt: 2, usage, durationMs: 321 }],
      } as never,
      foundationRevisionState: {
        knownIssueIds: ['known-1', 'known-2'],
        issueSummary: { total: 4, blocker: 1, high: 1, medium: 1, low: 1 },
        tasks: [{ kind: 'document-revision', documentPath: 'docs/GDD.md', status: 'running', attempt: 1, round: 2, usage, durationMs: 654 }],
      } as never,
    })
    expect(tasks.find(task => task.id === 'facts:gdd')).toMatchObject({ status: 'completed', usage, durationMs: 321 })
    expect(tasks.find(task => task.id === 'audit:issues')).toMatchObject({ issueSummary: { total: 4, blocker: 1, high: 1, medium: 1, low: 1 } })
    expect(tasks.find(task => task.id === 'revision:docs/GDD.md')).toMatchObject({ round: 2, knownIssueCount: 2, usage, durationMs: 654 })
    expect(JSON.stringify(tasks)).not.toContain('Registry')
    expect(JSON.stringify(tasks)).not.toContain('raw issue body')

    const withoutRevision = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'running',
      foundationAuditState: {
        status: 'audit_ready',
        review: { issueSummary: { total: 2, blocker: 0, high: 0, medium: 1, low: 1 }, knownIssueIds: ['known-1', 'known-2'] },
        tasks: [],
      } as never,
    })
    expect(withoutRevision.find(task => task.id === 'audit:issues')).toMatchObject({ knownIssueCount: 2 })
  })

})
