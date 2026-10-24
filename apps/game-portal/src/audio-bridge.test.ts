import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

type AudioBridge = { connect(setMuted: (muted: boolean) => void): () => void }

describe('optional game audio bridge', () => {
  test('only accepts sound changes from the embedding portal', () => {
    const listeners = new Map<
      string,
      (event: Record<string, unknown>) => void
    >()
    const sent: Array<{ message: unknown; origin: string }> = []
    const parent = {
      postMessage: (message: unknown, origin: string) =>
        sent.push({ message, origin }),
    }
    const window = {
      parent,
      addEventListener: (
        type: string,
        handler: (event: Record<string, unknown>) => void,
      ) => listeners.set(type, handler),
      removeEventListener: (type: string) => listeners.delete(type),
    } as {
      parent: typeof parent
      addEventListener: unknown
      removeEventListener: unknown
      BeeGamePortalAudio?: AudioBridge
    }
    const source = readFileSync(
      new URL('../public/game-audio-bridge.js', import.meta.url),
      'utf8',
    )
    runInNewContext(source, {
      window,
      document: { referrer: 'https://play.example.com/g/project_1' },
      URL,
    })

    const changes: boolean[] = []
    const disconnect = window.BeeGamePortalAudio!.connect(value =>
      changes.push(value),
    )
    expect(sent).toEqual([
      {
        message: { type: 'beegame:audio-control-ready', version: 1 },
        origin: 'https://play.example.com',
      },
    ])
    const message = { type: 'beegame:set-muted', version: 1, muted: true }
    listeners.get('message')?.({
      source: parent,
      origin: 'https://other.example.com',
      data: message,
    })
    expect(changes).toEqual([])
    listeners.get('message')?.({
      source: parent,
      origin: 'https://play.example.com',
      data: message,
    })
    expect(changes).toEqual([true])
    disconnect()
    expect(listeners.has('message')).toBe(false)
  })
})
