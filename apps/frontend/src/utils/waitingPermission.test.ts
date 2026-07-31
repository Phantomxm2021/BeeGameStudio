import { describe, expect, it } from 'vitest'
import { deriveDashboardStatus, getWaitingPermissionState } from './waitingPermission'

describe('waitingPermission helpers', () => {
  it('blocks chat only for an explicit tool permission', () => {
    const state = getWaitingPermissionState(undefined, [{
      gate_id: 'permission-1',
      type: 'BEEGAME_PERMISSION',
    }])
    expect(state.kind).toBe('permission')
    expect(state.isBlockingChat).toBe(true)
  })

  it('keeps a failed workflow actionable', () => {
    const state = getWaitingPermissionState({
      project_id: 'project-1',
      workflow: {
        runId: 'run-1',
        status: 'failed',
        block: { message: 'Implementation failed.' },
      },
    })
    expect(state.kind).toBe('none')
    expect(state.isBlockingChat).toBe(false)
  })

  it('blocks chat for a blocked workflow', () => {
    const state = getWaitingPermissionState({
      project_id: 'project-1',
      workflow: {
        runId: 'run-1',
        status: 'blocked',
        block: { message: 'User action required.' },
      },
    })
    expect(state.kind).toBe('workflow')
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
