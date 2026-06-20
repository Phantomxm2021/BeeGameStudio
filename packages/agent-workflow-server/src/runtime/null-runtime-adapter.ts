import type { RuntimeAdapter } from './types'

export function createNullRuntimeAdapter(): RuntimeAdapter {
  return {
    async startRun() {
      throw new Error('Claude Code runtime adapter is not attached')
    },
    async cancelRun() {
      throw new Error('Claude Code runtime adapter is not attached')
    },
    async retryRun() {
      throw new Error('Claude Code runtime adapter is not attached')
    },
    async resumeRun() {
      throw new Error('Claude Code runtime adapter is not attached')
    },
  }
}
