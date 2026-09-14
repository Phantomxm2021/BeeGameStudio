import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAgentResultReceipt, writeAgentResultReceipt, flushAgentResultReceipts, type AgentResultReceipt } from '../agentResultReceipt'

const roots: string[] = []
async function directory() { const root = await mkdtemp(join(tmpdir(), 'agent-receipt-test-')); roots.push(root); return root }
const receipt = (status: AgentResultReceipt['status'] = 'completed'): AgentResultReceipt => ({
  version: 1, task_id: 'agent-1', task_type: 'local_agent', status, description: 'Write files', output: 'Final answer',
})
afterEach(async () => { await flushAgentResultReceipts(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

test('no-session-persistence has a readable standalone output and durable terminal receipt', async () => {
  const root = await directory()
  await writeAgentResultReceipt(root, receipt(), true)
  expect(await readAgentResultReceipt(root, 'agent-1')).toEqual(receipt())
  expect(JSON.parse(await readFile(join(root, 'agent-1.output'), 'utf8'))).toEqual(receipt())
})
test('initial running write cannot overwrite a queued terminal result', async () => {
  const root = await directory()
  const start = writeAgentResultReceipt(root, receipt('running'), true)
  const finish = writeAgentResultReceipt(root, receipt(), true)
  await Promise.all([start, finish])
  expect((await readAgentResultReceipt(root, 'agent-1'))?.status).toBe('completed')
  expect(JSON.parse(await readFile(join(root, 'agent-1.output'), 'utf8')).status).toBe('completed')
})
test('running receipts are never recovered as completed, and another session cannot retrieve them', async () => {
  const root = await directory()
  await writeAgentResultReceipt(root, receipt('running'), true)
  expect(await readAgentResultReceipt(root, 'agent-1')).toBeUndefined()
  await writeAgentResultReceipt(root, receipt(), false)
  expect(await readAgentResultReceipt(await directory(), 'agent-1')).toBeUndefined()
})
test('failure and cancellation retain exact private results', async () => {
  const root = await directory()
  for (const status of ['failed', 'killed'] as const) {
    await writeAgentResultReceipt(root, { ...receipt(status), error: 'tool execution failed' }, true)
    expect(await readAgentResultReceipt(root, 'agent-1')).toMatchObject({ status, error: 'tool execution failed' })
  }
})
test('persistent sessions keep transcript output links untouched', async () => {
  const root = await directory(), transcript = join(root, 'transcript.jsonl')
  await writeFile(transcript, 'TRANSCRIPT')
  await symlink(transcript, join(root, 'agent-1.output'))
  await writeAgentResultReceipt(root, receipt(), false)
  expect(await readFile(join(root, 'agent-1.output'), 'utf8')).toBe('TRANSCRIPT')
  expect(await readAgentResultReceipt(root, 'agent-1')).toEqual(receipt())
})
test('standalone replacement never follows an output link', async () => {
  const root = await directory(), outside = join(root, 'outside')
  await writeFile(outside, 'UNCHANGED')
  await symlink(outside, join(root, 'agent-1.output'))
  await writeAgentResultReceipt(root, receipt(), true)
  expect(await readFile(outside, 'utf8')).toBe('UNCHANGED')
})
test('rejects traversal, mismatched IDs, corrupt receipts and symlinked receipts', async () => {
  const root = await directory()
  expect(await readAgentResultReceipt(root, '../agent-1')).toBeUndefined()
  await expect(writeAgentResultReceipt(root, { ...receipt(), task_id: '../agent-1' }, true)).rejects.toThrow('Invalid task receipt ID')
  const target = join(root, 'agent-1.result.json')
  await writeFile(target, '{broken')
  expect(await readAgentResultReceipt(root, 'agent-1')).toBeUndefined()
  for (const value of ['null', '[]', '1', '"not a receipt"']) {
    await writeFile(target, value)
    expect(await readAgentResultReceipt(root, 'agent-1')).toBeUndefined()
  }
  await writeFile(target, JSON.stringify({ ...receipt(), task_id: 'another-agent' }))
  expect(await readAgentResultReceipt(root, 'agent-1')).toBeUndefined()
  await rm(target)
  await writeFile(join(root, 'other'), JSON.stringify(receipt()))
  await symlink(join(root, 'other'), target)
  expect(await readAgentResultReceipt(root, 'agent-1')).toBeUndefined()
})
test('caps oversized final answers explicitly', async () => {
  const root = await directory()
  await writeAgentResultReceipt(root, { ...receipt(), output: '汉'.repeat(500_000) }, true)
  expect((await readAgentResultReceipt(root, 'agent-1'))?.output).toEndWith('[task result truncated]')
  await writeAgentResultReceipt(root, { ...receipt(), output: '\0'.repeat(500_000) }, true)
  expect((await readAgentResultReceipt(root, 'agent-1'))?.output).toEndWith('[task result truncated]')
})
