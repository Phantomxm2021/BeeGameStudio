import { expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditTechnicalIntegration } from './audit-technical-integration'
import { writeDesignDocumentsFixture } from '../packages/agent-workflow-server/src/beegame/fixtures/layout-fixture'

test('observes preserved, changed, removed and added source without modifying files or certifying semantics', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-integration-audit-'))
  try {
    await writeDesignDocumentsFixture(workspace)
    const path = join(workspace, 'docs/TECHNICAL_DESIGN.md'), baselinePath = join(workspace, 'baseline.md')
    const initial = await readFile(path, 'utf8')
    const before = initial + '\n## Stable interface\nKeep this contract.\n## Obsolete interface\nOld design.\n## Audio wiring\nBefore.\n'
    const after = initial + '\n## Stable interface\nKeep this contract.\n## Audio wiring\nConsume the owner source.\n## Resource binding\nConsume the manifest.\n'
    await writeFile(baselinePath, before)
    await writeFile(path, after)
    const report = auditTechnicalIntegration(baselinePath, workspace)
    expect(report.sections).toMatchObject({ modified: ['Audio wiring'], removed: ['Obsolete interface'], added: ['Resource binding'] })
    expect(report.sections!.unchanged).toContain('Stable interface')
    expect(report.lines.added).toBeGreaterThan(0)
    expect(report.lines.removed).toBeGreaterThan(0)
    expect(report.diff).toContain('-Old design.')
    expect(report.declaredCoverage.valid).toBe(true)
    expect(report.unverified).toHaveLength(4)
    expect(await readFile(path, 'utf8')).toBe(after)
    expect(await readFile(baselinePath, 'utf8')).toBe(before)

    // Real shared coverage still reports omitted owner mappings.
    const indexPath = join(workspace, '.beegame/design-handoffs/TECHNICAL_DESIGN.json')
    const index = JSON.parse(await readFile(indexPath, 'utf8'))
    index.implementationItems = []
    await writeFile(indexPath, JSON.stringify(index))
    expect(auditTechnicalIntegration(baselinePath, workspace).declaredCoverage.valid).toBe(false)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('missing or ambiguous baseline cannot produce a preservation pass', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-integration-baseline-'))
  try {
    await writeDesignDocumentsFixture(workspace)
    const finalPath = join(workspace, 'docs/TECHNICAL_DESIGN.md'), baseline = join(workspace, 'before.md')
    expect(() => auditTechnicalIntegration(finalPath, workspace)).toThrow('separate retained')
    expect(() => auditTechnicalIntegration(baseline, workspace)).toThrow()
    await writeFile(baseline, '')
    expect(() => auditTechnicalIntegration(baseline, workspace)).toThrow('required')
    await writeFile(baseline, '# Duplicate\nA\n# Duplicate\nB\n')
    const report = auditTechnicalIntegration(baseline, workspace)
    expect(report.sections).toBeNull()
    expect(report.sectionLimitation).toContain('ambiguous')
    expect(report.diff).toContain('-A')
  } finally { await rm(workspace, { recursive: true, force: true }) }
})
