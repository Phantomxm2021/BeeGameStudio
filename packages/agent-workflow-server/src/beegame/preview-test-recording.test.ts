import { expect, test } from 'bun:test'
import { pageEnvironmentFromCdp } from './preview-test-recording'

test('passive page observation distinguishes a narrow desktop view from touch capability', () => {
  expect(pageEnvironmentFromCdp({
    width: 375, height: 667, devicePixelRatio: 1,
    maxTouchPoints: 0, coarsePointer: false, hover: true,
  })).toEqual({
    status: 'observed', viewport: { width: 375, height: 667 },
    devicePixelRatio: 1, maxTouchPoints: 0, coarsePointer: false, hover: true,
  })
  expect(pageEnvironmentFromCdp({
    width: 375, height: 667, devicePixelRatio: 2,
    maxTouchPoints: 5, coarsePointer: true, hover: false,
  })?.coarsePointer).toBe(true)
  expect(pageEnvironmentFromCdp({
    width: 375, height: 667, devicePixelRatio: 1,
    maxTouchPoints: '5', coarsePointer: true, hover: false,
  })).toBeUndefined()
})
