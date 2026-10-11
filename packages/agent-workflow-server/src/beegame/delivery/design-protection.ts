import type { ProductionDesignBaseline } from '@bee-game-studio/agent-workflow/production-check-input'
import { requiredDesignFindings } from '@bee-game-studio/agent-workflow/design-review-result'
import { checkDesignHandoff } from '../design-handoff'
import { PROJECT_DOCUMENTS } from '../project-content-authority'

/** Production consumes a released design. It cannot grant itself a new baseline. */
export function checkProductionDesign(workspace: string, baseline: ProductionDesignBaseline,
  phase: 'resources' | 'content' | 'implementation' | 'acceptance') {
  const check = checkDesignHandoff(workspace, Object.keys(baseline.snapshots) as Array<typeof PROJECT_DOCUMENTS[number]>,
    { digestVersion: baseline.digestVersion, nextConsumers: [phase] })
  const changed = Object.keys(baseline.snapshots).filter(name => baseline.snapshots[name] !== check.snapshots[name])
  const evidence = Object.keys(baseline.evidenceHashes).filter(path => baseline.evidenceHashes[path] !== check.evidenceHashes[path])
  const issues = [...check.issues]
  if (changed.length || evidence.length) issues.push(
    'Reviewed design/evidence changed outside scheduled owner scope; request an affected design-resolution before dependent work.',
    ...(changed.length ? ['Changed design owners: ' + changed.join(', ') + '.'] : []),
    ...(evidence.length ? ['Changed design sources/evidence: ' + evidence.join(', ') + '.'] : []),
    'Saved production changed protected reviewed design. Correct unintended edits back to the accepted requirements, preserving valid bindings. If the original value is unavailable or the design itself must change, report blocked; do not invent a restoration or update baseline hashes.')
  issues.push(...requiredDesignFindings(baseline.followUps ?? [], [phase])
    .map(f => `${f.id} is due before ${phase}; owner ${f.owner}: ${f.closeWhen}`))
  return { revision: check.revision, issues }
}
