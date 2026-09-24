import { resolve } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import { auditResourceDeliveryReadiness, confirmedResourceLibraryUsage } from './resource-delivery-readiness'

/** Read-only entry point to the host's existing acceptance checks. */
export function validateResourceDelivery(workspacePath: string, confirmedBriefContext?: string) {
  const started = performance.now()
  const audit = auditAssetContract(workspacePath)
  if (!audit.present || !audit.valid)
    return { valid: false, issues: audit.present ? audit.issues : ['assets/asset-manifest.json is missing.'],
      requirementCount: audit.requirements.length, resourceCount: audit.resources.length,
      elapsedMs: Math.round(performance.now() - started) }
  const readiness = auditResourceDeliveryReadiness({ workspacePath,
    confirmedPolicy: confirmedResourceLibraryUsage(confirmedBriefContext),
  })
  const issues = [...new Set([
    ...audit.issues, ...readiness.issues, ...readiness.readinessIssues,
    ...(audit.requirements.length ? [] : ['Resource delivery requires at least one canonical requirement.']),
  ])]
  return { valid: issues.length === 0, issues, requirementCount: audit.requirements.length,
    resourceCount: audit.resources.length, elapsedMs: Math.round(performance.now() - started) }
}

if (import.meta.main) {
  try {
    const result = validateResourceDelivery(resolve(process.argv[2] ?? process.cwd()))
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.valid ? 0 : 1
  } catch (error) {
    console.log(JSON.stringify({ valid: false, issues: [error instanceof Error ? error.message : String(error)] }))
    process.exitCode = 1
  }
}
