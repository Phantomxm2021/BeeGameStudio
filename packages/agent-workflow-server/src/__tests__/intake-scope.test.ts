import { expect, test } from 'bun:test'
import { parseBeeGameIntakeContent } from '../app'

function gameOptions() {
  return ['Classic', 'Maze', 'Survival'].map((title, index) => ({
    id: `mode_${index + 1}`, title,
    gameplay: 'Move to catch stars, avoid meteors, score points, and finish after 45 seconds.',
    recommendedPlatform: 'Web', recommendedEngine: 'React', recommendedDimension: '2D',
    recommendedGenre: 'Arcade', recommendedStyle: 'Minimal', recommendedInputs: ['Keyboard/mouse'],
  }))
}

test.each([
  { inputs: ['Keyboard / Mouse', 'touch', 'GAMEPAD', 'hand_tracking'], expected: ['Keyboard/mouse', 'Touch', 'Gamepad', 'Hand tracking'] },
  { inputs: ['Keyboard', 'Mouse', 'Touchscreen'], expected: ['Keyboard/mouse', 'Touch'] },
  { inputs: ['keyboard + mouse', 'Keyboard & Mouse', 'Keyboard and Mouse', 'Motion', 'Voice'], expected: ['Keyboard/mouse', 'Motion', 'Voice'] },
])('equivalent input spellings keep all three options without guessing settings: %j', ({ inputs, expected }) => {
  const options = gameOptions(); options[2]!.recommendedInputs = [...inputs]
  const before = structuredClone(options)
  const result = parseBeeGameIntakeContent(JSON.stringify({ maturity: 'concrete', options }))
  expect(result.options).toHaveLength(3)
  expect(result.options.map(option => option.title)).toEqual(options.map(option => option.title))
  expect(result.options[2]!.recommendedInputs).toEqual([...expected])
  expect(options).toEqual(before)
})

test.each([{ inputs: ['Dance pad'] }, { inputs: ['Keyboard/mouse', 'Dance pad'] }, { inputs: [] }])('unknown or missing inputs remain actionable failures: %j', ({ inputs }) => {
  const options = gameOptions(); options[2]!.recommendedInputs = [...inputs]
  let message = ''
  try { parseBeeGameIntakeContent(JSON.stringify({ maturity: 'concrete', options })) }
  catch (error) { message = (error as Error).message }
  expect(message).toContain('Expected 3, received 2 from 3 returned')
  expect(message).toContain('options[2].recommendedInputs')
  expect(message).toContain('Keyboard/mouse')
  if (inputs.length) expect(message).toContain('Dance pad')
})

test('normalizing inputs does not fill another missing production setting or invent a third option', () => {
  const options = gameOptions(); options[2]!.recommendedInputs = ['Keyboard']; options[2]!.recommendedStyle = 'Auto'
  expect(() => parseBeeGameIntakeContent(JSON.stringify({ options }))).toThrow('recommendedStyle')
  expect(() => parseBeeGameIntakeContent(JSON.stringify({ options: gameOptions().slice(0, 2) }))).toThrow('Expected 3, received 2 from 2 returned')
})

test('non-game intake is not turned into invented game directions', () => {
  expect(() => parseBeeGameIntakeContent('{"request_scope":"out_of_scope"}'))
    .toThrow('Not a game idea')
})

test('a valid game idea still yields three selectable directions', () => {
  const options = ['Classic', 'Maze', 'Survival'].map((title, index) => ({
    id: `mode_${index + 1}`,
    title,
    gameplay: 'Control a snake, collect food, avoid collisions, and score points.',
    recommendedPlatform: 'Web',
    recommendedEngine: 'React',
    recommendedDimension: '2D',
    recommendedGenre: 'Arcade',
    recommendedStyle: 'Pixel',
    recommendedInputs: ['Keyboard/mouse'],
  }))
  const result = parseBeeGameIntakeContent(JSON.stringify({
    maturity: 'directional', options,
  }))
  expect(result.options.map(option => option.title)).toEqual(['Classic', 'Maze', 'Survival'])
  expect(result.recommendedNextStep).toBe('choose_direction')
})
