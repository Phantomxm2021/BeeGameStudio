import { resolve } from 'node:path'

// The BGS host owns account replacement. Count all operations that can use or
// refresh that account, including isolated workers whose own maps are private.
const active = new Map<string, number>()

export async function withBgsAccountUse<T>(configDirectory: string, operation: () => Promise<T>): Promise<T> {
  if (!configDirectory) throw Error('An owner-specific ChatGPT configuration directory is required')
  const key = resolve(configDirectory)
  active.set(key, (active.get(key) ?? 0) + 1)
  try { return await operation() }
  finally {
    const remaining = active.get(key)! - 1
    if (remaining) active.set(key, remaining)
    else active.delete(key)
  }
}

export function assertBgsAccountIdle(configDirectory: string): void {
  if (active.has(resolve(configDirectory)))
    throw Error('Wait for running model requests before changing subscription accounts')
}
