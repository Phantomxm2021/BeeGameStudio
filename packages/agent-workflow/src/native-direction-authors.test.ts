import { expect, test } from 'bun:test'
import { NATIVE_DIRECTION_AUTHORS, nativeWritingAuthors, nativeWritingAuthorDocument, parseNativeDirectionAuthors, parseNativeProjectTurn, type NativeDirectionAuthorInput, type NativeProjectTurnInput } from './native-direction-authors'
import type { DesignFinding } from './design-review-result'

test('resource group input paths are optional for legacy tasks and cannot leak into Content', () => {
  const production = { phase: 'resources', contextPath: '/workspace/context.md', inputRevision: 'a'.repeat(64) }
  expect(parseNativeProjectTurn({ production })?.production?.resourceContextPaths).toBeUndefined()
  const resourceContextPaths = { visual: '/workspace/visual.context.md', audio: '/workspace/audio.context.md' }
  expect(parseNativeProjectTurn({ production: { ...production, resourceContextPaths } })?.production?.resourceContextPaths).toEqual(resourceContextPaths)
  for (const paths of [null, [], { unknown: 'x' }, { visual: '' }, { audio: 3 }])
    expect(() => parseNativeProjectTurn({ production: { ...production, resourceContextPaths: paths } })).toThrow('resource group context')
  expect(() => parseNativeProjectTurn({ production: { ...production, phase: 'content', resourceContextPaths } })).toThrow('resource group context')
})

test('milestone metadata binds the exact main-turn receipt and rejects mixed phases or unsafe paths', () => {
  const receipt = { phase: 'author' as const, path: '/workspace/.beegame/tmp/session/milestone-current.txt' }
  expect(parseNativeProjectTurn({ authorDocument: 'GDD.md', milestoneResult: receipt })?.milestoneResult).toBe(receipt)
  for (const phase of ['resources', 'content', 'implementation'])
    expect(parseNativeProjectTurn({ milestoneResult: { ...receipt, phase } })).toBeDefined()
  for (const patch of [null, [], { ...receipt, phase: 'review' }, { ...receipt, phase: 'acceptance' },
    { ...receipt, phase: 'complete' }, { ...receipt, path: '' }, { ...receipt, path: '.beegame/tmp/session/milestone-current.txt' },
    { ...receipt, path: '/workspace/.beegame/tmp/../milestone-current.txt' },
    { ...receipt, path: '/workspace/xbeegame/tmp/session/milestone-current.txt' },
    { ...receipt, path: '/workspace/docs/GDD.md' }, { ...receipt, claimedComplete: true }])
    expect(() => parseNativeProjectTurn({ milestoneResult: patch })).toThrow('milestone result input')
  expect(() => parseNativeProjectTurn({ authorDocument: 'GDD.md', milestoneResult: { ...receipt, phase: 'content' } })).toThrow()
  expect(() => parseNativeProjectTurn({ reviewDocuments: ['GDD.md'], milestoneResult: receipt })).toThrow()
  expect(() => parseNativeProjectTurn({ production: { phase: 'content' }, milestoneResult: receipt })).toThrow()
  expect(parseNativeProjectTurn({})?.milestoneResult).toBeUndefined()
})

