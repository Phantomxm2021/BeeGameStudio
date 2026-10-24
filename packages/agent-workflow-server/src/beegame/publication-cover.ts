import sharp from 'sharp'
import { BeeGameUploadPolicyError, validateBeeGameAttachments } from '../security/upload-policy'

export const PUBLICATION_COVER_PATH = '__bgs_publication/cover.webp'

/** User-supplied release metadata, never a generated project resource. */
export async function preparePublicationCover(value: { mediaType: string; filename: string; data: string }): Promise<Buffer> {
  const [attachment] = validateBeeGameAttachments([{ ...value, type: 'image' }])
  try {
    // Decode and orient the actual bytes. Re-encoding strips metadata and ensures
    // that the public file is a still WebP, regardless of the uploaded extension.
    const { data, info } = await sharp(Buffer.from(attachment!.data, 'base64'), {
      limitInputPixels: 16_777_216, failOn: 'warning',
    }).rotate().webp({ quality: 85 }).toBuffer({ resolveWithObject: true })
    if (!info.width || info.width * 9 !== info.height * 16) {
      throw new BeeGameUploadPolicyError(`Cover must be 16:9; received ${info.width} × ${info.height}.`)
    }
    return data
  } catch (error) {
    if (error instanceof BeeGameUploadPolicyError) throw error
    throw new BeeGameUploadPolicyError('Cover could not be decoded. Use a PNG, JPEG or WebP image of up to 16 megapixels.')
  }
}

export function publicationCoverUrl(gameUrl: string): string {
  const url = new URL(PUBLICATION_COVER_PATH, new URL(gameUrl, 'http://bgs-runtime.invalid'))
  return gameUrl.startsWith('/') ? url.pathname : url.href
}
