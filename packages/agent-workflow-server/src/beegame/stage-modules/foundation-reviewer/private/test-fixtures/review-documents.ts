import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../../../../__tests__/complete-game-document-fixture'
import { REVIEW_DOCUMENT_PATHS } from '../single-agent-contract'

export function reviewFixtureDocuments() {
  return REVIEW_DOCUMENT_PATHS.map(path => ({
    path,
    content: renderTestCompleteGameDocument(path, completeTestSubmission(path)),
  }))
}
