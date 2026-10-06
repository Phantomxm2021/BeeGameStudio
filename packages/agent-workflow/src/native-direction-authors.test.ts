import { expect, test } from 'bun:test'
import { NATIVE_DIRECTION_AUTHORS, nativeWritingAuthors, parseNativeDirectionAuthors, parseNativeProjectTurn, type NativeDirectionAuthorInput } from './native-direction-authors'
test('revision file metadata permits retained calculations/sidecars but not broad directories or traversal', () => {
  const input = { restartContext: true, reviewDocuments: ['GDD.md'], reviewContextPath: '/workspace/context.md',
    reviewStep: 'revise' as const, reviewWorkspace: '/workspace', reviewResultPath: '/workspace/result.txt', reviewWritableDocuments: ['GDD.md'],
    reviewWritableFiles: ['docs/calc/model.mjs', '.beegame/design-handoffs/GDD.json'],
    reviewReceiptContext: { step: 'revise' as const, findings: [], sourceHeadings: { 'GDD.md': ['Design'] } } }
  expect(parseNativeProjectTurn(input)).toBe(input)
  expect(parseNativeProjectTurn({ ...input, reviewWritableFiles: ['docs/visual/ART_DIRECTION/sample.svg', 'docs/visual/UI_UX_SPEC/sample.html'] })).toBeDefined()
  expect(parseNativeProjectTurn({ ...input, reviewWritableFiles: ['content/ui/menu.json'] })).toBeDefined()
  for (const path of ['docs/calc', 'docs/calc/../../game.js', '/docs/calc/model.mjs', 'game.js', '.beegame/delivery/state.json',
    'docs/visual', 'docs/visual/ART_DIRECTION/../../game.html', 'docs/visual/ART_DIRECTION/script.js', 'docs/visual/GDD/sample.html',
    'content/ui', 'content/ui/../scenes/main.json', 'content/index.json', 'content/scenes/main.json', 'content/ui/layout.js'])
    expect(() => parseNativeProjectTurn({ ...input, reviewWritableFiles: [path] })).toThrow('revision file scope')
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
  for (const patch of [{ reviewStep: 'again' }, { reviewResultPath: '' }, { reviewWritableDocuments: undefined },
    { reviewStep: undefined }, { reviewDocuments: undefined }, { reviewReceiptContext: undefined },
    { reviewReceiptContext: { ...turn.reviewReceiptContext, step: 'verify' } },
    { reviewReceiptContext: { ...turn.reviewReceiptContext, sourceHeadings: { 'GDD.md': [7] } } }])
    expect(() => parseNativeProjectTurn({ ...turn, ...patch })).toThrow()
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
