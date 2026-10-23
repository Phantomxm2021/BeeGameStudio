import { describe, expect, it } from 'vitest'
import { deriveDashboardStatus, getWaitingPermissionState } from './waitingPermission'

describe('waitingPermission helpers', () => {
  it('blocks chat only for an explicit tool permission', () => {
    const state = getWaitingPermissionState([{
      gate_id: 'permission-1',
      type: 'BEEGAME_PERMISSION',
    }])
    expect(state.kind).toBe('permission')
    expect(state.isBlockingChat).toBe(true)
  })

  it('derives waiting_approval from the canonical waiting flag', () => {
    expect(deriveDashboardStatus({
      isOffline: false,
      isLoading: false,
      canContinue: false,
      hasWaitingPermission: true,
      messages: [],
    })).toBe('waiting_approval')
  })
})
