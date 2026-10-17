import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod/v4'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
import { checkDesignHandoff, checkDesignHandoffDraft, designReviewIndexes, type DesignHandoff } from './design-handoff'
import { designSourceLocations, readDesignSections } from './design-source-reading'
import { auditAssetContract } from './asset-contract-audit'
import { readBeeGameAssetManifestSync } from './asset-contracts'
import { inspectContentBindings } from './content-binding'
import { parseBeeGameContentDocument } from './game-content-schema'
import { contentBindingIssues } from './game-content-package'
import { validateResourceSelections } from './tilemap-contract'
import { collectContentSourceFiles } from './content-source-files'

export const designReadSchema = z.strictObject({ read: z.array(z.strictObject({
  document: z.enum(PROJECT_DOCUMENTS), sections: z.array(z.string().min(1)).min(1),
})).min(1).optional() })
export const implementationReadSchema = z.strictObject({ id: z.string().trim().min(1).optional() })
export const bindingsReadSchema = z.strictObject({ detailsFor: z.string().optional() })
export const verificationReadSchema = z.strictObject({
  measurementId: z.string().trim().min(1).optional(), previewReceipt: z.string().min(1).optional(),
  details: z.boolean().optional(),
}).refine(value => !(value.measurementId && value.previewReceipt), 'Select a measurement ID or a preview receipt, not both')
const reason = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Current saved inputs, including independently readable drafts. Never finalize or lock. */
export function readDesignHandoff(workspace: string, input: unknown) {
  const { read = [] } = designReadSchema.parse(input)
  const check = checkDesignHandoff(workspace, PROJECT_DOCUMENTS, { technicalBaseline: true, planningInputs: true })
  const issues = [...check.issues]
  const sources = read.flatMap(request => {
    try { return readDesignSections(workspace, [request]).sources }
    catch (error) { issues.push(request.document + ': ' + reason(error)); return [] }
  })
  return { valid: !issues.length, scope: 'saved-design-handoff', issues,
    documents: designSourceLocations(workspace, read.length ? [...new Set(read.map(item => item.document))] : PROJECT_DOCUMENTS).map(document => ({ ...document,
      ...(read.length ? { sections: 'sections' in document ? document.sections.filter(section => read.some(request =>
        request.document === document.document && request.sections.includes(section.heading))) : undefined } : {}),
      version: check.documentVersions[document.document as typeof PROJECT_DOCUMENTS[number]],
      requirementCount: (check.availableRequirements ?? []).filter(item => item.document === document.document).length,
    })), sources,
    note: 'Saved source/index structure only, not design completeness, visual approval or implementation permission. Missing siblings do not hide readable sources. No metadata changes or baseline lock.' }
}

/** The existing technical index locates prose; it is not a second task store. */
export function readImplementationTask(workspace: string, input: unknown) {
  const { id } = implementationReadSchema.parse(input)
  const indexes = designReviewIndexes(workspace, PROJECT_DOCUMENTS)
  const technical = indexes.find(index => index.document === 'TECHNICAL_DESIGN.md')!
  const items: NonNullable<DesignHandoff['implementationItems']> = 'implementationItems' in technical ? technical.implementationItems ?? [] : []
  const issues = [...checkDesignHandoffDraft(workspace, 'TECHNICAL_DESIGN.md', { finalTechnical: true }).issues]
  const directory = items.map(item => ({ id: item.id, dependsOn: item.dependsOn,
    dependencyStatus: item.dependsOn === undefined ? 'unspecified' : 'not-verified', section: item.section }))
  const result = { scope: 'saved-implementation-task', directory, issues,
    note: 'Read-only task/source view. Structural issues do not hide independently readable tasks. Dependencies are IDs, not completion evidence. Reading does not lock or authorize implementation.' }
  if (id === undefined) return { ...result, valid: !issues.length }
  const matches = items.filter(item => item.id === id)
  if (matches.length !== 1) return { ...result, valid: false,
    issues: [...issues, matches.length ? 'Ambiguous task ID: ' + id : 'Unknown task ID: ' + id] }
  const task = matches[0]!
  const requirements = task.requirementRefs.map(ref => {
    const owner = indexes.find(index => index.document === ref.document)
    const outputs = owner && 'outputs' in owner ? owner.outputs.filter(output => output.id === ref.id) : []
    if (outputs.length !== 1) {
      issues.push(`Missing or ambiguous requirement ${ref.document}#${ref.id}`)
      return { ...ref, unavailable: true }
    }
    const output = outputs[0]!
    if (!output.acceptance) issues.push(`Missing acceptance for ${ref.document}#${ref.id}`)
    return { ...ref, section: output.section, acceptance: output.acceptance }
  })
  let sources: ReturnType<typeof readDesignSections>['sources'] = []
  try {
    sources = readDesignSections(workspace, [{ document: 'TECHNICAL_DESIGN.md', sections: [task.section] }]).sources
    // Legacy indexes can point every ID at one Markdown table. Return the
    // exact ID row with its table header, preserving the shared prose around it.
    const siblings = items.filter(item => item.section === task.section)
    if (siblings.length > 1) for (const source of sources) for (const read of source.reads) {
      const lines = read.text.split('\n')
      const firstCell = (line: string) => line.trim().startsWith('|')
        ? line.trim().split('|')[1]?.trim().replace(/^`(.*)`$/, '$1') : undefined
      const matches = lines.filter(line => firstCell(line) === id)
      if (matches.length === 1) {
        const siblingIds = new Set(siblings.filter(item => item.id !== id).map(item => item.id))
        read.text = lines.filter(line => !siblingIds.has(firstCell(line) ?? '')).join('\n')
        Object.assign(read, { selection: 'task-table-row', taskId: id })
      } else Object.assign(read, {selection: 'shared-section', note: 'No unique task ID row; this is shared source prose, not an isolated task.'})
    }
  } catch (error) { issues.push('TECHNICAL_DESIGN.md: ' + reason(error)) }
  return { ...result, directory: directory.filter(item => item.id === id), valid: !issues.length, task, requirements, sources }
}