test('author format checking follows actual scheduled ownership, never ordinary agents or review inputs', () => {
  expect(nativeWritingAuthorDocument('bgs-ui-design')).toBe('UI_UX_SPEC.md')
  expect(nativeWritingAuthorDocument('bgs-technical-baseline')).toBe('TECHNICAL_DESIGN.md')
  expect(nativeWritingAuthorDocument('bgs-technical-completion')).toBe('TECHNICAL_DESIGN.md')
  expect(nativeWritingAuthorDocument('general-purpose')).toBeUndefined()
  expect(parseNativeProjectTurn({ authorDocument: 'GDD.md' })).toEqual({ authorDocument: 'GDD.md' })
  for (const value of ['docs/GDD.md', '../GDD.md', 'UI_UX_SPEC.md'])
    expect(() => parseNativeProjectTurn({ authorDocument: value })).toThrow('author document')
  expect(() => parseNativeProjectTurn({ authorDocument: 'GDD.md', reviewDocuments: ['GDD.md'] })).toThrow('author document')
})
test('revision file metadata permits retained calculations/sidecars but not broad directories or traversal', () => {
  const input = { restartContext: true, reviewDocuments: ['GDD.md'], reviewContextPath: '/workspace/context.md',
    reviewStep: 'revise' as const, reviewWorkspace: '/workspace', reviewResultPath: '/workspace/result.txt', reviewWritableDocuments: ['GDD.md'],
    reviewWritableFiles: ['docs/calc/model.mjs', '.beegame/design-handoffs/GDD.json'],
    reviewReceiptContext: { step: 'revise' as const, findings: [], sourceHeadings: { 'GDD.md': ['Design'] } } }
  expect(parseNativeProjectTurn(input)).toBe(input)
  expect(parseNativeProjectTurn({ ...input, reviewReadScope: { 'GDD.md': [], 'AUDIO_DESIGN.md': ['Sound'] } })).toBeDefined()
  expect(() => parseNativeProjectTurn({ ...input, reviewReadScope: { 'GDD.md': [''] } })).toThrow('read scope')
  expect(parseNativeProjectTurn({ ...input, reviewWritableFiles: ['docs/visual/ART_DIRECTION/sample.svg', 'docs/visual/UI_UX_SPEC/sample.html'] })).toBeDefined()
  expect(parseNativeProjectTurn({ ...input, reviewWritableFiles: ['content/ui/menu.json', 'content/scenes/main.json'] })).toBeDefined()
  for (const path of ['docs/calc', 'docs/calc/../../game.js', '/docs/calc/model.mjs', 'game.js', '.beegame/delivery/state.json',
    'docs/visual', 'docs/visual/ART_DIRECTION/../../game.html', 'docs/visual/ART_DIRECTION/script.js', 'docs/visual/GDD/sample.html',
    'content/ui', 'content/ui/../scenes/main.json', 'content/index.json', 'content/scenes',
    'content/scenes/../../game.json', '/content/scenes/main.json', 'content/scenes/layout.js', 'content/ui/layout.js'])
    expect(() => parseNativeProjectTurn({ ...input, reviewWritableFiles: [path] })).toThrow(`revision file scope: ${JSON.stringify(path)}`)
  expect(() => parseNativeProjectTurn({ restartContext: true, reviewWritableFiles: ['docs/calc/model.mjs'] })).toThrow()
})

test('review context metadata is explicit and cannot be attached to an ordinary turn', () => {
  const turn = { restartContext: true, reviewDocuments: ['GDD.md'], reviewContextPath: '/workspace/context.md' }
  expect(parseNativeProjectTurn(turn)).toBe(turn)
  for (const invalid of [{ restartContext: true, reviewContextPath: turn.reviewContextPath },
    { ...turn, reviewContextPath: '' }, { ...turn, reviewContextPath: 7 }])
    expect(() => parseNativeProjectTurn(invalid)).toThrow()
})

test('bounded review metadata requires a step, receipt, workspace and explicit writable scope', () => {
  const turn = { restartContext: true, reviewDocuments: ['GDD.md'], reviewContextPath: '/workspace/context.md',
    reviewStep: 'inspect' as const, reviewResultPath: '/workspace/.beegame/tmp/result.txt', reviewWorkspace: '/workspace', reviewWritableDocuments: [],
    reviewReceiptContext: { step: 'inspect' as const, findings: [], sourceHeadings: { 'GDD.md': ['Design'] } } }
  expect(parseNativeProjectTurn(turn)).toBe(turn)
  for (const nextConsumers of [['resources'], ['implementation'], ['UI_UX_SPEC.md']]) {
    const scoped = { ...turn, reviewReceiptContext: { ...turn.reviewReceiptContext, nextConsumers } }
    expect(parseNativeProjectTurn(scoped)).toBe(scoped)
  }
  for (const affectedChange of [true, false]) {
    const scoped = { ...turn, reviewReceiptContext: { ...turn.reviewReceiptContext, affectedChange } }
    expect(parseNativeProjectTurn(scoped)).toBe(scoped)
  }
  for (const patch of [{ reviewStep: 'again' }, { reviewResultPath: '' }, { reviewWritableDocuments: undefined },
    { reviewStep: undefined }, { reviewDocuments: undefined }, { reviewReceiptContext: undefined },
    { reviewReceiptContext: { ...turn.reviewReceiptContext, step: 'verify' } },
    ...[[], ['unknown'], [7]].map(nextConsumers => ({ reviewReceiptContext: { ...turn.reviewReceiptContext, nextConsumers } })),
    ...['true', 1, null].map(affectedChange => ({ reviewReceiptContext: { ...turn.reviewReceiptContext, affectedChange } })),
    { reviewReceiptContext: { ...turn.reviewReceiptContext, sourceHeadings: { 'GDD.md': [7] } } }])
    expect(() => parseNativeProjectTurn({ ...turn, ...patch })).toThrow()
})

