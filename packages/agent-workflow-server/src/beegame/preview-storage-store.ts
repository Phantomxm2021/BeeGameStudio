import { Database } from 'bun:sqlite'
import { chmodSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { setPreviewStorageItem, validatePreviewStorageItem, type PreviewStorageItems } from './preview-storage.mjs'

/** BGS-owned save data, never a project source, build input or deployment file.
 * SQLite transactions also prevent cross-process lost updates on one data root. */
export function createPreviewStorageStore(dataRoot: string) {
  mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
  const directory = join(realpathSync(dataRoot), 'preview-saves')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (realpathSync(directory) !== directory) throw Error('Preview save directory cannot be an alias')
  const file = join(directory, 'saves.sqlite')
  try { if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw Error('Preview save database must be a regular file') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const db = new Database(file, { create: true })
  try {
    chmodSync(file, 0o600)
    db.run('PRAGMA busy_timeout = 3000')
    db.run('PRAGMA journal_mode = WAL')
    db.run(`CREATE TABLE IF NOT EXISTS preview_saves (
      user_id TEXT NOT NULL, project_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (user_id, project_id, key))`)
  } catch (error) { db.close(); throw error }
  return {
    forProject(userId: string, projectId: string): PreviewStorageItems {
      if (!userId || !projectId) throw Error('Preview save scope is required')
      return {
        getItem(key) {
          validatePreviewStorageItem(key, null)
          return (db.query('SELECT value FROM preview_saves WHERE user_id=? AND project_id=? AND key=?')
            .get(userId, projectId, key) as { value: string } | null)?.value ?? null
        },
        setItem(key, value) {
          db.transaction(() => {
            const rows = db.query('SELECT key,value FROM preview_saves WHERE user_id=? AND project_id=?')
              .all(userId, projectId) as { key: string; value: string }[]
            setPreviewStorageItem(new Map(rows.map(row => [row.key, row.value])), key, value)
            if (value === null) db.query('DELETE FROM preview_saves WHERE user_id=? AND project_id=? AND key=?').run(userId, projectId, key)
            else db.query('INSERT INTO preview_saves VALUES (?,?,?,?) ON CONFLICT(user_id,project_id,key) DO UPDATE SET value=excluded.value')
              .run(userId, projectId, key, value)
          }).immediate()
        },
      }
    },
    close() { db.close() },
  }
}
