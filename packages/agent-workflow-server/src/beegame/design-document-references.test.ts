import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDesignDocumentReferences } from './design-document-references'
import { runGameContentCommand } from './game-content-validation-cli'
import { advanceProjectDeliveryAfterTurn, beginProjectDelivery, prepareProjectDesignReview, projectDeliveryStatePath, readProjectDelivery } from './project-delivery'
import { designDocumentFixture, designHandoffFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture } from './fixtures/layout-fixture'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(text: string) {
  const root = mkdtempSync(join(tmpdir(), 'bgs-document-references-')); roots.push(root)
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs/GDD.md'), text)
  return root
}

test('standard local link forms resolve relative to their source, without inspecting remote URLs or code examples', () => {
  const source = '# Game\n[Controls](UI_UX_SPEC.md#controls)\n[Input][ui]\n\n[ui]: UI_UX_SPEC.md\n\n`docs/UI_UX_SPEC.md`\n[Reference](https://example.test/design.md)\n```md\n[Example](NOT_A_SOURCE.md)\n```'
  const root = fixture(source)
  writeFileSync(join(root, 'docs/UI_UX_SPEC.md'), '# Controls')
  expect(checkDesignDocumentReferences(root, 0)).toMatchObject({ valid: true, checkedReferences: 2, pendingReferences: [] })
  expect(readFileSync(join(root, 'docs/GDD.md'), 'utf8')).toBe(source)
})

test('only genuinely later scheduled documents may be pending, not arbitrary promised files', () => {
  const root = fixture('[Future controls](UI_UX_SPEC.md)\n[Invented owner](UNASSIGNED_DESIGN.md)')
  const result = checkDesignDocumentReferences(root, 0)
  expect(result.valid).toBe(false)
  expect(result.pendingReferences).toHaveLength(1)
  expect(result.issues).toHaveLength(1)
  expect(result.issues[0]).toContain('UNASSIGNED_DESIGN.md')
  expect(checkDesignDocumentReferences(root).pendingReferences).toEqual([])
  expect(checkDesignDocumentReferences(root).issues).toHaveLength(2)
  expect(runGameContentCommand(root, ['--design-references', '--author-batch', '1']))
    .toMatchObject({ valid: false, scope: 'design-document-references', runtimeVerified: false })
  for (const value of ['0', '1.5', '6', 'NaN'])
    expect(() => runGameContentCommand(root, ['--design-references', '--author-batch', value])).toThrow()
})

test('empty targets, traversal, encoded traversal and symlinks outside the workspace cannot become authorities', () => {
  const root = fixture('[Empty](EMPTY.md)\n[Outside](../../OUTSIDE.md)\n[Encoded](%2e%2e/%2e%2e/OUTSIDE.md)\n[Symlink](LINK.md)')
  const outside = fixture('# External')
  writeFileSync(join(root, 'docs/EMPTY.md'), '')
  symlinkSync(join(outside, 'docs/GDD.md'), join(root, 'docs/LINK.md'))
  const result = checkDesignDocumentReferences(root, 0)
  expect(result.issues).toHaveLength(4)
  expect(result.pendingReferences).toHaveLength(0)
})

test('an unlinked authority title is reported as unmeasured, not falsely certified as closed', () => {
  const root = fixture('# Game\nThe controls document owns the unresolved mappings.')
  expect(checkDesignDocumentReferences(root, 0)).toMatchObject({ checkedReferences: 0, uncitedDocuments: ['docs/GDD.md'] })
  expect(checkDesignDocumentReferences(root, 0).note).toContain('Unlinked titles')
})

test('embedded visual references are checked and binary byte changes alter the reference revision', () => {
  const root = fixture('![Visual](visual/ART_DIRECTION/sample.png)\n![Other][missing]\n\n[missing]: visual/ART_DIRECTION/missing.png\n')
  mkdirSync(join(root, 'docs/visual/ART_DIRECTION'), { recursive: true })
  const path = join(root, 'docs/visual/ART_DIRECTION/sample.png')
  writeFileSync(path, Buffer.from([0xff]))
  const before = checkDesignDocumentReferences(root, 0)
  expect(before.checkedReferences).toBe(2)
  expect(before.issues).toHaveLength(1)
  expect(before.issues[0]).toContain('missing.png')
  writeFileSync(path, Buffer.from([0xfe])) // Both decode as a replacement character in UTF-8.
  expect(checkDesignDocumentReferences(root, 0).inputRevision).not.toBe(before.inputRevision)
})

