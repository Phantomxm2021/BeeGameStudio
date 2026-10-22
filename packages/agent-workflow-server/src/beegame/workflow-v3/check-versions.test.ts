import { test, expect } from 'bun:test'
import { CHECK_IDS, type CheckResult } from './state'
import { CHECK_VERSIONS, EDITABLE_BUILD_CHECK_VERSION, currentCheckVersion, isCurrentCheckVersion } from './check-versions'
import { checkIsCurrent } from './checks'

test('every declared checker has one current driver identity; unknown/obsolete versions cannot be reused', async () => {
  for (const id of CHECK_IDS) {
    const check: CheckResult = { id, version: CHECK_VERSIONS[id], status: 'passed', inputs: [], observation: 'Synthetic version fixture, not acceptance', createdAt: '2026-10-11T00:00:00Z' }
    expect(isCurrentCheckVersion(check)).toBe(true)
    expect(await checkIsCurrent('/path-not-accessed-for-empty-input', check)).toBe(true)
    expect(await checkIsCurrent('/path-not-accessed-for-empty-input', { ...check, version: 'obsolete.0' })).toBe(false)
    expect(check.version).toBe(CHECK_VERSIONS[id])
  }
  for (const id of ['author-PASS', '__proto__', 'toString'])
    expect(isCurrentCheckVersion({ id, version: 'v3-slice.1' })).toBe(false)
  // Old outer-box-only UI evidence cannot certify the new text-fit contract.
  expect(isCurrentCheckVersion({id:'ui-data-consumption',version:'v3-ui-dom-consumption.1'})).toBe(false)
  expect(isCurrentCheckVersion({id:'ui-data-consumption',version:'v3-ui-dom-consumption.2'})).toBe(false)
  expect(isCurrentCheckVersion({id:'ui-data-consumption',version:'v3-ui-dom-consumption.3'})).toBe(false)
  expect(isCurrentCheckVersion({id:'ui-data-consumption',version:'v3-ui-dom-consumption.4'})).toBe(false)
  expect(await checkIsCurrent('/path-not-accessed-for-empty-input', {id:'ui-data-consumption',version:'v3-ui-dom-consumption.6',
    status:'passed',inputs:[],observation:'No enabled visibility evidence',createdAt:'earlier'})).toBe(false)
  expect(isCurrentCheckVersion({id:'pixel-data-consumption',version:'v3-canvas-image-consumption.2'})).toBe(false)
  expect(await checkIsCurrent('/path-not-accessed-for-empty-input', {id:'ui-data-consumption',version:'v3-ui-dom-consumption.1',
    status:'passed',inputs:[],observation:'Old synthetic receipt',createdAt:'earlier'})).toBe(false)
  // These drivers either audit atlas structure or invoke that audit before
  // packaging/probing. Old receipts did not apply the same evidence contract.
  for (const [id, version] of [['content-resources','v3-content.4'], ['delivery-package','v3-static-artifact.3'],
    ['pixel-data-consumption','v3-canvas-image-consumption.6'], ['font-data-consumption','v3-dom-font-consumption.4'],
    ['audio-data-consumption','v3-html-audio-consumption.6']])
    expect(await checkIsCurrent('/path-not-accessed-for-empty-input', {id:id!,version:version!,
      status:'passed',inputs:[],observation:'Old resource validation',createdAt:'earlier'})).toBe(false)
})

test('build evidence must match the owning task mode, not any recognized build version', () => {
  const ordinary = { id: 'build', version: currentCheckVersion('build') }
  const editable = { id: 'build', version: currentCheckVersion('build', { editableProject: true }) }
  expect(editable.version).toBe(EDITABLE_BUILD_CHECK_VERSION)
  expect(isCurrentCheckVersion(ordinary, {})).toBe(true)
  expect(isCurrentCheckVersion(editable, { editableProject: true })).toBe(true)
  expect(isCurrentCheckVersion(ordinary, { editableProject: true })).toBe(false)
  expect(isCurrentCheckVersion(editable, {})).toBe(false)
  expect(isCurrentCheckVersion(editable)).toBe(true)
})
