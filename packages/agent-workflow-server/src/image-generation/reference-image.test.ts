import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { ImageReferenceError, readProjectReferenceImage } from './reference-image'

test('reference image must be a real project PNG under assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-image-reference-'))
  const outside = await mkdtemp(join(tmpdir(), 'bgs-image-outside-'))
  try {
    await mkdir(join(root, 'assets/generated'), { recursive: true })
    const image = await sharp({ create: { width: 8, height: 8, channels: 4,
      background: { r: 20, g: 40, b: 60, alpha: 1 } } }).png().toBuffer()
    await writeFile(join(root, 'assets/generated/board.png'), image)
    const reference = await readProjectReferenceImage(root, 'assets/generated/board.png')
    expect(Buffer.from(reference.bytes).toString('hex')).toBe(image.toString('hex'))
    expect(reference.sha256).toMatch(/^[a-f0-9]{64}$/)
    for (const path of ['../outside.png', '/tmp/outside.png', 'docs/secret.png', 'assets/../../secret.png'])
      await expect(readProjectReferenceImage(root, path)).rejects.toBeInstanceOf(ImageReferenceError)
    await writeFile(join(root, 'assets/generated/fake.png'), 'not a PNG')
    await expect(readProjectReferenceImage(root, 'assets/generated/fake.png')).rejects.toMatchObject({ code: 'format' })
    await writeFile(join(outside, 'outside.png'), image)
    await symlink(join(outside, 'outside.png'), join(root, 'assets/generated/link.png'))
    await expect(readProjectReferenceImage(root, 'assets/generated/link.png')).rejects.toMatchObject({ code: 'path' })
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
