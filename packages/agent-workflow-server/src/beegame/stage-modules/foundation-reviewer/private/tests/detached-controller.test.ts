import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createReviewerFactController } from '../fact-controller'
import { createReviewerSemanticController } from '../semantic-controller'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../test-fixtures/complete-game-document-fixture'

for (const phase of ['fact', 'semantic']) test(`${phase}: another OS process cannot acquire an active controller lease and can request durable stop`, async () => {
  const root = resolve(import.meta.dir, '..')
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-controller-process-')))
  let child: ReturnType<typeof Bun.spawn> | undefined
  try {
    const builder = Bun.spawn([process.execPath, join(root, 'test-fixtures/build-controller.ts'), workspacePath], { cwd: workspacePath, stdout: 'pipe', stderr: 'pipe' })
    const [built, buildError, buildExit] = await Promise.all([new Response(builder.stdout).text(), new Response(builder.stderr).text(), builder.exited])
    expect(buildError).toBe('')
    expect(buildExit).toBe(0)
    expect(JSON.parse(built).loaded).toContain(join(root, 'fact-controller.ts'))
    expect(JSON.parse(built).loaded).toContain(join(root, 'semantic-controller.ts'))
    const create = phase === 'semantic' ? createReviewerSemanticController : createReviewerFactController
    const other = await create({ workspacePath,
      identity: { ownerId: 'controller-owner', projectId: 'project', requestId: 'request' },
      documents: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)) })),
    }, { protocolVersion: 1, ownerId: 'controller-owner', async resolve() { throw new Error('peer must never execute') } })
    const spawned = Bun.spawn([process.execPath, join(workspacePath, 'native-controller.js'), join(workspacePath, 'native-reviewer.js'), phase], {
      cwd: workspacePath, env: { PATH: '/usr/bin:/bin', TMPDIR: tmpdir() }, stdout: 'pipe', stderr: 'pipe',
    })
    child = spawned
    let ready = false
    for (let i = 0; i < 500; i++) {
      const state = await other.read()
      if ((phase === 'semantic' ? state.semantic?.collection.aggregateUsage.total_tokens ?? 0 : state.collection.aggregateUsage.total_tokens) >= 10) { ready = true; break }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(ready).toBe(true)
    const path = join(workspacePath, '.beegame/workflow/foundation-reviewer/state', other.runId, 'execution.lock')
    expect(JSON.parse(await readFile(path, 'utf8')).pid).toBe(spawned.pid)
    expect((await other.run()).execution).toBe('busy')
    await other.stop('cross-process-stop')
    const [stdout, stderr, exit] = await Promise.all([new Response(spawned.stdout).text(), new Response(spawned.stderr).text(), spawned.exited])
    expect(stderr).toBe('')
    expect(exit).toBe(0)
    const stopped = JSON.parse(stdout).state
    expect(phase === 'semantic' ? stopped.semantic.phase : stopped.phase).toBe('stopped')
    await expect(readFile(path)).rejects.toThrow()
    const final = await other.read()
    expect((phase === 'semantic' ? final.semantic!.collection : final.collection).tasks.some(task => task.status === 'completed')).toBe(false)
  } finally {
    child?.kill()
    if (child) await child.exited
    await rm(workspacePath, { recursive: true, force: true })
  }
}, 20_000)
