import { expect, test } from 'bun:test'
import { GATE_REFERENCE_DESCRIPTION, parseAcceptanceChecklist } from './acceptance-checklist'

test('accepts scenario sources and the fixed owner-gate form', () => {
  const result = parseAcceptanceChecklist([
    '- [ ] PATH-01 [docs/GDD.md#core_loop] Start a session, complete the loop, and record the stated reward evidence.',
    '- [ ] AC-01 [docs/GDD.md#AC-01] Start the accepted IR scenario and record its observable outcome.',
    `- [ ] BAL-01 [docs/BALANCE_DESIGN.md#formulas] ${GATE_REFERENCE_DESCRIPTION}`,
  ].join('\n'))
  expect(result.issues).toEqual([])
  expect(result.tasks.map(task => task.source)).toEqual([
    '[docs/GDD.md#core_loop]',
    '[docs/GDD.md#AC-01]',
    '[docs/BALANCE_DESIGN.md#formulas]',
  ])
})

test('rejects missing, excluded, and expanded gate sources', () => {
  const result = parseAcceptanceChecklist([
    '- [ ] PATH-01 A source tag is required.',
    '- [ ] ASSET-01 [docs/ASSET_PLAN.md#inventory] Inventory has one item.',
    '- [ ] BAL-01 [docs/BALANCE_DESIGN.md#formulas] Formula 7 produces 42.',
  ].join('\n'))
  expect(result.issues).toEqual([
    'docs/acceptance/gameplay-checklist.md: Checklist task PATH-01 has no Checklist authority source tag.',
    'docs/acceptance/gameplay-checklist.md: Checklist task ASSET-01 cites an excluded or unknown source: [docs/ASSET_PLAN.md#inventory].',
    'docs/acceptance/gameplay-checklist.md: Checklist task BAL-01 must use the gate-reference form for [docs/BALANCE_DESIGN.md#formulas].',
  ])
})
