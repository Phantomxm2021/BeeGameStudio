import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'

export type BeeGameProjectMetadata = {
  id: string
  name: string
  root_path?: string
  created_at: number
  runtime_snapshot?: BeeGameProjectRuntimeSnapshot
}

export type BeeGameProjectRuntimeSnapshot = {
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  phase_name?: string
  model_config_id?: string
  model_name?: string
  updated_at?: number
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
        updated_at INTEGER NOT NULL,
        runtime_snapshot TEXT
      )
    `)
    this.ensureRuntimeSnapshotColumn()
  }

  listProjects(): BeeGameProjectMetadata[] {
    return this.db
      .query<{
        id: string
        name: string
        root_path: string | null
        created_at: number
        runtime_snapshot: string | null
      }, []>(
        `SELECT id, name, root_path, created_at, runtime_snapshot
         FROM projects
         ORDER BY created_at DESC, updated_at DESC`,
      )
      .all()
      .map(row => ({
        id: row.id,
        name: row.name,
        ...(row.root_path ? { root_path: row.root_path } : {}),
        created_at: row.created_at,
        ...parseRuntimeSnapshot(row.runtime_snapshot),
      }))
  }

  upsertProject(project: BeeGameProjectMetadata): BeeGameProjectMetadata {
    const normalized = normalizeProject(project)
    const now = Date.now()
    this.db
      .query<
        unknown,
        [string, string, string | null, number, number, string | null]
      >(
        `INSERT INTO projects (id, name, root_path, created_at, updated_at, runtime_snapshot)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           root_path = excluded.root_path,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           runtime_snapshot = excluded.runtime_snapshot`,
      )
      .run(
        normalized.id,
        normalized.name,
        normalized.root_path ?? null,
        normalized.created_at,
        now,
        normalized.runtime_snapshot
          ? JSON.stringify(normalized.runtime_snapshot)
          : null,
      )
    return normalized
  }

  deleteProject(id: string): boolean {
    const result = this.db
      .query<unknown, [string]>('DELETE FROM projects WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  private ensureRuntimeSnapshotColumn(): void {
    const columns = this.db
      .query<{ name: string }, []>('PRAGMA table_info(projects)')
      .all()
      .map(column => column.name)
    if (!columns.includes('runtime_snapshot')) {
      this.db.run('ALTER TABLE projects ADD COLUMN runtime_snapshot TEXT')
    }
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
    ...normalizeRuntimeSnapshot(project.runtime_snapshot),
  }
}

function normalizeRuntimeSnapshot(
  snapshot: BeeGameProjectRuntimeSnapshot | undefined,
): { runtime_snapshot?: BeeGameProjectRuntimeSnapshot } {
  if (!snapshot || typeof snapshot !== 'object') return {}
  const usage = snapshot.usage
  const normalizedUsage = usage && typeof usage === 'object'
    ? {
        prompt_tokens: Math.max(0, Number(usage.prompt_tokens) || 0),
        completion_tokens: Math.max(0, Number(usage.completion_tokens) || 0),
        total_tokens: Math.max(0, Number(usage.total_tokens) || 0),
      }
    : undefined
  const normalized: BeeGameProjectRuntimeSnapshot = {
    ...(normalizedUsage ? { usage: normalizedUsage } : {}),
    ...(snapshot.phase_name?.trim()
      ? { phase_name: snapshot.phase_name.trim() }
      : {}),
    ...(snapshot.model_config_id?.trim()
      ? { model_config_id: snapshot.model_config_id.trim() }
      : {}),
    ...(snapshot.model_name?.trim()
      ? { model_name: snapshot.model_name.trim() }
      : {}),
    ...(Number.isFinite(snapshot.updated_at)
      ? { updated_at: Number(snapshot.updated_at) }
      : {}),
  }
  return Object.keys(normalized).length > 0
    ? { runtime_snapshot: normalized }
    : {}
}

function parseRuntimeSnapshot(
  raw: string | null,
): { runtime_snapshot?: BeeGameProjectRuntimeSnapshot } {
  if (!raw) return {}
  try {
    return normalizeRuntimeSnapshot(JSON.parse(raw))
  } catch {
    return {}
  }
}
