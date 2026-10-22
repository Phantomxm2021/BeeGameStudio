import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DESIGN_ACCEPTANCE_PATH } from './design-handoff'
import { inspectDesignAcceptance } from './runtime-acceptance'

test('local acceptance check uses delivery validation without a browser', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bgs-acceptance-format-'))
  try {
    const reportPath = join(directory, DESIGN_ACCEPTANCE_PATH)
    await mkdir(join(directory, '.beegame/delivery'), { recursive: true })
    await writeFile(join(directory, 'evidence.png'), 'evidence')
    await writeFile(join(directory, 'dist'), 'tested build')
    const check = {
      kind: 'ui-layout', document: 'content/ui/title.json', nodeId: 'title', property: 'layout',
      change: 'move button', expected: 'button moves', observed: 'button moved',
      status: 'passed', evidencePaths: ['evidence.png'],
    }
    const base = {
      scope: 'delivery', status: 'passed', summary: 'Observed in browser', environment: 'Browser',
      evidencePaths: ['evidence.png'], artifactPaths: ['dist'],
      verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [], unverified: [] },
    }
    const run = async (report: unknown) => {
      await writeFile(reportPath, JSON.stringify(report))
      return inspectDesignAcceptance(directory)
    }
    const misplaced = await run({ ...base, contentChecks: [check] })
    expect(misplaced.valid).toBe(false)
    expect(misplaced.diagnostic?.message).toContain('contentChecks must be inside verification.contentChecks')

    const wrongProperty = await run({ ...base, verification: { ...base.verification,
      contentChecks: [{ ...check, property: 'transform' }] } })
    expect(wrongProperty).toMatchObject({ valid: false, diagnostic: { category: 'report-invalid' } })

    const valid = await run(base)
    expect(valid).toMatchObject({ valid: true, status: 'passed', quality: 'unverified' })
    const missingEvidence = await run({ ...base, evidencePaths: ['missing.png'] })
    expect(missingEvidence).toMatchObject({ valid: false, diagnostic: { category: 'report-invalid' } })
    const incomplete = await run({ ...base, verification: { ...base.verification, unverified: ['Not tested'] } })
    expect(incomplete).toMatchObject({ valid: false, diagnostic: { category: 'verification-incomplete' } })
    const failed = await run({ ...base, verification: { ...base.verification, knownIssues: ['Broken input'] } })
    expect(failed).toMatchObject({ valid: false, diagnostic: { category: 'product-failed' } })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
