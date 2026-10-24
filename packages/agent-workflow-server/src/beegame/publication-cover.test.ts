import { expect, test } from 'bun:test'
import sharp from 'sharp'
import { preparePublicationCover } from './publication-cover'

test('decodes actual cover dimensions and returns a metadata-free 16:9 WebP', async () => {
  const input = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#345678' } })
    .png().toBuffer()
  const output = await preparePublicationCover({ mediaType: 'image/png', filename: 'cover.png', data: input.toString('base64') })
  const metadata = await sharp(output).metadata()
  expect(metadata).toMatchObject({ format: 'webp', width: 160, height: 90 })
  expect(metadata.exif).toBeUndefined()
})

test('rejects wrong ratios and corrupt bytes even when the MIME and filename claim PNG', async () => {
  const square = await sharp({ create: { width: 90, height: 90, channels: 3, background: '#345678' } }).png().toBuffer()
  await expect(preparePublicationCover({ mediaType: 'image/png', filename: 'cover.png', data: square.toString('base64') }))
    .rejects.toThrow('16:9')
  const corrupt = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await expect(preparePublicationCover({ mediaType: 'image/png', filename: 'cover.png', data: corrupt.toString('base64') }))
    .rejects.toThrow('decoded')
})
