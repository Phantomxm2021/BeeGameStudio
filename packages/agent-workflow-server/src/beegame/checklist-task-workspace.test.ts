import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareChecklistTask, collectChecklistTask } from './checklist-task-workspace'
import { createBeeGameDeliveryWorkerPort } from './delivery-worker-session-port'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './foundation-documents'
import { checklistCandidatePath } from './checklist-candidate'
import type { WorkerDispatchRequest } from './delivery-workflow/types'
import type { BeeGameSessionManager, StartBeeGameSessionInput } from './session-manager'
import { createNativeTaskAccess } from '@bee-game-studio/agent-workflow/native-task-access'

function request(workspacePath: string): WorkerDispatchRequest {
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path,
    content: '# Frozen source ' + path, digest: createHash('sha256').update('# Frozen source ' + path).digest('hex') }))
  const revision = createHash('sha256').update(JSON.stringify(documents.map(d => [d.path, d.digest]))).digest('hex')
  return { dispatchId: 'checklist-test', runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath,
    workerType: 'document-author', phase: 'DOCUMENT_REVIEW', revision,
    allowedPaths: [checklistCandidatePath('checklist-test')],
    contract: { documentSet: 'checklist', checklistCandidatePath: checklistCandidatePath('checklist-test'),
      checklistAuthority: { foundationRevision: revision, documents } } }
}

test('Checklist runs in a private workspace and publishes only the collected candidate after draining', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'checklist-port-test-')))
  const dispatch = request(root)
  let start: StartBeeGameSessionInput | undefined, prompt = '', drained = false
  const sessions = {
    start(input: StartBeeGameSessionInput) { start = input; return { id: 'worker' } },
    updateAuthToken() {},
    async sendWithDisplay(_id: string, text: string) { prompt = text },
    events() { return [{ id: 1, type: 'result', payload: { type: 'result', result: 'Done' }, text: 'Done', createdAt: new Date() }] },
    async waitForWorkflowWorkerIdle() {
      drained = true
      await writeFile(join(start!.isolatedTask!.workspacePath, 'checklist.md'), '- [ ] AC-1 Verify the goal\n')
      await writeFile(join(start!.isolatedTask!.workspacePath, 'other.md'), 'Not a deliverable')
    },
    get() { return { status: 'idle' } }, async disposeWorkflowWorker() {},
  } as unknown as BeeGameSessionManager
  const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'owner', confirmedBriefContext: 'DO NOT REINJECT ME' })
  try {
    await port.start(dispatch)
    expect(start?.workspacePath).toBe(root) // Chat/billing stay attached to the project.
    expect(start?.isolatedTask?.workspacePath).not.toBe(root)
    expect(start).not.toHaveProperty('workflowAllowedTools')
    expect(start).not.toHaveProperty('workflowProjectReadScope')
    await port.submit('checklist-test', 'OLD SHARED WORKSPACE PROMPT')
    expect(prompt).toContain('Read authority.md')
    expect(prompt).toContain('checklist.md')
    expect(prompt).not.toContain('OLD SHARED WORKSPACE PROMPT')
    expect(prompt).not.toContain('DO NOT REINJECT ME')
    expect(prompt).not.toContain('# Frozen source')
    expect(await readFile(join(start!.isolatedTask!.workspacePath, 'authority.md'), 'utf8')).toContain('# Frozen source docs/GDD.md')
    const terminal = await port.waitForTerminal!('checklist-test')
    expect(drained).toBe(true)
    expect(terminal).toMatchObject({ writtenPaths: [checklistCandidatePath('checklist-test')] })
    expect(await readFile(join(root, checklistCandidatePath('checklist-test')), 'utf8')).toContain('AC-1')
    expect(await Bun.file(join(root, 'other.md')).exists()).toBe(false)
    expect(await Bun.file(join(root, 'docs/acceptance/gameplay-checklist.md')).exists()).toBe(false)
  } finally {
    await port.close?.('checklist-test')
    if (start?.isolatedTask) expect(await Bun.file(join(start.isolatedTask.workspacePath, 'authority.md')).exists()).toBe(false)
    await rm(root, { recursive: true, force: true })
  }
})

test('private task permits native tools within boundaries and rejects linked output', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'checklist-isolation-test-')))
  const dispatch = request(root)
  const task = await prepareChecklistTask(dispatch, 'Frozen inputs')
  try {
    const access = await createNativeTaskAccess({ ...task, allowWorkingFiles: true })
    const ask = (tool_name: string, input: object) => access.permission({ tool_name, input })
    expect((await ask('Read', { file_path: 'authority.md' })).behavior).toBe('allow')
    expect((await ask('Bash', { command: 'pwd', dangerouslyDisableSandbox: true }))).toMatchObject({ behavior: 'allow', updatedInput: { dangerouslyDisableSandbox: false } })
    expect((await ask('Agent', { prompt: 'Check output', mode: 'bypassPermissions' }))).toMatchObject({ behavior: 'allow', updatedInput: { mode: 'default' } })
    expect((await ask('Write', { file_path: 'scratch.txt', content: 'ok' })).behavior).toBe('allow')
    expect((await ask('Write', { file_path: 'authority.md', content: 'bad' })).behavior).toBe('deny')
    expect((await ask('Read', { file_path: join(root, 'private.txt') })).behavior).toBe('deny')
    await writeFile(join(root, 'private.txt'), 'Not task output')
    await symlink(join(root, 'private.txt'), join(task.workspacePath, 'checklist.md'))
    await expect(collectChecklistTask(dispatch, task)).rejects.toThrow('regular task file')
    expect(await Bun.file(join(root, checklistCandidatePath('checklist-test'))).exists()).toBe(false)
    await expect(prepareChecklistTask({ ...dispatch, allowedPaths: ['../wrong.md'] }, '')).rejects.toThrow('dispatch')
  } finally { await rm(task.workspacePath, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }) }
})

test('stopping a Checklist task does not collect its partial candidate', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'checklist-stop-test-')))
  let start: StartBeeGameSessionInput | undefined, stopped = false
  const sessions = {
    start(input: StartBeeGameSessionInput) { start = input; return { id: 'worker' } },
    stop() { stopped = true },
    events() { return [] },
    isWorkflowWorkerOpen() { return !stopped },
    async waitForWorkflowWorkerIdle() {}, async disposeWorkflowWorker() {},
    get() { return { status: 'stopped' } },
  } as unknown as BeeGameSessionManager
  const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'owner' })
  try {
    await port.start(request(root))
    await writeFile(join(start!.isolatedTask!.workspacePath, 'checklist.md'), 'Partial output')
    await port.stop('checklist-test', 'User stopped')
    await expect(port.waitForTerminal!('checklist-test')).rejects.toThrow('stopped before producing')
    expect(await Bun.file(join(root, checklistCandidatePath('checklist-test'))).exists()).toBe(false)
  } finally {
    await port.close?.('checklist-test')
    await rm(root, { recursive: true, force: true })
  }
})