export async function checkResourcesAndBindings(workspace: string, input: unknown) {
  const { detailsFor } = bindingsReadSchema.parse(input)
  if (detailsFor !== undefined && (!/^content\/(ui|scenes)\/.+\.json$/.test(detailsFor) ||
      detailsFor.includes('\\') || detailsFor.split('/').some(part => !part || part === '.' || part === '..')))
    throw Error('detailsFor must be an exact content/ui or content/scenes JSON path')
  const root = realpathSync(workspace), issues: string[] = []
  const paths = collectContentSourceFiles(root, ['content/ui', 'content/scenes'], issues)
  if (!paths.length) issues.push('No saved UI/Scene binding inputs found')
  const bindings = paths.length ? await inspectContentBindings(root, paths) : { files: [], issues: [] }
  issues.push(...bindings.issues)
  const audit = auditAssetContract(root)
  issues.push(...audit.issues)
  if (!audit.present) issues.push('assets/asset-manifest.json is missing; resource bindings remain unverified')
  const manifest = (() => {
    try { return readBeeGameAssetManifestSync(root) }
    catch (error) { if (audit.present) issues.push(reason(error)); return undefined }
  })()
  // Read full source, not the display projection: nested locators must also be checked.
  for (const file of paths) try {
    const document = parseBeeGameContentDocument(JSON.parse(readFileSync(resolve(root, file), 'utf8')))
    issues.push(...contentBindingIssues(file, document))
    if (manifest) {
      for (const assetRef of document.assetRefs) if (!manifest.resources.some(resource => resource.id === assetRef && resource.status === 'verified'))
        issues.push(file + ': missing verified declared resource ' + assetRef)
      validateResourceSelections(root, manifest, document.data, issues, file)
    }
  } catch (error) { issues.push(file + ': ' + reason(error)) }
  if (detailsFor && !bindings.files.some(file => file.file === detailsFor)) issues.push('Cannot expand unavailable binding input: ' + detailsFor)
  return { valid: !issues.length, scope: 'saved-resources-and-bindings', issues: [...new Set(issues)],
    resources: audit.resources.map(({ fileEvidence, ...resource }) => {
      const registered = manifest?.resources.find(item => item.id === resource.id)
      return { ...resource, assetKind: registered?.asset_kind, fulfills: registered?.fulfills,
        files: fileEvidence.map(({ path, sha256 }) => ({ path, sha256 })) }
    }),
    requirementBindings: audit.bindings,
    files: bindings.files.map(file => file.file === detailsFor ? file : {
      file: file.file, sha256: file.sha256, documentId: file.documentId, kind: file.kind, assetRefs: file.assetRefs,
      nodeCount: file.nodes.length, bindings: file.nodes.filter(node => JSON.stringify(node).includes('"assetRef":')),
    }),
    note: 'All saved UI/Scene files and registered resources checked; detailsFor changes presentation only. Missing inputs are unverified. Actions/state bindings are source operands only: runtime wiring, design coverage and quality remain unverified. No files changed.' }
}

export type VerificationReadBinding = { capabilityFile: string; sessionId: string }
export async function readVerificationResults(workspace: string, input: unknown, binding?: VerificationReadBinding) {
  const { measurementId, previewReceipt, details = false } = verificationReadSchema.parse(input)
  if (!binding) throw Error('Current BGS turn result access is unavailable; no verification was started')
  const root = realpathSync(workspace)
  let capability: { version: number; workspace: string; sessionId: string; executionId: string; apiUrl: string }
  try { capability = JSON.parse(readFileSync(binding.capabilityFile, 'utf8')) }
  catch { throw Error('Current BGS turn result access has expired; no verification was started') }
  if (capability.version !== 1 || capability.workspace !== root || capability.sessionId !== binding.sessionId || !capability.executionId)
    throw Error('Current BGS turn result access does not match this project/session')
  const api = new URL(capability.apiUrl)
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.username || api.password || api.search || api.hash)
    throw Error('Invalid host result-read endpoint')
  // Never forward model input to this endpoint: its generic fallback starts a measurement.
  const body = previewReceipt ? { executionInputs: true } : measurementId
    ? { inspectRequestKey: measurementId, details } : { handoffPaths: [], details }
  let response: Response
  try { response = await fetch(api, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
  catch { throw Error('Current BGS result-read connection is unavailable; no retry or verification was started') }
  const result = await response.json()
  if (!response.ok) throw Error(String(result.error ?? 'Result read rejected').replace(/https?:\/\/\S+/g, '[host endpoint]'))
  if (previewReceipt) {
    // Keep the supplied Node helpers as modules: bundling them would make their
    // CLI import.meta.url guard mistake this MCP executable for their main file.
    const inspectorUrl = new URL('./preview-test-command.mjs', import.meta.url).href
    const { inspectPreviewTest } = await import(inspectorUrl)
    return inspectPreviewTest(previewReceipt, { workspace: root, capabilityFile: binding.capabilityFile })
  }
  if (measurementId) {
    if (result.id !== measurementId) throw Error('No saved measurement with this exact ID; select an ID from retained results')
    return result
  }
  // Keep host freshness/failed/unfinished status; never search backward for a PASS.
  return { scope: result.scope, designFileChanges: result.designFileChanges, measurement: result.measurement, checkScope: result.checkScope,
    acceptance: result.acceptance, quality: 'unverified', note: result.note,
    ...(details ? { measurements: result.measurements } : {}) }
}
