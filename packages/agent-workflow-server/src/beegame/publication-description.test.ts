import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publicationDescriptionSources, validatePublicDescriptionDraft } from './publication-description'

test('draft inputs read only saved player-facing documents without changing them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'publication-copy-'))
  try {
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'docs/GDD.md'), '# Game\nFind the lighthouse.')
    await writeFile(join(root, 'docs/UI_UX_SPEC.md'), '# Controls\nArrow keys to move.')
    await writeFile(join(root, 'docs/TECHNICAL_DESIGN.md'), 'Internal implementation details')
    expect(await publicationDescriptionSources(root)).toEqual([
      { path: 'docs/GDD.md', text: '# Game\nFind the lighthouse.' },
      { path: 'docs/UI_UX_SPEC.md', text: '# Controls\nArrow keys to move.' },
    ])
    expect(await readFile(join(root, 'docs/GDD.md'), 'utf8')).toBe('# Game\nFind the lighthouse.')
    expect(validatePublicDescriptionDraft('  Goal\nFind the lighthouse.  ')).toBe('Goal\nFind the lighthouse.')
    expect(() => validatePublicDescriptionDraft(' ')).toThrow()
    expect(() => validatePublicDescriptionDraft('x'.repeat(4001))).toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('missing, oversized and symlink sources fail instead of inventing or reading other material', async () => {
  const root = await mkdtemp(join(tmpdir(), 'publication-copy-boundary-'))
  try {
    await expect(publicationDescriptionSources(root)).rejects.toThrow('No saved')
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'docs/GDD.md'), 'x'.repeat(65537))
    await expect(publicationDescriptionSources(root)).rejects.toThrow('64 KiB')
    await rm(join(root, 'docs/GDD.md'))
    await writeFile(join(root, 'private.txt'), 'Not a design document')
    await symlink(join(root, 'private.txt'), join(root, 'docs/GDD.md'))
    await expect(publicationDescriptionSources(root)).rejects.toThrow('without symlinks')
  } finally { await rm(root, { recursive: true, force: true }) }
})
