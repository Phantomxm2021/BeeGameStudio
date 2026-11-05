import { mkdtempSync, realpathSync } from 'node:fs'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

// Private to this server lifetime. A restarted native runner receives the new
// path; an old process cannot accidentally acquire another session's access.
let directory: string | undefined
const pending = new Map<string, Promise<unknown>>()
function serialized<T>(path: string, action: () => Promise<T>): Promise<T> {
  const work = (pending.get(path) ?? Promise.resolve()).catch(() => {}).then(action)
  pending.set(path, work)
  void work.finally(() => { if (pending.get(path) === work) pending.delete(path) }).catch(() => {})
  return work
}
export function projectPreviewCapabilityPath(workspace: string, sessionId: string) {
  directory ??= realpathSync(mkdtempSync(join(tmpdir(), 'beegame-preview-access-')))
  return join(directory, createHash('sha256').update(JSON.stringify([realpathSync(workspace), sessionId])).digest('hex') + '-assets.json')
}

export async function publishProjectAssetCapabilities(workspace: string, sessionId: string, assets: { libraryBaseUrl?: string; imageEndpoint?: string; registrationEndpoint?: string; screenOrientation?: 'Landscape' | 'Portrait' }) {
  return publishCapability(workspace, sessionId, { assets })
}

async function publishCapability(workspace: string, sessionId: string, value: object) {
  workspace = realpathSync(workspace)
  const path = projectPreviewCapabilityPath(workspace, sessionId), executionId = randomUUID()
  const temporary = path + '.' + executionId
  await serialized(path, async () => { try {
    await writeFile(temporary, JSON.stringify({ version: 1, workspace, sessionId, executionId, ...value }), { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(() => {}) } })
  return () => serialized(path, async () => {
    // A delayed old-turn cleanup must never revoke its replacement.
    const current = await readFile(path, 'utf8').catch(() => undefined)
    if (current && JSON.parse(current).executionId === executionId) await unlink(path).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
  })
}
