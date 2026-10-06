import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolUseContext } from '../Tool.js'
import { createFileStateCacheWithSizeLimit, inspectedDraftHash } from '../utils/fileStateCache.js'
import { getCwd } from '../utils/cwd.js'
import { setCwd } from '../utils/Shell.js'
import { createAssistantMessage } from '../utils/messages.js'
import { FileReadTool } from '../../packages/builtin-tools/src/tools/FileReadTool/FileReadTool.js'
import { FileEditTool } from '../../packages/builtin-tools/src/tools/FileEditTool/FileEditTool.js'
import { FileWriteTool } from '../../packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.js'
import { missingSavedDraftReads } from './saved-draft-check.js'
import { handleStopHooks } from '../query/stopHooks.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'

test('review requires complete current saved source; Write, tail, stale and inherited reads are not evidence', async () => {
  const root = await mkdtemp('/private/tmp/bgs-saved-source-test-'), previous = getCwd()
  const context = { agentId: 'offline-reviewer' as ToolUseContext['agentId'], beegameReviewDocuments: ['GDD.md', 'AUDIO_DESIGN.md'], readFileState: createFileStateCacheWithSizeLimit(10) } as ToolUseContext
  try {
    setCwd(root)
    await mkdir(join(root, 'docs'))
    const path = join(root, 'docs/GDD.md'), audio = join(root, 'docs/AUDIO_DESIGN.md')
    await writeFile(path, 'Complete source\nSecond clause\n')
    await writeFile(audio, 'Audio source\n')
    expect(await missingSavedDraftReads(context, [])).toEqual(['docs/GDD.md', 'docs/AUDIO_DESIGN.md'])
    const stamp = Math.floor((await stat(path)).mtimeMs)
    context.readFileState.set(path, { content: await readFile(path, 'utf8'), timestamp: stamp, offset: undefined, limit: undefined })
    expect(await missingSavedDraftReads(context, [])).toContain('docs/GDD.md')
    context.readFileState.set(path, { content: 'Second clause\n', timestamp: stamp, offset: 2, limit: undefined })
    expect(await missingSavedDraftReads(context, [])).toContain('docs/GDD.md')
    context.readFileState.set(path, { content: await readFile(path, 'utf8'), timestamp: stamp - 1, offset: 1, limit: undefined })
    expect(await missingSavedDraftReads(context, [])).toContain('docs/GDD.md')
    context.readFileState.set(path, { content: await readFile(path, 'utf8'), timestamp: stamp, offset: 1, limit: undefined })
    expect(await missingSavedDraftReads(context, [])).toEqual(['docs/AUDIO_DESIGN.md'])
    const alias = join(root, 'gdd-alias.md')
    await symlink(path, alias)
    const full = context.readFileState.get(path)!
    context.readFileState.delete(path)
    context.readFileState.set(alias, full)
    expect(await missingSavedDraftReads(context, [])).toEqual(['docs/AUDIO_DESIGN.md'])
    context.agentId = 'offline-author' as ToolUseContext['agentId']
    context.agentType = 'general-purpose'
    expect(await missingSavedDraftReads(context, [])).toEqual(['docs/AUDIO_DESIGN.md'])
    context.readFileState.set(audio, { content: await readFile(audio, 'utf8'), timestamp: Math.floor((await stat(audio)).mtimeMs), offset: 1, limit: 20 })
    expect(await missingSavedDraftReads(context, [])).toEqual([])
    await writeFile(audio, 'Changed audio source\n')
    expect(await missingSavedDraftReads(context, [])).toEqual(['docs/AUDIO_DESIGN.md'])
    context.agentType = 'general-purpose'
    const written = createAssistantMessage({ content: [{ type: 'tool_use', id: 'write-fixture', name: 'Write', input: { file_path: path, content: 'fixture' } }] })
    expect(await missingSavedDraftReads(context, [written])).toEqual(['docs/AUDIO_DESIGN.md'])
    expect(await missingSavedDraftReads({ ...context, agentId: undefined }, [])).toEqual([]) // Coordinator does not repeat review.
    expect(await missingSavedDraftReads({ ...context, beegameReviewDocuments: undefined }, [])).toEqual([])
  } finally { setCwd(previous); await rm(root, { recursive: true, force: true }) }
})

test('missing saved source offers one normal corrective review, then fails closed without an unbounded loop', async () => {
  const context = { agentId: 'offline-reviewer' as ToolUseContext['agentId'], beegameReviewDocuments: ['MISSING.md'], readFileState: createFileStateCacheWithSizeLimit(10), abortController: new AbortController() } as ToolUseContext
  const run = () => handleStopHooks([], [], asSystemPrompt([]), {}, {}, context, 'sdk')
  const first = run()
  expect((await first.next()).value).toMatchObject({ type: 'user', isMeta: true })
  expect((await first.next()).value).toMatchObject({ preventContinuation: false, blockingErrors: expect.any(Array) })
  await expect(run().next()).rejects.toThrow('review incomplete')
})