test('platform-temporary references fail both before and after cleanup, including non-Markdown inputs', () => {
  const root = fixture('[Brief](../.beegame/tmp/session/context.md)\n[Input][state]\n\n[state]: ../.beegame/tmp/session/input.json')
  const temporary = join(root, '.beegame/tmp/session')
  mkdirSync(temporary, { recursive: true })
  writeFileSync(join(temporary, 'context.md'), '# Temporary brief')
  writeFileSync(join(temporary, 'input.json'), '{}')
  const before = checkDesignDocumentReferences(root, 0)
  expect(before).toMatchObject({ valid: false, checkedReferences: 2, pendingReferences: [] })
  expect(before.issues).toHaveLength(2)
  expect(before.issues.every(issue => issue.includes('platform-temporary'))).toBe(true)
  rmSync(temporary, { recursive: true })
  expect(checkDesignDocumentReferences(root, 0)).toEqual(before)
})

test('encoded links and symlink aliases cannot turn temporary inputs into persistent sources', () => {
  const root = fixture('[Encoded](../.beegame/%74mp/session/context.md)\n[Alias](BRIEF.md)\n[JSON alias](input.json)')
  const temporary = join(root, '.beegame/tmp/session')
  mkdirSync(temporary, { recursive: true })
  writeFileSync(join(temporary, 'context.md'), '# Input')
  writeFileSync(join(temporary, 'input.json'), '{}')
  symlinkSync(join(temporary, 'context.md'), join(root, 'docs/BRIEF.md'))
  symlinkSync(join(temporary, 'input.json'), join(root, 'docs/input.json'))
  const result = checkDesignDocumentReferences(root, 0)
  expect(result).toMatchObject({ valid: false, checkedReferences: 3 })
  expect(result.issues).toHaveLength(3)
  expect(result.issues.every(issue => issue.includes('platform-temporary'))).toBe(true)
})

test('a delivered document cannot itself be a symlink to a temporary file', () => {
  const root = fixture('# Placeholder')
  const temporary = join(root, '.beegame/tmp/session')
  mkdirSync(temporary, { recursive: true })
  writeFileSync(join(temporary, 'draft.md'), '# Input')
  rmSync(join(root, 'docs/GDD.md'))
  symlinkSync(join(temporary, 'draft.md'), join(root, 'docs/GDD.md'))
  expect(checkDesignDocumentReferences(root, 0)).toMatchObject({ valid: false,
    issues: ['docs/GDD.md: source resolves to a platform-temporary file'] })
})

test('persistent platform contracts and user-owned tmp-named files remain valid', () => {
  const root = fixture('[Notes](../tmp/notes.md)\n[Contract](../.beegame/delivery/content-format.json)\n[Resource](../assets/future.png)')
  mkdirSync(join(root, 'tmp'))
  writeFileSync(join(root, 'tmp/notes.md'), '# Retained notes')
  mkdirSync(join(root, '.beegame/delivery'), { recursive: true })
  writeFileSync(join(root, '.beegame/delivery/content-format.json'), '{}')
  expect(checkDesignDocumentReferences(root, 0)).toMatchObject({ valid: true, checkedReferences: 2, issues: [] })
})

