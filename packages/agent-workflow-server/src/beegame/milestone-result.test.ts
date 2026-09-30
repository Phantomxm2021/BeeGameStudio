import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMilestoneResult } from './milestone-result'

test('milestone signal is explicit, not extracted from natural language', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-milestone-result-'))
  const path = join(root, 'result.txt')
  try {
    expect(await readMilestoneResult(path, 'review')).toBeUndefined()
    for (const text of ['PASS', 'Review complete, but blocked', 'blocked']) {
      await writeFile(path, text)
      expect(await readMilestoneResult(path, 'review')).toBeUndefined()
    }
    await writeFile(path, 'blocked\n需求存在矛盾')
    expect(await readMilestoneResult(path, 'review')).toMatchObject({ status: 'blocked', summary: '需求存在矛盾' })
    await writeFile(path, 'complete\n')
    expect(await readMilestoneResult(path, 'implementation')).toMatchObject({ phase: 'implementation', status: 'complete' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
