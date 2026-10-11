import { expect, test } from 'bun:test'
import { resolveDistRoot } from './distRoot'

test('native assets resolve inside the running generation, including split chunks', () => {
  expect(resolveDistRoot('/project/dist/build-current')).toBe('/project/dist/build-current')
  expect(resolveDistRoot('/project/dist/build-current/chunks')).toBe('/project/dist/build-current')
  expect(resolveDistRoot('/project/dist/chunks')).toBe('/project/dist')
  expect(resolveDistRoot('/project/dist-vite/chunks')).toBe('/project/dist-vite')
  expect(resolveDistRoot('/project/src/utils')).toBe('/project')
  expect(resolveDistRoot('/isolated/build')).toBe('/isolated/build')
  expect(resolveDistRoot('/isolated/custom-release/chunks')).toBe('/isolated/custom-release')
  expect(resolveDistRoot('/projects/src/custom-release')).toBe('/projects/src/custom-release')
  expect(resolveDistRoot('/projects/dist/custom-release/chunks')).toBe('/projects/dist/custom-release')
})