test('a broken source enters the joint diagnostic review but cannot release or re-dispatch authors', async () => {
  const root = fixture('[Owner](UNASSIGNED_DESIGN.md)')
  const state = await beginProjectDelivery(root, root, 'Build a game')
  await writeDesignDocumentsFixture(root)
  await writeDesignDocumentFixture(root, 'GDD.md', designHandoffFixture('GDD.md'),
    designDocumentFixture('GDD.md') + '[Owner](UNASSIGNED_DESIGN.md)')
  writeFileSync(projectDeliveryStatePath(root, root), JSON.stringify({ ...state, authorBatch: 4 }))
  const handoff = await advanceProjectDeliveryAfterTurn(root, root, undefined, 4)
  expect(handoff).toMatchObject({ phase: 'review', shouldContinue: true })
  expect(checkDesignDocumentReferences(root, 4).issues.join(' ')).toContain('UNASSIGNED_DESIGN.md')
  await prepareProjectDesignReview(root, root)
  const release = await advanceProjectDeliveryAfterTurn(root, root, { phase: 'review', status: 'complete', summary: '',
    review: { step: 'inspect', findings: [], resolved: [] } })
  expect(release).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(root, root))?.designReview).toMatchObject({ step: 'revise', writableDocuments: ['GDD.md'] })
  const unrepaired = await advanceProjectDeliveryAfterTurn(root, root, { phase: 'review', status: 'complete', summary: '',
    review: { step: 'revise', findings: [], resolved: [] } })
  expect(unrepaired?.shouldContinue).toBe(false)
  expect((await readProjectDelivery(root, root))?.designBaseline).toBeUndefined()
})

test('a legitimate pending future owner continues writing without an intermediate review or invented answer', async () => {
  const root = fixture('')
  await beginProjectDelivery(root, root, 'Build a game')
  writeFileSync(join(root, 'docs/GDD.md'), designDocumentFixture('GDD.md') + '[Pending input design](UI_UX_SPEC.md)')
  expect(await advanceProjectDeliveryAfterTurn(root, root, { phase: 'author', status: 'complete', summary: 'Saved GDD' })).toMatchObject({ phase: 'author', shouldContinue: true, issues: [] })
  expect(await readProjectDelivery(root, root)).toMatchObject({ phase: 'author', authorBatch: 1 })
  expect((await readProjectDelivery(root, root))?.designBaseline).toBeUndefined()
})

test('a Review complete claim cannot override a missing reference even when all eight files exist', async () => {
  const root = fixture('# Game')
  const state = await beginProjectDelivery(root, root, 'Build a game')
  await writeDesignDocumentsFixture(root)
  writeFileSync(join(root, 'docs/GDD.md'), designDocumentFixture('GDD.md') + '[Owner](UNASSIGNED_DESIGN.md)')
  writeFileSync(projectDeliveryStatePath(root, root), JSON.stringify({ ...state, phase: 'review' }))
  await prepareProjectDesignReview(root, root)
  const result = await advanceProjectDeliveryAfterTurn(root, root, { phase: 'review', status: 'complete', summary: 'Claimed ready', review: { step: 'inspect', findings: [], resolved: [] } })
  expect(result).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(root, root))?.designBaseline).toBeUndefined()
  const unrepaired = await advanceProjectDeliveryAfterTurn(root, root, { phase: 'review', status: 'complete', summary: '',
    review: { step: 'revise', findings: [], resolved: [] } })
  expect(unrepaired?.shouldContinue).toBe(false)
  expect(unrepaired?.issues.join(' ')).toContain('UNASSIGNED_DESIGN.md')
})

test('local draft checks allow only pending peers; strict batch and prior authorities remain strict', () => {
  const root = fixture('# Core contract')
  const source = '[Core](GDD.md)\n[Art](ART_DIRECTION.md)\n[Audio](AUDIO_DESIGN.md)'
  writeFileSync(join(root, 'docs/TECHNICAL_DESIGN.md'), source)
  const args = ['--design-references', '--author-batch', '2', '--document', 'TECHNICAL_DESIGN.md']
  const local = checkDesignDocumentReferences(root, 1, 'TECHNICAL_DESIGN.md')
  expect(local).toMatchObject({ valid: true, checkedDocuments: ['docs/TECHNICAL_DESIGN.md'] })
  expect(local.pendingReferences).toHaveLength(2)
  expect(runGameContentCommand(root, args)).toMatchObject(local)
  expect(checkDesignDocumentReferences(root, 1).valid).toBe(false)
  rmSync(join(root, 'docs/GDD.md'))
  expect(checkDesignDocumentReferences(root, 1, 'TECHNICAL_DESIGN.md').issues.join(' ')).toContain('GDD.md')
  expect(() => checkDesignDocumentReferences(root, 0, 'TECHNICAL_DESIGN.md')).toThrow()
  expect(() => checkDesignDocumentReferences(root, 1, '../../other.md')).toThrow()
  expect(() => runGameContentCommand(root, [...args, '--document', 'ART_DIRECTION.md'])).toThrow()
  expect(checkDesignDocumentReferences(root, 1, 'ART_DIRECTION.md').valid).toBe(false)
  expect(readFileSync(join(root, 'docs/TECHNICAL_DESIGN.md'), 'utf8')).toBe(source)
})

