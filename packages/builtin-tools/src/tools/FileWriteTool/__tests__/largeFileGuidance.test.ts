import { describe, expect, test } from 'bun:test'
import { getWriteToolDescription } from '../prompt'

describe('native file-writing guidance', () => {
  test('preserves upstream safety guidance without prescribing a studio writing sequence', () => {
    const description = getWriteToolDescription()

    expect(description).toContain('Edit tool')
    expect(description).toContain('MUST use the Read tool first')
    expect(description).toContain('not a directory path')
    expect(description).not.toMatch(/small stable scaffold|3 to 6 Edit calls|Never send a complete long document/)
    expect(description).not.toMatch(/8,?192|maximum \d+ characters|bounded append/i)
  })
})
