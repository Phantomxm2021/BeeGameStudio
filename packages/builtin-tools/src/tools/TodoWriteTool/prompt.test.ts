import { expect, test } from 'bun:test'
import { TodoWriteTool } from './TodoWriteTool'
import { PROMPT } from './prompt'

test('BGS project execution preserves the native task tool description', async () => {
  const previous = process.env.BEEGAME_PROJECT_EXECUTION
  try {
    delete process.env.BEEGAME_PROJECT_EXECUTION
    expect(await TodoWriteTool.prompt()).toBe(PROMPT)
    process.env.BEEGAME_PROJECT_EXECUTION = '1'
    expect(await TodoWriteTool.prompt()).toBe(PROMPT)
  } finally {
    if (previous === undefined) delete process.env.BEEGAME_PROJECT_EXECUTION
    else process.env.BEEGAME_PROJECT_EXECUTION = previous
  }
})
