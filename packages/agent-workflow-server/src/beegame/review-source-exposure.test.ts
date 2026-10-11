import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { ReviewSourceExposure } from './review-source-exposure'
import type { NativeProjectTurnInput } from '@bee-game-studio/agent-workflow/native-direction-authors'

async function fixture(run: (root: string, exposure: ReviewSourceExposure) => Promise<void>, scope?: Record<string, string[] | null>) {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-review-exposure-test-'))
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'docs/GDD.md'), '# Rules\nMove with keys.\n## End\nStop at goal.\n')
  const turn: NativeProjectTurnInput = { reviewDocuments: ['GDD.md'], reviewReadScope: scope }
  try { await run(root, await ReviewSourceExposure.create(root, turn)) }
  finally { await rm(root, { recursive: true, force: true }) }
}
async function read(root: string, exposure: ReviewSourceExposure, start = 1, limit = Infinity, truncated = false, stale?: string) {
  const path = join(root, 'docs/GDD.md'), body = stale ?? await readFile(path, 'utf8')
  const lines = body.split('\n'), content = lines.slice(start - 1, start - 1 + limit).join('\n')
  const id = 'read-' + Math.random()
  await exposure.observe({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: path, offset: start, ...(Number.isFinite(limit) ? { limit } : {}) } }] } })
  await exposure.observe({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id,
    content: truncated ? 'Stored output; inspect it separately.' : content.split('\n').map((line, i) => (start + i) + '\t' + line).join('\n') }] },
    tool_use_result: { type: 'text', file: { filePath: path, content, startLine: start, numLines: content.split('\n').length, totalLines: lines.length } } })
}

test('host exposure requires real Read output visible to the model, not SDK-only or inherited reads', () => fixture(async (root, exposure) => {
  expect((await exposure.check()).missing.length).toBeGreaterThan(0)
  await read(root, exposure, 1, Infinity, true)
  expect((await exposure.check()).missing.length).toBeGreaterThan(0)
  await read(root, exposure)
  expect((await exposure.check()).missing).toEqual([])
}))

test('workspace directory aliases count the actual saved Read, but a symlinked source document never counts', () => fixture(async (root, exposure) => {
  await symlink(join(root, 'docs'), join(root, 'alias-docs'))
  const path = join(root, 'alias-docs/GDD.md'), body = await readFile(path, 'utf8')
  await exposure.observe({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'alias', name: 'Read', input: { file_path: path } }] } })
  await exposure.observe({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'alias',
    content: body.split('\n').map((line, i) => (i + 1) + '\t' + line).join('\n') }] },
    tool_use_result: { type: 'text', file: { filePath: join(root, 'docs/GDD.md'), content: body,
      startLine: 1, numLines: body.split('\n').length, totalLines: body.split('\n').length } } })
  expect((await exposure.check()).missing).toEqual([])
  await writeFile(join(root, 'other.md'), body)
  await rm(join(root, 'docs/GDD.md')); await symlink(join(root, 'other.md'), join(root, 'docs/GDD.md'))
  await read(root, exposure)
  expect((await exposure.check()).missing).toEqual(['docs/GDD.md'])
}))

test('chunked source reads complete the same review without forcing one monolithic reread', () => fixture(async (root, exposure) => {
  await read(root, exposure, 1, 2)
  expect((await exposure.check()).missing.join(',')).toContain(':3-5')
  await read(root, exposure, 3, 3)
  expect((await exposure.check()).missing).toEqual([])
}))

test('stale source outputs do not certify the newly saved document', () => fixture(async (root, exposure) => {
  const old = await readFile(join(root, 'docs/GDD.md'), 'utf8')
  await writeFile(join(root, 'docs/GDD.md'), old.replace('Move with keys.', 'Move with touch.'))
  await read(root, exposure, 1, Infinity, false, old)
  expect((await exposure.check()).missing.length).toBeGreaterThan(0)
  await read(root, exposure)
  expect((await exposure.check()).missing).toEqual([])
}))

test('selected clauses are sufficient until another section actually changes', () => fixture(async (root, exposure) => {
  await read(root, exposure, 3, 3)
  expect((await exposure.check()).missing).toEqual([])
  await writeFile(join(root, 'docs/GDD.md'), '# Rules\nChanged control.\n## End\nStop at goal.\n')
  expect((await exposure.check()).missing.join(',')).toContain(':1-2')
  await read(root, exposure, 1, 2)
  expect((await exposure.check()).missing).toEqual([])
}, { 'GDD.md': ['End'] }))

test('renamed headings fall back to resulting-source ranges and still accept chunked inspection', () => fixture(async (root, exposure) => {
  await writeFile(join(root, 'docs/GDD.md'), '# Renamed\nMove with keys.\n## End\nStop at goal.\n')
  await read(root, exposure, 3, 3)
  expect((await exposure.check()).missing.join(',')).toContain(':1-2')
  await read(root, exposure, 1, 2)
  expect((await exposure.check()).missing).toEqual([])
}, { 'GDD.md': ['End'] }))

test('known successful exact edits preserve full inspection; Write and external changes do not', () => fixture(async (root, exposure) => {
  await read(root, exposure)
  const path = join(root, 'docs/GDD.md'), original = await readFile(path, 'utf8'), next = original.replace('keys', 'touch')
  const input = { file_path: path, old_string: 'keys', new_string: 'touch' }
  await exposure.observe({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'edit', name: 'Edit', input }] } })
  await writeFile(path, next)
  await exposure.observe({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'edit', content: 'Saved.' }] },
    tool_use_result: { filePath: path, originalFile: original, oldString: 'keys', newString: 'touch', userModified: false, replaceAll: false } })
  expect((await exposure.check()).missing).toEqual([])
  await writeFile(path, next.replace('touch', 'pointer'))
  expect((await exposure.check()).missing.length).toBeGreaterThan(0)
}))

test('source exposure survives host restart without certifying different saved bytes', () => fixture(async (root, exposure) => {
  await read(root, exposure, 1, 2)
  const restarted = await ReviewSourceExposure.create(root, { reviewDocuments: ['GDD.md'] }, JSON.parse(JSON.stringify(exposure.state)))
  await read(root, restarted, 3, 3)
  expect((await restarted.check()).missing).toEqual([])
  await writeFile(join(root, 'docs/GDD.md'), '# Rules\nDifferent rule.\n## End\nStop at goal.\n')
  expect((await restarted.check()).missing.join(',')).toContain(':1-2')
}))

