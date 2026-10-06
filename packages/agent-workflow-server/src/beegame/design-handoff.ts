import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { z } from 'zod'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
import { designFindingSourceIssues, type DesignFinding } from '@bee-game-studio/agent-workflow/design-review-result'
import { parseBeeGameContentDocument } from './game-content-schema'
export { designReviewResultSchema, type DesignReviewStep, type DesignReviewResult, type DesignFinding } from '@bee-game-studio/agent-workflow/design-review-result'

export type DesignDocument = typeof PROJECT_DOCUMENTS[number]
const text = z.string().trim().min(1)
const handoffSchema = z.object({
  version: z.literal(2).default(2),
  documentVersion: text.optional(),
  outputs: z.array(z.object({ id: text, section: text,
    acceptance: z.object({ section: text, method: z.enum(['test', 'target-runtime', 'inspection']) }).strict().optional() }).strict()),
  evidence: z.array(z.object({ id: text, kind: z.enum(['contract', 'documentation', 'capability']),
    path: text, sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), source: text, section: text.optional(),
    pointer: z.string().optional(), expected: z.unknown().optional() }).strict()).default([]),
}).strict()
export type DesignHandoff = z.infer<typeof handoffSchema>

export const DESIGN_HANDOFF_INSTRUCTION = `Keep decisions, dependencies, open questions, limits and human-readable tables in docs/<NAME>.md. Save only the downstream index at .beegame/design-handoffs/<NAME without .md>.json; do not embed bgs-handoff JSON in prose.
Write outputs:[{id,section,acceptance?:{section,method:"test"|"target-runtime"|"inspection"}}] and, where retained evidence is needed, evidence:[{id,kind:"contract"|"documentation"|"capability",path:workspace-relative retained file,source,section?:actual prose heading,pointer?:JSON pointer,expected?:value}]. IDs are local to their document. Headings point to the authoritative decisions and expectations; do not copy their rules into JSON. Do not mirror states, events, parameters, resources, inputs, consumes, pending, limits, platformFacts or readiness in the index. The host sets format version 2, document header/documentVersion and evidence sha256 after an authorized completed write. It advances versions on material changes to prose, the index or referenced retained evidence; unchanged documents keep their version. Authors do not calculate or synchronize versions/hashes.
For owned release-critical outputs, acceptance points to an actual prose heading explaining the relevant conditions/actions and observable expected result, including necessary boundaries or recovery. Reuse the decision's section where sufficient; do not create one check per sentence. GDD identifies core gameplay delivery expectations on at least one output; this minimum does not establish full coverage. Other owners index their necessary professional expectations when decided. Use test for deterministic rules/calculations, target-runtime for actual presentation/input/audio and end-to-end play, inspection for directly examinable resources or retained provenance. Prose review is not runtime evidence; no completed runtime check is required while authoring.
Contract evidence checks its JSON pointer against expected. Capability evidence retains an actual JSON observation {observation:"target-runtime",check,passed:true,expected,observed}; expected and observed must agree. Documentation retains source bytes with an HTTPS source URL and precise source location. Live content/ui JSON is a design source, not immutable evidence: link it from UI prose instead of indexing it in evidence, because Content completes bindings in the same file. Host-generated hashes bind bytes, not source authority, observation authenticity or semantic adequacy. Unsupported consequential assumptions, their owner, needed-by point and authorized fallback remain in prose for the joint review. User decisions must trace to actual user authorization. Legacy version 1 sidecars are read only for outputs and evidence; their retired business mirrors are not checked or treated as certified.`

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
  const tree = fromMarkdown(body), blocks: string[] = [], headings = new Set<string>()
  function words(node: any): string { return node.value ?? (node.children ?? []).map(words).join('') }
  function walk(node: any) {
    if (node.type === 'code' && node.lang === 'bgs-handoff') blocks.push(node.value)
    if (node.type === 'heading') headings.add(words(node))
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return { blocks, headings }
}
export const DESIGN_HANDOFF_DIRECTORY = '.beegame/design-handoffs'
export function designHandoffPath(name: string) {
  if (!PROJECT_DOCUMENTS.some(document => document === name)) throw new Error('Unknown design document')
  return `${DESIGN_HANDOFF_DIRECTORY}/${name.slice(0, -3)}.json`
}
export function designDocumentVersion(body: string): string {
  const versions = [...body.matchAll(/^\s*-\s*(?:Version|版本)\s*[:：]\s*v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?)\s*$/gim)]
  if (versions.length !== 1) throw new Error('Expected one document header version: - Version: v1.0 (or - 版本：v1.0)')
  const version = versions[0]![1]!
  if (version.split('.').some(n => !Number.isSafeInteger(Number(n)))) throw new Error('Invalid document version')
  return version
}
export function isHigherDocumentVersion(current: string, previous: string) {
  const a = current.split('.').map(Number), b = previous.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}
