import { createHash } from 'node:crypto'
import { designDocumentSections, renderDesignHeading } from './design-document-sections'
import { checkCalculationResult } from './balance-calculation.mjs'
import { readCalculationInputs } from './balance-calculation'
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { collectContentSourceFiles } from './content-source-files'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { array, enum as enumeration, literal, object, string, unknown } from 'zod'
import type { z } from 'zod'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
import { parseBeeGameContentDocument, parseBeeGameContentIndex, sceneDesignSource, BEEGAME_UI_ASSET_BACKED_ROLES, uiDesignData } from './game-content-schema'
export { designReviewResultSchema, type DesignReviewStep, type DesignReviewResult, type DesignFinding } from '@bee-game-studio/agent-workflow/design-review-result'

export type DesignDocument = typeof PROJECT_DOCUMENTS[number]
export const DESIGN_ACCEPTANCE_PATH = '.beegame/delivery/acceptance.json'
const text = string().trim().min(1)
const handoffSchema = object({
  version: literal(2).default(2),
  documentVersion: text.optional(),
  outputs: array(object({ id: text, section: text,
    acceptance: object({ section: text, method: enumeration(['test', 'target-runtime', 'inspection']) }).strict().optional() }).strict()),
  implementationItems: array(object({ id: text, section: text,
    dependsOn: array(text).optional(),
    requirementRefs: array(object({ document: enumeration(PROJECT_DOCUMENTS), id: text }).strict()).min(1) }).strict()).optional(),
  evidence: array(object({ id: text, kind: enumeration(['contract', 'documentation', 'capability']),
    path: text, sha256: string().regex(/^[a-f0-9]{64}$/).optional(), source: text, section: text.optional(),
    pointer: string().optional(), expected: unknown().optional() }).strict()).default([]),
}).strict()
export type DesignHandoff = z.infer<typeof handoffSchema>

/** Owned outcome/pointer/evidence feedback, without host versions or semantic
 * certification. Catch malformed indexes in the author's short
 * history instead of deferring basic field errors to a full joint Revision. */
export function checkDesignHandoffDraft(workspace: string, name: string, options: { includeRequirements?: boolean } = {}) {
  const issues: string[] = []
  const availableRequirements: Array<{ document: DesignDocument; id: string; section: string }> = []
  try {
    // This public command takes either the logical name or its exact workspace
    // docs path. Do not use basename(), which would accept arbitrary/traversing paths.
    const documentName = name.startsWith('docs/') ? name.slice(5) : name
    if (!PROJECT_DOCUMENTS.some(document => document === documentName))
      throw new Error('Invalid design document argument ' + JSON.stringify(name) +
        '. Expected NAME.md or docs/NAME.md; supported names: ' + PROJECT_DOCUMENTS.join(', '))
    name = documentName
    const document = name as DesignDocument
    const { headings, headingNames, blocks } = documentStructure(readRetained(workspace, `docs/${name}`).toString('utf8'))
    if (blocks.length) throw new Error('Move inline bgs-handoff to ' + designHandoffPath(name))
    const sidecar = optionalDesignFile(workspace, designHandoffPath(name))
    const handoff = canonicalHeadingPointers(sidecar ? diagnosticHandoff(document,
      JSON.parse(sidecar.toString('utf8')), issues) : { outputs: [], evidence: [] }, headingNames)
    issues.push(...outputIssues(document, handoff.outputs ?? [], headings))
    const indexes: Partial<Record<DesignDocument, IndexedDesign>> = { [document]: { handoff, headings } }
    issues.push(...implementationIssues(indexes))
    const ids = new Set<string>()
    for (const evidence of handoff.evidence ?? []) {
      if (ids.has(evidence.id)) issues.push(`duplicate evidence ID ${evidence.id}`)
      ids.add(evidence.id)
      if (evidence.section && !headings.has(evidence.section))
        issues.push(`evidence ${evidence.id} references an absent section`)
      try { evidenceDigest(workspace, evidence) }
      catch (error) { issues.push(`evidence ${evidence.id} (${evidence.path}): ${error instanceof Error ? error.message : String(error)}`) }
    }
  } catch (error) { issues.push(error instanceof Error ? error.message : String(error)) }
  // Planning inputs are the current GDD's independently addressable outputs,
  // not a readiness gate or a technical closeout.
  if (name === 'GDD.md' && options.includeRequirements) {
    const sources = checkDesignHandoff(workspace, PROJECT_DOCUMENTS, { includeRequirements: true })
    availableRequirements.push(...(sources.availableRequirements ?? []).map(({ document, id, outputSection }) =>
      ({ document, id, section: outputSection })))
  }
  return { valid: !issues.length, issues: issues.map(issue => issue.startsWith(name + ':') ? issue : `${name}: ${issue}`),
    ...(availableRequirements.length ? { availableRequirements } : {}) }
}

