import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationAuthoringContext } from '../types'
import { foundationAuthoringSources } from '../foundation-authoring-contract'
import { buildFoundationAuthorPrompt } from '../foundation-authoring-prompt'
import { buildFoundationAuthorDispatchRequest } from '../foundation-authoring-request'
import { beginParallelFoundationAuthoring, readyDraftPaths, MAX_PARALLEL_FOUNDATION_DRAFTS } from '../foundation-authoring-batch'
import { foundationMarkdownPendingPath } from '../foundation-markdown-stream'
import { foundationProjectionRelativePath } from '../foundation-authority-projection'
import { computeWorkspaceRevision } from '../revision'
import { commitAuthoredFoundationDocument, readAuthoredDocumentReceipt } from '../authored-document-receipt'
import { buildFoundationAuthorAuthorityBlock } from '../foundation-authoring-input'

const brief = 'fixed authoring brief'
const digest = createHash('sha256').update(brief).digest('hex')
const run = (): FoundationAuthoringContext => ({ runId: 'run', ownerId: 'owner', projectId: 'project', confirmedBriefDigest: digest, confirmedBriefContext: brief, phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING', status: 'running', foundationDraftState: { completedPaths: [] }, updatedAt: '2026-09-05T00:00:00.000Z', revision: { document: 'doc', workspace: 'workspace' } })

describe('private foundation author domain', () => {
  test('retains canonical dependency graph and frozen concurrency', () => {
    expect(CANONICAL_FOUNDATION_DOCUMENTS).toHaveLength(8)
    expect(MAX_PARALLEL_FOUNDATION_DRAFTS).toBe(4)
    const state = beginParallelFoundationAuthoring([CANONICAL_FOUNDATION_DOCUMENTS[0]])
    expect(readyDraftPaths(state)).toEqual(['docs/LEVEL_SCENE_DESIGN.md'])
    expect(foundationAuthoringSources('docs/ASSET_PLAN.md').map(value => value.path)).toEqual(['docs/GDD.md','docs/LEVEL_SCENE_DESIGN.md','docs/TECHNICAL_DESIGN.md','docs/ART_DIRECTION.md','docs/UI_UX_SPEC.md','docs/AUDIO_DESIGN.md'])
  })
  test('builds the same author request shape without a DeliveryRun', () => {
    const request = buildFoundationAuthorDispatchRequest({ run: run(), workspacePath: '/tmp/work', dispatchId: 'dispatch', path: 'docs/GDD.md' })
    expect(request.workerType).toBe('document-author')
    expect(request.allowedPaths).toEqual(['docs/GDD.md'])
    expect(request.contract.authoringMode).toBe('initial')
    expect(buildFoundationAuthorPrompt(request)).toContain('Return Markdown, without a wrapper fence')
  })
  test('uses only author namespace for mutable and immutable artifacts', () => {
    expect(foundationMarkdownPendingPath('/tmp/work', 'run', 'dispatch')).toBe('/tmp/work/.beegame/workflow/foundation-authoring/pending-documents/run/dispatch.md')
    expect(foundationProjectionRelativePath('dispatch')).toBe('.beegame/workflow/foundation-authoring/projections/dispatch.json')
  })
  test('author workspace hash ignores private workflow writes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'author-domain-hash-'))
    await mkdir(join(workspace, '.beegame/workflow/foundation-authoring'), { recursive: true })
    await writeFile(join(workspace, 'docs.txt'), 'stable')
    const before = await computeWorkspaceRevision(workspace)
    await writeFile(join(workspace, '.beegame/workflow/foundation-authoring/receipt.json'), 'private')
    expect(await computeWorkspaceRevision(workspace)).toBe(before)
  })
  test('prompt rejects removed retry contract', () => {
    const request = buildFoundationAuthorDispatchRequest({ run: run(), workspacePath: '/tmp/work', dispatchId: 'dispatch', path: 'docs/GDD.md' })
    request.contract.priorFailureReason = 'old failure'
    expect(() => buildFoundationAuthorPrompt(request)).toThrow('retry contract is removed')
  })
  test('foreign receipt identity is rejected', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'author-foreign-receipt-'))
    const request = buildFoundationAuthorDispatchRequest({ run: run(), workspacePath: workspace, dispatchId: 'dispatch', path: 'docs/GDD.md' })
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await buildFoundationAuthorAuthorityBlock(request)
    await commitAuthoredFoundationDocument({ workspacePath: workspace, dispatchId: 'dispatch', targetPath: 'docs/GDD.md', authoredBody: '# Game Design Document\n', updatedAt: '2026-09-05T00:00:00.000Z' })
    const receiptPath = join(workspace, '.beegame/workflow/foundation-authoring/receipts/dispatch.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    receipt.dispatchId = 'foreign'
    await writeFile(receiptPath, JSON.stringify(receipt))
    await expect(readAuthoredDocumentReceipt(workspace, 'dispatch')).rejects.toThrow('receipt is invalid')
  })
})
