import { expect, test } from 'bun:test'
import { foundationFactDefinition } from '../stage-modules/foundation-reviewer/private/domain/foundation-fact-definitions'
test('Level fact owners retain the canonical section bindings', () => {
  const path = 'docs/LEVEL_SCENE_DESIGN.md'
expect(foundationFactDefinition('level.required_entities')?.owner).toEqual({
      documentPath: path,
      sectionId: 'encounters',
    })
expect(foundationFactDefinition('level.required_assets')?.owner).toEqual({
      documentPath: path,
      sectionId: 'content_matrix',
    })
expect(foundationFactDefinition('level.complexity_budget')?.owner).toEqual({
      documentPath: path,
      sectionId: 'production_acceptance',
    })
})
