import { expect, test } from 'bun:test'
import { directImplementationTask } from './direct-implementation-task'

test('creates one direct implementation task covering published inputs', () => {
  expect(
    directImplementationTask({
      checklistIds: ['AC-1'],
      resourceIds: ['RS-1'],
      contentIds: ['CONTENT-1'],
    }),
  ).toMatchObject({
    id: 'DIRECT_IMPLEMENTATION',
    checklistIds: ['AC-1'],
    resourceIds: ['RS-1'],
    contentIds: ['CONTENT-1'],
    allowedPaths: ['./'],
    status: 'pending',
    attempt: 0,
  })
})
