import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acceptanceReportFormatCheckerSource } from './content-runtime-contract'

test('local report-format check catches misplaced checks and wrong kind/property without a browser', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bgs-acceptance-format-'))
  try {
    const script = join(directory, 'check-acceptance.mjs')
    const reportPath = join(directory, 'acceptance.json')
    await writeFile(script, acceptanceReportFormatCheckerSource())
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
      return Bun.spawnSync([process.execPath, script, reportPath], { cwd: directory })
    }
    const misplaced = await run({ ...base, contentChecks: [check] })
    expect(misplaced.exitCode).toBe(1)
    expect(misplaced.stderr.toString()).toContain('move top-level contentChecks to verification.contentChecks')

    const wrongProperty = await run({ ...base, verification: { ...base.verification,
      contentChecks: [{ ...check, property: 'transform' }] } })
    expect(wrongProperty.exitCode).toBe(1)
    expect(wrongProperty.stderr.toString()).toContain('invalid for ui-layout; use layout')

    const valid = await run({ ...base, verification: { ...base.verification, contentChecks: [check] } })
    expect(valid.exitCode).toBe(0)
    expect(valid.stdout.toString()).toContain('full report and runtime evidence are not verified')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
