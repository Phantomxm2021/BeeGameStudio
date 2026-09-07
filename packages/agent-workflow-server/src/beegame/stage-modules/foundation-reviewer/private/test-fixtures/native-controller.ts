/** Offline controller process for execution-lease isolation tests. */
import { createReviewerFactController } from '../fact-controller'
import { createReviewerSemanticController } from '../semantic-controller'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { completeTestSubmission, renderTestCompleteGameDocument } from './complete-game-document-fixture'

const input = {
  workspacePath: process.cwd(), identity: { ownerId: 'controller-owner', projectId: 'project', requestId: 'request' },
  documents: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)) })),
}
const semantic = process.argv[3] === 'semantic'
const infrastructure = (mode: string) => ({ protocolVersion: 1 as const, ownerId: 'controller-owner', async resolve() {
  return { command: [process.execPath, process.argv[2]!, `--fixture-mode=${mode}`], env: { BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast', OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced', OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong' } }
} })
if (semantic) await (await createReviewerFactController(input, infrastructure('success'))).run()
const controller = semantic ? await createReviewerSemanticController(input, infrastructure('stop')) : await createReviewerFactController(input, infrastructure('stop'))
process.on('SIGTERM', () => { void controller.stop('fixture-cleanup').finally(() => process.exit(0)) })
console.log(JSON.stringify(await controller.run()))
