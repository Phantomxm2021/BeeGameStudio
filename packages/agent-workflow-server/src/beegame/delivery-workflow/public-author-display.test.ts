import { describe, expect, test } from 'bun:test'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { projectPublicAuthorDisplay } from './public-author-display'

const digest = 'a'.repeat(64)
const handle = {
  protocolVersion: 1,
  producer: 'foundation-authoring',
  id: '550e8400-e29b-41d4-a716-446655440000',
}

function link(status: string, result?: Record<string, unknown>) {
  return {
    protocolVersion: 1,
    requestId: 'author-request',
    inputDigest: digest,
    status,
    handle,
    control: { sequence: 1, action: 'run', requestId: 'author-request' },
    ...(result ? { result } : {}),
  }
}

function completedResult() {
  return {
    protocolVersion: 1,
    producer: 'foundation-authoring',
    kind: 'foundation_documents',
    resultId: 'b'.repeat(64),
    inputDigest: digest,
    ownerId: 'owner',
    projectId: 'project',
    confirmedBriefDigest: 'c'.repeat(64),
    documents: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
      path,
      digest,
      byteLength: 10,
      artifactPath: `.beegame/workflow/foundation-authoring/artifacts/${'b'.repeat(64)}/${path}`,
    })),
    documentRevision: 'document-revision',
    workspaceRevision: 'workspace-revision',
    receiptSetDigest: 'd'.repeat(64),
  }
}

describe('public author display projection', () => {
  test('does not project absent or malformed author links', () => {
    expect(projectPublicAuthorDisplay(undefined)).toBeUndefined()
    expect(projectPublicAuthorDisplay({ protocolVersion: 1, status: 'completed' })).toBeUndefined()
    expect(projectPublicAuthorDisplay(link('completed', { ...completedResult(), resultId: 'invalid' }))).toBeUndefined()
  })

  test('uses one aggregate task while authoring and never exposes private progress', () => {
    const display = projectPublicAuthorDisplay(link('running'))
    expect(display).toEqual({
      completed: false,
      tasks: [{ id: 'author:foundation', title: 'Foundation documents', status: 'running', attempt: 0, operation: 'write' }],
    })
    expect(display?.tasks).not.toHaveLength(CANONICAL_FOUNDATION_DOCUMENTS.length)
  })

  test('projects exactly eight completed public document tasks', () => {
    const display = projectPublicAuthorDisplay(link('completed', completedResult()))
    expect(display?.completed).toBe(true)
    expect(display?.tasks).toHaveLength(8)
    expect(display?.tasks.map(task => ({ id: task.id, status: task.status, operation: task.operation }))).toEqual(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ id: path, status: 'completed', operation: 'write' })),
    )
  })

  test('does not claim completion for a malformed or incomplete result', () => {
    const malformed = completedResult()
    malformed.documents = malformed.documents.slice(0, 7)
    expect(projectPublicAuthorDisplay(link('completed', malformed))).toBeUndefined()
    expect(projectPublicAuthorDisplay(link('needs_action'))?.tasks[0]?.status).toBe('failed')
    expect(projectPublicAuthorDisplay(link('stopped'))?.tasks[0]?.status).toBe('stopped')
  })

  test('requires result input binding and handles for accepted author work', () => {
    expect(projectPublicAuthorDisplay(link('completed', {
      ...completedResult(), inputDigest: 'e'.repeat(64),
    }))).toBeUndefined()
    for (const status of ['running', 'needs_action']) {
      expect(projectPublicAuthorDisplay({ ...link(status), handle: undefined })).toBeUndefined()
    }
    expect(projectPublicAuthorDisplay({ ...link('starting'), handle: undefined })?.completed).toBe(false)
  })
})
