import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../services/api'
import { useChatStore } from '../store/chatStore'
import { useProjectStore } from '../store/projectStore'
import { useSystemStore } from '../store/systemStore'
import { normalizeChatHistory } from '../utils/chatHistory'

/** Owns initial history/cursor readiness and subsequent session synchronization.
 * Transport retries and event routing stay in their existing hooks. */
export function useProjectSession({ projectId, enabled, refreshRuntime }: {
  projectId: string
  enabled: boolean
  refreshRuntime: () => Promise<void>
}) {
  const loadHistory = useChatStore(state => state.loadHistory)
  const { authenticationStatus, currentUser, setIsSyncing } = useSystemStore(useShallow(state => ({
    authenticationStatus: state.authenticationStatus,
    currentUser: state.currentUser,
    setIsSyncing: state.setIsSyncing,
  })))
  const userId = currentUser?.id
  // Identity distinguishes A -> B -> A, account changes and hot-reloaded actions.
  const scope = useMemo(() => ({ projectId, enabled, authenticationStatus, userId, loadHistory }),
    [projectId, enabled, authenticationStatus, userId, loadHistory])
  type Lifetime = {
    scope: typeof scope
    active: boolean
    connected: boolean
    initialHistory: Promise<void> | null
    sync: Promise<void> | null
  }
  const current = useRef<Lifetime | null>(null)
  const [readyScope, setReadyScope] = useState<typeof scope | null>(null)

  const isCurrent = useCallback((lifetime: Lifetime) => {
    const activeProjectId = useProjectStore.getState().activeProjectId
    const authentication = useSystemStore.getState()
    return lifetime.active && current.current === lifetime &&
      authentication.authenticationStatus === 'authenticated' &&
      authentication.currentUser?.id === lifetime.scope.userId &&
      (activeProjectId === undefined || activeProjectId === lifetime.scope.projectId)
  }, [])

  useLayoutEffect(() => {
    const lifetime: Lifetime = { scope, active: enabled && Boolean(projectId) &&
      authenticationStatus === 'authenticated', connected: false, initialHistory: null, sync: null }
    current.current = lifetime
    return () => {
      lifetime.active = false
      // A stale request may finish before unmount and clear its promise.
      // Release the indicator by ownership, not by whether it is still pending.
      if (current.current === lifetime) setIsSyncing(false)
    }
  }, [scope, enabled, projectId, authenticationStatus, setIsSyncing])

  const refreshHistory = useCallback(async (lifetime: Lifetime) => {
    const history = await api.getChatHistory(lifetime.scope.projectId)
    if (!isCurrent(lifetime)) return
    setReadyScope(lifetime.scope)
    const chat = useChatStore.getState()
    // Recheck after awaiting: live output may have arrived during the read.
    if (chat.isStreaming || chat.messages.some(message => message.id?.startsWith('streaming-'))) return
    const messages = normalizeChatHistory(history)
    // Empty server history must not erase optimistic bootstrap/system hints.
    if (messages.length > 0 || chat.messages.length === 0) lifetime.scope.loadHistory(messages)
  }, [isCurrent])

  useEffect(() => {
    const lifetime = current.current
    if (!lifetime || lifetime.scope !== scope || !isCurrent(lifetime)) return
    lifetime.initialHistory = refreshHistory(lifetime).catch(error => {
      if (isCurrent(lifetime)) console.error('[ProjectSession] Failed to load chat history:', error)
    })
  }, [scope, isCurrent, refreshHistory])

  const synchronize = useCallback((includeHistory = true): Promise<void> => {
    const lifetime = current.current
    if (!lifetime || lifetime.scope !== scope || !isCurrent(lifetime)) return Promise.resolve()
    if (lifetime.sync) return lifetime.sync
    setIsSyncing(true)
    const request = (async () => {
      await refreshRuntime()
      if (!isCurrent(lifetime) || !includeHistory) return
      await lifetime.initialHistory
      if (isCurrent(lifetime) && !useChatStore.getState().isStreaming) await refreshHistory(lifetime)
    })().catch(error => {
      if (isCurrent(lifetime)) console.error('[ProjectSession] Failed to synchronize state:', error)
    }).finally(() => {
      if (lifetime.sync === request) lifetime.sync = null
      if (isCurrent(lifetime)) setIsSyncing(false)
    })
    lifetime.sync = request
    return request
  }, [scope, isCurrent, refreshRuntime, refreshHistory, setIsSyncing])

  const onTransportOpen = useCallback(() => {
    const lifetime = current.current
    if (!lifetime || lifetime.scope !== scope || !isCurrent(lifetime)) return Promise.resolve()
    // Initial history already established the cursor before the first socket.
    // A later connection still needs the authoritative runtime + history sync.
    const includeHistory = lifetime.connected
    lifetime.connected = true
    return synchronize(includeHistory)
  }, [scope, isCurrent, synchronize])

  return { historyReady: readyScope === scope, synchronize, onTransportOpen }
}
