import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readDeliveryPhaseReport, type DeliveryBillingEvent } from '../src/beegame/delivery-phase-report'

const workspace = process.argv[2]
if (!workspace) {
  console.error('Usage: bun scripts/delivery-phase-report.ts <project-workspace> [project-filtered-usage-events.json]')
  process.exit(2)
}

const billingEvents = process.argv[3]
  ? JSON.parse(await readFile(resolve(process.argv[3]), 'utf8')) as DeliveryBillingEvent[]
  : undefined
if (billingEvents && !Array.isArray(billingEvents))
  throw new Error('Billing events JSON must be an array')
const report = await readDeliveryPhaseReport(resolve(workspace), billingEvents)
console.log(JSON.stringify(report, null, 2))
