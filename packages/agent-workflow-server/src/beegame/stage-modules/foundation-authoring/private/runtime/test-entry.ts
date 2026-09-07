import {
  createAuthorRuntimeWithSpawn,
  type AuthorRuntime,
  type AuthorRuntimeConfig,
} from './runtime'

type TestProcess = Parameters<typeof createAuthorRuntimeWithSpawn>[1]

/** Test-only construction seam; production callers must use createAuthorRuntime. */
export function createAuthorRuntimeForTest(
  config: AuthorRuntimeConfig,
  spawn: TestProcess,
): AuthorRuntime {
  return createAuthorRuntimeWithSpawn(config, spawn)
}
