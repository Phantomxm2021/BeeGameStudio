import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createTwoFilesPatch, diffLines } from 'diff'
import { designSectionHashes } from '../packages/agent-workflow-server/src/beegame/design-document-sections'
import { checkDesignHandoffDraft } from '../packages/agent-workflow-server/src/beegame/design-handoff'

/** Offline observations, not an author tool, a new release gate or a semantic
 * score. The baseline must be the actual pre-completion source, not a rewrite.
 * No files, receipts or design versions are changed by this command. */
export function auditTechnicalIntegration(baselinePath: string, workspace: string) {
  const beforePath = resolve(baselinePath)
  const afterPath = resolve(workspace, 'docs/TECHNICAL_DESIGN.md')
  if (realpathSync(beforePath) === realpathSync(afterPath)) throw new Error('Baseline must be a separate retained pre-completion source')
  const before = readFileSync(beforePath, 'utf8'), after = readFileSync(afterPath, 'utf8')
  if (!before.trim() || !after.trim()) throw new Error('Both actual baseline and completed technical source are required')
  const previous = designSectionHashes(before), current = designSectionHashes(after)
  const sections = previous && current ? {
    unchanged: Object.keys(previous).filter(name => current[name] === previous[name]),
    modified: Object.keys(previous).filter(name => name in current && current[name] !== previous[name]),
    removed: Object.keys(previous).filter(name => !(name in current)),
    added: Object.keys(current).filter(name => !(name in previous)),
  } : null
  const lines = { unchanged: 0, added: 0, removed: 0 }
  for (const part of diffLines(before, after))
    lines[part.added ? 'added' : part.removed ? 'removed' : 'unchanged'] += part.count ?? 0
  const hash = (source: string) => createHash('sha256').update(source).digest('hex')
  return {
    baseline: { path: beforePath, sha256: hash(before), characters: before.length },
    completed: { path: afterPath, sha256: hash(after), characters: after.length },
    lines,
    sections,
    sectionLimitation: sections ? 'Own section bodies; nested headings are compared separately. Host version metadata is ignored. Renamed/moved headings may appear as removed/added; this is not a lost-requirement verdict.'
      : 'Headings absent or ambiguous; inspect the full diff, not an inferred section mapping.',
    declaredCoverage: checkDesignHandoffDraft(workspace, 'TECHNICAL_DESIGN.md', { finalTechnical: true }),
    diff: createTwoFilesPatch('retained-baseline', 'completed-technical', before, after),
    unverified: [
      'Whether changed or removed baseline decisions were invalidated by actual specialist requirements or evidence.',
      'Whether additions duplicate another owner\'s parameters/rules rather than define a necessary interface or derived specification.',
      'Whether original requirements, necessary interfaces and implementation tasks are semantically complete.',
      'Elapsed time and input/cache/output tokens require the matching native run logs; text differences do not measure savings.',
    ],
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 2) throw new Error('Usage: bun scripts/audit-technical-integration.ts RETAINED_BASELINE.md PROJECT_WORKSPACE')
    const report = auditTechnicalIntegration(args[0]!, args[1]!)
    await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify(report, null, 2) + '\n',
      error => error ? reject(error) : resolve()))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
