import { describe, expect, test } from 'bun:test'
import { FileWriteTool } from '../FileWriteTool'

describe('native Write input contract', () => {
  test('accepts a large streamed write without a local checkpoint cap', () => {
    expect(
      FileWriteTool.inputSchema.safeParse({
        file_path: '/tmp/document.md',
        content: 'x'.repeat(32_768),
      }).success,
    ).toBe(true)
  })

  test('does not expose a studio-specific append protocol', () => {
    expect(
      FileWriteTool.inputSchema.safeParse({
        file_path: '/tmp/document.md',
        content: 'continuation',
        mode: 'append',
      }).success,
    ).toBe(false)
  })
})
