import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BgsClientError } from './client'
import { BeeGameSessionManager } from '../beegame/session-manager'

test('typed BGS host diagnostics survive the fake runner failure into turn.failed facts', async () => {
  const root = await mkdtemp('/private/tmp/bgs-client-error-lifecycle-')
  const workspace = join(root, 'game')
  await mkdir(workspace)
  const diagnostic = {
    phase: 'spawn' as const,
    code: 'ENOENT',
    executable: 'bgs',
    cwd: { kind: 'missing' as const },
  }
  let starts = 0
  const manager = new BeeGameSessionManager({
    async start() {
      starts++
      throw new BgsClientError('Could not start BGS; install the configured BGS CLI', diagnostic)
    },
  }, root, () => ({}))
  try {
    const session = manager.start({ workspacePath: workspace, projectId: 'diagnostic-fixture', userId: 'owner' })
    await manager.sendWithDisplay(session.id, 'Offline diagnostic fixture')
    await manager.waitForSessionIdle(session.id)
    const failed = manager.transcriptFacts(session.id).find(event => event.type === 'turn.failed')
    expect(starts).toBe(1)
    expect(failed).toMatchObject({
      type: 'turn.failed',
      payload: { type: 'turn.failed', bgsErrorInfo: diagnostic },
    })
    expect(JSON.stringify(failed)).not.toContain(workspace)
    expect(JSON.stringify(failed)).not.toContain('argv')
    expect(JSON.stringify(failed)).not.toContain('stderr')
  } finally {
    await manager.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
