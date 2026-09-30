import { readRuntimeAcceptanceReport } from './runtime-acceptance'

// Read-only preflight: exactly the report/content/evidence validator used by
// delivery, not a second schema or a browser test. Never records acceptance.
const report = await readRuntimeAcceptanceReport(process.cwd(), process.argv[2] || '.beegame/delivery/acceptance.json')
const issue = !report ? { category: 'report-invalid', message: 'Acceptance report is missing.' }
  : report.diagnostic ?? (report.scope !== 'delivery' ? { category: 'report-invalid', message: 'Acceptance report must have scope delivery.' } : undefined)
const valid = Boolean(report?.status === 'passed' && !issue)
console.log(JSON.stringify({ check: 'report-content-evidence', valid, publishReadiness: 'not-checked', status: report?.status ?? 'blocked', diagnostic: issue,
  message: valid ? 'Report, content references and evidence files validated. This does not independently certify gameplay or publish the project.' : issue?.message ?? report?.summary }, null, 2))
process.exitCode = valid ? 0 : 1
