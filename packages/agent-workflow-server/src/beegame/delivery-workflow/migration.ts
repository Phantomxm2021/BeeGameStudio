import { readdir } from 'node:fs/promises'
import type { RunStore } from './run-store'

export type WorkflowMigrationState =
  | { status: 'managed'; runId: string }
  | { status: 'unmanaged'; reason: 'missing_snapshot' | 'legacy_evidence_only' }

export async function inspectWorkflowOwnership(
  store: RunStore,
): Promise<WorkflowMigrationState> {
  const run = await store.load()
  if (run) return { status: 'managed', runId: run.runId }
  try {
    const entries = await readdir(store.paths.directory, {
      withFileTypes: true,
    })
    const evidence = entries.find(
      entry => entry.isDirectory() && entry.name === 'evidence',
    )
    if (evidence) {
      const files = await readdir(`${store.paths.directory}/evidence`)
      if (files.length > 0)
        return { status: 'unmanaged', reason: 'legacy_evidence_only' }
    }
  } catch {
    // Missing workflow storage is the ordinary unmanaged state.
  }
  return { status: 'unmanaged', reason: 'missing_snapshot' }
}
