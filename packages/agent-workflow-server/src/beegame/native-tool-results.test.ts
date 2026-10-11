import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { getProjectDir } from '../../../../src/utils/sessionStorage.js'
import { PREVIEW_SIZE_BYTES, processPreMappedToolResultBlock } from '../../../../src/utils/toolResultStorage.js'
import { BashTool } from '../../../builtin-tools/src/tools/BashTool/BashTool.js'
import { FileReadTool } from '../../../builtin-tools/src/tools/FileReadTool/FileReadTool.js'
import type { ToolUseContext } from '../../../../src/Tool.js'
import { createFileStateCacheWithSizeLimit } from '../../../../src/utils/fileStateCache.js'
import { createAssistantMessage } from '../../../../src/utils/messages.js'
import { projectExecutionAccess } from './project-execution-access.js'
import { standardCliCache } from '@bee-game-studio/agent-workflow/standard-cli-cache'

const output = JSON.stringify({ ok: true, scope: 'content-format-selection', values: { baseline: 'source '.repeat(6000) } })
const block: ToolResultBlockParam = { type: 'tool_result', tool_use_id: 'offline-native-result', content: output }

test('upstream persisted output has an exact host-readable session cache without exposing config', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-project-results-'))
  const workspace = join(root, 'workspace'), config = join(root, 'config')
  await mkdir(workspace)
  try {
    const stateUrl = new URL('../../../../src/bootstrap/state.ts', import.meta.url).href
    const storageUrl = new URL('../../../../src/utils/toolResultStorage.ts', import.meta.url).href
    const child = Bun.spawn([process.execPath, '-e',
      'import {setOriginalCwd,getSessionId} from ' + JSON.stringify(stateUrl) + ';' +
      'import {processPreMappedToolResultBlock} from ' + JSON.stringify(storageUrl) + ';' +
      'setOriginalCwd(process.cwd()); const result=await processPreMappedToolResultBlock(' + JSON.stringify(block) +
      ',"Bash",1000); console.log(JSON.stringify({result,session:getSessionId()}));'], {
      cwd: workspace, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', BEEGAME_CONFIG_DIR: config }, stdout: 'pipe', stderr: 'pipe',
    })
    const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect(code, error).toBe(0)
    const { result, session } = JSON.parse(out)
    const saved = result.content.match(/Full output saved to: ([^\n]+)/)?.[1]
    expect(saved).toBeDefined()
    const cache = standardCliCache(workspace, session, { BEEGAME_CONFIG_DIR: config })
    expect(saved.startsWith(cache + '/')).toBe(true)
    expect(saved).not.toContain('.native-tool-results')
    expect(await readFile(saved, 'utf8')).toBe(output)
    const access = await projectExecutionAccess({ workspacePath: workspace, sessionId: 'fixture',
      environment: { BEEGAME_CONFIG_DIR: config }, toolResultsDirectory: cache })
    expect(await access.isReferenceRead('Read', { file_path: saved })).toBe(true)
    expect(await access.isReferenceRead('Read', { file_path: config })).toBe(false)
    expect(await access.isReferenceRead('Write', { file_path: saved })).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 20000)

test('format results use the native Bash limit, not a BGS-specific output policy', async () => {
  const selected = { ...block, content: JSON.stringify({ ok: true, scope: 'content-format-selection', values: { geometry: 'source '.repeat(2500) } }) }
  expect(String(selected.content).length).toBeGreaterThan(PREVIEW_SIZE_BYTES)
  expect(String(selected.content).length).toBeLessThan(BashTool.maxResultSizeChars)
  expect(await processPreMappedToolResultBlock(selected, 'Bash', BashTool.maxResultSizeChars)).toBe(selected)
  expect(String(block.content).length).toBeGreaterThan(BashTool.maxResultSizeChars)
})

test('native Read does not receive an extra BGS archive threshold for format content', async () => {
  const readBlock = { ...block, content: '    1→' + output }
  expect(String(readBlock.content).length).toBeGreaterThan(PREVIEW_SIZE_BYTES)
  expect(await processPreMappedToolResultBlock(readBlock, 'Read', FileReadTool.maxResultSizeChars)).toBe(readBlock)
})

test('large native Read exposes original source lines without recursively archiving its own result', async () => {
  const root = await mkdtemp('/private/tmp/bgs-native-read-')
  try {
    const file_path = join(root, 'context.md')
    const content = Array.from({ length: 180 }, (_, i) => 'Clause ' + (i + 1) + ': ' + 'required source '.repeat(22)).join('\n')
    await writeFile(file_path, content)
    const context = { readFileState: createFileStateCacheWithSizeLimit(10),
      abortController: new AbortController(),
      fileReadingLimits: { maxTokens: 100000, maxSizeBytes: 1000000 } } as unknown as ToolUseContext
    const parent = createAssistantMessage({ content: 'Synthetic source delivery' })
    const result = await FileReadTool.call({ file_path }, context, undefined!, parent)
    const mapped = FileReadTool.mapToolResultToToolResultBlockParam(result.data, 'source-read')
    expect(String(mapped.content).length).toBeGreaterThan(50000)
    const visible = await processPreMappedToolResultBlock(mapped, 'Read', FileReadTool.maxResultSizeChars)
    expect(visible).toBe(mapped)
    expect(String(visible.content)).toContain('Clause 180:')
    expect(String(visible.content)).not.toContain('Full output saved to:')
    // Still bounded at the source: rejection cannot be turned into truncation
    // or a cache entry claiming that unread text was inspected.
    const limited = { ...context, readFileState: createFileStateCacheWithSizeLimit(10),
      fileReadingLimits: { maxTokens: 10, maxSizeBytes: 1000000 } } as ToolUseContext
    await expect(FileReadTool.call({ file_path }, limited, undefined!, parent)).rejects.toThrow()
    expect(limited.readFileState.get(file_path)).toBeUndefined()
    const page = await FileReadTool.call({ file_path, offset: 54, limit: 2 }, context, undefined!, parent)
    const pageBlock = FileReadTool.mapToolResultToToolResultBlockParam(page.data, 'source-page')
    expect(String(pageBlock.content)).toContain('Clause 54:')
    expect(String(pageBlock.content)).toContain('Clause 55:')
    expect(String(pageBlock.content)).not.toContain('Clause 56:')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('native large-result persistence retains complete output; failures remain visible inline', async () => {
  const root = await mkdtemp('/private/tmp/bgs-native-results-fixture-')
  const original = process.env.BEEGAME_CONFIG_DIR
  const scoped = process.env.BEEGAME_NATIVE_TOOL_RESULTS_DIR
  try {
    process.env.BEEGAME_CONFIG_DIR = root
    delete process.env.BEEGAME_NATIVE_TOOL_RESULTS_DIR
    getProjectDir.cache.clear!()
    const limit = BashTool.maxResultSizeChars
    const result = await processPreMappedToolResultBlock(block, 'Bash', limit)
    expect(result.tool_use_id).toBe(block.tool_use_id)
    expect(result.type).toBe('tool_result')
    expect(String(result.content).length).toBeLessThan(output.length)
    const file = String(result.content).match(/Full output saved to: ([^\n]+)/)![1]!
    expect(file.startsWith(root)).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(output)
    expect(block.content).toBe(output)
    expect(await processPreMappedToolResultBlock(block, 'Bash', limit)).toEqual(result)
    // Storage is independent of a format command, its scope or model type.
    const other = { ...block, tool_use_id: 'ordinary-native-result', content: 'ordinary output '.repeat(4000) }
    const ordinary = await processPreMappedToolResultBlock(other, 'Bash', limit)
    const ordinaryFile = String(ordinary.content).match(/Full output saved to: ([^\n]+)/)![1]!
    expect(await readFile(ordinaryFile, 'utf8')).toBe(other.content)
    const small = { ...block, tool_use_id: 'small-fixture', content: output.slice(0, 100) }
    expect(await processPreMappedToolResultBlock(small, 'Bash', limit)).toBe(small)
    const unavailable = join(root, 'not-a-directory')
    await writeFile(unavailable, 'fixture')
    process.env.BEEGAME_CONFIG_DIR = unavailable
    getProjectDir.cache.clear!()
    const failed = { ...block, tool_use_id: 'failed-persistence-fixture' }
    expect(await processPreMappedToolResultBlock(failed, 'Bash', limit)).toBe(failed)
  } finally {
    if (original === undefined) delete process.env.BEEGAME_CONFIG_DIR
    else process.env.BEEGAME_CONFIG_DIR = original
    if (scoped === undefined) delete process.env.BEEGAME_NATIVE_TOOL_RESULTS_DIR
    else process.env.BEEGAME_NATIVE_TOOL_RESULTS_DIR = scoped
    getProjectDir.cache.clear!()
    await rm(root, { recursive: true, force: true })
  }
})
