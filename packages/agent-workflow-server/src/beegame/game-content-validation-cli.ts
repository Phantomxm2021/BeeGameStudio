import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readBeeGameAssetManifestSync } from './asset-contracts'
import { auditBeeGameContentPackage } from './game-content-package'
import type { DeliveryRun } from './delivery-workflow/types'

/** Read-only entry point to the exact host validation used after Content authoring. */
export function validateGameContent(workspacePath: string) {
  const started = performance.now()
  const run = JSON.parse(
    readFileSync(resolve(workspacePath, '.beegame/workflow/run.json'), 'utf8'),
  ) as DeliveryRun
  const assetManifestRevision = run.revision.resource
  if (!assetManifestRevision)
    return {
      valid: false,
      issues: ['An accepted Asset Manifest revision is required.'],
      contentCount: 0,
      elapsedMs: Math.round(performance.now() - started),
    }
  const audit = auditBeeGameContentPackage(workspacePath, {
    documentRevision: run.revision.document,
    assetManifestRevision,
    manifest: readBeeGameAssetManifestSync(workspacePath),
  })
  return {
    valid: audit.valid,
    issues: audit.issues,
    contentCount: audit.package?.documents.length ?? 0,
    elapsedMs: Math.round(performance.now() - started),
  }
}

if (import.meta.main) {
  try {
    const result = validateGameContent(resolve(process.argv[2] ?? process.cwd()))
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.valid ? 0 : 1
  } catch (error) {
    console.log(
      JSON.stringify({
        valid: false,
        issues: [error instanceof Error ? error.message : String(error)],
      }),
    )
    process.exitCode = 1
  }
}
