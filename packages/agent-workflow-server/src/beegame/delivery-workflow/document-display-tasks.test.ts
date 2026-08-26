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

  test('does not project a retryable worker failure as blocked user feedback', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'running',
      thinking: 'working',
      foundationAuditState: {
        status: 'semantic_review',
        tasks: [{
          kind: 'semantic',
          taskId: 'semantic:retry',
          checkId: 'retry',
          attempt: 1,
          status: 'retryable',
          failureReason: 'Failed to provide valid structured output after 5 attempts',
          dispatch: { status: 'failed' },
        }],
      } as never,
    })

    const retryable = tasks.find(task => task.id === 'semantic:retry')
    expect(retryable).toMatchObject({ status: 'pending' })
    expect(retryable).not.toHaveProperty('failureReason')
  })

  test('projects one ordinary revision task per affected document', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'running',
      thinking: 'working',
      foundationAuditState: {
        status: 'revising',
        issueSummary: { total: 4, blocker: 1, high: 1, medium: 1, low: 1 },
        activeBundleId: 'bundle-display',
        revisionBundles: [{ bundleId: 'bundle-display', status: 'active', round: 1, baseDocumentRevision: 'revision-1', baseDocumentDigests: [], remediationDigest: 'a'.repeat(64), taskIds: ['display-gdd', 'display-art', 'display-audio', 'display-facts', 'display-semantic'], frozenTaskIds: [] }],
        tasks: [
          { kind: 'document-revision', taskId: 'display-gdd', bundleId: 'bundle-display', documentPath: 'docs/GDD.md', status: 'completed', attempt: 2 },
          { kind: 'document-revision', taskId: 'display-art', bundleId: 'bundle-display', documentPath: 'docs/ART_DIRECTION.md', status: 'needs_action', attempt: 1, failureReason: 'blocked' },
          { kind: 'document-revision', taskId: 'display-audio', bundleId: 'bundle-display', documentPath: 'docs/AUDIO_DESIGN.md', status: 'pending', attempt: 0 },
          { kind: 'impacted-facts', taskId: 'display-facts', bundleId: 'bundle-display', status: 'completed', attempt: 1 },
          { kind: 'semantic-recheck', taskId: 'display-semantic', bundleId: 'bundle-display', issueId: 'ISSUE-1', status: 'pending', attempt: 0 },
        ],
      } as never,
    })

    expect(tasks.map(task => ({
      id: task.id,
      title: task.title,
      operation: task.operation,
      status: task.status,
      attempt: task.attempt,
      issueSummary: task.issueSummary,
      failureReason: task.failureReason,
    }))).toEqual([
      { id: 'revision:docs/GDD.md', title: 'docs/GDD.md', operation: 'revise', status: 'completed', attempt: 2, issueSummary: { total: 4, blocker: 1, high: 1, medium: 1, low: 1 }, failureReason: undefined },
      { id: 'revision:docs/ART_DIRECTION.md', title: 'docs/ART_DIRECTION.md', operation: 'revise', status: 'failed', attempt: 1, issueSummary: undefined, failureReason: 'blocked' },
      { id: 'revision:docs/AUDIO_DESIGN.md', title: 'docs/AUDIO_DESIGN.md', operation: 'revise', status: 'pending', attempt: 0, issueSummary: undefined, failureReason: undefined },
      { id: 'display-facts', title: '影响事实验证', operation: 'review', status: 'completed', attempt: 1, issueSummary: undefined, failureReason: undefined },
      { id: 'display-semantic', title: '定向语义验证 · ISSUE-1', operation: 'review', status: 'pending', attempt: 0, issueSummary: undefined, failureReason: undefined },
    ])
  })

  test('does not mix completed audit tasks into an active revision card', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'needs_action',
      foundationAuditState: {
        status: 'revising',
        activeBundleId: 'bundle-display',
        revisionBundles: [{ bundleId: 'bundle-display', status: 'active', round: 1, baseDocumentRevision: 'revision-1', baseDocumentDigests: [], remediationDigest: 'a'.repeat(64), taskIds: ['display-gdd'], frozenTaskIds: [] }],
        tasks: [
          { kind: 'document-facts', taskId: 'facts:gdd', status: 'completed', attempt: 1 },
          { kind: 'document-revision', taskId: 'display-gdd', bundleId: 'bundle-display', documentPath: 'docs/GDD.md', status: 'needs_action', attempt: 1 },
        ],
      } as never,
    })

    expect(tasks.map(task => task.id)).toEqual(['revision:docs/GDD.md'])
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

  test('projects an interrupted stopped review task as stopped even after retryable classification', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'stopped',
      foundationAuditState: {
        status: 'revising',
        activeBundleId: 'bundle-display',
        revisionBundles: [{ bundleId: 'bundle-display', status: 'active', round: 1, baseDocumentRevision: 'revision-1', baseDocumentDigests: [], remediationDigest: 'a'.repeat(64), taskIds: ['display-gdd'], frozenTaskIds: [] }],
        tasks: [{
          kind: 'document-revision',
          taskId: 'display-gdd',
          bundleId: 'bundle-display',
          documentPath: 'docs/GDD.md',
          status: 'retryable',
          attempt: 1,
          failureReason: 'user stopped workflow',
          dispatch: { status: 'interrupted' },
        }],
      } as never,
    })
    expect(tasks[0]).toMatchObject({
      status: 'stopped',
      operation: 'revise',
    })
  })

  test('does not let completed revision state replace checklist work', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'CHECKLIST_DRAFTING',
      foundationAuditState: { status: 'audit_ready', tasks: [] } as never,
    })

    expect(tasks.map(task => task.title)).toEqual([
      'docs/acceptance/gameplay-checklist.md',
    ])
  })

  test('does not display superseded revision evidence', async () => {
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      foundationAuditState: {
        status: 'revising',
        activeBundleId: 'bundle-new',
        revisionBundles: [
          { bundleId: 'bundle-old', status: 'superseded', round: 1, baseDocumentRevision: 'revision-1', baseDocumentDigests: [], remediationDigest: 'a'.repeat(64), taskIds: ['old-task'], frozenTaskIds: [] },
          { bundleId: 'bundle-new', status: 'active', round: 2, baseDocumentRevision: 'revision-1', baseDocumentDigests: [], remediationDigest: 'b'.repeat(64), taskIds: ['new-task'], frozenTaskIds: [] },
        ],
        tasks: [
          { kind: 'document-revision', taskId: 'old-task', bundleId: 'bundle-old', documentPath: 'docs/GDD.md', status: 'needs_action', attempt: 1 },
          { kind: 'document-revision', taskId: 'new-task', bundleId: 'bundle-new', documentPath: 'docs/ART_DIRECTION.md', status: 'pending', attempt: 0 },
        ],
      } as never,
    })
    expect(tasks.map(task => task.id)).toEqual(['revision:docs/ART_DIRECTION.md'])
  })

  test('projects fact evidence, round feedback, and severity summary without registry bodies', async () => {
    const usage = { input_tokens: 10, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 4, total_tokens: 14 }
    const tasks = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'running',
      foundationAuditState: {
        status: 'audit_ready',
        review: { issueSummary: { total: 4, blocker: 1, high: 1, medium: 1, low: 1 } },
        tasks: [{ kind: 'document-facts', taskId: 'facts:gdd', status: 'completed', attempt: 2, usage, durationMs: 321 }],
      } as never,
    })
    expect(tasks.find(task => task.id === 'facts:gdd')).toMatchObject({ status: 'completed', usage, durationMs: 321 })
    expect(tasks.find(task => task.id === 'audit:issues')).toMatchObject({ issueSummary: { total: 4, blocker: 1, high: 1, medium: 1, low: 1 } })
    expect(JSON.stringify(tasks)).not.toContain('Registry')
    expect(JSON.stringify(tasks)).not.toContain('raw issue body')

    const withoutRevision = projectDocumentDisplayTasks({
      workspacePath: await workspace(),
      documentStep: 'FOUNDATION_REVIEW',
      workflowStatus: 'running',
      foundationAuditState: {
        status: 'audit_ready',
        review: { issueSummary: { total: 2, blocker: 0, high: 0, medium: 1, low: 1 } },
        tasks: [],
      } as never,
    })
  })

})
