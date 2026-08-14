import { describe, expect, test } from 'bun:test'
import { getWriteToolDescription } from '../prompt'

describe('native large-file authoring guidance', () => {
  test('keeps checkpoint decisions native without a fixed studio limit', () => {
    const description = getWriteToolDescription()

    expect(description).toContain('Never send a complete long document')
    expect(description).toContain('small stable scaffold')
    expect(description).toContain('2 to 3 Edit calls')
    expect(description).toContain('Group related sections')
    expect(description).toContain('grouped placeholders')
    expect(description).toContain('Trust each successful file mutation result')
    expect(description).toContain('validate the completed file once')
    expect(description).toContain('creates missing parent directories')
    expect(description).toContain('do not inspect or list its parent directory')
    expect(description).toContain('Edit tool')
    expect(description).not.toMatch(/8,?192|maximum \d+ characters|bounded append/i)
  })
})
