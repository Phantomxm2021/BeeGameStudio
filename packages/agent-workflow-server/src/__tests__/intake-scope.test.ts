import { expect, test } from 'bun:test'
import { parseBeeGameIntakeContent } from '../app'

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
