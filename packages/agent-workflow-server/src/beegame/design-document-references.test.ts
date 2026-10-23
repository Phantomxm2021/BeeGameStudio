import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDesignDocumentReferences } from './design-document-references'

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'bgs-design-reference-'))
  try {
    await mkdir(join(root, 'docs'))
    await run(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('reference checker reads one requested document and reports missing cited documents', async () => fixture(async root => {
  await writeFile(join(root, 'docs/GDD.md'), '# Game\n[Art](ART_DIRECTION.md)\n[Local](#game)')
  const missing = checkDesignDocumentReferences(root, 'GDD.md')
  expect(missing.checkedDocuments).toEqual(['docs/GDD.md'])
  expect(missing.issues.join(' ')).toContain('ART_DIRECTION.md')
  expect(missing.checkedReferences).toBe(1)
  await writeFile(join(root, 'docs/ART_DIRECTION.md'), '# Art')
  expect(checkDesignDocumentReferences(root, 'GDD.md').issues).toEqual([])
  expect(checkDesignDocumentReferences(root, 'GDD.md').inputRevision).not.toBe(missing.inputRevision)
}))

test('reference checker rejects absent retained evidence and temporary outputs', async () => fixture(async root => {
  await writeFile(join(root, 'docs/GDD.md'), '# Game\n[Evidence](../calc/proof.json)\n[Scratch](../.beegame/tmp/proof.json)')
  const result = checkDesignDocumentReferences(root, 'GDD.md')
  expect(result.issues.some(issue => issue.includes('retained design evidence does not exist'))).toBe(true)
  expect(result.issues.some(issue => issue.includes('platform-temporary reference'))).toBe(true)
}))

test('reference checker refuses an unknown source document', async () => fixture(async root => {
  expect(() => checkDesignDocumentReferences(root, '../GDD.md')).toThrow('Unknown design document')
}))