function hash(body: string | Buffer) { return createHash('sha256').update(body).digest('hex') }
function readRetained(workspace: string, path: string) {
  if (isAbsolute(path) || path.replaceAll('\\', '/').split('/').includes('..')) throw new Error('Expected a workspace-relative evidence path without traversal')
  const root = realpathSync(workspace), file = realpathSync(resolve(root, path)), part = relative(root, file)
  if (part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part) ||
      part === '.beegame/tmp' || part.startsWith(`.beegame/tmp${sep}`)) throw new Error('Evidence must be retained inside the workspace')
  if (!statSync(file).isFile()) throw new Error('Evidence is not a file')
  const bytes = readFileSync(file)
  if (!bytes.length) throw new Error('Evidence is empty')
  return bytes
}
function documentStructure(body: string) {
  const tree = fromMarkdown(body), blocks: string[] = []
  // Match the source reader: headings inside quotes/lists are nested content,
  // not separately addressable document sections.
  const headingNames = designDocumentSections(body).map(section => section.heading)
  const headings = new Set(headingNames)
  function walk(node: any) {
    if (node.type === 'code' && node.lang === 'bgs-handoff') blocks.push(node.value)
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return { blocks, headings, headingNames }
}

/** Markdown formatting and numbering are presentation, not a decision.
 * Resolve only an identical title
 * with one real source location; never choose between same-title sections or
 * fuzzy-match words. Read checks normalize parsed copies; only authorized
 * finalization persists the exact source heading in an index. */
function canonicalHeadingPointers<T extends Partial<DesignHandoff>>(handoff: T, headings: readonly string[], diagnostic = false): T {
  const title = (heading: string) => heading.replace(/^(?:\d+(?:\.\d+)+[.)]?|\d+[.)])\s+/, '')
  const canonical = (section: string) => {
    // Prefer literal titles so meaningful Markdown characters are not reinterpreted.
    let matches = headings.filter(heading => heading === section)
    if (!matches.length) {
      const rendered = renderDesignHeading(section)
      matches = headings.filter(heading => heading === rendered)
      if (!matches.length) matches = headings.filter(heading => title(heading) === title(rendered))
    }
    if (matches.length > 1) {
      // Diagnostic readers keep the unresolved pointer so other valid sources
      // remain readable. Validation/finalization still reject ambiguity.
      if (diagnostic) return section
      throw Error('Ambiguous design section ' + JSON.stringify(section))
    }
    return matches[0] ?? section
  }
  for (const output of handoff.outputs ?? []) {
    output.section = canonical(output.section)
    if (output.acceptance) output.acceptance.section = canonical(output.acceptance.section)
  }
  for (const item of handoff.implementationItems ?? []) item.section = canonical(item.section)
  for (const evidence of handoff.evidence ?? []) if (evidence.section) evidence.section = canonical(evidence.section)
  return handoff
}
export const DESIGN_HANDOFF_DIRECTORY = '.beegame/design-handoffs'
export function designHandoffPath(name: string) {
  if (!PROJECT_DOCUMENTS.some(document => document === name)) throw new Error('Unknown design document')
  return `${DESIGN_HANDOFF_DIRECTORY}/${name.slice(0, -3)}.json`
}

/** Reserved planning records. Native file tools author these before handoff;
 * Shell never needs to mutate them or bypass the host's baseline authority. */
export const PROJECT_DESIGN_PATHS = PROJECT_DOCUMENTS.flatMap(name => [`docs/${name}`, designHandoffPath(name)])
export function designDocumentVersion(body: string): string {
  const versions = [...body.matchAll(/^\s*-\s*(?:Version|版本)\s*[:：]\s*v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?)\s*$/gim)]
  if (versions.length !== 1) throw new Error('Missing or malformed host version metadata. Refresh the document and its existing source/version metadata through the owning file operation.')
  const version = versions[0]![1]!
  if (version.split('.').some(n => !Number.isSafeInteger(Number(n)))) throw new Error('Invalid document version')
  return version
}
/** Exact owned calculation/layout outputs for scoped writes and versioning.
 * Reference pictures are read through the native Read tool, like documents;
 * they are not classified, authenticated or made into a delivery gate here. */
