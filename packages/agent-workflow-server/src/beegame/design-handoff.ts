import { createHash } from 'node:crypto'
import { designSectionHashes, designDocumentSections } from './design-document-sections'
import { checkCalculationResult } from './balance-calculation.mjs'
import { readCalculationInputs } from './balance-calculation'
import { lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { collectContentSourceFiles } from './content-source-files'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { array, enum as enumeration, literal, object, string, unknown } from 'zod'
import type { z } from 'zod'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
import { designFindingSourceIssues, type DesignFinding } from '@bee-game-studio/agent-workflow/design-review-result'
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

/** Owned outcome/pointer/evidence feedback, without host versions, sibling readiness
 * or semantic certification. Catch malformed indexes in the author's short
 * history instead of deferring basic field errors to a full joint Revision. */
export function checkDesignHandoffDraft(workspace: string, name: string, options: { finalTechnical?: boolean | 'when-ready' } = {}) {
  const issues: string[] = []
  const availableRequirements: Array<{ document: DesignDocument; id: string; section: string }> = []
  const pendingDocuments = new Set<DesignDocument>()
  const allowPending = options.finalTechnical === 'when-ready'
  let taskCoverageChecked = false
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
    const handoff = canonicalHeadingPointers(diagnosticHandoff(document,
      JSON.parse(readRetained(workspace, designHandoffPath(name)).toString('utf8')), issues), headingNames)
    issues.push(...outputIssues(document, handoff.outputs ?? [], headings))
    const indexes: Partial<Record<DesignDocument, IndexedDesign>> = { [document]: { handoff, headings } }
    const inspectTechnical = document === 'TECHNICAL_DESIGN.md' && Boolean(options.finalTechnical)
    // Public draft reads available owners during writing. Explicit final checks
    // remain strict; missing draft inputs never become a completed task check.
    const readSibling = (sibling: DesignDocument, path: string) => {
      if (allowPending) try { lstatSync(resolve(workspace, path)) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        pendingDocuments.add(sibling)
        return undefined
      }
      // Do not classify a broken/unsafe alias or unreadable file as not authored.
      return readRetained(workspace, path)
    }
    if (inspectTechnical) for (const sibling of PROJECT_DOCUMENTS) {
      if (sibling === document) continue
      try {
        const body = readSibling(sibling, `docs/${sibling}`)
        const index = readSibling(sibling, designHandoffPath(sibling))
        const source = body ? documentStructure(body.toString('utf8')) : undefined
        const owner = index ? diagnosticHandoff(sibling, JSON.parse(index.toString('utf8')), issues) : undefined
        if (!source || !owner) continue
        if (source.blocks.length) issues.push(`${sibling}: Move inline bgs-handoff to ${designHandoffPath(sibling)}`)
        const handoff = canonicalHeadingPointers(owner, source.headingNames)
        indexes[sibling] = { headings: source.headings, handoff }
        issues.push(...outputIssues(sibling, handoff.outputs ?? [], source.headings))
      } catch (error) { issues.push(`Cannot check task coverage against ${sibling}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    taskCoverageChecked = inspectTechnical && !pendingDocuments.size
    issues.push(...implementationIssues(indexes, taskCoverageChecked))
    if (!handoff.outputs?.length) issues.push('required owned delivery outcomes are missing')
    for (const output of handoff.outputs ?? []) if (!output.acceptance)
      issues.push(`output ${output.id} needs an acceptance section for its owned delivery`)
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
  // Planning inputs must not depend on the technical plan already existing.
  // These are readable source pointers, not a released/accepted baseline.
  if (name === 'TECHNICAL_DESIGN.md' && options.finalTechnical) {
    const sources = checkDesignHandoff(workspace, PROJECT_DOCUMENTS, { technicalBaseline: true, planningInputs: true })
    availableRequirements.push(...(sources.availableRequirements ?? []).map(({ document, id, outputSection }) =>
      ({ document, id, section: outputSection })))
  }
  return { valid: !issues.length, issues: issues.map(issue => issue.startsWith(name + ':') ? issue : `${name}: ${issue}`),
    ...(allowPending && name === 'TECHNICAL_DESIGN.md' ? { pendingDocuments: [...pendingDocuments], taskCoverageChecked } : {}),
    ...(availableRequirements.length ? { availableRequirements } : {}) }
}

export const DESIGN_INDEX_INSTRUCTION = `Keep decisions, dependencies, open questions, limits and human-readable tables in docs/<NAME>.md. Save only the downstream index at .beegame/design-handoffs/<NAME without .md>.json; do not embed bgs-handoff JSON in prose.
Minimal new index envelope: {"outputs":[{"id":"owned-outcome","section":"Exact saved heading","acceptance":{"section":"Exact saved acceptance heading","method":"test"}}],"evidence":[]}. Replace example IDs/headings with actual owned outcomes. Do not add a top-level document/path field; the sidecar filename identifies its document. Only TECHNICAL_DESIGN owns implementationItems; other authors do not add them. Preserve existing valid fields when editing. Only version 2 is accepted; an absent version means a current draft. A section uses its full saved heading, including numbering. The host canonicalizes a uniquely matching title differing only by leading chapter numbering; missing or ambiguous titles remain invalid. The host adds metadata only after validation; it does not discard invalid fields or repair malformed indexes.
Write outputs:[{id,section,acceptance?:{section,method:"test"|"target-runtime"|"inspection"}}] and, where retained evidence is needed, evidence:[{id,kind:"contract"|"documentation"|"capability",path:workspace-relative retained file,source,section?:actual prose heading,pointer?:JSON pointer,expected?:value}]. IDs are local to their document. Headings point to the authoritative decisions and expectations; do not copy their rules into JSON. Do not mirror states, events, parameters, resources, inputs, consumes, pending, limits, platformFacts or readiness in the index. After saving a document and its index, explicitly call handoff.mjs --design finalize DOCUMENT.md. Only that command sets format version 2, document header/documentVersion and evidence sha256; ordinary Write/Edit and read-only baseline/draft do not finalize metadata. It advances versions on material changes to prose, the index or referenced retained evidence; unchanged documents keep their version. Authors do not calculate or synchronize versions/hashes.
Register every necessary owned release outcome in outputs with acceptance pointing to an actual prose heading explaining conditions/actions, observable expected results and necessary boundaries/recovery. Keep explanatory prose out of the required checklist. Use an independently checkable behavior, page/state interaction, professional treatment or technical integration, not "implement all gameplay/UI" or one item per function, constant or sentence. Existing version 2 indexes remain readable but their coarse or unindexed expectations are not certified as a new complete checklist. Use test for deterministic rules/calculations, target-runtime for actual presentation/input/audio and end-to-end play, inspection for directly examinable resources or retained provenance. Prose review is not runtime evidence; no completed runtime check is required while authoring.`

export const DESIGN_HANDOFF_INSTRUCTION = DESIGN_INDEX_INSTRUCTION + `
Read reference pictures with the native Read tool at their actual saved paths, just as you read the linked design documents. A document link, filename, hash or generation record is not an image read. If a picture is missing, unreadable or unsupported, report the exact path and read error; do not claim to have inspected it or silently substitute another image. Existing and user-supplied references do not need AI source certification. Use the available AI image tools when generation is needed within the authorized scope and budget. UI/Scene source and runtime consumption checks remain separate from reading reference pictures.
Use gameplay-programmer and game-implementation-planning to complete TECHNICAL_DESIGN.md and its implementation tasks/index during the eight-document design-record stage, before actual visual design, resource production or UI/Scene JSON. Define the technical approach, module responsibilities, interfaces, data consumption and verification methods. Compare the original confirmed scope and all applicable professional records, not just output IDs; do not silently omit or defer necessary work. The technical author adds implementationItems:[{id,section,dependsOn:[existing task IDs],requirementRefs:[{document:actual design filename,id:owned output ID}]}] to its existing index. New tasks state dependsOn explicitly (empty when independent); legacy absence is not independence. Each task points to a concise technical section using the planning Skill's six-part task description. Reference exact owner sections; describe unproduced content/resources as planned inputs and their consumption contracts, not existing files or evidence. As selected pictures, resources and UI/Scene sources become available, revise affected sections and task references in this same plan from their actual paths/IDs/metrics; preserve unaffected decisions and task IDs. Keep shared cross-task interfaces once in their existing source, including names, producer/consumer and consequential types/units. Do not duplicate rules, numeric tables or layouts in the index. Foundations and player-visible behavior are both valid tasks; do not split functions/fields or force every task to launch a full game. Cover every registered required output, including technical ones; program checks declared coverage/references/dependencies, not original completeness or semantic adequacy.
Implementation uses game-plan-execution. ReadDesignHandoff reads current inputs and selected original sections; ReadImplementationTask lists the existing IDs/dependencies or reads one task and referenced owner section locations. These reads neither lock nor enter implementation. Use the supplied --design implementation only for the authorized implementation handoff; keep the existing technical plan and task list, with no copied delivery plan or task database. Confirm dependency outputs actually work before consuming them; task ticks and file existence are not proof. Preserve confirmed design and consume its actual content/resources. Use the same task IDs in the existing execution list with concise progress and retained result paths; do not write execution logs into finalized design records. Resume from actual partial code and current evidence, checking unknown gaps rather than replaying completed work. Reuse current results across applicable tasks; keep pending integration unverified. Final checks compare the whole confirmed scope with original designs and actual runtime results; one successful player route cannot replace other promised outcomes.
Contract evidence checks its JSON pointer against expected. Capability evidence retains an actual JSON observation {observation:"target-runtime",check,passed:true,expected,observed}; expected and observed must agree. Documentation retains source bytes with an HTTPS source URL and precise source location. Live content/ui and content/scenes JSON are design sources, not immutable evidence: create them only after selected actual visual designs and corresponding resources exist, then link them from their owning UI_UX_SPEC.md or LEVEL_SCENE_DESIGN.md sections. During document authoring use prose/sketches for space requirements, not early UI/Scene JSON. Author layout and bindings from the selected designs and delivered visual resources, preserving live text/actions and runtime-driven objects separately. Check the saved sources and replace planned inputs in affected technical task prose with actual picture/resource/frame/content references before implementation handoff; index coverage alone is not that revision. Missing production inputs do not postpone completion of TECHNICAL_DESIGN.md in the eight-document stage or justify restarting valid professional documents. Todo ticks are navigation, never proof that the files or prerequisite outputs exist. Host-generated hashes bind bytes, not source authority, observation authenticity or semantic adequacy. Unsupported consequential assumptions, their owner, needed-by point and authorized fallback remain in prose; do not silently substitute a fallback. User decisions must trace to actual user authorization. Version 1 sidecars are rejected instead of silently converted.`

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
      const parsed = /[\r\n]/.test(section) ? [] : documentStructure(
        /^#{1,6}(?:[ \t]|$)/.test(section) ? section : '# ' + section,
      ).headingNames
      const rendered = parsed.length === 1 && parsed[0] ? parsed[0] : section
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
  if (versions.length !== 1) throw new Error('Missing or malformed host version metadata. Save the document/index, then run handoff.mjs --design finalize DOCUMENT.md for this owner; do not add or synchronize version headers manually.')
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
      const ownLayout = (name === 'UI_UX_SPEC.md' && isDesignUiFile(part)) ||
        (name === 'LEVEL_SCENE_DESIGN.md' && isDesignSceneFile(part))
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
/** Kept for callers requesting calculations only, not visual source files. */
export function designCalculationFiles(workspace: string, documents: readonly string[]) {
  return designSupportingFiles(workspace, documents).filter(path => path.startsWith('docs/calc/'))
}

export function isDesignUiFile(path: string) {
  return /^content\/ui\/[A-Za-z0-9_./-]+\.json$/.test(path)
}
export function isDesignSceneFile(path: string) {
  return /^content\/scenes\/[A-Za-z0-9_./-]+\.json$/.test(path)
}

/** The same owner/registry identity check is useful before implementation and
 * at acceptance. Return both owners' issues together, not one repair per run. */
export function designContentLinkIssues(workspace: string, runtimeUi: Iterable<string>, runtimeScenes: Iterable<string>) {
  const issues: string[] = []
  for (const [owner, isOwned, registered] of [
    ['UI_UX_SPEC.md', isDesignUiFile, new Set(runtimeUi)],
    ['LEVEL_SCENE_DESIGN.md', isDesignSceneFile, new Set(runtimeScenes)],
  ] as const) {
    const declared = designSupportingFiles(workspace, [owner]).filter(isOwned)
    const missing = [...registered].filter(path => !declared.includes(path))
    const unregistered = declared.filter(path => !registered.has(path))
    if (missing.length || unregistered.length) issues.push(owner + ' and content/index.json must reference the same sources. ' +
      'Missing design links: ' + (missing.join(', ') || 'none') + '; unregistered design sources: ' + (unregistered.join(', ') || 'none') +
      '. Use actual Markdown links, for example [layout](../content/ui/menu.json); plain text/backticks are not source links.')
  }
  return issues
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
  const documentVersion = designDocumentVersion(body), sidecar = readFileSync(designFilePath(realpathSync(workspace), designHandoffPath(name)))
  const raw = JSON.parse(sidecar.toString('utf8'))
  if (raw?.documentVersion !== undefined && raw.documentVersion !== documentVersion)
    throw new Error(`Handoff documentVersion must match document header ${documentVersion}. Run handoff.mjs --design finalize ${name}; do not synchronize host metadata manually.`)
  const issues: string[] = []
  if (diagnostic) {
    // Reuse draft parsing to retain valid tasks when a sibling is malformed.
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
      ? ' Each task needs at least one real owned-output reference {document,id}, including technical foundations and end-to-end tasks. Use handoff.mjs --design draft TECHNICAL_DESIGN.md for availableRequirements; do not invent IDs or inspect checker source.' : ''
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
  if (name === 'GDD.md' && !outputs.some(output => output.acceptance))
    issues.push(`${name}: core gameplay delivery expectations must be declared on an owned output`)
  return issues
}
type IndexedDesign = { handoff: Partial<DesignHandoff>; headings: Set<string> }
/** Structural task/source relationships, never semantic grouping or task completion. */
function implementationIssues(indexes: Partial<Record<DesignDocument, IndexedDesign>>, required: boolean) {
  const issues: string[] = []
  for (const name of PROJECT_DOCUMENTS) {
    const index = indexes[name]
    if (!index) continue
    if (required) {
      if (!index.handoff.outputs?.length) issues.push(`${name}: required delivery outcomes are missing`)
      for (const output of index.handoff.outputs ?? []) if (!output.acceptance)
        issues.push(`${name}: output ${output.id} needs an acceptance section before implementation`)
    }
    if (name !== 'TECHNICAL_DESIGN.md' && index.handoff.implementationItems !== undefined)
      issues.push(`${name}: implementationItems belongs only to the final TECHNICAL_DESIGN.md index`)
  }
  const tech = indexes['TECHNICAL_DESIGN.md'], items = tech?.handoff.implementationItems
  if (required && !items?.length)
    issues.push('TECHNICAL_DESIGN.md: implementationItems is missing or empty; prepare the cross-document task checklist through authorized design revision, not an implementation Todo')
  const ids = new Set<string>(), covered = new Set<string>()
  const byId = new Map((items ?? []).map(item => [item.id, item]))
  for (const item of items ?? []) {
    if (ids.has(item.id)) issues.push(`TECHNICAL_DESIGN.md: duplicate implementation item ID ${item.id}`)
    ids.add(item.id)
    const dependencies = new Set<string>()
    for (const dependency of item.dependsOn ?? []) {
      if (dependencies.has(dependency)) issues.push(`TECHNICAL_DESIGN.md: implementation item ${item.id} has duplicate dependency ${dependency}`)
      dependencies.add(dependency)
      if (dependency === item.id) issues.push(`TECHNICAL_DESIGN.md: implementation item ${item.id} depends on itself`)
      else if (!byId.has(dependency)) issues.push(`TECHNICAL_DESIGN.md: implementation item ${item.id} references missing dependency ${dependency}`)
    }
    if (!tech!.headings.has(item.section)) issues.push(`TECHNICAL_DESIGN.md: implementation item ${item.id} references an absent section`)
    const refs = new Set<string>()
    for (const ref of item.requirementRefs) {
      const key = `${ref.document}#${ref.id}`
      if (refs.has(key)) issues.push(`TECHNICAL_DESIGN.md: implementation item ${item.id} has duplicate requirement ${key}`)
      refs.add(key)
      const source = indexes[ref.document]
      // Pending draft siblings are not failures during dependent writing.
      if (!source && !required) continue
      const output = source?.handoff.outputs?.find(output => output.id === ref.id)
      if (!output) issues.push(`TECHNICAL_DESIGN.md: implementation item ${item.id} references missing requirement ${key}`)
      else if (!output.acceptance) issues.push(`TECHNICAL_DESIGN.md: implementation item ${item.id} requirement ${key} has no acceptance section`)
      else covered.add(key)
    }
  }
  const visited = new Set<string>(), active = new Set<string>()
  const visit = (id: string): void => {
    if (active.has(id)) { issues.push(`TECHNICAL_DESIGN.md: implementation dependency cycle at ${id}`); return }
    if (visited.has(id)) return
    visited.add(id); active.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) if (byId.has(dependency)) visit(dependency)
    active.delete(id)
  }
  for (const id of byId.keys()) visit(id)
  if (required) for (const name of PROJECT_DOCUMENTS) for (const output of indexes[name]?.handoff.outputs ?? [])
    if (!covered.has(`${name}#${output.id}`)) issues.push(`TECHNICAL_DESIGN.md: required output ${name}#${output.id} has no implementation item`)
  return issues
}
function readImmutableEvidence(workspace: string, path: string) {
  const bytes = readRetained(workspace, path)
  // Check the resolved file too: an alias must not freeze a live source or
  // overwrite its decision digest in the released baseline.
  const part = relative(realpathSync(workspace), realpathSync(resolve(workspace, path))).split(sep).join('/')
  if (part.startsWith('content/ui/') && part.endsWith('.json'))
    throw new Error('Live UI source ' + path + ' cannot be immutable evidence; remove this evidence entry and link the source from UI_UX_SPEC.md. Content completes bindings in place.')
  if (isDesignSceneFile(part))
    throw new Error('Live Scene source ' + path + ' cannot be immutable evidence; link the source from LEVEL_SCENE_DESIGN.md. Content completes bindings in place.')
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
  nextConsumers?: readonly string[]; technicalBaseline?: boolean; inputs?: readonly string[]; digestVersion?: 1 | 2; planningInputs?: boolean
} = {}) {
  const issues: string[] = [], snapshots: Record<string, string> = {}, evidenceHashes: Record<string, string> = {}, documentVersions: Record<string, string> = {}
  const indexes: Partial<Record<DesignDocument, IndexedDesign>> = {}
  const availableRequirements: ReturnType<typeof readDesignAcceptanceRequirements> = []
  for (const name of documents) {
    try {
      const root = realpathSync(workspace)
      const bytes = readFileSync(designFilePath(root, `docs/${name}`))
      snapshots[name] = hash(bytes)
      try { documentVersions[name] = designDocumentVersion(bytes.toString('utf8')) }
      catch (error) { issues.push(`${name}: ${error instanceof Error ? error.message.replace('DOCUMENT.md', name) : String(error)}`) }
      const path = designHandoffPath(name)
      designFilePath(root, path)
      try { snapshots[name] = hash(JSON.stringify([hash(bytes), hash(readRetained(workspace, path))])) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const { blocks, headings } = documentStructure(bytes.toString('utf8'))
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
      const raw = JSON.parse(readRetained(workspace, path).toString('utf8'))
      if (documentVersions[name] && raw?.documentVersion !== undefined && raw.documentVersion !== documentVersions[name])
        issues.push(`${name}: Handoff documentVersion must match document header ${documentVersions[name]}. Run handoff.mjs --design finalize ${name}; do not synchronize host metadata manually.`)
      const h = diagnosticHandoff(name, raw, issues)
      indexes[name] = { handoff: h, headings }
      if (h.outputs) issues.push(...outputIssues(name, h.outputs, headings))
      // Keep independently addressable inputs even when a sibling or host
      // metadata is incomplete. Duplicate IDs and broken pointers are excluded.
      for (const output of _options.planningInputs ? h.outputs ?? [] : []) if (output.acceptance && headings.has(output.section) &&
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
  const completeDesign = PROJECT_DOCUMENTS.every(name => documents.includes(name)) && !_options.technicalBaseline
  issues.push(...implementationIssues(indexes, completeDesign))
  return { valid: !issues.length, issues, ...(_options.planningInputs ? { availableRequirements } : {}), snapshots, evidenceHashes, documentVersions, digestVersion: _options.digestVersion ?? DESIGN_DIGEST_VERSION,
    revision: hash(JSON.stringify([snapshots, evidenceHashes])),
    note: 'Checks output/acceptance pointers, local IDs and retained evidence bytes/declared observations. Version 1 and retired business mirrors are rejected. Prose completeness, dependencies, source authority, observation authenticity, semantic adequacy and experience quality remain review/owner judgments.' }
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
  const current = raw
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
  const refs = (raw as { evidence?: unknown } | undefined)?.evidence
  if (Array.isArray(refs)) for (const ref of refs) if (typeof ref?.path === 'string') {
    try { evidence.push([ref.path, hash(readRetained(workspace, ref.path))]) }
    catch (error) { evidence.push([ref.path, String(error)]) }
  }
  if (bytes) try {
    for (const file of designSupportingFiles(workspace, [name])) evidence.push([file, designSupportingFileDigest(workspace, file)])
  } catch (error) { evidence.push(['calculation-reference-error', String(error)]) }
  let version: string | undefined
  if (bytes) try { version = designDocumentVersion(bytes.toString('utf8')) } catch { /* Host can add missing metadata. */ }
  return { version, sections: bytes ? designSectionHashes(bytes.toString('utf8')) : undefined,
    contentHash: hash(JSON.stringify([bytes ? withoutVersion(bytes.toString('utf8')) : null,
    materialHandoff(raw), evidence.sort(([a], [b]) => a.localeCompare(b))])) }
}
export type DesignDocumentSnapshot = { workspace: string; documents: Partial<Record<DesignDocument, { version?: string; contentHash: string; sections?: Record<string, string> }>> }
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
export function finalizeDesignDocuments(workspace: string, documents: readonly DesignDocument[], snapshot: DesignDocumentSnapshot,
  prior?: { changedDocuments: string[]; documentVersions?: Record<string, string> }) {
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
      const { blocks, headings, headingNames } = documentStructure(body)
      if (blocks.length) throw new Error('Move inline bgs-handoff to ' + designHandoffPath(name) + '; preserve prose decisions')
      const handoff = canonicalHeadingPointers(parseHandoff(name, JSON.parse(originalIndex)), headingNames)
      const invalidOutputs = outputIssues(name, handoff.outputs, headings)
      invalidOutputs.push(...implementationIssues({ [name]: { handoff, headings } }, false))
      if (invalidOutputs.length) throw new Error(invalidOutputs.join('; '))
      const evidenceIds = new Set<string>()
      handoff.evidence = handoff.evidence.map(evidence => {
        if (evidenceIds.has(evidence.id)) throw new Error('Duplicate evidence ID ' + evidence.id)
        evidenceIds.add(evidence.id)
        if (evidence.section && !headings.has(evidence.section)) throw new Error('Evidence ' + evidence.id + ' references an absent section')
        return { ...evidence, sha256: evidenceDigest(root, evidence) }
      })
      const current = materialDocument(root, name)
      const originalVersion = prior?.changedDocuments.includes(name) ? prior.documentVersions?.[name] ?? before.version : before.version
      const changed = prior?.changedDocuments.includes(name) || current.contentHash !== before.contentHash
      const version = originalVersion ? changed ? nextVersion(originalVersion) : originalVersion : '1.0'
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
  // Finalize independent valid owners even when a sibling has a recoverable
  // index error. Otherwise its missing host version becomes a second repair
  // assigned to the model. Unsafe I/O still prevents the whole batch.
  if (!unsafeIssues.length) for (const write of writes) {
    try { writeFileSync(write.path, write.body) }
    catch (error) {
      const issue = `${relative(root, write.path)}: ${error instanceof Error ? error.message : String(error)}`
      issues.push(issue); unsafeIssues.push(issue); break
    }
  }
  return { issues, unsafeIssues }
}

/** Reuse the only output index actually consumed by runtime acceptance. */
export function readDesignAcceptanceRequirements(workspace: string, options: { technicalBaseline?: boolean } = {}) {
  const requirements: Array<{ document: DesignDocument; id: string; section: string; outputSection: string;
    method: 'test' | 'target-runtime' | 'inspection'; documentSha256: string; handoffSha256: string }> = []
  const documents: DesignDocument[] = []
  const indexes: Partial<Record<DesignDocument, IndexedDesign>> = {}
  for (const document of PROJECT_DOCUMENTS) {
    const bytes = optionalDesignFile(workspace, `docs/${document}`)
    if (!bytes) continue
    documents.push(document)
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
  if (documents.length && !documents.includes('GDD.md')) throw new Error('Design acceptance requires the current GDD.md')
  const issues = implementationIssues(indexes, !options.technicalBaseline && PROJECT_DOCUMENTS.every(name => documents.includes(name)))
  if (issues.length) throw new Error(issues.join('; '))
  return requirements
}

/** Same reviewed index, deterministically presented to the implementation Agent.
 * No inferred task graph, copied business rules, or author-awarded completion. */
export function readDesignImplementationChecklist(workspace: string) {
  const check = checkDesignHandoff(workspace, PROJECT_DOCUMENTS)
  if (!check.valid) throw new Error(check.issues.join('; '))
  let registry: ReturnType<typeof parseBeeGameContentIndex> | undefined
  try { registry = parseBeeGameContentIndex(JSON.parse(readRetained(workspace, 'content/index.json').toString('utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (registry) {
    // Legacy registries may omit documents metadata; use the actual saved
    // documents, as acceptance already does, rather than trusting labels.
    const sources = registry.files.map(file => ({ path: 'content/' + file,
      kind: parseBeeGameContentDocument(JSON.parse(readRetained(workspace, 'content/' + file).toString('utf8'))).kind }))
    const ui = sources.filter(entry => entry.kind.startsWith('ui-')).map(entry => entry.path)
    const scenes = sources.filter(entry => entry.kind.startsWith('scene-')).map(entry => entry.path)
    const issues = designContentLinkIssues(workspace, ui, scenes)
    if (issues.length) throw new Error(issues.join('; '))
  }
  const requirements = readDesignAcceptanceRequirements(workspace)
  const { handoff } = documentHandoff(workspace, 'TECHNICAL_DESIGN.md', readRetained(workspace, 'docs/TECHNICAL_DESIGN.md').toString('utf8'))
  return { source: designHandoffPath('TECHNICAL_DESIGN.md'), designRevision: check.revision,
    globalSources: PROJECT_DOCUMENTS.map(document => `docs/${document}`),
    resultPath: DESIGN_ACCEPTANCE_PATH,
    items: handoff.implementationItems!.map(item => ({ id: item.id,
      ...(item.dependsOn !== undefined ? { dependsOn: item.dependsOn } : {}),
      taskSource: { document: 'docs/TECHNICAL_DESIGN.md', section: item.section },
      requirements: item.requirementRefs.map(ref => {
        const source = requirements.find(requirement => requirement.document === ref.document && requirement.id === ref.id)!
        return { document: source.document, id: source.id, sourceSection: source.outputSection, acceptanceSection: source.section, method: source.method }
      }),
    })),
    limitation: 'This is a required task/source checklist, not proof of original completeness, semantic grouping, implementation or truthful observation. Read task paragraphs, original owner clauses, global constraints and actual data. Reuse still-valid evidence; report unverified outcomes honestly.' }
}
/** An explicitly revised owner may affect its existing task consumer. The
 * exact technical document/index enter the same revision scope, not all docs. */
export function designImplementationRevisionDocuments(workspace: string, documents: readonly DesignDocument[]) {
  const scope = [...new Set(documents)]
  const supporting = new Map<DesignDocument, readonly string[]>(PROJECT_DOCUMENTS.map(name => {
    try { return [name, designSupportingFiles(workspace, [name])] as const }
    catch { return [name, []] as const }
  }))
  // A correction can invalidate another owner's retained calculation. Follow
  // existing recorded inputs before dispatch, including chained appendices;
  // no model-selected dependency list and no blanket document grant.
  let previousSize: number
  do {
    previousSize = scope.length
    if (!scope.includes('TECHNICAL_DESIGN.md')) try {
      const { handoff } = documentHandoff(workspace, 'TECHNICAL_DESIGN.md', readRetained(workspace, 'docs/TECHNICAL_DESIGN.md').toString('utf8'))
      if (handoff.implementationItems?.some(item => item.requirementRefs.some(ref => scope.includes(ref.document))))
        scope.push('TECHNICAL_DESIGN.md')
    } catch { /* Malformed task sources have their own structural repair diagnostic. */ }
    const changedInputs = new Set(scope.flatMap(name => [`docs/${name}`, designHandoffPath(name), ...supporting.get(name) ?? []]))
    for (const [name, files] of supporting) {
      if (scope.includes(name)) continue
      if (files.some(file => {
        if (!file.startsWith('docs/calc/') || !file.endsWith('.md')) return false
        try { return readCalculationInputs(workspace, file).some(input => changedInputs.has(input)) }
        catch { return false } // Unrecorded/malformed evidence cannot establish dependencies.
      })) scope.push(name)
    }
  } while (scope.length !== previousSize)
  return scope
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

/** Host locations from findings, registered outcomes and actual revision changes. */
export function designReviewReadScope(workspace: string, documents: readonly string[], findings: readonly DesignFinding[],
  changed: Record<string, string[] | null> = {}): Record<string, string[] | null> {
  const scope: Record<string, string[] | null> = {}
  const sources = findings.filter(finding => finding.documents.some(name => documents.includes(name)) ||
    finding.sources.some(source => documents.includes(source.document))).flatMap(finding => finding.sources)
  const names = [...new Set([...documents, ...sources.map(source => source.document)])]
  const indexes = designReviewIndexes(workspace, names)
  const affectedOutputs = new Set<string>()
  const located = sources.length > 0 || Object.keys(changed).length > 0
  for (const name of names) {
    const index = indexes.find(index => index.document === name)
    const own = index && 'outputs' in index ? index : undefined
    const headings = new Set([...sources.filter(source => source.document === name).map(source => source.section), ...changed[name] ?? []])
    let sections: ReturnType<typeof designDocumentSections> = []
    try { sections = designDocumentSections(readRetained(workspace, 'docs/' + name).toString('utf8')) } catch { /* Full-source diagnostic below. */ }
    // Unknown/moved sources and unlocated structural failures retain full reads.
    // Permission to edit a consumer alone does not require all its output clauses.
    if (!own || !sections.length || changed[name] === null || !located ||
        [...headings].some(heading => sections.filter(section => section.heading === heading).length !== 1)) {
      scope[name] = null
      for (const output of own?.outputs ?? []) affectedOutputs.add(name + '#' + output.id)
      continue
    }
    const selected = sections.filter(section => headings.has(section.heading))
    const overlaps = (heading: string) => sections.some(section => section.heading === heading &&
      selected.some(source => source.start <= section.end && section.start <= source.end))
    for (const output of own.outputs) {
      if (!overlaps(output.section) && !(output.acceptance && overlaps(output.acceptance.section))) continue
      affectedOutputs.add(name + '#' + output.id)
      headings.add(output.section)
      if (output.acceptance) headings.add(output.acceptance.section)
    }
    // [] means no initial mandatory clauses, not a whole-file read. Actual
    // edits outside this selection are still detected at the native stop check.
    scope[name] = [...headings]
  }
  for (const index of indexes) {
    if (!('outputs' in index) || scope[index.document] === null) continue
    for (const item of index.implementationItems ?? [])
      if (item.requirementRefs.some(ref => affectedOutputs.has(ref.document + '#' + ref.id)))
        scope[index.document] = [...new Set([...scope[index.document] ?? [], item.section])]
  }
  return scope
}

export function changedDesignSections(workspace: string, before: DesignDocumentSnapshot): Record<string, string[] | null> {
  const changes: Record<string, string[] | null> = {}
  for (const [name, previous] of Object.entries(before.documents)) {
    const current = materialDocument(workspace, name as DesignDocument)
    if (current.contentHash === previous!.contentHash) continue
    if (!previous!.sections || !current.sections ||
        Object.keys(previous!.sections).join('\n') !== Object.keys(current.sections).join('\n')) {
      changes[name] = null; continue
    }
    changes[name] = Object.keys(current.sections).filter(heading => current.sections![heading] !== previous!.sections![heading])
  }
  return changes
}

/** Current pointers only, not another authority or semantic verdict. This
 * replaces serial metadata reads; the reviewer still reads the saved prose
 * and actual evidence. Malformed indexes retain the host's revision path. */
export function designReviewIndexes(workspace: string, documents: readonly string[], scope?: Record<string, string[] | null>) {
  return documents.map(name => {
    if (!PROJECT_DOCUMENTS.some(document => document === name)) throw new Error('Unknown design document')
    try {
      const body = readRetained(workspace, `docs/${name}`).toString('utf8')
      const { handoff, issues } = documentHandoff(workspace, name as DesignDocument, body, true)
      const headings = scope?.[name]
      const sections = designDocumentSections(body)
      // Unknown/moved headings keep the full source fallback, just as the
      // reading contract does. [] explicitly selects no mandatory material.
      const full = headings === undefined || headings === null || headings.some(heading =>
        sections.filter(section => section.heading === heading).length !== 1)
      const selected = sections.filter(section => headings?.includes(section.heading))
      const includes = (heading: string) => full || sections.some(section => section.heading === heading &&
        selected.some(source => source.start <= section.end && section.start <= source.end))
      // Give native Read its actual source coordinates. Do not force the model
      // to grep headings or parse tool archives just to locate assigned text.
      // These hints never count as having read the file, and edits invalidate them.
      const ranges: { offset: number; limit: number }[] = []
      const sourceRanges = full ? [{ start: 1, end: body.replace(/\r(?=\n|$)/g, '').split('\n').length }] : selected
      for (const section of [...sourceRanges].sort((a, b) => a.start - b.start)) {
        const previous = ranges.at(-1)
        if (previous && section.start <= previous.offset + previous.limit)
          previous.limit = Math.max(previous.offset + previous.limit - 1, section.end) - previous.offset + 1
        else ranges.push({ offset: section.start, limit: section.end - section.start + 1 })
      }
      return { document: name, ...(issues.length ? { issues } : {}), sourceReads: ranges.map(range => ({ file_path: 'docs/' + name, ...range })),
        outputs: handoff.outputs.filter(output => includes(output.section) ||
          !!output.acceptance && includes(output.acceptance.section)),
        ...(handoff.implementationItems ? { implementationItems: handoff.implementationItems.filter(item => includes(item.section)) } : {}),
        evidence: full || selected.length ? handoff.evidence.map(({ sha256: _hash, ...source }) => source) : [] }
    } catch { return { document: name, unavailable: 'Index unavailable/malformed; use the host structural revision scope, not invented pointers.' } }
  })
}

/** Locations are checkable; the finding's semantic merit is not. */
export function checkDesignFindingSources(workspace: string, findings: DesignFinding[]) {
  return designFindingSourceIssues(findings, designReviewSourceHeadings(workspace, findings.flatMap(f => f.sources.map(s => s.document))))
}
