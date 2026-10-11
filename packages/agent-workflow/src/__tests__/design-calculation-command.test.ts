import { expect, test } from 'bun:test'
import { parseDesignCalculationCommand as parse } from '../design-calculation-command'

const command = 'bun .beegame/delivery/calculate-balance.mjs docs/calc/model.mjs docs/calc/result.md'

test('permission and interrupted write tracking recognize both supported calculation modes', () => {
  expect(parse(command)).toEqual({ model: 'docs/calc/model.mjs', output: 'docs/calc/result.md', scenes: false })
  expect(parse(command + ' --scenes')?.scenes).toBe(true)
  expect(parse("cd '/tmp/project with spaces' && " + command + ' --scenes')?.cwd).toBe('/tmp/project with spaces')
  expect(parse('cd . && ' + command)?.output).toBe('docs/calc/result.md')
})

test('a calculation invocation is not an arbitrary shell command', () => {
  for (const value of [command + '; echo done', command + ' && echo done', command + ' --unknown',
    command.replace('docs/calc/model', 'docs/calc/../model'),
    command.replace('docs/calc/result', 'docs/calc//result'),
    'echo ' + command, 'cd "$(pwd)" && ' + command, 'node ' + command.slice(4)])
    expect(parse(value)).toBeUndefined()
})
