import { AsyncLocalStorage } from 'node:async_hooks'
import {
  getCwdState,
  getOriginalCwd,
  getProjectRoot,
  getSessionId,
  getSessionProjectDir,
  getPlanSlugCache,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
  setPlanSlugCacheEntry,
  switchSession,
} from '../../../bootstrap/state.js'
import type { SessionId } from '../../../types/ids.js'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'

// ACP engines share process-global settings and transcript identity. Coordinate
// foreground operations across sessions (and agent instances), not tool calls.
// Nested resume -> create calls already own the slot and must not deadlock.
const owner = new AsyncLocalStorage<{ active: boolean }>()
let tail: Promise<void> | undefined

// CLI /resume discards the outgoing plan slug. ACP retains multiple engines;
// temporary context switches must not change their existing plan filenames.
export function switchAcpSession(
  sessionId: SessionId,
  projectDir: string | null,
): void {
  const outgoingId = getSessionId()
  const slug = getPlanSlugCache().get(outgoingId)
  switchSession(sessionId, projectDir)
  if (slug) setPlanSlugCacheEntry(outgoingId, slug)
}

export function withAcpProcessContext<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (owner.getStore()?.active) return operation()
  const previous = tail
  let release!: () => void
  const slot = new Promise<void>(resolve => {
    release = resolve
  })
  tail = slot

  const run = () =>
    owner.run({ active: true }, async () => {
      const context = owner.getStore()!
      const cwd = process.cwd()
      const originalCwd = getOriginalCwd()
      const workingCwd = getCwdState()
      const projectRoot = getProjectRoot()
      const sessionId = getSessionId()
      const projectDir = getSessionProjectDir()
      const env = { ...process.env }
      try {
        return await operation()
      } finally {
        try {
          // Settings.env is process-global too; do not leave project A's safe
          // overrides installed when project B has no corresponding setting.
          for (const key of Object.keys(process.env)) {
            if (!(key in env)) delete process.env[key]
          }
          Object.assign(process.env, env)
          try {
            process.chdir(cwd)
          } finally {
            setOriginalCwd(originalCwd)
            setCwdState(workingCwd)
            setProjectRoot(projectRoot)
            switchAcpSession(sessionId, projectDir)
            resetSettingsCache()
          }
        } finally {
          context.active = false
          if (tail === slot) tail = undefined
          release()
        }
      }
    })
  // Start an idle operation synchronously, preserving prompt/cancel ordering.
  return previous ? previous.then(run) : run()
}
