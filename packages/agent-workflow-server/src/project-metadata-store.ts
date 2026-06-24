import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'

export type BeeGameProjectMetadata = {
  id: string
  name: string
  root_path?: string
  created_at: number
}

export class BeeGameProjectMetadataStore {
  private db: Database

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.db = new Database(resolve(databasePath), { create: true })
    this.db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  }

  listProjects(): BeeGameProjectMetadata[] {
    return this.db
      .query<{
        id: string
        name: string
        root_path: string | null
        created_at: number
      }, []>(
        `SELECT id, name, root_path, created_at
         FROM projects
         ORDER BY created_at DESC, updated_at DESC`,
      )
      .all()
      .map(row => ({
        id: row.id,
        name: row.name,
        ...(row.root_path ? { root_path: row.root_path } : {}),
        created_at: row.created_at,
      }))
  }

  upsertProject(project: BeeGameProjectMetadata): BeeGameProjectMetadata {
    const normalized = normalizeProject(project)
    const now = Date.now()
    this.db
      .query<
        unknown,
        [string, string, string | null, number, number]
      >(
        `INSERT INTO projects (id, name, root_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           root_path = excluded.root_path,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        normalized.id,
        normalized.name,
        normalized.root_path ?? null,
        normalized.created_at,
        now,
      )
    return normalized
  }

  deleteProject(id: string): boolean {
    const result = this.db
      .query<unknown, [string]>('DELETE FROM projects WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}

export function getBeeGameProjectDatabasePath(dataRoot: string): string {
  return resolve(dataRoot, 'beegame.sqlite')
}

function normalizeProject(project: BeeGameProjectMetadata): BeeGameProjectMetadata {
  const id = project.id.trim()
  const name = project.name.trim()
  if (!id) throw new Error('Project id is required')
  if (!name) throw new Error('Project name is required')
  return {
    id,
    name,
    ...(project.root_path?.trim() ? { root_path: project.root_path.trim() } : {}),
    created_at: Number.isFinite(project.created_at)
      ? project.created_at
      : Date.now(),
  }
}
