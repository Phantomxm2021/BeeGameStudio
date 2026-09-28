import { API_IMAGE_MAX_BASE64_SIZE } from '../constants/apiLimits.js'
import { logEvent } from '../services/analytics/index.js'
import type { AssistantMessage, UserMessage } from '../types/message.js'
import { getImageProcessor } from '@bee-game-studio/builtin-tools/tools/FileReadTool/imageProcessor.js'
import { createHash } from 'node:crypto'
import { formatFileSize } from './format.js'

const decodedImageCache = new Map<string, boolean>()
const INVALID_IMAGE_TEXT =
  'The image in this earlier message is invalid and could not be decoded. Read or regenerate the source image before using it.'

/**
 * An invalid image in persisted tool output otherwise poisons every resumed
 * request. Keep the native transcript intact, but replace only that image in
 * the outgoing API projection so the same session can recover.
 */
export async function sanitizeInvalidImagesForAPI(
  messages: (UserMessage | AssistantMessage)[],
): Promise<(UserMessage | AssistantMessage)[]> {
  let processor: Awaited<ReturnType<typeof getImageProcessor>> | undefined
  async function decodable(data: string): Promise<boolean> {
    const digest = createHash('sha256').update(data).digest('hex')
    const cached = decodedImageCache.get(digest)
    if (cached !== undefined) return cached
    processor ??= await getImageProcessor()
    let valid = false
    try {
      const image = processor(Buffer.from(data, 'base64'))
      await image.metadata()
      // Metadata alone can accept truncated pixel data. Force a full decode.
      await image.png().toBuffer()
      valid = true
    } catch {
      console.warn('[image] Invalid historical image omitted from API request')
    }
    if (decodedImageCache.size >= 128) decodedImageCache.clear()
    decodedImageCache.set(digest, valid)
    return valid
  }

  const result: (UserMessage | AssistantMessage)[] = []
  for (const message of messages) {
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      result.push(message)
      continue
    }
    let changed = false
    const content = []
    for (const block of message.message.content) {
      if (isBase64ImageBlock(block) && !(await decodable(block.source.data))) {
        content.push({ type: 'text' as const, text: INVALID_IMAGE_TEXT })
        changed = true
      } else if (block.type === 'tool_result' && Array.isArray(block.content)) {
        let toolChanged = false
        const toolContent = []
        for (const item of block.content) {
          if (
            isBase64ImageBlock(item) &&
            !(await decodable(item.source.data))
          ) {
            toolContent.push({
              type: 'text' as const,
              text: INVALID_IMAGE_TEXT,
            })
            toolChanged = true
          } else {
            toolContent.push(item)
          }
        }
        content.push(toolChanged ? { ...block, content: toolContent } : block)
        changed ||= toolChanged
      } else {
        content.push(block)
      }
    }
    result.push(
      changed
        ? { ...message, message: { ...message.message, content } }
        : message,
    )
  }
  return result
}

/**
 * Information about an oversized image.
 */
export type OversizedImage = {
  index: number
  size: number
}

/**
 * Error thrown when one or more images exceed the API size limit.
 */
export class ImageSizeError extends Error {
  constructor(oversizedImages: OversizedImage[], maxSize: number) {
    let message: string
    const firstImage = oversizedImages[0]
    if (oversizedImages.length === 1 && firstImage) {
      message =
        `Image base64 size (${formatFileSize(firstImage.size)}) exceeds API limit (${formatFileSize(maxSize)}). ` +
        `Please resize the image before sending.`
    } else {
      message =
        `${oversizedImages.length} images exceed the API limit (${formatFileSize(maxSize)}): ` +
        oversizedImages
          .map(img => `Image ${img.index}: ${formatFileSize(img.size)}`)
          .join(', ') +
        `. Please resize these images before sending.`
    }
    super(message)
    this.name = 'ImageSizeError'
  }
}

/**
 * Type guard to check if a block is a base64 image block
 */
function isBase64ImageBlock(
  block: unknown,
): block is { type: 'image'; source: { type: 'base64'; data: string } } {
  if (typeof block !== 'object' || block === null) return false
  const b = block as Record<string, unknown>
  if (b.type !== 'image') return false
  if (typeof b.source !== 'object' || b.source === null) return false
  const source = b.source as Record<string, unknown>
  return source.type === 'base64' && typeof source.data === 'string'
}

/**
 * Validates that all images in messages are within the API size limit.
 * This is a safety net at the API boundary to catch any oversized images
 * that may have slipped through upstream processing.
 *
 * Note: The API's 5MB limit applies to the base64-encoded string length,
 * not the decoded raw bytes.
 *
 * Works with both UserMessage/AssistantMessage types (which have { type, message })
 * and raw MessageParam types (which have { role, content }).
 *
 * @param messages - Array of messages to validate
 * @throws ImageSizeError if any image exceeds the API limit
 */
export function validateImagesForAPI(messages: unknown[]): void {
  const oversizedImages: OversizedImage[] = []
  let imageIndex = 0

  for (const msg of messages) {
    if (typeof msg !== 'object' || msg === null) continue

    const m = msg as Record<string, unknown>

    // Handle wrapped message format { type: 'user', message: { role, content } }
    // Only check user messages
    if (m.type !== 'user') continue

    const innerMessage = m.message as Record<string, unknown> | undefined
    if (!innerMessage) continue

    const content = innerMessage.content
    if (typeof content === 'string' || !Array.isArray(content)) continue

    for (const block of content) {
      if (isBase64ImageBlock(block)) {
        imageIndex++
        // Check the base64-encoded string length directly (not decoded bytes)
        // The API limit applies to the base64 payload size
        const base64Size = block.source.data.length
        if (base64Size > API_IMAGE_MAX_BASE64_SIZE) {
          logEvent('tengu_image_api_validation_failed', {
            base64_size_bytes: base64Size,
            max_bytes: API_IMAGE_MAX_BASE64_SIZE,
          })
          oversizedImages.push({ index: imageIndex, size: base64Size })
        }
      }
    }
  }

  if (oversizedImages.length > 0) {
    throw new ImageSizeError(oversizedImages, API_IMAGE_MAX_BASE64_SIZE)
  }
}
