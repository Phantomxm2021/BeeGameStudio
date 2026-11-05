import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod/v4'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
import { checkDesignHandoffDraft, designReviewIndexes, type DesignHandoff } from './design-handoff'
import { designSourceLocations, readDesignSections } from './design-source-reading'
import { findDesignSections } from './design-document-sections'
import { auditAssetContract } from './asset-contract-audit'
import { readBeeGameAssetManifestSync } from './asset-contracts'

export const designReadSchema = z.strictObject({ read: z.array(z.strictObject({
  document: z.enum(PROJECT_DOCUMENTS), sections: z.array(z.string().min(1)).min(1).optional(),
})).min(1).optional() })
export const implementationReadSchema = z.strictObject({ id: z.string().trim().min(1).optional() })
export const bindingsReadSchema = z.strictObject({})
const reason = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Current saved inputs, including independently readable drafts. Never finalize or lock. */
export function readDesignHandoff(workspace: string, input: unknown) {
  const { read = [] } = designReadSchema.parse(input)
  const issues: string[] = []
  const sources = read.flatMap(request => {
    if (!request.sections) return []
    try { return readDesignSections(workspace, [request]).sources }
    catch (error) { issues.push(request.document + ': ' + reason(error)); return [] }
  })
  const documents = designSourceLocations(workspace, read.length ? [...new Set(read.map(item => item.document))] : PROJECT_DOCUMENTS)
    .map(document => {
      if (read.length && document.unavailable) issues.push(document.document + ': ' + document.unavailable)
      const requests = read.filter(request => request.document === document.document)
      const selected = 'sections' in document ? requests.flatMap(request => request.sections
        ? request.sections.flatMap(heading => findDesignSections(document.sections, heading)) : document.sections) : []
      return { document: document.document, path: 'docs/' + document.document,
        available: !document.unavailable,
        ...(document.unavailable ? { unavailable: document.unavailable } : {}),
        ...(read.length && 'sections' in document ? { sections: requests.some(request => !request.sections)
          ? document.sections : document.sections.filter(section => selected.includes(section)) } : {}),
      }
    })
  return { valid: !issues.length, scope: 'saved-design-handoff', issues: [...new Set(issues)], documents, sources,
    note: 'Read availability only, not design completeness or approval. Unrequested missing documents do not fail a read. No index requirement counts, metadata changes or baseline lock. Use read:[{document:"GDD.md"}] for headings; sections:["Exact heading"] reads that heading and its descendants; the document title reads the full file.' }
}

/** The optional GDD index locates implementation prose; it is not a second task store. */
export function readImplementationTask(workspace: string, input: unknown) {
  const { id } = implementationReadSchema.parse(input)
  const indexes = designReviewIndexes(workspace, PROJECT_DOCUMENTS)
  const gdd = indexes.find(index => index.document === 'GDD.md')!
  const items: NonNullable<DesignHandoff['implementationItems']> = 'implementationItems' in gdd ? gdd.implementationItems ?? [] : []
  const issues = [...checkDesignHandoffDraft(workspace, 'GDD.md').issues]
  if ('unavailable' in gdd) issues.push(gdd.document + ': ' + gdd.unavailable)
  const directory = items.map(item => ({ id: item.id, dependsOn: item.dependsOn,
    dependencyStatus: item.dependsOn === undefined ? 'unspecified' : 'not-verified', section: item.section }))
  const result = { scope: 'saved-implementation-task', directory, issues,
    documents: designSourceLocations(workspace, ['GDD.md']),
    note: 'Read-only GDD source and optional existing task index. No index is required; an empty directory does not mean implementation is complete. Read the relevant GDD sections and choose the work organization. Reading does not lock or authorize implementation.' }
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
  const requests = new Map<string, Set<string>>([['GDD.md', new Set([task.section])]])
  for (const requirement of requirements) {
    if (!('section' in requirement)) continue
    const sections = requests.get(requirement.document) ?? new Set<string>()
    sections.add(requirement.section)
    if (requirement.acceptance) sections.add(requirement.acceptance.section)
    requests.set(requirement.document, sections)
  }
  const sources: ReturnType<typeof readDesignSections>['sources'] = []
  for (const [document, requested] of requests) {
    const location = designSourceLocations(workspace, [document])[0]!
    const available = 'sections' in location ? location.sections : undefined
    if (!available) { issues.push(document + ': ' + location.unavailable); continue }
    // A broken pointer must not hide another independently readable section.
    const sections = [...requested].filter(heading => {
      if (findDesignSections(available, heading).length === 1) return true
      issues.push(`${document}: missing/ambiguous heading ${JSON.stringify(heading)}`)
      return false
    })
    if (!sections.length) continue
    try { sources.push(...readDesignSections(workspace, [{ document, sections }]).sources) }
    catch (error) { issues.push(document + ': ' + reason(error)) }
  }
  // An ID-like table cell can be a shared interface or acceptance requirement.
  // Keep source sections intact; the selected task/requirements already identify
  // the requested work without silently rewriting authoritative prose.
  const siblings = items.filter(item => item.section === task.section)
  if (siblings.length > 1) for (const source of sources.filter(source => source.document === 'GDD.md')) for (const read of source.reads)
    Object.assign(read, { selection: 'shared-section', note: 'Multiple tasks share this section; original source text is retained.' })
  return { ...result, directory: directory.filter(item => item.id === id), valid: !issues.length, task, requirements, sources }
}

export async function checkResourcesAndBindings(workspace: string, input: unknown) {
  bindingsReadSchema.parse(input)
  const root = realpathSync(workspace), issues: string[] = []
  const audit = auditAssetContract(root)
  issues.push(...audit.issues)
  if (!audit.present) issues.push('assets/asset-manifest.json is missing')
  const manifest = (() => {
    try { return readBeeGameAssetManifestSync(root) }
    catch (error) { if (audit.present) issues.push(reason(error)); return undefined }
  })()
  return { valid: !issues.length, scope: 'registered-resources', issues: [...new Set(issues)],
    requirements: audit.requirements,
    resources: audit.resources.map(({ fileEvidence, ...resource }) => {
      const registered = manifest?.resources.find(item => item.id === resource.id)
      return { ...resource, assetKind: registered?.asset_kind, fulfills: registered?.fulfills,
        files: fileEvidence.map(({ path, sha256, facts }) => ({ path, sha256, facts })) }
    }),
    requirementBindings: audit.bindings,
    note: 'Checked Manifest requirements, registered files, hashes and supported structure. Structural unknowns identify facts not established by these file and declaration checks. No files changed.' }
}
