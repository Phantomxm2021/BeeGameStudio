import { expect, test } from 'bun:test'
import { TodoWriteTool } from './TodoWriteTool'
import { PROMPT } from './prompt'

test('completion is scoped without hiding defects or requiring experimental success', () => {
  const completion = PROMPT.split('3. **Task Completion Requirements**:')[1]!.split('4. **Task Breakdown**:')[0]!
  expect(completion).toContain("Self-authored experiments do not add delivery requirements to the user's request.")
  expect(completion).toContain('Confirmed requirement violations must be fixed within the authorized scope or explicitly reported as blocked')
  expect(completion).toContain('the affected implementation or repair task remains incomplete until resolved')
  expect(completion).toContain('Do not hide failing checks or weaken valid assertions to manufacture success.')
  expect(completion).toContain('An observation or diagnostic task can be completed after reporting its actual results, including failed attempts and unverified coverage.')
  expect(completion).toContain('This does not certify product acceptance or resolve known defects.')
  expect(completion).not.toContain('Tests are failing')
  expect(completion).not.toContain('keep the task as in_progress')
})

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
