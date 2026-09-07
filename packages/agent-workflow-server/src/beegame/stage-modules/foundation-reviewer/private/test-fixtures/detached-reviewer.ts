/** Integration harness for the private packet runtime, not the stage public API. */
import { createHash } from 'node:crypto'
import { createFactWorkerTask, createSemanticWorkerTask } from '../worker-task'
import { executeReviewWorker } from '../native-worker'
import { openReviewerFactJournal } from '../fact-journal'
import { foundationFactModelPayloadSchema } from '../worker-schemas'
import { prepareFoundationReview } from '../prepare-review'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { FOUNDATION_SEMANTIC_CHECKS } from '../domain/foundation-semantic-audit'
import { completeTestSubmission, renderTestCompleteGameDocument } from './complete-game-document-fixture'

const documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)) }))
const prepared = prepareFoundationReview(documents)
if (prepared.kind !== 'facts_pending') throw new Error('invalid private fixture')
const bodies = new Map(documents.map(item => [item.path, item.content]))
const sectionBytes = new Map(prepared.sectionIndex.map(ref => [
  `${ref.documentPath}#${ref.sectionId}`,
  bodies.get(ref.documentPath)!.split('\n').slice(ref.startLine - 1, ref.endLine).join('\n'),
]))
const semanticInput = {
  revision: prepared.snapshot.digest, checkId: FOUNDATION_SEMANTIC_CHECKS[0]!.checkId,
  sectionIndex: prepared.sectionIndex, sectionBytes, factStore: prepared.extraction.facts,
  deterministicIssuePrefix: [], deterministicReviewDigest: createHash('sha256').update('[]').digest('hex'),
}
const config = { configuration: { command: [process.execPath, process.argv[2]!], env: {} }, workspacePath: process.cwd() }
const identity = { ownerId: 'detached-owner', projectId: 'detached-project', requestId: 'detached-review' }
const journal = await openReviewerFactJournal({ workspacePath: process.cwd(), identity, documents })
await journal.append('claim', { kind: 'claim', taskId: 'fact-0', dispatchId: 'detached-dispatch' })
const factTask = createFactWorkerTask(documents, 0)
let meteringIndex = 0
const execution = await executeReviewWorker({ ...config,
  task: { ...factTask, admit(value) { return { admitted: factTask.admit(value), output: foundationFactModelPayloadSchema.parse(value) } } },
  onUsage: usage => journal.append(`usage-${meteringIndex++}`, { kind: 'usage', taskId: 'fact-0', dispatchId: 'detached-dispatch', usage: {
    input_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cache_read_tokens: usage.cache_read_tokens,
    cache_creation_tokens: usage.cache_creation_tokens, total_tokens: usage.total_tokens,
  } }).then(() => {}),
})
const fact = { value: execution.value.admitted, usage: execution.usage }
const accepted = await journal.append('accept', { kind: 'accept', taskId: 'fact-0', dispatchId: 'detached-dispatch', output: execution.value.output,
  usage: { input_tokens: fact.usage.prompt_tokens, completion_tokens: fact.usage.completion_tokens, cache_read_tokens: fact.usage.cache_read_tokens, cache_creation_tokens: fact.usage.cache_creation_tokens, total_tokens: fact.usage.total_tokens },
})
const restored = await openReviewerFactJournal({ workspacePath: process.cwd(), identity, documents })
if (JSON.stringify(await restored.read()) !== JSON.stringify(accepted)) throw new Error('detached journal replay diverged')
const source = await executeReviewWorker({ ...config, task: createSemanticWorkerTask(semanticInput) })
const confirmation = await executeReviewWorker({ ...config, task: createSemanticWorkerTask(semanticInput, 'confirmation') })
console.log(JSON.stringify({ fact, source, confirmation, journal: { taskStatus: accepted.collection.tasks[0]!.status, usage: accepted.collection.aggregateUsage.total_tokens } }))
