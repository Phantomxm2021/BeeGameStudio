import { afterEach, describe, expect, test } from 'bun:test'
import { getAPIProvider } from '../providers'

describe('runtime model provider override', () => {
  const previous = process.env.BEEGAME_RUNTIME_MODEL_TYPE

  afterEach(() => {
    if (previous === undefined) delete process.env.BEEGAME_RUNTIME_MODEL_TYPE
    else process.env.BEEGAME_RUNTIME_MODEL_TYPE = previous
  })

  test('durable runtime provider wins over local model settings', () => {
    process.env.BEEGAME_RUNTIME_MODEL_TYPE = 'anthropic'

    expect(getAPIProvider({ modelType: 'openai' })).toBe('firstParty')
  })
})
