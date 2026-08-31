import { expect, test } from 'bun:test'
import { assembleWorldPresentationClosure } from './world-presentation-assembler'

test('rejects an authority with a detached projection instead of raw replay authority', () => {
  expect(() =>
    assembleWorldPresentationClosure({
      phase4Authority: {
        gameplay: { projection: {} },
        balance: { projection: {} },
      },
      worldScene: {
        source: {},
        mechanical: {},
        semantic: {},
        validation: {},
      },
      presentation: {
        source: {},
        mechanical: {},
        semantic: {},
        validation: {},
      },
    } as never),
  ).toThrow()
})
