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

test('one GDD may own independent UI, Scene and calculation sections', async () => fixture(async root => {
  await mkdir(join(root, 'docs/calc'), { recursive: true })
  await mkdir(join(root, 'content/ui'), { recursive: true })
  await mkdir(join(root, 'content/scenes'), { recursive: true })
  await writeFile(join(root, 'content/ui/menu.json'), '{}')
  await writeFile(join(root, 'content/scenes/level.json'), '{}')
  await writeFile(join(root, 'docs/calc/result.json'), '{}')
  await writeFile(join(root, 'docs/GDD.md'), [
    '# Game', '',
    '## UI layout', '[Menu](../content/ui/menu.json)', '',
    '## Scene layout', '[Level](../content/scenes/level.json)', '',
    '## Balance calculation', '[Result](calc/result.json)', '',
  ].join('\n'))
  const result = checkDesignDocumentReferences(root, 'GDD.md')
  expect(result.valid).toBe(true)
  expect(result.retainedFiles).toEqual([
    'content/scenes/level.json', 'content/ui/menu.json', 'docs/calc/result.json',
  ])
}))

test('GDD retains linked UI and Scene sources with spaces and non-ASCII names', async () => fixture(async root => {
  const ui = 'content/ui/menu space/菜单.json'
  const scene = 'content/scenes/关卡 space.json'
  await mkdir(join(root, 'content/ui/menu space'), { recursive: true })
  await mkdir(join(root, 'content/scenes'), { recursive: true })
  await writeFile(join(root, ui), '{}')
  await writeFile(join(root, scene), '{}')
  await writeFile(join(root, 'docs/GDD.md'), [
    '# Game', '', `[Menu](${encodeURI('../' + ui)})`, '', `[Level](${encodeURI('../' + scene)})`, '',
  ].join('\n'))
  const result = checkDesignDocumentReferences(root, 'GDD.md')
  expect(result.valid).toBe(true)
  expect(result.retainedFiles).toEqual([scene, ui])
}))

test('reference checker refuses an unknown source document', async () => fixture(async root => {
  expect(() => checkDesignDocumentReferences(root, '../GDD.md')).toThrow('Unknown design document')
}))