test('reference revision tracks scope, source, dependency contents, arrival and symlink identity', () => {
  const root = fixture('# Contract')
  const path = join(root, 'docs/TECHNICAL_DESIGN.md')
  writeFileSync(path, '[Core](GDD.md)\n[Art](ART_DIRECTION.md)')
  const check = () => checkDesignDocumentReferences(root, 1, 'TECHNICAL_DESIGN.md')
  const original = check().inputRevision
  expect(check().inputRevision).toBe(original)
  expect(checkDesignDocumentReferences(root, 1).inputRevision).not.toBe(original)
  writeFileSync(join(root, 'docs/GDD.md'), '# Changed contract')
  const dependencyChanged = check().inputRevision
  expect(dependencyChanged).not.toBe(original)
  writeFileSync(join(root, 'docs/ART_DIRECTION.md'), '# Art')
  expect(check().inputRevision).not.toBe(dependencyChanged)
  const arrived = check().inputRevision
  writeFileSync(path, '[Core](GDD.md)\n[Art](ART_DIRECTION.md)\n[Resource](alias.json)')
  expect(check().inputRevision).not.toBe(arrived)
  writeFileSync(join(root, 'docs/resource.json'), '{}')
  symlinkSync(join(root, 'docs/resource.json'), join(root, 'docs/alias.json'))
  const persistent = check()
  mkdirSync(join(root, '.beegame/tmp'), { recursive: true })
  writeFileSync(join(root, '.beegame/tmp/resource.json'), '{}')
  rmSync(join(root, 'docs/alias.json'))
  symlinkSync(join(root, '.beegame/tmp/resource.json'), join(root, 'docs/alias.json'))
  const temporary = check()
  expect(persistent.valid).toBe(true)
  expect(temporary.valid).toBe(false)
  expect(temporary.inputRevision).not.toBe(persistent.inputRevision)
})

test('host handoff cannot substitute a valid local check for missing direction drafts', async () => {
  const root = fixture('# Gameplay')
  const state = await beginProjectDelivery(root, root, 'Build a game')
  writeFileSync(join(root, 'docs/TECHNICAL_DESIGN.md'), '[Core](GDD.md)\n[Art](ART_DIRECTION.md)')
  writeFileSync(projectDeliveryStatePath(root, root), JSON.stringify({ ...state, authorBatch: 1 }))
  expect(checkDesignDocumentReferences(root, 1, 'TECHNICAL_DESIGN.md').valid).toBe(true)
  const result = await advanceProjectDeliveryAfterTurn(root, root,
    { phase: 'author', status: 'complete', summary: 'Claimed local check passed' }, 1)
  expect(result?.phase).toBe('author')
  expect(result?.issues.join(' ')).toContain('ART_DIRECTION.md is missing')
  expect((await readProjectDelivery(root, root))?.authorBatch).toBe(1)
})

test('retained design evidence must exist; planned assets and later documents remain stage-scoped', () => {
  const root = fixture('[Calculation](calc/inputs.json)\n[Formula](calc/formula.mjs)\n[Planned art](../assets/player.png)\n[Future UI](UI_UX_SPEC.md)')
  mkdirSync(join(root, 'docs/calc'))
  writeFileSync(join(root, 'docs/calc/formula.mjs'), 'export const result = 4')
  const missing = checkDesignDocumentReferences(root, 0)
  expect(missing.valid).toBe(false)
  expect(missing.issues).toHaveLength(1)
  expect(missing.issues[0]).toContain('retained design evidence does not exist: calc/inputs.json')
  expect(missing.pendingReferences).toHaveLength(1)
  writeFileSync(join(root, 'docs/calc/inputs.json'), '{"speed":4}')
  const saved = checkDesignDocumentReferences(root, 0)
  expect(saved).toMatchObject({ valid: true, checkedReferences: 3 })
  writeFileSync(join(root, 'docs/calc/inputs.json'), '{"speed":8}')
  expect(checkDesignDocumentReferences(root, 0).inputRevision).not.toBe(saved.inputRevision)
  writeFileSync(join(root, 'docs/calc/inputs.json'), '')
  expect(checkDesignDocumentReferences(root, 0).issues.join(' ')).toContain('not a nonempty file')
})

