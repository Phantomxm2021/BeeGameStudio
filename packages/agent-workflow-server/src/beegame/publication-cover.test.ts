import { expect, test } from 'bun:test'
import sharp from 'sharp'
import { preparePublicationCover, distinctPublicationCovers } from './publication-cover'

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


test('compresses a 4K cover to 1280 × 720 without changing its ratio', async () => {
  const width = 3840, height = 2160
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 3
    pixels[offset] = x % 256
    pixels[offset + 1] = y % 256
    pixels[offset + 2] = (x + y) % 256
  }
  const input = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer()
  const output = await preparePublicationCover({ mediaType: 'image/png', filename: 'large.png', data: input.toString('base64') })
  expect(await sharp(output).metadata()).toMatchObject({ format: 'webp', width: 1280, height: 720 })
  expect(output.length).toBeLessThan(input.length)
})

test('validates the source ratio before resize can round it to 16:9', async () => {
  const input = await sharp({ create: { width: 2561, height: 1440, channels: 3, background: '#345678' } }).png().toBuffer()
  await expect(preparePublicationCover({ mediaType: 'image/png', filename: 'almost.png', data: input.toString('base64') }))
    .rejects.toThrow('2561 × 1440')
})

test('validates and compresses using EXIF-oriented dimensions', async () => {
  const input = await sharp({ create: { width: 900, height: 1600, channels: 3, background: '#345678' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer()
  const output = await preparePublicationCover({ mediaType: 'image/jpeg', filename: 'rotated.jpg', data: input.toString('base64') })
  const metadata = await sharp(output).metadata()
  expect(metadata).toMatchObject({ format: 'webp', width: 1280, height: 720 })
  expect(metadata.exif).toBeUndefined()
})


test('deduplicates identical views despite JPEG noise or a small animation, retaining a visibly different cover', async () => {
  const base = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#182333' } }).png().toBuffer()
  const jpeg = await sharp(base).jpeg({ quality: 65 }).toBuffer()
  const smallAnimation = await sharp(base).composite([{ input: await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } }).png().toBuffer(), left: 600, top: 350 }]).webp().toBuffer()
  const different = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#b2d8a1' } }).webp().toBuffer()
  const result = await distinctPublicationCovers([base, base, jpeg, smallAnimation, different])
  expect(result).toHaveLength(2)
  expect(result[0]).toEqual(base)
  expect(result[1]).toEqual(different)
})
