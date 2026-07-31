import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectDocumentDisplayTasks } from './document-display-tasks'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
} from './types'

const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

describe('document workflow display tasks', () => {
  test('uses filesystem completion only while authoring documents', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-display-'))
    workspaces.push(workspacePath)
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await writeFile(join(workspacePath, 'docs/GDD.md'), '# GDD\n')

    const tasks = projectDocumentDisplayTasks({
      workspacePath,
      documentStep: 'FOUNDATION_DRAFTING',
      workflowStatus: 'running',
      thinking: 'working',
    })

    expect(tasks[0]).toMatchObject({
      id: 'docs/GDD.md',
      status: 'completed',
      operation: 'write',
    })
    expect(tasks.slice(1).every(task => task.status === 'pending')).toBe(true)
  })

  test('starts a separate review checklist instead of reusing authored file status', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-review-'))
    workspaces.push(workspacePath)
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await Promise.all(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path =>
        writeFile(join(workspacePath, path), `# ${path}\n`),
      ),
    )

    const tasks = projectDocumentDisplayTasks({
      workspacePath,
      documentStep: 'FOUNDATION_REVIEW',
      currentItemId: 'docs/TECHNICAL_DESIGN.md',
      reviewedDocumentPaths: ['docs/GDD.md'],
      workflowStatus: 'running',
      thinking: 'working',
    })

    expect(tasks).toHaveLength(6)
    expect(tasks[0]).toMatchObject({
      id: 'docs/GDD.md',
      status: 'completed',
      operation: 'review',
    })
    expect(tasks[1]).toMatchObject({
      id: 'docs/TECHNICAL_DESIGN.md',
      status: 'running',
      operation: 'review',
    })
    expect(tasks.slice(2).every(task => task.status === 'pending')).toBe(true)
  })

  test('projects all eight canonical artifacts for the comprehensive review', () => {
    const workspacePath = workspaces[0] ?? '/tmp/document-review-display'
    const tasks = projectDocumentDisplayTasks({
      workspacePath,
      documentStep: 'CHECKLIST_REVIEW',
      reviewedDocumentPaths: [CANONICAL_ASSET_MANIFEST],
      workflowStatus: 'running',
      thinking: 'working',
    })

    expect(tasks.map(task => task.id)).toEqual([
      ...CANONICAL_PROJECT_DOCUMENTS,
      CANONICAL_ASSET_MANIFEST,
    ])
    expect(tasks).toHaveLength(8)
    expect(tasks.at(-1)).toMatchObject({
      id: CANONICAL_ASSET_MANIFEST,
      status: 'completed',
      operation: 'review',
    })
  })
})
