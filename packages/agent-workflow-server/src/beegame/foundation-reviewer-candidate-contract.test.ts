import { expect, test } from 'bun:test'
import { firstCandidateFixture } from './stage-modules/foundation-reviewer/private/test-fixtures/candidate-fixture'
import { verifyReviewerCandidateChanges } from './stage-modules/foundation-reviewer/private/candidate-changes'

test('isolated candidate scope admits only the declared repaired section', () => {
  for (const normalized of [true, false]) {
    const { prepared } = firstCandidateFixture(normalized)
    const after = prepared.documents[0]!.content
    const operations = verifyReviewerCandidateChanges({ baseDocuments: prepared.baseDocuments, candidateDocuments: prepared.documents, issues: prepared.issues })
    expect(operations).toHaveLength(1)
    expect(operations.map(operation => operation.scope === 'section' ? operation.sectionId : '')).toEqual(['player_actions'])
    for (const replacement of ['unauthorized\n' + after, after.replace('game.players.max: 4', 'game.players.max: 8')]) {
      expect(() => verifyReviewerCandidateChanges({ baseDocuments: prepared.baseDocuments,
        candidateDocuments: prepared.documents.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md' ? replacement : doc.content })), issues: prepared.issues })).toThrow()
    }
  }
})