test('retained design answers require a matching revision and recorded decide ID', () => {
  const finding: DesignFinding = { id: 'F1', severity: 'blocker', action: 'decide', owner: 'user', documents: ['GDD.md'],
    sources: [{ document: 'GDD.md', section: 'Design' }], impact: 'Scope', closeWhen: 'Direction chosen', neededBefore: 'resources' }
  const decision = { id: 'F1', revision: 'a', toolUseID: 'q', question: 'Keep scope?', answer: 'Keep' }
  const input = { restartContext: true, reviewDocuments: ['GDD.md'], reviewStep: 'revise', reviewWorkspace: '/workspace',
    reviewResultPath: '/workspace/receipt.txt', reviewWritableDocuments: ['GDD.md'], reviewRevision: 'a', reviewUserDecisions: [decision],
    reviewReceiptContext: { step: 'revise', findings: [finding], sourceHeadings: { 'GDD.md': ['Design'] } } } satisfies NativeProjectTurnInput
  expect(parseNativeProjectTurn(input)).toBe(input)
  for (const patch of [{ reviewRevision: '' }, { reviewRevision: undefined }, { reviewUserDecisions: {} },
    { reviewUserDecisions: [{ ...decision, revision: 'old' }] }, { reviewUserDecisions: [{ ...decision, id: 'unknown' }] },
    { reviewUserDecisions: [{ ...decision, answer: '' }] }, { reviewStep: undefined }])
    expect(() => parseNativeProjectTurn({ ...input, ...patch })).toThrow()
})

test('keeps absent metadata absent and validates all three original role assignments', () => {
  expect(parseNativeDirectionAuthors(undefined)).toBeUndefined()
  const input: NativeDirectionAuthorInput = { contextPath: '/workspace/context.md',
    responsibilities: Object.fromEntries(NATIVE_DIRECTION_AUTHORS.map(author => [author.document, 'Original role'])) as NativeDirectionAuthorInput['responsibilities'] }
  expect(parseNativeDirectionAuthors(input)).toBe(input)
  for (const invalid of [null, [], {}, { ...input, contextPath: '' },
    { ...input, responsibilities: { 'TECHNICAL_DESIGN.md': 'Only one role' } }])
    expect(() => parseNativeDirectionAuthors(invalid)).toThrow()
})

test('scoped inputs require all owners and retain legacy shared input compatibility', () => {
  const input: NativeDirectionAuthorInput = { contextPath: '/workspace/context.md',
    responsibilities: Object.fromEntries(NATIVE_DIRECTION_AUTHORS.map(author => [author.document, 'Original role'])) as NativeDirectionAuthorInput['responsibilities'],
    contextPaths: Object.fromEntries(NATIVE_DIRECTION_AUTHORS.map(author => [author.document, '/workspace/' + author.document + '.context.md'])) as NativeDirectionAuthorInput['contextPaths'] }
  expect(parseNativeDirectionAuthors(input)).toBe(input)
  for (const contextPaths of [[], {}, { ...input.contextPaths, 'AUDIO_DESIGN.md': '' }])
    expect(() => parseNativeDirectionAuthors({ ...input, contextPaths })).toThrow()
})

test.each([2, 3, 4] as const)('batch %d validates only its scheduled owners and rejects other batches', batch => {
  const owners = nativeWritingAuthors(batch)
  const input: NativeDirectionAuthorInput = { batch, contextPath: '/workspace/context.md',
    responsibilities: Object.fromEntries(owners.map(author => [author.document, 'Owned role'])),
    contextPaths: Object.fromEntries(owners.map(author => [author.document, '/workspace/' + author.document + '.context.md'])) }
  expect(parseNativeDirectionAuthors(input)).toBe(input)
  for (const invalid of [{ ...input, batch: 0 }, { ...input, batch: '2' }, { ...input, batch: 5 },
    { ...input, responsibilities: {} }, { ...input, contextPaths: {} },
    { ...input, responsibilities: { ...input.responsibilities, 'GDD.md': 'Unassigned' } },
    { ...input, contextPaths: { ...input.contextPaths, 'GDD.md': '/workspace/gdd.md' } }])
    expect(() => parseNativeDirectionAuthors(invalid)).toThrow()
})
