import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(), on: vi.fn(), removeListener: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: electron,
}))
import './preload'

describe('desktop command bridge', () => {
  it('accepts only the known menu commands and removes the listener on cleanup', () => {
    const bridge = electron.exposeInMainWorld.mock.calls[0][1]
    const handler = vi.fn()
    const cleanup = bridge.onCommand(handler)
    expect(electron.invoke).toHaveBeenCalledWith('desktop-commands-ready')
    const listener = electron.on.mock.calls.find(call => call[0] === 'desktop-command')?.[1]
    listener({}, 'new-project')
    listener({}, 'toggle-sidebar')
    listener({}, 'focus-input')
    listener({}, 'unexpected-command')
    expect(handler.mock.calls).toEqual([['new-project'], ['toggle-sidebar'], ['focus-input']])
    cleanup()
    expect(electron.removeListener).toHaveBeenCalledWith('desktop-command', listener)
  })
})
