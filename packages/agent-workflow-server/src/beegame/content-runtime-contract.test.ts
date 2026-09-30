import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundleAcceptanceChecker } from './acceptance-check-bundle'
import { readRuntimeAcceptanceReport } from './runtime-acceptance'

test('local acceptance check uses delivery validation without a browser', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bgs-acceptance-format-'))
  try {
    const script = join(directory, 'check-acceptance.mjs')
    const reportPath = join(directory, 'acceptance.json')
    await writeFile(script, await bundleAcceptanceChecker())
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
      const result = Bun.spawnSync([process.execPath, script, 'acceptance.json'], { cwd: directory })
      expect(JSON.parse(result.stdout.toString()).diagnostic).toEqual((await readRuntimeAcceptanceReport(directory, 'acceptance.json'))?.diagnostic)
      return result
    }
    const misplaced = await run({ ...base, contentChecks: [check] })
    expect(misplaced.exitCode).toBe(1)
    expect(misplaced.stdout.toString()).toContain('contentChecks must be inside verification.contentChecks')

    const wrongProperty = await run({ ...base, verification: { ...base.verification,
      contentChecks: [{ ...check, property: 'transform' }] } })
    expect(wrongProperty.exitCode).toBe(1)
    expect(wrongProperty.stdout.toString()).toContain('report-invalid')

    const valid = await run(base)
    expect(valid.exitCode).toBe(0)
    expect(valid.stdout.toString()).toContain('does not independently certify gameplay')
    const missingEvidence = await run({ ...base, evidencePaths: ['missing.png'] })
    expect(missingEvidence.exitCode).toBe(1)
    expect(missingEvidence.stdout.toString()).toContain('report-invalid')
    const incomplete = await run({ ...base, verification: { ...base.verification, unverified: ['Not tested'] } })
    expect(incomplete.stdout.toString()).toContain('verification-incomplete')
    const failed = await run({ ...base, verification: { ...base.verification, knownIssues: ['Broken input'] } })
    expect(failed.stdout.toString()).toContain('product-failed')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
