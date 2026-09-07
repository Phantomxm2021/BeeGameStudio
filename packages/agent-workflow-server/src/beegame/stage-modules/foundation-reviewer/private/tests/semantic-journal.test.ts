import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openReviewerFactJournal, ReviewJournalConflictError } from '../fact-journal'
import { prepareFoundationReview } from '../prepare-review'
import { prepareReviewerSemanticInput } from '../semantic-input'
import { createSemanticWorkerTask } from '../worker-task'
import { executeReviewWorker } from '../native-worker'
import { foundationSemanticModelPayloadSchema } from '../worker-schemas'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../test-fixtures/complete-game-document-fixture'

const ten = { input_tokens: 7, completion_tokens: 3, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 10 }
const identity = { ownerId: 'semantic-owner', projectId: 'project', requestId: 'initial-review' }
async function fixture(run: (input: { workspacePath: string; documents: { path: typeof CANONICAL_FOUNDATION_DOCUMENTS[number]; content: string }[];
  journal: Awaited<ReturnType<typeof openReviewerFactJournal>>; eventsPath: string }) => Promise<void>) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-semantic-journal-')))
  try {
    const documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)) }))
    const journal = await openReviewerFactJournal({ workspacePath, identity, documents })
    const prepared = prepareFoundationReview(documents)
    if (prepared.kind !== 'facts_pending') throw new Error('invalid fixture')
    for (const [index, packet] of prepared.factPackets.entries()) {
      const taskId = `fact-${index}`, dispatchId = `fact-dispatch-${index}`
      await journal.append(`fact-claim-${index}`, { kind: 'claim', taskId, dispatchId })
      await journal.append(`fact-accept-${index}`, { kind: 'accept', taskId, dispatchId, usage: ten,
        output: { status: 'completed', results: packet.keys.map(key => ({ key, status: 'absent' })) } })
    }
    await journal.append('begin', { kind: 'begin_semantic' })
    await run({ workspacePath, documents, journal, eventsPath: join(workspacePath, '.beegame/workflow/foundation-reviewer/state', journal.runId, 'events') })
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
}

test('native source and strong receipts replay through the same owned journal without publishing canonical files', async () => fixture(async ({ workspacePath, documents, journal }) => {
  let current = await journal.read()
  const packets = prepareReviewerSemanticInput(documents, current).packets
  // An undecidable source must durably create its strong task in the same accept event.
  await journal.append('source-claim', { kind: 'semantic', command: { kind: 'claim', taskId: 'semantic-0', dispatchId: 'source-0' } })
  current = await journal.append('source-undecidable', { kind: 'semantic', command: { kind: 'accept', taskId: 'semantic-0', dispatchId: 'source-0', usage: ten,
    output: { status: 'completed', outcome: 'UNDECIDABLE', reason: 'needs independent confirmation' } } })
  const reopened = await openReviewerFactJournal({ workspacePath, identity, documents })
  expect(await reopened.read()).toEqual(current)
  expect((await reopened.append('source-undecidable', { kind: 'semantic', command: { kind: 'accept', taskId: 'semantic-0', dispatchId: 'source-0', usage: ten,
    output: { status: 'completed', outcome: 'UNDECIDABLE', reason: 'needs independent confirmation' } } })).semantic!.collection.tasks.filter(task => task.kind === 'confirmation')).toHaveLength(1)
  for (const task of current.semantic!.collection.tasks.filter(task => task.status === 'pending')) {
    const dispatchId = `native-${task.taskId}`
    await reopened.append(`claim-${dispatchId}`, { kind: 'semantic', command: { kind: 'claim', taskId: task.taskId, dispatchId } })
    const worker = createSemanticWorkerTask(packets.find(packet => packet.checkId === task.checkId)!, task.kind === 'confirmation' ? 'confirmation' : 'source')
    let meter = 0
    const result = await executeReviewWorker({ workspacePath,
      configuration: { command: [process.execPath, join(import.meta.dir, '../test-fixtures/native-reviewer.ts')], env: {} },
      task: { ...worker, admit(value) { worker.admit(value); return foundationSemanticModelPayloadSchema.parse(value) } },
      onUsage: usage => reopened.append(`meter-${dispatchId}-${meter++}`, { kind: 'semantic', command: { kind: 'usage', taskId: task.taskId, dispatchId,
        usage: { input_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cache_read_tokens: usage.cache_read_tokens,
          cache_creation_tokens: usage.cache_creation_tokens, total_tokens: usage.total_tokens } } }).then(() => {}),
    })
    current = await reopened.append(`accept-${dispatchId}`, { kind: 'semantic', command: { kind: 'accept', taskId: task.taskId, dispatchId, output: result.value, usage: ten } })
    const accepted = current.semantic!.collection.tasks.find(item => item.taskId === task.taskId)!
    const receipt = JSON.parse(await readFile(join(workspacePath, accepted.receiptPath!), 'utf8'))
    expect(receipt.digest).toBe(accepted.receiptDigest)
    expect(receipt.event.command.output.outcome).toBe('PASS')
  }
  expect(current.semantic!.phase).toBe('semantic_staged')
  expect(current.semantic!.collection.aggregateUsage.total_tokens).toBe(100)
  expect(current.semantic!.collection.deepAggregateUsage!.total_tokens).toBe(10)
  expect(await (await openReviewerFactJournal({ workspacePath, identity, documents })).read()).toEqual(current)
  expect(await readdir(workspacePath)).toEqual(['.beegame'])
}), 60_000)