test('a complete saved read followed by known successful edits is not mistaken for an unread draft', async () => {
  const root = await mkdtemp('/private/tmp/bgs-selfcheck-edits-'), previous = getCwd()
  const context = { agentId: 'offline-reviewer' as ToolUseContext['agentId'], beegameReviewDocuments: ['GDD.md'], readFileState: createFileStateCacheWithSizeLimit(10), abortController: new AbortController() } as ToolUseContext
  try {
    setCwd(root); await mkdir(join(root, 'docs'))
    const path = join(root, 'docs/GDD.md'), initial = 'Clause one\nClause two\nPolicy old\n'
    await writeFile(path, initial)
    const parent = createAssistantMessage({ content: 'Offline fixture' })
    const read = (offset?: number, limit?: number) => FileReadTool.call({ file_path: path, offset, limit }, context, undefined!, parent)
    const edit = (old_string: string, new_string: string) => FileEditTool.call({ file_path: path, old_string, new_string }, context, undefined!, parent)
    await read(1, 1)
    expect(context.readFileState.get(path)?.beegameInspectedHash).toBeUndefined()
    expect(await missingSavedDraftReads(context, [])).toEqual(['docs/GDD.md'])
    await read()
    expect(context.readFileState.get(path)?.beegameInspectedHash).toBe(inspectedDraftHash(initial))
    let current = initial
    for (const [oldString, newString] of [['Clause one', 'Clause 1'], ['Clause two', 'Clause 2'], ['Policy old', 'Policy current']] as const) {
      await edit(oldString, newString)
      current = current.replace(oldString, newString)
      expect(context.readFileState.get(path)?.offset).toBeUndefined() // Preserve normal native read/dedup semantics.
      expect(context.readFileState.get(path)?.beegameInspectedHash).toBe(inspectedDraftHash(current))
      expect(await missingSavedDraftReads(context, [])).toEqual([]) // Query has already discarded raw tool receipts.
    }
    await read(2, 1)
    expect(await missingSavedDraftReads(context, [])).toEqual([]) // A focused unchanged reread retains full inspection.
    const beforeFailure = context.readFileState.get(path)?.beegameInspectedHash
    await expect(edit('Absent clause', 'Changed')).rejects.toThrow()
    expect(context.readFileState.get(path)?.beegameInspectedHash).toBe(beforeFailure)
    expect(await readFile(path, 'utf8')).toBe(current)
    await FileWriteTool.call({ file_path: path, content: current }, context, undefined!, parent)
    expect(context.readFileState.get(path)?.beegameInspectedHash).toBeUndefined()
    expect(await missingSavedDraftReads(context, [])).toEqual(['docs/GDD.md'])
    await read()
    await edit(current, current + 'Whole replacement\n')
    expect(context.readFileState.get(path)?.beegameInspectedHash).toBeUndefined()
    expect(await missingSavedDraftReads(context, [])).toEqual(['docs/GDD.md'])
    await read()
    context.userModified = true
    await edit('Clause 1', 'User-modified clause')
    expect(context.readFileState.get(path)?.beegameInspectedHash).toBeUndefined()
    expect(await missingSavedDraftReads(context, [])).toEqual(['docs/GDD.md'])
    context.beegameReviewDocuments = undefined
    await read()
    expect(context.readFileState.get(path)?.beegameInspectedHash).toBeUndefined() // Ordinary CLI reads do not carry BGS markers.
  } finally { setCwd(previous); await rm(root, { recursive: true, force: true }) }
})

test('preview cache and unaccounted external changes cannot establish complete current source', async () => {
  const root = await mkdtemp('/private/tmp/bgs-selfcheck-edit-boundaries-'), previous = getCwd()
  try {
    setCwd(root); await mkdir(join(root, 'docs'))
    const path = join(root, 'docs/GDD.md'), content = 'First clause\nSecond clause\n'
    await writeFile(path, content)
    const context = { agentId: 'offline-reviewer' as ToolUseContext['agentId'], beegameReviewDocuments: ['GDD.md'], readFileState: createFileStateCacheWithSizeLimit(10) } as ToolUseContext
    const stamp = Math.floor((await stat(path)).mtimeMs)
    context.readFileState.set(path, { content, timestamp: stamp, offset: 1, limit: undefined, isPartialView: true })
    expect(await missingSavedDraftReads(context, [])).toEqual(['docs/GDD.md'])
    context.readFileState.set(path, { content, timestamp: stamp, offset: undefined, limit: undefined, beegameInspectedHash: inspectedDraftHash(content) })
    expect(await missingSavedDraftReads(context, [])).toEqual([])
    await writeFile(path, content + 'An external change\n')
    // A content mismatch fails even if cached mtime is made equal to current mtime.
    context.readFileState.get(path)!.timestamp = Math.floor((await stat(path)).mtimeMs)
    expect(await missingSavedDraftReads(context, [])).toEqual(['docs/GDD.md'])
    const parent = createAssistantMessage({ content: 'Offline fixture' })
    await FileEditTool.call({ file_path: path, old_string: 'First', new_string: 'Changed' }, context, undefined!, parent)
    expect(context.readFileState.get(path)?.beegameInspectedHash).toBeUndefined()
    expect(await missingSavedDraftReads(context, [])).toEqual(['docs/GDD.md'])
  } finally { setCwd(previous); await rm(root, { recursive: true, force: true }) }
})

test('a source symlink outside the project cannot satisfy the saved-source gate', async () => {
  const root = await mkdtemp('/private/tmp/bgs-source-boundary-test-'), previous = getCwd()
  try {
    setCwd(root); await mkdir(join(root, 'docs')); await writeFile(join(root, 'outside-fixture'), 'fixture')
    await symlink('/etc/hosts', join(root, 'docs/GDD.md'))
    expect(await missingSavedDraftReads({ agentId: 'offline-reviewer' as ToolUseContext['agentId'], beegameReviewDocuments: ['GDD.md'], readFileState: createFileStateCacheWithSizeLimit(10) } as ToolUseContext, [])).toEqual(['docs/GDD.md'])
  } finally { setCwd(previous); await rm(root, { recursive: true, force: true }) }
})