/** Exact supporting files cited by affected documents; a UI owner may also
 * create its explicitly linked missing UI output. No broad directory grant. */
export function designSupportingFiles(workspace: string, documents: readonly string[]) {
  const root = realpathSync(workspace), files = new Set<string>()
  for (const name of documents) {
    if (!PROJECT_DOCUMENTS.some(document => document === name)) throw new Error('Unknown design document')
    const body = readRetained(workspace, `docs/${name}`).toString('utf8')
    const tree = fromMarkdown(body), definitions = new Map<string, string>()
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
      const ownVisual = part.startsWith('docs/visual/' + name.slice(0, -3) + '/') &&
        /^docs\/visual\/[A-Za-z0-9_./-]+\.(?:html|svg|png|jpg|jpeg|webp)$/.test(part)
      const ownUi = name === 'UI_UX_SPEC.md' && isDesignUiFile(part)
      if (!calculation && !ownVisual && !ownUi) return
      // readRetained checks containment; reject even an in-workspace symlink.
      let actual: string
      try { actual = realpathSync(target) } catch (error) {
        // Missing factual evidence cannot be invented. A UI layout is an
        // owned output, however: its exact planned link can authorize repair.
        // Missing UI data still fails reference/geometry checks until saved.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          if (ownUi) files.add(part)
          return
        }
        throw error
      }
      if (actual !== target) throw new Error('Supporting file target must not be a symlink: ' + part)
      readRetained(workspace, part)
      files.add(part)
    })
  }
  return [...files].sort()
}
/** Kept for callers requesting calculations only, not visual source files. */
export function designCalculationFiles(workspace: string, documents: readonly string[]) {
  return designSupportingFiles(workspace, documents).filter(path => path.startsWith('docs/calc/'))
}

export function isDesignUiFile(path: string) {
  return /^content\/ui\/[A-Za-z0-9_./-]+\.json$/.test(path)
}

/** Freeze UI decisions, not later resource/action bindings in the same file.
 * This is only a digest in the existing baseline, never a second layout copy.
 * Immutable factual evidence (not live UI sources) still binds whole bytes. */
