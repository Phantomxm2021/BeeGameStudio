import { expect, test } from 'bun:test'

test('actual ACP session methods restore project context, queue shared state and reject unsupported MCP', () => {
  const fixture = Bun.spawnSync(
    [
      process.execPath,
      new URL('./processContext.fixture.ts', import.meta.url).pathname,
    ],
    { cwd: process.cwd(), env: process.env, stdout: 'pipe', stderr: 'pipe' },
  )
  expect(fixture.exitCode, fixture.stderr.toString()).toBe(0)
  const output = JSON.parse(
    fixture.stdout.toString().trim().split('\n').at(-1)!,
  )
  expect(output.sequential).toMatchObject([
    {
      cwd: output.cwd,
      originalCwd: output.cwd,
      projectRoot: output.cwd,
      sessionId: output.a,
      projectDir: null,
      flag: 'project-A',
    },
    {
      cwd: '/private/tmp',
      originalCwd: '/private/tmp',
      projectRoot: '/private/tmp',
      sessionId: output.b,
      projectDir: null,
    },
  ])
  expect(output.sequential[1].flag).toBeUndefined()
  expect(output.observedRestoration).toBe(true)
  expect(output.planSlugs).toEqual(['plan-A', 'plan-B'])
  expect(output.during).toEqual({
    originalCwd: output.cwd,
    sessionId: output.a,
    created: false,
    submitted: 1,
  })
  expect(output.concurrent).toHaveLength(1)
  expect(output.queuedResult.stopReason).toBe('cancelled')
  expect(output.failed).toBe(true)
  expect(output.afterFailure).toBe(true)
  expect(output.resumed[0]).toMatchObject({
    originalCwd: '/private/tmp',
    sessionId: 'resumed',
    projectDir: '/fixture/resumed',
  })
  expect(output.freshAfterResume[0].projectDir).toBeNull()
  expect(output.forkHistoryContext).toEqual({
    cwd: '/private/tmp',
    projectDir: '/fixture/resumed',
  })
  expect(output.defaultSessionCwd).toBe('/private/tmp')
  expect(output.mcpCapabilities).toEqual({ http: false, sse: false })
  expect(output.rejected).toBe(2)
  expect(output.enginesCreatedOnRejection).toBe(0)
})
