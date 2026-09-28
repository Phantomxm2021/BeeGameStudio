import { expect, test } from 'bun:test'
import sharp from 'sharp'
import { createUserMessage } from '../messages.js'
import { sanitizeInvalidImagesForAPI } from '../imageValidation.js'

test('resumed tool output with a corrupt image does not poison later API requests', async () => {
  const valid = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer()
  const corrupt = Buffer.from(valid)
  corrupt[24] = 6 // Invalid PNG bit depth in the persisted image block.
  const message = createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'read-1',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: corrupt.toString('base64'),
            },
          },
        ],
      },
    ],
  })

  const [sanitized] = await sanitizeInvalidImagesForAPI([message])
  const content = sanitized?.message.content
  expect(Array.isArray(content)).toBe(true)
  if (!Array.isArray(content) || content[0]?.type !== 'tool_result')
    throw new Error('Missing tool result')
  expect(content[0].content).toEqual([
    { type: 'text', text: expect.stringContaining('invalid') },
  ])
  expect((message.message.content as any[])[0].content[0].type).toBe('image')

  const validMessage = createUserMessage({
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: valid.toString('base64'),
        },
      },
    ],
  })
  const [preserved] = await sanitizeInvalidImagesForAPI([validMessage])
  expect(preserved).toBe(validMessage)
})
