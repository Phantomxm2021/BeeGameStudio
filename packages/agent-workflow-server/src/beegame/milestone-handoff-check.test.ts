import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkSavedMilestoneResult } from './milestone-handoff-check'
import { checkDesignHandoff } from './design-handoff'
import { writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'

async function fixture(run: (root: string, path: string) => Promise<void>) {
  const root = await mkdtemp('/private/tmp/bgs-host-receipt-test-')
  const directory = join(root, '.beegame/tmp/task')
  await mkdir(directory, { recursive: true })
  try { await run(root, join(directory, 'milestone-current.txt')) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('host checks only the exact assigned receipt and never adopts or overwrites another file', () => fixture(async (root, path) => {
  const wrong = path.replace('current', 'other')
  await writeFile(wrong, 'complete\n')
  expect((await checkSavedMilestoneResult(root, { phase: 'author', path }))?.issues).toEqual(['Current-turn milestone receipt is missing.'])
  await writeFile(path, 'COMPLETE\n')
  expect(await checkSavedMilestoneResult(root, { phase: 'author', path })).toEqual({ status: 'complete', issues: [] })
  expect(await readFile(wrong, 'utf8')).toBe('complete\n')
}))

test.each(['author', 'resources', 'content', 'implementation'] as const)('%s checks shape and preserves genuine blocked outcomes', phase => fixture(async (root, path) => {
  const assigned = { phase, path }
  await writeFile(path, 'done\n')
  const first = await checkSavedMilestoneResult(root, assigned)
  expect(first?.issues.join('; ')).toContain('first line')
  await writeFile(path, 'blocked\n')
  const second = await checkSavedMilestoneResult(root, assigned)
  expect(second?.key).not.toBe(first?.key)
  expect(second?.issues.join('; ')).toContain('must include a reason')
  await writeFile(path, 'BLOCKED\nActual necessary input unavailable.\n')
  expect(await checkSavedMilestoneResult(root, assigned)).toEqual({ status: 'blocked', issues: [] })
  await writeFile(path, 'complete\n{"summary":"Malformed report","designIssues":42}')
  expect((await checkSavedMilestoneResult(root, assigned))?.issues.join('; ')).toContain('designIssues')
}))

test('receipt symlink outside the project cannot be read or adopted', () => fixture(async (root, path) => {
  await symlink('/etc/hosts', path)
  await expect(checkSavedMilestoneResult(root, { phase: 'author', path })).rejects.toThrow('inside the current workspace')
}))

test('another valid project receipt cannot be adopted through an inside-workspace symlink', () => fixture(async (root, path) => {
  const other = path.replace('current', 'other')
  await writeFile(other, 'complete\n')
  await symlink(other, path)
  await expect(checkSavedMilestoneResult(root, { phase: 'author', path })).rejects.toThrow('exact assigned file')
  expect(await readFile(other, 'utf8')).toBe('complete\n')
}))

test('production cannot erase previously reported issues by rewriting the completion summary', () => fixture(async (root, path) => {
  const assigned = { phase: 'resources' as const, path }
  await writeFile(path, 'complete\n' + JSON.stringify({ summary: 'Saved', designIssues: [{ id: 'font-gap', owner: 'BAD' }] }))
  expect((await checkSavedMilestoneResult(root, assigned))?.issues.length).toBeGreaterThan(0)
  for (const body of ['Saved, font gap mentioned here', '{"summary":"font gap","designIssues":[]}']) {
    await writeFile(path, 'complete\n' + body)
    expect((await checkSavedMilestoneResult(root, assigned))?.issues.join('; ')).toContain('font-gap')
  }
  await writeFile(path, 'complete\n' + JSON.stringify({ summary: 'Corrected', designIssues: [],
    resolved: [{ id: 'font-gap', disposition: 'not-applicable', evidence: 'The approved synthetic labels do not require this glyph.' }] }))
  expect((await checkSavedMilestoneResult(root, assigned))?.issues).toEqual(['Resources handoff requires a reviewed design baseline.'])
}))

test('protection follows actual saved design, not receipt prose or resource bindings', () => fixture(async (root, path) => {
  await writeDesignDocumentsFixture(root)
  const source = join(root, 'content/scenes/level.json')
  const original = JSON.parse(await readFile(source, 'utf8'))
  original.data.nodes[1].components = [{ id: 'visual', type: 'sprite-renderer', data: { color: '#abcdef', size: [50, 50] } }]
  await writeFile(source, JSON.stringify(original))
  const baseline = checkDesignHandoff(root, PROJECT_DOCUMENTS)
  expect(baseline.issues).toEqual([])
  const assigned = { phase: 'implementation' as const, path, designBaseline: baseline }
  await writeFile(path, 'complete\n')
  const bound = structuredClone(original); bound.data.nodes[1].components[0].assetRef = 'production-art'
  await writeFile(source, JSON.stringify(bound))
  expect(await checkSavedMilestoneResult(root, assigned)).toMatchObject({ status: 'complete', issues: [] })
  delete bound.data.nodes[1].components[0].data.color
  await writeFile(source, JSON.stringify(bound))
  const failure = await checkSavedMilestoneResult(root, assigned)
  expect(failure?.issues.join('; ')).toContain('protected reviewed design')
  await writeFile(path, 'complete\nDifferent completion prose\n')
  expect((await checkSavedMilestoneResult(root, assigned))?.key).toBe(failure?.key)
  await writeFile(path, 'blocked\nRequired owner direction unavailable.\n')
  expect(await checkSavedMilestoneResult(root, assigned)).toMatchObject({ status: 'blocked', issues: [] })
}))