test('file evidence outside docs cannot evade validation, including relative path mistakes and external targets', () => {
  const root = fixture('[Model](../calc/model.json)\n[Result](../calc/result.txt)\n[Script](../calc/model.mjs)\n[Outside](../../result.txt)\n[Invalid](%zz.json)\n[Planned](../assets/future.png)\n[Future content](../content/scenes/future.json)')
  const missing = checkDesignDocumentReferences(root, 0)
  expect(missing.valid).toBe(false)
  expect(missing.issues).toHaveLength(5)
  expect(missing.issues.join(' ')).toContain('retained design evidence does not exist: ../calc/model.json')
  expect(missing.issues.join(' ')).toContain('leaves the workspace')
  expect(missing.issues.join(' ')).toContain('invalid document reference')
  mkdirSync(join(root, 'calc'))
  writeFileSync(join(root, 'calc/model.json'), '{}')
  writeFileSync(join(root, 'calc/result.txt'), 'Observed result')
  writeFileSync(join(root, 'calc/model.mjs'), 'export default 1')
  writeFileSync(join(root, 'docs/GDD.md'), '[Model](../calc/model.json)\n[Result](../calc/result.txt)\n[Script](../calc/model.mjs)\n[Directory](../calc/)\n[Planned](../assets/future.png)\n[Future content](../content/scenes/future.json)')
  expect(checkDesignDocumentReferences(root, 0)).toMatchObject({ valid: true, checkedReferences: 3 })
})

test('retained evidence cannot resolve outside the workspace or to transient task files', () => {
  const root = fixture('[Outside](calc/outside.json)\n[Temporary](calc/temporary.json)')
  const outside = fixture('# External')
  mkdirSync(join(root, 'docs/calc'))
  mkdirSync(join(root, '.beegame/tmp'), { recursive: true })
  writeFileSync(join(outside, 'inputs.json'), '{}')
  writeFileSync(join(root, '.beegame/tmp/inputs.json'), '{}')
  symlinkSync(join(outside, 'inputs.json'), join(root, 'docs/calc/outside.json'))
  symlinkSync(join(root, '.beegame/tmp/inputs.json'), join(root, 'docs/calc/temporary.json'))
  const result = checkDesignDocumentReferences(root, 0)
  expect(result).toMatchObject({ valid: false, checkedReferences: 2 })
  expect(result.issues).toHaveLength(2)
  expect(result.issues[0]).toContain('outside the workspace')
  expect(result.issues[1]).toContain('platform-temporary')
})

test('a review completion claim cannot release downstream work with missing cited evidence', async () => {
  const root = fixture(designDocumentFixture('GDD.md') + '[Calculation inputs](calc/inputs.json)')
  const state = await beginProjectDelivery(root, root, 'Build a game')
  await writeDesignDocumentsFixture(root)
  writeFileSync(projectDeliveryStatePath(root, root), JSON.stringify({ ...state, phase: 'review', authorBatch: 4 }))
  await prepareProjectDesignReview(root, root)
  const result = await advanceProjectDeliveryAfterTurn(root, root,
    { phase: 'review', status: 'complete', summary: 'The document claims its calculation passed', review: { step: 'inspect', findings: [], resolved: [] } })
  expect(result).toMatchObject({ phase: 'review', shouldContinue: true })
  expect((await readProjectDelivery(root, root))?.designBaseline).toBeUndefined()
  const unrepaired = await advanceProjectDeliveryAfterTurn(root, root, { phase: 'review', status: 'complete', summary: '',
    review: { step: 'revise', findings: [], resolved: [] } })
  expect(unrepaired?.shouldContinue).toBe(false)
  expect(unrepaired?.issues.join(' ')).toContain('retained design evidence does not exist')
  expect(await readProjectDelivery(root, root)).toMatchObject({ phase: 'review', authorBatch: 4 })
})