test('semantic journal stop/resume is durable and replayed commands cannot stop a newer dispatch', async () => fixture(async ({ workspacePath, documents, journal, eventsPath }) => {
  const lease = await journal.tryExecutionLease()
  expect(lease.kind).toBe('owned')
  const command = { kind: 'semantic' as const, command: { kind: 'claim' as const, taskId: 'semantic-0', dispatchId: 'old' } }
  await journal.append('claim-old', command)
  const peer = await openReviewerFactJournal({ workspacePath, identity, documents })
  expect((await peer.tryExecutionLease()).kind).toBe('busy')
  await peer.append('stop', { kind: 'stop' })
  const before = await readdir(eventsPath)
  await expect(journal.append('late', { kind: 'semantic', command: { kind: 'accept', taskId: 'semantic-0', dispatchId: 'old', usage: ten, output: { status: 'completed', outcome: 'PASS' } } })).rejects.toThrow('running dispatch')
  expect(await readdir(eventsPath)).toEqual(before)
  await peer.append('resume', { kind: 'resume' })
  const current = await peer.append('claim-new', { ...command, command: { ...command.command, dispatchId: 'new' } })
  expect(await journal.append('stop', { kind: 'stop' })).toEqual(current)
  await expect(journal.append('claim-new', command)).rejects.toBeInstanceOf(ReviewJournalConflictError)
  expect((await journal.read()).semantic!.collection.tasks[0]!.attempt).toBe(1)
  if (lease.kind === 'owned') await lease.release()
}))

test('tampering semantic output fails closed; packet selection cannot be supplied to begin', async () => fixture(async ({ journal, eventsPath }) => {
  await expect(journal.append('injected', { kind: 'begin_semantic', packets: [] } as never)).rejects.toThrow()
  await journal.append('claim', { kind: 'semantic', command: { kind: 'claim', taskId: 'semantic-0', dispatchId: 'd0' } })
  await journal.append('accept', { kind: 'semantic', command: { kind: 'accept', taskId: 'semantic-0', dispatchId: 'd0', usage: ten, output: { status: 'completed', outcome: 'PASS' } } })
  const path = join(eventsPath, (await readdir(eventsPath)).sort().at(-1)!)
  const original = await readFile(path, 'utf8')
  const record = JSON.parse(original); record.event.command.output.outcome = 'UNDECIDABLE'
  await writeFile(path, JSON.stringify(record))
  await expect(journal.read()).rejects.toThrow('binding mismatch')
  await writeFile(path, original)
  expect((await journal.read()).semantic!.results['semantic-0']!.outcome).toBe('PASS')
}))