export function designSupportingFileDigest(workspace: string, path: string) {
  const bytes = readRetained(workspace, path)
  if (!isDesignUiFile(path)) return hash(bytes)
  try {
    const doc = parseBeeGameContentDocument(JSON.parse(bytes.toString('utf8')))
    if (doc.kind !== 'ui-screen' && doc.kind !== 'ui-hud' && doc.kind !== 'ui-flow') return hash(bytes)
    return hash(JSON.stringify(stable({ schema: doc.schema, id: doc.id, kind: doc.kind, rootId: doc.data.rootId,
      nodes: doc.data.nodes.map(node => ({ id: node.id, parentId: node.parentId, role: node.role, text: node.text,
        enabled: node.enabled ?? true, layout: node.layout,
        responsive: Object.fromEntries(Object.entries(node.responsive ?? {})
          .filter(([, variant]) => variant.enabled !== undefined || variant.layout !== undefined)
          .map(([name, variant]) => [name, { enabled: variant.enabled, layout: variant.layout }])),
        anchor: node.data?.anchor, space: node.data?.space, layoutOcclusion: node.data?.layoutOcclusion,
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
/** Read legacy indexes without certifying or retaining their retired business mirrors. */
function consumerHandoff(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as any).version !== 1) return raw
  const legacy = raw as Record<string, any>
  return { version: 2, ...(legacy.documentVersion !== undefined ? { documentVersion: legacy.documentVersion } : {}),
    outputs: Array.isArray(legacy.outputs) ? legacy.outputs.map((output: any) => {
      if (!output || typeof output !== 'object' || Array.isArray(output)) return output
      return { id: output.id, section: output.section, ...(output.acceptance !== undefined ? { acceptance: output.acceptance } : {}) }
    }) : legacy.outputs,
    ...(legacy.evidence !== undefined ? { evidence: legacy.evidence } : {}) }
}
function documentHandoff(workspace: string, name: DesignDocument, body: string) {
  const { blocks, headings } = documentStructure(body)
  if (blocks.length) throw new Error('Move inline bgs-handoff to ' + designHandoffPath(name) + '; preserve prose decisions')
  const documentVersion = designDocumentVersion(body), sidecar = readFileSync(designFilePath(realpathSync(workspace), designHandoffPath(name)))
  const raw = JSON.parse(sidecar.toString('utf8'))
  if (raw?.documentVersion !== undefined && raw.documentVersion !== documentVersion)
    throw new Error('Handoff documentVersion must match document header ' + documentVersion)
  return { handoff: handoffSchema.parse(consumerHandoff(raw)), headings, sidecar }
}

// A malformed evidence record must not hide an independently invalid output pointer.
function diagnosticHandoff(name: DesignDocument, raw: unknown, issues: string[]): Partial<DesignHandoff> {
  const current = consumerHandoff(raw), parsed = handoffSchema.safeParse(current)
  if (parsed.success) return parsed.data
  issues.push(`${name}: ${parsed.error.message}`)
  if (!current || typeof current !== 'object' || Array.isArray(current)) return {}
  const fields: Partial<DesignHandoff> = {}
  for (const [key, schema] of Object.entries(handoffSchema.shape)) {
    const field = schema.safeParse((current as Record<string, unknown>)[key])
    if (field.success) Object.assign(fields, { [key]: field.data })
    else issues.push(`${name}: checks requiring handoff.${key} were not run because the field is invalid`)
  }
  return fields
}
function outputIssues(name: DesignDocument, outputs: DesignHandoff['outputs'], headings: Set<string>) {
  const issues: string[] = [], ids = new Set<string>()
  for (const output of outputs) {
    if (ids.has(output.id)) issues.push(`${name}: duplicate output ID ${output.id}`)
    ids.add(output.id)
    if (!headings.has(output.section)) issues.push(`${name}: output ${output.id} references an absent section`)
    if (output.acceptance && !headings.has(output.acceptance.section))
      issues.push(`${name}: acceptance ${output.id} references an absent section`)
  }
  if (name === 'GDD.md' && !outputs.some(output => output.acceptance))
    issues.push(`${name}: core gameplay delivery expectations must be declared on an owned output`)
  return issues
}
function readImmutableEvidence(workspace: string, path: string) {
  const bytes = readRetained(workspace, path)
  // Check the resolved file too: an alias must not freeze a live source or
  // overwrite its decision digest in the released baseline.
  const part = relative(realpathSync(workspace), realpathSync(resolve(workspace, path))).split(sep).join('/')
  if (part.startsWith('content/ui/') && part.endsWith('.json'))
    throw new Error('Live UI source ' + path + ' cannot be immutable evidence; remove this evidence entry and link the source from UI_UX_SPEC.md. Content completes bindings in place.')
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

/** Index/evidence integrity only. Prose decisions and dependencies need semantic review.
 * The old options remain source compatible; none enables retired mirror checks. */
export function checkDesignHandoff(workspace: string, documents: readonly DesignDocument[], _options: {
  nextConsumers?: readonly string[]; technicalBaseline?: boolean; inputs?: readonly string[]
} = {}) {
  const issues: string[] = [], snapshots: Record<string, string> = {}, evidenceHashes: Record<string, string> = {}, documentVersions: Record<string, string> = {}
  for (const name of documents) {
    try {
      const root = realpathSync(workspace)
      const bytes = readFileSync(designFilePath(root, `docs/${name}`))
      snapshots[name] = hash(bytes)
      try { documentVersions[name] = designDocumentVersion(bytes.toString('utf8')) }
      catch (error) { issues.push(`${name}: ${error instanceof Error ? error.message : String(error)}`) }
      const path = designHandoffPath(name)
      designFilePath(root, path)
      try { snapshots[name] = hash(JSON.stringify([hash(bytes), hash(readRetained(workspace, path))])) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const { blocks, headings } = documentStructure(bytes.toString('utf8'))
      if (blocks.length) issues.push(`${name}: Move inline bgs-handoff to ${path}; preserve prose decisions`)
      try {
        const supporting = designSupportingFiles(workspace, [name]).map(file => {
          const digest = designSupportingFileDigest(workspace, file)
          evidenceHashes[file] = digest
          return [file, digest]
        })
        if (supporting.length) snapshots[name] = hash(JSON.stringify([snapshots[name], supporting]))
      } catch (error) { issues.push(`${name}: ${error instanceof Error ? error.message : String(error)}`) }
      const raw = JSON.parse(readRetained(workspace, path).toString('utf8'))
      if (documentVersions[name] && raw?.documentVersion !== undefined && raw.documentVersion !== documentVersions[name])
        issues.push(`${name}: Handoff documentVersion must match document header ${documentVersions[name]}`)
      const h = diagnosticHandoff(name, raw, issues)
      if (h.outputs) issues.push(...outputIssues(name, h.outputs, headings))
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
  return { valid: !issues.length, issues, snapshots, evidenceHashes, documentVersions,
    revision: hash(JSON.stringify([snapshots, evidenceHashes])),
    note: 'Checks output/acceptance pointers, local IDs and retained evidence bytes/declared observations. Legacy v1 is read-only compatible for outputs/evidence; retired readiness, states, events, parameters, resources, inputs, consumes, platformFacts, pending and limits are ignored and not certified. Prose completeness, dependencies, source authority, observation authenticity, semantic adequacy and experience quality remain review/owner judgments.' }
}

// Version lines are host metadata, excluded only from material-change detection.
const versionLine = /^[ \t]*-[ \t]*(?:Version|版本)[ \t]*[:：][^\r\n]*(?:\r?\n|$)/gim
function withoutVersion(body: string) {
  const valid = /^[ \t]*-[ \t]*(?:Version|版本)[ \t]*[:：][ \t]*v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?)[ \t]*(?:\r?\n|$)/gim
  return [...body.matchAll(valid)].length === 1 ? body.replace(valid, '') : body
}
function withVersion(body: string, version: string) {
  const lines = [...body.matchAll(versionLine)]
  if (lines.length > 1) throw new Error('Expected at most one document header version before finalization')
  if (lines.length) {
    try { if (designDocumentVersion(body) === version) return body } catch { /* Replace malformed host metadata. */ }
    return body.replace(versionLine, '- Version: v' + version + (lines[0]![0].endsWith('\n') ? '\n' : ''))
  }
  const heading = /^#[ \t]+[^\r\n]*(?:\r?\n|$)/m.exec(body)
  const at = heading ? heading.index + heading[0].length : 0
  return body.slice(0, at) + (at && !body.slice(0, at).endsWith('\n') ? '\n' : '') + '- Version: v' + version + '\n' + body.slice(at)
}
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
}
function materialHandoff(raw: unknown) {
  const current = consumerHandoff(raw)
  if (!current || typeof current !== 'object' || Array.isArray(current)) return current
  const { version: _format, documentVersion: _version, ...index } = current as Record<string, any>
  if (Array.isArray(index.evidence)) index.evidence = index.evidence.map(evidence => {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return evidence
    const { sha256: _hash, ...source } = evidence
    return source
  })
  // Omitted and empty evidence both mean no retained evidence references.
  if (index.evidence === undefined || (Array.isArray(index.evidence) && !index.evidence.length)) delete index.evidence
  return stable(index)
}
function optionalDesignFile(workspace: string, path: string) {
  // Snapshots must preserve malformed/empty drafts for an authorized repair;
  // they are not evidence validation or a release verdict.
  try { return readFileSync(designFilePath(realpathSync(workspace), path)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
function materialDocument(workspace: string, name: DesignDocument) {
  const bytes = optionalDesignFile(workspace, `docs/${name}`)
  const sidecar = optionalDesignFile(workspace, designHandoffPath(name))
  let raw: unknown
  try { raw = sidecar ? JSON.parse(sidecar.toString('utf8')) : undefined }
  catch { raw = { malformedIndex: hash(sidecar!) } }
  const evidence: Array<[string, string]> = []
  const refs = (consumerHandoff(raw) as { evidence?: unknown } | undefined)?.evidence
  if (Array.isArray(refs)) for (const ref of refs) if (typeof ref?.path === 'string') {
    try { evidence.push([ref.path, hash(readRetained(workspace, ref.path))]) }
    catch (error) { evidence.push([ref.path, String(error)]) }
  }
  if (bytes) try {
    for (const file of designSupportingFiles(workspace, [name])) evidence.push([file, designSupportingFileDigest(workspace, file)])
  } catch (error) { evidence.push(['calculation-reference-error', String(error)]) }
  let version: string | undefined
  if (bytes) try { version = designDocumentVersion(bytes.toString('utf8')) } catch { /* Host can add missing metadata. */ }
  return { version, contentHash: hash(JSON.stringify([bytes ? withoutVersion(bytes.toString('utf8')) : null,
    materialHandoff(raw), evidence.sort(([a], [b]) => a.localeCompare(b))])) }
}
export type DesignDocumentSnapshot = { workspace: string; documents: Partial<Record<DesignDocument, { version?: string; contentHash: string }>> }
/** Capture before a controlled author/revise write; malformed drafts can be repaired. */
export function snapshotDesignDocuments(workspace: string, documents: readonly DesignDocument[]): DesignDocumentSnapshot {
  const result: DesignDocumentSnapshot = { workspace: realpathSync(workspace), documents: {} }
  for (const name of documents) {
    designHandoffPath(name) // Reject unknown document names.
    result.documents[name] = materialDocument(workspace, name)
  }
  return result
}
function nextVersion(version: string) {
  const parts = version.split('.').map(Number), last = parts.length - 1
  if (!Number.isSafeInteger(parts[last]! + 1)) throw new Error('Document version exceeds supported range')
  parts[last] = parts[last]! + 1
  return parts.join('.')
}
function designFilePath(root: string, path: string) {
  const target = resolve(root, path)
  // Containment alone permits a GDD symlink to overwrite another in-workspace
  // document. Exact resolution also rejects symlinked path ancestors.
  if (realpathSync(target) !== target) throw new Error('Design finalization target must not be a symlink: ' + path)
  if (!statSync(target).isFile()) throw new Error('Design target must be a regular file: ' + path)
  return target
}
/** Called only at an authorized completed-write boundary, never by read/check APIs.
 * Stages metadata after validating saved decisions/evidence; does not invent proof. */
export function finalizeDesignDocuments(workspace: string, documents: readonly DesignDocument[], snapshot: DesignDocumentSnapshot) {
  const issues: string[] = [], unsafeIssues: string[] = [], writes: Array<{ path: string; body: string }> = [], root = realpathSync(workspace)
  if (snapshot.workspace !== root) {
    const issue = 'Design finalization snapshot belongs to another workspace'
    return { issues: [issue], unsafeIssues: [issue] }
  }
  for (const name of new Set(documents)) {
    let safeTargets = false
    try {
      const before = snapshot.documents[name]
      if (!before) throw new Error('Document was not captured in the authorized write scope')
      const sourcePath = designFilePath(root, `docs/${name}`), indexPath = designFilePath(root, designHandoffPath(name))
      const body = readFileSync(sourcePath, 'utf8'), originalIndex = readFileSync(indexPath, 'utf8')
      safeTargets = true
      const { blocks, headings } = documentStructure(body)
      if (blocks.length) throw new Error('Move inline bgs-handoff to ' + designHandoffPath(name) + '; preserve prose decisions')
      const handoff = handoffSchema.parse(consumerHandoff(JSON.parse(originalIndex)))
      const invalidOutputs = outputIssues(name, handoff.outputs, headings)
      if (invalidOutputs.length) throw new Error(invalidOutputs.join('; '))
      const evidenceIds = new Set<string>()
      handoff.evidence = handoff.evidence.map(evidence => {
        if (evidenceIds.has(evidence.id)) throw new Error('Duplicate evidence ID ' + evidence.id)
        evidenceIds.add(evidence.id)
        if (evidence.section && !headings.has(evidence.section)) throw new Error('Evidence ' + evidence.id + ' references an absent section')
        return { ...evidence, sha256: evidenceDigest(root, evidence) }
      })
      const current = materialDocument(root, name)
      const version = before.version ? current.contentHash === before.contentHash ? before.version : nextVersion(before.version) : '1.0'
      handoff.documentVersion = version
      const finalizedBody = withVersion(body, version), finalizedIndex = JSON.stringify(handoff, null, 2) + '\n'
      if (body !== finalizedBody) writes.push({ path: sourcePath, body: finalizedBody })
      // Preserve already finalized bytes, including formatting, on an unchanged call.
      if (JSON.stringify(stable(JSON.parse(originalIndex))) !== JSON.stringify(stable(handoff)))
        writes.push({ path: indexPath, body: finalizedIndex })
    } catch (error) {
      const issue = `${name}: ${error instanceof Error ? error.message : String(error)}`
      issues.push(issue)
      // A missing draft/index is a reproducible design diagnostic. Unsafe
      // redirects and other I/O failures cannot be delegated as a normal draft.
      if (!safeTargets && (error as NodeJS.ErrnoException).code !== 'ENOENT') unsafeIssues.push(issue)
    }
  }
  if (!issues.length) for (const write of writes) {
    try { writeFileSync(write.path, write.body) }
    catch (error) {
      const issue = `${relative(root, write.path)}: ${error instanceof Error ? error.message : String(error)}`
      issues.push(issue); unsafeIssues.push(issue); break
    }
  }
  return { issues, unsafeIssues }
}

/** Reuse the only output index actually consumed by runtime acceptance. */
export function readDesignAcceptanceRequirements(workspace: string) {
  const requirements: Array<{ document: DesignDocument; id: string; section: string;
    method: 'test' | 'target-runtime' | 'inspection'; documentSha256: string; handoffSha256: string }> = []
  const documents: DesignDocument[] = []
  for (const document of PROJECT_DOCUMENTS) {
    const bytes = optionalDesignFile(workspace, `docs/${document}`)
    if (!bytes) continue
    documents.push(document)
    const { handoff, headings, sidecar } = documentHandoff(workspace, document, bytes.toString('utf8'))
    const issues = outputIssues(document, handoff.outputs, headings)
    if (issues.length) throw new Error(issues.join('; '))
    for (const evidence of handoff.evidence) {
      const digest = evidenceDigest(workspace, evidence)
      if (evidence.sha256 !== undefined && evidence.sha256 !== digest) throw new Error(`${document}: evidence ${evidence.id}: Evidence bytes changed`)
    }
    for (const output of handoff.outputs) if (output.acceptance)
      requirements.push({ document, id: output.id, ...output.acceptance, documentSha256: hash(bytes), handoffSha256: hash(sidecar) })
  }
  if (documents.length && !documents.includes('GDD.md')) throw new Error('Design acceptance requires the current GDD.md')
  return requirements
}
export function designReviewSourceHeadings(workspace: string, documents: readonly string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const name of documents) {
    if (!PROJECT_DOCUMENTS.some(document => document === name)) continue
    try { result[name] = [...documentStructure(readRetained(workspace, `docs/${name}`).toString('utf8')).headings] }
    catch { /* Missing/unreadable sources remain unavailable, not fabricated headings. */ }
  }
  return result
}

/** Current pointers only, not another authority or semantic verdict. This
 * replaces serial metadata reads; the reviewer still reads the saved prose
 * and actual evidence. Malformed indexes retain the host's revision path. */
export function designReviewIndexes(workspace: string, documents: readonly string[]) {
  return documents.map(name => {
    if (!PROJECT_DOCUMENTS.some(document => document === name)) throw new Error('Unknown design document')
    try {
      const { handoff } = documentHandoff(workspace, name as DesignDocument,
        readRetained(workspace, `docs/${name}`).toString('utf8'))
      return { document: name, outputs: handoff.outputs, evidence: handoff.evidence.map(({ sha256: _hash, ...source }) => source) }
    } catch { return { document: name, unavailable: 'Index unavailable/malformed; use the host structural revision scope, not invented pointers.' } }
  })
}

/** Locations are checkable; the finding's semantic merit is not. */
export function checkDesignFindingSources(workspace: string, findings: DesignFinding[]) {
  return designFindingSourceIssues(findings, designReviewSourceHeadings(workspace, findings.flatMap(f => f.sources.map(s => s.document))))
}