export function designSupportingFiles(workspace: string, documents: readonly string[]) {
  const root = realpathSync(workspace), files = new Set<string>()
  for (const name of documents) {
    if (!PROJECT_DOCUMENTS.some(document => document === name)) throw new Error('Unknown design document')
    const tree = fromMarkdown(readRetained(workspace, `docs/${name}`).toString('utf8')), definitions = new Map<string, string>()
    const walk = (node: any, visit: (node: any) => void) => {
      visit(node)
      for (const child of node.children ?? []) walk(child, visit)
    }
    walk(tree, node => { if (node.type === 'definition') definitions.set(node.identifier, node.url) })
    walk(tree, node => {
      const url = ['link', 'image'].includes(node.type) ? node.url
        : ['linkReference', 'imageReference'].includes(node.type) ? definitions.get(node.identifier) : undefined
      if (typeof url !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(url)) return
      let path: string
      try { path = decodeURIComponent(url.split(/[?#]/)[0]!) } catch { return }
      const target = resolve(root, 'docs', path), part = relative(root, target).split(sep).join('/')
      const calculation = /^docs\/calc\/[A-Za-z0-9_./-]+\.(?:mjs|js|json|md)$/.test(part)
      const ownLayout = name === 'GDD.md' && (isDesignUiFile(part) || isDesignSceneFile(part))
      if (!calculation && !ownLayout) return
      let actual: string
      try { actual = realpathSync(target) } catch (error) {
        // Only explicitly linked owned layouts can authorize a missing output.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          if (ownLayout) files.add(part)
          return
        }
        throw error
      }
      if (actual !== target) throw new Error('Supporting file target must not be a symlink: ' + part)
      readRetained(workspace, part)
      files.add(part)
    })
  }

  // An appendix already records its model/imported calculation code. It
  // need not also be duplicated as Markdown links to permit a retained rerun.
  for (const file of [...files]) {
    if (!file.startsWith('docs/calc/') || !file.endsWith('.md')) continue
    try {
      for (const input of readCalculationInputs(workspace, file)) {
        // Consumed data/other owners' appendices stay read-only unless their
        // owner joins the correction scope; code is needed for the retained rerun.
        if (!/^docs\/calc\/[A-Za-z0-9_./-]+\.(?:mjs|js)$/.test(input)) continue
        if (realpathSync(resolve(root, input)) !== resolve(root, input)) continue
        readRetained(workspace, input)
        files.add(input)
      }
    } catch { /* Invalid evidence retains its existing handoff diagnostic; no extra grant. */ }
  }
  return [...files].sort()
}
export function isDesignUiFile(path: string) {
  return /^content\/ui\/[A-Za-z0-9_./-]+\.json$/.test(path)
}
export function isDesignSceneFile(path: string) {
  return /^content\/scenes\/[A-Za-z0-9_./-]+\.json$/.test(path)
}

function layoutTypography(style: Record<string, unknown> = {}) {
  const fields = Object.fromEntries(Object.entries(style).filter(([key]) =>
    ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'align', 'textAlign', 'verticalAlign'].includes(key)))
  return Object.keys(fields).length ? fields : undefined
}

/** Freeze layout decisions, not known later resource bindings in the same file.
 * This is only a digest in the existing baseline, never a second layout copy.
 * Immutable factual evidence (not live UI sources) still binds whole bytes. */
export const DESIGN_DIGEST_VERSION = 2 as const
export function designSupportingFileDigest(workspace: string, path: string, digestVersion: 1 | 2 = DESIGN_DIGEST_VERSION) {
  const bytes = readRetained(workspace, path)
  return designSupportingBytesDigest(path, bytes, digestVersion)
}
export function designSupportingBytesDigest(path: string, bytes: Buffer, digestVersion: 1 | 2 = DESIGN_DIGEST_VERSION) {
  if (!isDesignUiFile(path) && !isDesignSceneFile(path)) return hash(bytes)
  try {
    const doc = parseBeeGameContentDocument(JSON.parse(bytes.toString('utf8')))
    if (isDesignSceneFile(path) && (doc.kind === 'scene-2d' || doc.kind === 'scene-3d')) {
      // Only known resource selections are excluded. Camera, collider, grid,
      // placement, behavior and unknown fields remain design decisions.
      return hash(JSON.stringify(stable(sceneDesignSource(doc))))
    }
    if (doc.kind !== 'ui-screen' && doc.kind !== 'ui-hud' && doc.kind !== 'ui-flow') return hash(bytes)
    if (digestVersion === 2) return hash(JSON.stringify(stable({ schema: doc.schema, id: doc.id, kind: doc.kind,
      data: { ...doc.data, nodes: doc.data.nodes.map(node => {
        const { assetRef: _assetRef, actions: _actions, bindings: _bindings, ...decision } = node
        // assetRef is always a locator slot. Illegal use on a non-asset role
        // is a Content validation error, not authority to redesign that role.
        return { ...decision,
          enabled: node.enabled ?? true, data: uiDesignData(node.data, 'data', BEEGAME_UI_ASSET_BACKED_ROLES.some(role => role === node.role)), style: uiDesignData(node.style, 'style'),
          responsive: Object.fromEntries(Object.entries(node.responsive ?? {}).map(([name, variant]) => [name,
            { ...variant, style: uiDesignData(variant.style, 'style') }] as const).filter(([, variant]) => Object.values(variant).some(value => value !== undefined))) }
      }) } })))
    return hash(JSON.stringify(stable({ schema: doc.schema, id: doc.id, kind: doc.kind, rootId: doc.data.rootId,
      nodes: doc.data.nodes.map(node => ({ id: node.id, parentId: node.parentId, role: node.role, text: node.text,
        enabled: node.enabled ?? true, layout: node.layout,
        responsive: Object.fromEntries(Object.entries(node.responsive ?? {})
          .filter(([, variant]) => variant.enabled !== undefined || variant.layout !== undefined || layoutTypography(variant.style) !== undefined)
          .map(([name, variant]) => [name, { enabled: variant.enabled, layout: variant.layout, typography: layoutTypography(variant.style) }])),
        typography: layoutTypography(node.style),
        anchor: node.data?.anchor, space: node.data?.space, layoutCamera: node.data?.layoutCamera, layoutOcclusion: node.data?.layoutOcclusion,
        layoutUnderlay: node.data?.layoutUnderlay,
        orientation: node.data?.orientation, referenceResolution: node.data?.referenceResolution,
        targetViewports: node.data?.targetViewports, minimumControlSize: node.data?.minimumControlSize,
        compactMaxWidth: node.data?.compactMaxWidth })),
    })))
  } catch {
    // Preserve an invalid draft's identity for authorized repair/versioning.
    // The separate schema/geometry check blocks its release.
    return hash(bytes)
  }
}
function documentHandoff(workspace: string, name: DesignDocument, body: string, diagnostic = false) {
  const { blocks, headings, headingNames } = documentStructure(body)
  if (blocks.length) throw new Error('Move inline bgs-handoff to ' + designHandoffPath(name) + '; preserve prose decisions')
  const sidecar = optionalDesignFile(workspace, designHandoffPath(name))
  if (!sidecar) return { handoff: { version: 2, outputs: [], evidence: [] } as DesignHandoff, headings, sidecar: Buffer.alloc(0), issues: [] as string[] }
  const raw = JSON.parse(sidecar.toString('utf8'))
  const documentVersion = raw?.documentVersion !== undefined || [...body.matchAll(versionLine)].length
    ? designDocumentVersion(body) : undefined
  if (raw?.documentVersion !== undefined && raw.documentVersion !== documentVersion)
    throw new Error(`Handoff documentVersion must match document header ${documentVersion}. Refresh the existing source/version metadata for ${name}.`)
  const issues: string[] = []
  if (diagnostic) {
    // Reuse draft parsing to retain valid tasks when another handoff field is malformed.
    // Other malformed fields still fail strict parsing; no release check is relaxed.
    const fields = diagnosticHandoff(name, raw, issues)
    if (issues.length && fields.implementationItems) raw.implementationItems = fields.implementationItems
  }
  return { handoff: canonicalHeadingPointers(parseHandoff(name, raw), headingNames, diagnostic), headings, sidecar, issues }
}

// A malformed evidence record must not hide an independently invalid output pointer.
function diagnosticHandoff(name: DesignDocument, raw: unknown, issues: string[]): Partial<DesignHandoff> {
  const current = raw, parsed = handoffSchema.safeParse(current)
  if (parsed.success) return parsed.data
  issues.push(...handoffShapeIssues(name, current, parsed.error))
  if (!current || typeof current !== 'object' || Array.isArray(current)) return {}
  const fields: Partial<DesignHandoff> = {}
  for (const [key, schema] of Object.entries(handoffSchema.shape)) {
    const field = schema.safeParse((current as Record<string, unknown>)[key])
    if (field.success) Object.assign(fields, { [key]: field.data })
    else {
      // One malformed task must not hide valid task/source mappings and cause
      // a spurious request to rebuild the entire implementation index.
      const value = (current as Record<string, unknown>)[key]
      if (key === 'implementationItems' && Array.isArray(value)) {
        fields.implementationItems = value.flatMap(item => {
          const parsedItem = handoffSchema.shape.implementationItems.unwrap().element.safeParse(item)
          return parsedItem.success ? [parsedItem.data] : []
        })
        issues.push(`${name}: checks for invalid handoff.implementationItems entries were not run; valid entries remain checked`)
      } else issues.push(`${name}: checks requiring handoff.${key} were not run because the field is invalid`)
    }
  }
  return fields
}

/** Compact source-addressed errors, not a serialized validator stack. */
function handoffShapeIssues(name: DesignDocument, raw: unknown, error: z.ZodError) {
  return error.issues.map(issue => {
    const [field, index] = issue.path
    const item = typeof index === 'number' && raw && typeof raw === 'object'
      ? (raw as Record<string, any>)[String(field)]?.[index] : undefined
    const target = `${designHandoffPath(name)} / ${issue.path.join('.') || 'root'}` +
      (typeof item?.id === 'string' ? ` (id: ${JSON.stringify(item.id)})` : '')
    const hint = field === 'implementationItems' && issue.path[2] === 'requirementRefs'
      ? ' Each task needs at least one real owned-output reference {document,id}. Read existing GDD requirement definitions; do not invent IDs.' : ''
    return `${name}: ${target}: ${issue.message}${hint}`
  })
}
function parseHandoff(name: DesignDocument, raw: unknown): DesignHandoff {
  const current = raw, parsed = handoffSchema.safeParse(current)
  if (!parsed.success) throw Error(handoffShapeIssues(name, current, parsed.error).join('; '))
  return parsed.data
}
function outputIssues(name: DesignDocument, outputs: DesignHandoff['outputs'], headings: Set<string>) {
  const issues: string[] = [], ids = new Set<string>()
  for (const output of outputs) {
    if (ids.has(output.id)) issues.push(`${name}: duplicate output ID ${output.id}`)
    ids.add(output.id)
    if (!headings.has(output.section)) issues.push(`${name}: output ${output.id} references an absent section ${JSON.stringify(output.section)}`)
    if (output.acceptance && !headings.has(output.acceptance.section))
      issues.push(`${name}: acceptance ${output.id} references an absent section ${JSON.stringify(output.acceptance.section)}`)
  }
  return issues
}
type IndexedDesign = { handoff: Partial<DesignHandoff>; headings: Set<string> }
/** Structural task/source relationships, never semantic grouping or task completion. */
function implementationIssues(indexes: Partial<Record<DesignDocument, IndexedDesign>>) {
  const issues: string[] = []
  const gdd = indexes['GDD.md'], items = gdd?.handoff.implementationItems
  const ids = new Set<string>()
  const byId = new Map((items ?? []).map(item => [item.id, item]))
  for (const item of items ?? []) {
    if (ids.has(item.id)) issues.push(`GDD.md: duplicate implementation item ID ${item.id}`)
    ids.add(item.id)
    const dependencies = new Set<string>()
    for (const dependency of item.dependsOn ?? []) {
      if (dependencies.has(dependency)) issues.push(`GDD.md: implementation item ${item.id} has duplicate dependency ${dependency}`)
      dependencies.add(dependency)
      if (dependency === item.id) issues.push(`GDD.md: implementation item ${item.id} depends on itself`)
      else if (!byId.has(dependency)) issues.push(`GDD.md: implementation item ${item.id} references missing dependency ${dependency}`)
    }
    if (!gdd!.headings.has(item.section)) issues.push(`GDD.md: implementation item ${item.id} references an absent section`)
    const refs = new Set<string>()
    for (const ref of item.requirementRefs) {
      const key = `${ref.document}#${ref.id}`
      if (refs.has(key)) issues.push(`GDD.md: implementation item ${item.id} has duplicate requirement ${key}`)
      refs.add(key)
      const source = indexes[ref.document]
      const output = source?.handoff.outputs?.find(output => output.id === ref.id)
      if (!output) issues.push(`GDD.md: implementation item ${item.id} references missing requirement ${key}`)
      else if (!output.acceptance) issues.push(`GDD.md: implementation item ${item.id} requirement ${key} has no acceptance section`)
    }
  }
  const visited = new Set<string>(), active = new Set<string>()
  const visit = (id: string): void => {
    if (active.has(id)) { issues.push(`GDD.md: implementation dependency cycle at ${id}`); return }
    if (visited.has(id)) return
    visited.add(id); active.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) if (byId.has(dependency)) visit(dependency)
    active.delete(id)
  }
  for (const id of byId.keys()) visit(id)
  return issues
}
function readImmutableEvidence(workspace: string, path: string) {
  const bytes = readRetained(workspace, path)
  // Check the resolved file too: an alias must not freeze a live source or
  // overwrite its decision digest in the released baseline.
  const part = relative(realpathSync(workspace), realpathSync(resolve(workspace, path))).split(sep).join('/')
  if (part.startsWith('content/ui/') && part.endsWith('.json'))
    throw new Error('Live UI source ' + path + ' cannot be immutable evidence; remove this evidence entry and link the source from GDD.md. Content completes bindings in place.')
  if (isDesignSceneFile(part))
    throw new Error('Live Scene source ' + path + ' cannot be immutable evidence; link the source from GDD.md. Content completes bindings in place.')
  return bytes
}
function evidenceDigest(workspace: string, evidence: DesignHandoff['evidence'][number], bytes = readImmutableEvidence(workspace, evidence.path)) {
  if (evidence.kind === 'documentation' && new URL(evidence.source).protocol !== 'https:')
    throw new Error('Documentation needs an HTTPS source')
  if (evidence.kind === 'contract') {
    if (evidence.pointer === undefined || !Object.hasOwn(evidence, 'expected')) throw new Error('Contract evidence needs pointer and expected value')
    if (evidence.pointer && !evidence.pointer.startsWith('/')) throw new Error('Invalid JSON pointer')
    let value: any = JSON.parse(bytes.toString('utf8'))
    for (const key of evidence.pointer ? evidence.pointer.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~')) : [])
      value = value != null && Object.hasOwn(value, key) ? value[key] : undefined
    if (JSON.stringify(value) !== JSON.stringify(evidence.expected)) throw new Error('Contract value does not match the claim')
  }
  if (evidence.kind === 'capability') {
    const observation = JSON.parse(bytes.toString('utf8'))
    if (observation.observation !== 'target-runtime' || observation.passed !== true ||
        !observation.check || !Object.hasOwn(observation, 'expected') || !Object.hasOwn(observation, 'observed') ||
        JSON.stringify(observation.expected) !== JSON.stringify(observation.observed))
      throw new Error('Capability needs a passing actual observation, not a model assertion')
  }
  return hash(bytes)
}

/** Index/evidence integrity only. Prose decisions and dependencies need semantic review. */
export function checkDesignHandoff(workspace: string, documents: readonly DesignDocument[], _options: {
  digestVersion?: 1 | 2; includeRequirements?: boolean
} = {}) {
  const issues: string[] = [], snapshots: Record<string, string> = {}, evidenceHashes: Record<string, string> = {}, documentVersions: Record<string, string> = {}
  const indexes: Partial<Record<DesignDocument, IndexedDesign>> = {}
  const availableRequirements: ReturnType<typeof readDesignAcceptanceRequirements> = []
  for (const name of documents) {
    try {
      const root = realpathSync(workspace)
      const bytes = readFileSync(designFilePath(root, `docs/${name}`))
      if (!bytes.toString('utf8').trim()) throw Error('Design document is empty')
      snapshots[name] = hash(bytes)
      const path = designHandoffPath(name)
      const sidecar = optionalDesignFile(root, path)
      const hasDeclaredVersion = [...bytes.toString('utf8').matchAll(versionLine)].length > 0
      if (sidecar) {
        if (hasDeclaredVersion) {
          try { documentVersions[name] = designDocumentVersion(bytes.toString('utf8')) }
          catch (error) { issues.push(`${name}: ${error instanceof Error ? error.message.replace('DOCUMENT.md', name) : String(error)}`) }
        }
        snapshots[name] = hash(JSON.stringify([hash(bytes), hash(sidecar)]))
      }
      const { blocks, headings, headingNames } = documentStructure(bytes.toString('utf8'))
      if (blocks.length) issues.push(`${name}: Move inline bgs-handoff to ${path}; preserve prose decisions`)
      try {
        const supporting = designSupportingFiles(workspace, [name]).map(file => {
          const digest = designSupportingFileDigest(workspace, file, _options.digestVersion)
          evidenceHashes[file] = digest
          // Only retained helper results carry a machine-checkable input record.
          // This never executes the model or certifies its rules; ordinary notes
          // and legacy appendices still require evidence review, not a new format gate.
          if (file.startsWith('docs/calc/') && file.endsWith('.md') &&
              readRetained(workspace, file).includes('<!-- bgs-calculation-v1:')) {
            const freshness = checkCalculationResult(workspace, file, resolve(root, '.beegame/delivery/calculate-balance.mjs'))
            issues.push(...freshness.issues.map(issue => `${name}: ${file}: ${issue}`))
          }
          return [file, digest]
        })
        if (supporting.length) snapshots[name] = hash(JSON.stringify([snapshots[name], supporting]))
      } catch (error) { issues.push(`${name}: ${error instanceof Error ? error.message : String(error)}`) }
      if (!sidecar) continue
      const raw = JSON.parse(sidecar.toString('utf8'))
      if (!hasDeclaredVersion && raw?.documentVersion !== undefined)
        issues.push(`${name}: Declared handoff documentVersion requires a matching document header.`)
      if (documentVersions[name] && raw?.documentVersion !== undefined && raw.documentVersion !== documentVersions[name])
        issues.push(`${name}: Handoff documentVersion must match document header ${documentVersions[name]}. Refresh the existing source/version metadata for ${name}.`)
      const h = canonicalHeadingPointers(diagnosticHandoff(name, raw, issues), headingNames)
      indexes[name] = { handoff: h, headings }
      if (h.outputs) issues.push(...outputIssues(name, h.outputs, headings))
      // Keep independently addressable inputs even when host metadata is incomplete.
      // Duplicate IDs and broken pointers are excluded.
      for (const output of _options.includeRequirements ? h.outputs ?? [] : []) if (output.acceptance && headings.has(output.section) &&
          headings.has(output.acceptance.section) && h.outputs!.filter(item => item.id === output.id).length === 1)
        availableRequirements.push({ document: name, id: output.id, outputSection: output.section,
          ...output.acceptance, documentSha256: hash(bytes), handoffSha256: hash(readRetained(workspace, path)) })
      const evidenceIds = new Set<string>()
      for (const evidence of h.evidence ?? []) {
        if (evidenceIds.has(evidence.id)) issues.push(`${name}: duplicate evidence ID ${evidence.id}`)
        evidenceIds.add(evidence.id)
        if (evidence.section && !headings.has(evidence.section)) issues.push(`${name}: evidence ${evidence.id} references an absent section`)
        try {
          // Record actual bytes even when the declared claim is false, so edits
          // still invalidate a previously released baseline.
          const bytes = readImmutableEvidence(workspace, evidence.path), digest = hash(bytes)
          evidenceHashes[evidence.path] = digest
          if (evidence.sha256 !== undefined && digest !== evidence.sha256) throw new Error('Evidence bytes changed')
          evidenceDigest(workspace, evidence, bytes)
        } catch (error) { issues.push(`${name}: evidence ${evidence.id}: ${error instanceof Error ? error.message : String(error)}`) }
      }
    } catch (error) {
      issues.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      issues.push(`${name}: remaining handoff checks were not run because the document or index could not be read/parsed`)
    }
  }
  issues.push(...implementationIssues(indexes))
  return { valid: !issues.length, issues, ...(_options.includeRequirements ? { availableRequirements, indexedDocuments: Object.keys(indexes) } : {}), snapshots, evidenceHashes, documentVersions, digestVersion: _options.digestVersion ?? DESIGN_DIGEST_VERSION,
    revision: hash(JSON.stringify([snapshots, evidenceHashes])),
    note: 'Checks saved documents, supporting files and any existing index integrity. Indexes and task coverage are not required. File presence and structural validity do not establish design completeness, semantic quality or acceptance.' }
}

// Version lines are host metadata, excluded only from material-change detection.
const versionLine = /^[ \t]*-[ \t]*(?:Version|版本)[ \t]*[:：][^\r\n]*(?:\r?\n|$)/gim
function withoutVersion(body: string) {
  const valid = /^[ \t]*-[ \t]*(?:Version|版本)[ \t]*[:：][ \t]*v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?)[ \t]*(?:\r?\n|$)/gim
  return [...body.matchAll(valid)].length === 1 ? body.replace(valid, '') : body
}
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
}
function designFilePath(root: string, path: string) {
  const target = resolve(root, path)
  // Exact resolution also rejects links to a different in-workspace document.
  if (realpathSync(target) !== target) throw new Error('Design source must not be a symlink: ' + path)
  if (!statSync(target).isFile()) throw new Error('Design target must be a regular file: ' + path)
  return target
}
function optionalDesignFile(workspace: string, path: string) {
  // Snapshots must preserve malformed/empty drafts for an authorized repair;
  // they are not evidence validation or a release verdict.
  try {
    if (lstatSync(resolve(workspace, path)).isSymbolicLink()) throw Error('Design input must not be a symlink: ' + path)
    return readFileSync(designFilePath(realpathSync(workspace), path))
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
/** Raw bytes for interrupted-write attribution, not normalized design semantics. */
export function designRevisionFileDigest(workspace: string, path: string): string | null {
  const part = relative(resolve(workspace), resolve(workspace, path))
  if (!part || isAbsolute(path) || part === '..' || part.startsWith('..' + sep))
    throw new Error('Design revision file must remain inside the workspace: ' + path)
  const bytes = optionalDesignFile(workspace, path)
  return bytes === undefined ? null : hash(bytes)
}
export function snapshotDesignRevisionFiles(workspace: string): Record<string, string | null> {
  const paths = new Set<string>()
  // Observe saved drafts independently of document links or content registration.
  // Missing directories are normal before authoring; unsafe/unreadable inputs
  // must invalidate the snapshot rather than produce a partial successful diff.
  try {
    if (lstatSync(resolve(workspace, 'content')).isSymbolicLink())
      throw new Error('Design revision snapshot incomplete: content must not be a symlink')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const directories = (['content/ui', 'content/scenes'] as const).filter(directory => {
    try { lstatSync(resolve(workspace, directory)); return true }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  })
  const issues: string[] = []
  for (const path of collectContentSourceFiles(workspace, directories, issues)) paths.add(path)
  if (issues.length) throw new Error('Design revision snapshot incomplete: ' + issues.join('; '))
  const evidenceFiles: Record<string, string | null> = {}
  for (const name of PROJECT_DOCUMENTS) {
    paths.add(`docs/${name}`)
    const indexPath = designHandoffPath(name)
    paths.add(indexPath)
    if (optionalDesignFile(workspace, `docs/${name}`) !== undefined)
      for (const path of designSupportingFiles(workspace, [name])) paths.add(path)
    const bytes = optionalDesignFile(workspace, indexPath)
    let index: { evidence?: Array<{ path?: unknown }> } | undefined
    try { index = bytes ? JSON.parse(bytes.toString('utf8')) : undefined } catch { /* A malformed index can be repaired. */ }
    if (Array.isArray(index?.evidence))
      for (const evidence of index.evidence) if (typeof evidence?.path === 'string') {
        // A bad reference must remain repairable through its index. It is not
        // readable evidence and cannot authorize a write outside the scope.
        try { evidenceFiles[evidence.path] = designRevisionFileDigest(workspace, evidence.path) }
        catch { /* Handoff validation reports the invalid reference. */ }
      }
  }
  const files = { ...evidenceFiles, ...Object.fromEntries([...paths].map(path => [path, designRevisionFileDigest(workspace, path)])) }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
}
/** Bind a measurement to the design bytes it observed, without locking them. */
export function designInputRevision(workspace: string): string {
  return hash(JSON.stringify(snapshotDesignRevisionFiles(workspace)))
}

/** Reuse the only output index actually consumed by runtime acceptance. */
export function readDesignAcceptanceRequirements(workspace: string) {
  const requirements: Array<{ document: DesignDocument; id: string; section: string; outputSection: string;
    method: 'test' | 'target-runtime' | 'inspection'; documentSha256: string; handoffSha256: string }> = []
  const indexes: Partial<Record<DesignDocument, IndexedDesign>> = {}
  for (const document of PROJECT_DOCUMENTS) {
    const bytes = optionalDesignFile(workspace, `docs/${document}`)
    if (!bytes) continue
    const { handoff, headings, sidecar } = documentHandoff(workspace, document, bytes.toString('utf8'))
    indexes[document] = { handoff, headings }
    const issues = outputIssues(document, handoff.outputs, headings)
    if (issues.length) throw new Error(issues.join('; '))
    for (const evidence of handoff.evidence) {
      const digest = evidenceDigest(workspace, evidence)
      if (evidence.sha256 !== undefined && evidence.sha256 !== digest) throw new Error(`${document}: evidence ${evidence.id}: Evidence bytes changed`)
    }
    for (const output of handoff.outputs) if (output.acceptance)
      requirements.push({ document, id: output.id, outputSection: output.section, ...output.acceptance, documentSha256: hash(bytes), handoffSha256: hash(sidecar) })
  }
  const issues = implementationIssues(indexes)
  if (issues.length) throw new Error(issues.join('; '))
  return requirements
}
