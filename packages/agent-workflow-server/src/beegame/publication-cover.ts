import sharp from 'sharp'
import { BeeGameUploadPolicyError, validateBeeGameAttachments } from '../security/upload-policy'

export const PUBLICATION_COVER_PATH = '__bgs_publication/cover.webp'

/** User-supplied release metadata, never a generated project resource. */
export async function preparePublicationCover(value: { mediaType: string; filename: string; data: string }): Promise<Buffer> {
  const [attachment] = validateBeeGameAttachments([{ ...value, type: 'image' }])
  try {
    const image = sharp(Buffer.from(attachment!.data, 'base64'), {
      limitInputPixels: 16_777_216, failOn: 'warning',
    })
    // Validate the oriented source before resize rounding can mask a wrong ratio.
    const { autoOrient: { width, height } } = await image.metadata()
    if (!width || width * 9 !== height * 16) {
      throw new BeeGameUploadPolicyError(`Cover must be 16:9; received ${width} × ${height}.`)
    }
    // Uploads and preview captures share the same bounded, metadata-free WebP.
    return await image.rotate().resize({ width: 1280, height: 720, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 }).toBuffer()
  } catch (error) {
    if (error instanceof BeeGameUploadPolicyError) throw error
    throw new BeeGameUploadPolicyError('Cover could not be decoded. Use a PNG, JPEG or WebP image of up to 16 megapixels.')
  }
}

export function publicationCoverUrl(gameUrl: string): string {
  const url = new URL(PUBLICATION_COVER_PATH, new URL(gameUrl, 'http://bgs-runtime.invalid'))
  return gameUrl.startsWith('/') ? url.pathname : url.href
}
