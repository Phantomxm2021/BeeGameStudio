import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod/v4'
import { contentRuntimeCheckSchema } from './content-runtime-contract'
import { parseBeeGameContentDocument, parseBeeGameContentIndex, isContentEntryKind } from './game-content-schema'
import { auditUiInteractiveBounds, readUiLayoutCameras } from './ui-layout-audit'
import { checkDesignHandoff, DESIGN_ACCEPTANCE_PATH, designHandoffPath, designSupportingFiles, designContentLinkIssues, isDesignUiFile, isDesignSceneFile, readDesignAcceptanceRequirements } from './design-handoff'
import { PROJECT_DOCUMENTS } from './project-content-authority'
import { designReviewResultSchema, type DesignFinding } from './design-handoff'
import { projectFiles, projectDependencies, changedProjectPaths, AGENT_EVIDENCE_DIRECTORY } from './workflow-v3/checks'
import { projectPathSchema } from './workflow-v3/state'

export const DESIGN_RUNTIME_REPORT_INSTRUCTION = 'Compare actual results with confirmed requirements and original design sources. Record real test/runtime/inspection evidence, knownIssues and unverified outcomes; a model declaration is not independent acceptance. Existing indexed requirementChecks remain supported with their original document/id, source hashes, method, scenario, observed result, status and evidencePaths. For a delivery PASS, include a passed check for every existing design output that declares acceptance; empty or partial coverage is verification-incomplete. Request-scoped reports may remain local or partial. Do not create indexes or coverage mappings to write a report. Every cited evidence path must appear in evidencePaths. Failed or unverified checks cannot support PASS. BGS validates retained evidence and data contracts, not complete requirements, truthful observations or visual/game quality.'


const requirementCheckSchema = z.object({
  document: z.enum(PROJECT_DOCUMENTS), id: z.string().trim().min(1),
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  handoffSha256: z.string().regex(/^[a-f0-9]{64}$/),
  method: z.enum(['test', 'target-runtime', 'inspection']),
  scenario: z.string().trim().min(1), observed: z.string().trim().min(1),
  status: z.enum(['passed', 'failed', 'unverified']),
  evidencePaths: z.array(z.string().trim().min(1)).min(1),
}).strict()

// A result record, not a test plan: the Agent chooses its own checks/tools.
const verificationSchema = z.object({
  target: z.enum(['development', 'deployment']),
  observation: z.enum(['target-runtime', 'simulation']).optional(),
  knownIssues: z.array(z.string().trim().min(1)),
  unverified: z.array(z.string().trim().min(1)),
  outsideScope: z.array(z.string().trim().min(1)).optional(),
  contentChecks: z.array(contentRuntimeCheckSchema).optional(),
  requirementChecks: z.array(requirementCheckSchema).optional(),
  designRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
})
const reportSchema = z.object({
  scope: z.enum(['request', 'delivery']).optional(),
  status: z.enum(['passed', 'failed', 'blocked']),
  summary: z.string().trim().min(1),
  environment: z.string().trim().min(1),
  evidencePaths: z.array(z.string().trim().min(1)),
  artifactPaths: z.array(z.string().trim().min(1)).optional(),
  verification: verificationSchema.optional(),
  designIssues: designReviewResultSchema.shape.findings.optional(),
})
export type RuntimeAcceptance = {
  scope?: 'request' | 'delivery'
  declaredStatus?: 'passed' | 'failed' | 'blocked'
  status: 'passed' | 'failed' | 'blocked'
  diagnostic?: AcceptanceDiagnostic
  summary: string
  environment: string
  verification?: z.infer<typeof verificationSchema>
  evidence: Array<{ path: string; sha256: string }>
  artifacts?: Array<{ path: string; sha256: string }>
  designIssues?: DesignFinding[]
}

export type AcceptanceDiagnostic = {
  category: 'report-invalid' | 'verification-incomplete' | 'product-failed'
  message: string
}
const diagnostic = (category: AcceptanceDiagnostic['category'], message: string): AcceptanceDiagnostic => ({ category, message })

type ExecutionIdentity = { runId: string; requirementsRevision: string }
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const executionSnapshotSchema = z.object({
  status: z.literal('observed'), scriptSha256: sha256,
  inputs: z.object({ runId: z.string().min(1), requirementsRevision: z.string().min(1),
    files: z.array(z.object({ path: projectPathSchema, sha256 })).min(1), dependencySha256: sha256.optional() }),
})

/** Validate only known Preview receipts used to support a passed check. Other
 * attachments can retain failed history; arbitrary logs are not parsed as verdicts. */
async function previewEvidenceLimitation(workspace: string, verification: z.infer<typeof verificationSchema> | undefined,
  evidencePaths: string[], identity?: ExecutionIdentity) {
  const checks = [...(verification?.requirementChecks ?? []), ...(verification?.contentChecks ?? [])]
  const supportingPaths = checks.length ? checks.filter(check => check.status === 'passed').flatMap(check => check.evidencePaths) : evidencePaths
  const receipts = new Set<string>()
  const root = await realpath(workspace)
  for (const path of supportingPaths) {
    // Recognize stdout/stderr too: citing the log must not bypass its execution result.
    const normalized = relative(root, await realpath(resolve(root, path))).split('\\').join('/')
    const match = /^(\.beegame\/tmp\/preview-test-[^/]+)\/(?:execution\.json|stdout\.txt|stderr\.txt)$/.exec(normalized)
    if (match) receipts.add(match[1] + '/execution.json')
  }
  const retained: string[] = []
  let current: { files: Awaited<ReturnType<typeof projectFiles>>; dependencySha256?: string } | undefined
  const incomplete = (path: string, reason: string) => ({ evidencePaths: retained,
    diagnostic: diagnostic('verification-incomplete', `Preview evidence ${path}: ${reason}`) })
  for (const path of receipts) {
    try {
      const file = resolve(root, path)
      await artifactDigest(root, path)
      if (await realpath(file) !== file) throw Error('Execution receipt must not resolve through an alias')
      const receipt = JSON.parse(await readFile(file, 'utf8'))
      if (receipt.status !== 'exited' || receipt.exitCode !== 0 || receipt.signal != null || !receipt.finishedAt)
        return incomplete(path, `execution did not succeed (${receipt.status ?? 'missing status'}, exit ${receipt.exitCode ?? 'unknown'}); cannot support PASS.`)
      const before = executionSnapshotSchema.safeParse(receipt.before), after = executionSnapshotSchema.safeParse(receipt.after)
      if (!before.success || !after.success || receipt.inputIdentity !== 'unchanged-at-boundaries')
        return incomplete(path, 'Execution input identity is missing, changed or unverified.')
      // Do not trust the summary flag when the retained boundaries contradict it.
      if (JSON.stringify(receipt.before) !== JSON.stringify(receipt.after))
        return incomplete(path, 'Inputs changed during execution; cannot establish an unchanged tested version.')
      if (identity && (after.data.inputs.runId !== identity.runId || after.data.inputs.requirementsRevision !== identity.requirementsRevision))
        return incomplete(path, 'Run or requirements identity changed; the receipt is stale.')
      const script = z.string().min(1).parse(receipt.script), scriptFile = resolve(root, script)
      const scriptSha256 = await artifactDigest(root, script)
      if (await realpath(scriptFile) !== scriptFile) throw Error('Test script must not resolve through an alias')
      current ??= { files: await projectFiles(root, '', [AGENT_EVIDENCE_DIRECTORY]), dependencySha256: await projectDependencies(root) }
      const changes = { sources: changedProjectPaths(after.data.inputs.files, current.files),
        script: after.data.scriptSha256 !== scriptSha256, dependencies: after.data.inputs.dependencySha256 !== current.dependencySha256 }
      if (changes.sources.length || changes.script || changes.dependencies)
        return incomplete(path, 'Tested inputs changed: ' + [changes.script ? 'test script' : '',
          changes.dependencies ? 'dependencies' : '', ...changes.sources].filter(Boolean).join(', '))
      const directory = path.slice(0, -'execution.json'.length)
      if (receipt.reportPath !== path || receipt.stdoutPath !== directory + 'stdout.txt' || receipt.stderrPath !== directory + 'stderr.txt')
        throw Error('Execution/output paths do not match the retained receipt')
      // Bind the receipt and both logs even when the author cited only stdout.
      // A later read must not accept rewritten evidence with unchanged game bytes.
      for (const evidence of [path, receipt.stdoutPath, receipt.stderrPath]) {
        if (await realpath(resolve(root, evidence)) !== resolve(root, evidence)) throw Error('Execution output must not resolve through an alias')
        await artifactDigest(root, evidence)
        retained.push(evidence)
      }
    } catch (error) {
      return { evidencePaths: retained, diagnostic: diagnostic('report-invalid',
        `Invalid Preview evidence ${path}: ${error instanceof Error ? error.message : String(error)}`) }
    }
  }
  return { evidencePaths: retained, diagnostic: undefined }
}

export async function artifactDigest(workspace: string, path: string, allowDirectory = false): Promise<string> {
  if (isAbsolute(path) || path.replaceAll('\\', '/').split('/').includes('..'))
    throw new Error('Runtime evidence must be a workspace-relative file')
  const root = await realpath(workspace)
  const digest = async (candidate: string, ancestors: Set<string>): Promise<string> => {
    const target = await realpath(candidate)
    const rel = relative(root, target)
    if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel))
      throw new Error(`Runtime evidence resolves outside the workspace: ${path}`)
    const info = await stat(target)
    if (info.isFile()) return createHash('sha256').update(await readFile(target)).digest('hex')
    if (!info.isDirectory() || !allowDirectory)
      throw new Error(`Runtime evidence must be a regular file: ${relative(root, candidate)}`)
    if (ancestors.has(target)) throw new Error(`Runtime artifact directory contains a cycle: ${path}`)
    const parents = new Set([...ancestors, target])
    const hash = createHash('sha256').update('directory\n')
    // Sort names and include them in the hash: edits, additions, removals and
    // renames all invalidate the tested output. Walk sequentially to bound I/O.
    for (const name of (await readdir(target)).sort()) {
      hash.update(JSON.stringify([name, await digest(resolve(target, name), parents)]) + '\n')
    }
    return hash.digest('hex')
  }
  try { return await digest(resolve(root, path), new Set()) }
  catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }) }
}

/** Read an Agent-authored result at a fixed project path, without a workflow dispatch. */
export async function readRuntimeAcceptanceReport(workspace: string, reportPath: string,
  options: { requireDesignRevision?: boolean; requireEditableContent?: boolean; executionIdentity?: ExecutionIdentity } = {}): Promise<RuntimeAcceptance | undefined> {
  let text: string
  try {
    await artifactDigest(workspace, reportPath) // Reject symlink escapes before reading the report.
    text = await readFile(resolve(workspace, reportPath), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' ||
        ((error as Error).cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return undefined
    return blocked(error)
  }
  try {
    const raw: unknown = JSON.parse(text)
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'contentChecks' in raw)
      throw new Error('contentChecks must be inside verification.contentChecks, not at the report top level')
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'requirementChecks' in raw)
      throw new Error('requirementChecks must be inside verification.requirementChecks, not at the report top level')
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'designRevision' in raw)
      throw new Error('designRevision must be inside verification.designRevision, not at the report top level')
    const report = reportSchema.parse(raw)
    let limitation = report.scope !== 'request' && report.status === 'passed'
      ? deliveryLimitation(report) : undefined
    if (report.scope !== 'request' && report.status === 'passed' && !limitation &&
        (options.requireDesignRevision || report.verification?.designRevision !== undefined)) {
      if (report.verification?.designRevision === undefined)
        limitation = diagnostic('verification-incomplete', 'verification.designRevision is missing; record the design version actually verified (existing implementation handoff: designRevision; read-only --design baseline: revision).')
      else {
        const design = checkDesignHandoff(workspace, PROJECT_DOCUMENTS)
        if (!design.valid) limitation = diagnostic('verification-incomplete', 'Design handoff is incomplete: ' + design.issues.join('; '))
        else if (report.verification.designRevision !== design.revision)
          limitation = diagnostic('verification-incomplete', 'verification.designRevision does not match the current design revision; revalidate affected evidence before updating this field. Changing the hash alone does not establish verification.')
      }
    }
    if (report.designIssues?.length && report.status === 'passed')
      limitation = diagnostic('product-failed', 'Design issues remain unresolved; a passed report cannot release them.')
    if (report.scope !== 'request' && report.status === 'passed' && !report.artifactPaths?.length)
      limitation ??= diagnostic('verification-incomplete', 'The tested deployment artifacts are not recorded.')
    if (report.scope !== 'request' && report.status === 'passed' && !limitation)
      limitation = await contentBindingLimitation(workspace, report.verification, report.evidencePaths, options.requireEditableContent,
        options.requireDesignRevision || report.verification?.designRevision !== undefined)
    if (report.scope !== 'request' && report.status === 'passed' && !limitation)
      limitation = await designRequirementLimitation(workspace, report.verification, report.evidencePaths)
    const previewEvidence = report.status === 'passed' && !limitation
      ? await previewEvidenceLimitation(workspace, report.verification, report.evidencePaths, options.executionIdentity) : undefined
    limitation ??= previewEvidence?.diagnostic
    if (report.status === 'passed' && report.scope !== 'request' && !report.evidencePaths.length)
      throw new Error('Passed runtime acceptance requires saved evidence')
    const reportFile = await realpath(resolve(workspace, reportPath))
    const evidence = await Promise.all([...new Set([...report.evidencePaths, ...(previewEvidence?.evidencePaths ?? [])])].map(async path => {
      if (await realpath(resolve(workspace, path)) === reportFile) throw new Error('The acceptance report cannot be its own evidence')
      return { path, sha256: await artifactDigest(workspace, path) }
    }))
    // Bind the actual tested output, even when build directories are excluded
    // from source identity. No build command, output layout or engine is imposed.
    const artifacts = await Promise.all([...new Set(report.artifactPaths ?? [])].map(async path =>
      ({ path, sha256: await artifactDigest(workspace, path, true) })))
    return { ...(report.scope ? { scope: report.scope } : {}),
      declaredStatus: report.status,
      ...(report.verification ? { verification: report.verification } : {}),
      ...(report.designIssues ? { designIssues: report.designIssues } : {}),
      status: limitation ? 'blocked' : report.status,
      diagnostic: limitation ?? (report.status === 'failed' ? diagnostic('product-failed', report.summary)
        : report.status === 'blocked' ? diagnostic('verification-incomplete', report.summary) : undefined),
      summary: limitation?.message ?? report.summary,
      environment: report.environment, evidence, artifacts }
  } catch (error) { return blocked(error) }
}

/** Read-only view of the existing delivery report. Valid means declared
 * coverage/version/evidence integrity, never independent aesthetic approval. */
export async function inspectDesignAcceptance(workspace: string, requireDesignRevision = false, requireEditableContent = false, executionIdentity?: ExecutionIdentity) {
  const report = await readRuntimeAcceptanceReport(workspace, DESIGN_ACCEPTANCE_PATH,
    {requireDesignRevision,requireEditableContent,executionIdentity})
  const checks = report?.verification?.requirementChecks ?? []
  return {path:DESIGN_ACCEPTANCE_PATH, valid:report?.scope === 'delivery' && report.status === 'passed',
    status:report?.status ?? 'unverified',scope:report?.scope,
    declaredStatus:report?.declaredStatus,
    summary:report?.summary ?? 'No runtime acceptance report is recorded; runtime verification is unverified.',
    diagnostic:report?.diagnostic,
    // Preserve author declarations, including absent coverage. An empty legacy
    // requirement index cannot stand in for the report's unresolved items.
    verification:report?.verification,
    requirementChecks:checks,
    evidence:report?.evidence ?? [],artifacts:report?.artifacts ?? [],
    quality:'unverified' as const,
    note:'Reported checks, current design revision and retained evidence integrity only. Missing indexes/checks do not establish coverage. Observation truth, original semantic completeness, visual restoration and experience quality remain unverified by this read.'}
}

function deliveryLimitation(report: { verification?: z.infer<typeof verificationSchema> }): AcceptanceDiagnostic | undefined {
  const checked = verificationSchema.safeParse(report.verification)
  if (!checked.success) return diagnostic('verification-incomplete', 'Delivery verification coverage is not recorded; this is not a full delivery pass.')
  if (checked.data.target !== 'deployment') return diagnostic('verification-incomplete', 'Development verification does not establish deployment readiness.')
  if (checked.data.observation !== 'target-runtime')
    return diagnostic('verification-incomplete', 'Delivery requires verification in the actual target runtime; simulated checks alone are insufficient.')
  if (checked.data.knownIssues.length)
    return diagnostic('product-failed', `Delivery still has known issues: ${checked.data.knownIssues.join('; ')}`)
  if (checked.data.unverified.length)
    return diagnostic('verification-incomplete', `Delivery still has unverified requirements: ${checked.data.unverified.join('; ')}`)
}

/** Checks declared requirement coverage/version for delivery reports, not the
 * truth of an observation or semantic completeness of ordinary prose. */
async function designRequirementLimitation(workspace: string, verification: z.infer<typeof verificationSchema> | undefined, evidencePaths: string[]): Promise<AcceptanceDiagnostic | undefined> {
  const requirements = readDesignAcceptanceRequirements(workspace)
  const checks = verification?.requirementChecks ?? []
  const seen = new Set<string>()
  for (const check of checks) {
    const key = check.document + '#' + check.id
    if (seen.has(key)) return diagnostic('report-invalid','Duplicate requirement check: ' + key)
    seen.add(key)
    const source = requirements.find(requirement => requirement.document === check.document && requirement.id === check.id)
    if (!source) return diagnostic('report-invalid', `Requirement check has no declared acceptance source: ${check.document}#${check.id}.`)
    if (source.documentSha256 !== check.documentSha256 || source.handoffSha256 !== check.handoffSha256)
      return diagnostic('verification-incomplete', `Requirement source changed: ${check.document}#${check.id}; revalidate affected evidence against the current design.`)
    if (source.method !== check.method)
      return diagnostic('report-invalid', `Requirement ${check.document}#${check.id} requires ${source.method}, not ${check.method}.`)
    if (check.status !== 'passed')
      return diagnostic(check.status === 'failed' ? 'product-failed' : 'verification-incomplete', `Requirement ${check.document}#${check.id} is ${check.status}: ${check.observed}`)
    if (check.evidencePaths.some(path => !evidencePaths.includes(path)))
      return diagnostic('report-invalid', `Requirement ${check.document}#${check.id} needs recorded result evidence, not its design source.`)
    const sources = await Promise.all([`docs/${check.document}`, designHandoffPath(check.document)].map(path => realpath(resolve(workspace, path))))
    for (const path of check.evidencePaths)
      if (sources.includes(await realpath(resolve(workspace, path))))
        return diagnostic('report-invalid', `Requirement ${check.document}#${check.id} needs recorded result evidence, not its design source.`)
  }
  const missing = requirements.filter(source => !seen.has(source.document + '#' + source.id))
  if (missing.length)
    return diagnostic('verification-incomplete', `Design requirements are unverified: ${missing.map(source => `${source.document}#${source.id}`).join(', ')}.`)

}

/** Verify coverage and evidence identity, not source-code patterns or claimed
 * visual correctness. The Agent remains responsible for the observed result. */
async function contentBindingLimitation(workspace: string, verification: z.infer<typeof verificationSchema> | undefined, evidencePaths: string[],
  requireEditableContent = false, bindDesignSources = verification?.designRevision !== undefined): Promise<AcceptanceDiagnostic | undefined> {
  // Reuse the owners' actual source links and the runtime registry, not another
  // checklist. Source-only/native projects remain valid when content is neither
  // required by the host nor declared by their design documents.
  const designUi = bindDesignSources ? designSupportingFiles(workspace, ['UI_UX_SPEC.md']).filter(isDesignUiFile) : []
  const designScenes = bindDesignSources ? designSupportingFiles(workspace, ['LEVEL_SCENE_DESIGN.md']).filter(isDesignSceneFile) : []
  const indexPath = 'content/index.json'
  try { await artifactDigest(workspace, indexPath) }
  catch (error) {
    if (((error as Error).cause as NodeJS.ErrnoException)?.code === 'ENOENT')
      return requireEditableContent || designUi.length || designScenes.length || verification?.contentChecks?.length
        ? diagnostic('verification-incomplete', 'Required, design-linked or checked editable content is missing: ' + indexPath) : undefined
    throw error
  }
  const index = parseBeeGameContentIndex(JSON.parse(await readFile(resolve(workspace, indexPath), 'utf8')))
  const authoredInputs = new Set([await realpath(resolve(workspace, indexPath))])
  const required = new Map<string, Set<string>>()
  const nodeIds = new Map<string, Set<string>>()
  const tilemapNodes = new Map<string, Set<string>>()
  const runtimeUi = new Set<string>(), runtimeScenes = new Set<string>()
  const add = (kind: string, path: string) => {
    if (!required.has(kind)) required.set(kind, new Set())
    required.get(kind)!.add(path)
  }
  for (const file of index.files) {
    if (isAbsolute(file) || file.replaceAll('\\', '/').split('/').includes('..'))
      throw new Error(`Invalid content path: ${file}`)
    const path = `content/${file}`
    await artifactDigest(workspace, path)
    authoredInputs.add(await realpath(resolve(workspace, path)))
    const document = parseBeeGameContentDocument(JSON.parse(await readFile(resolve(workspace, path), 'utf8')))
    if (bindDesignSources || requireEditableContent) {
      const entries = index.documents?.filter(entry => entry.path === file) ?? []
      if (entries.length !== 1 || entries[0]!.id !== document.id || entries[0]!.kind !== document.kind ||
          index.documents!.filter(entry => entry.id === document.id).length !== 1)
        return diagnostic('report-invalid', 'Runtime registry must identify the actual saved document: ' + path)
    }
    if (document.kind.startsWith('ui-')) runtimeUi.add(path)
    if (document.kind.startsWith('scene-')) runtimeScenes.add(path)
    nodeIds.set(path, new Set(document.data.nodes.map(node => node.id)))
    if (document.kind === 'ui-screen' || document.kind === 'ui-hud') {
      const geometryIssues = readUiLayoutCameras(workspace, document).flatMap(options => auditUiInteractiveBounds(document, options))
      if (geometryIssues.length)
        return diagnostic('product-failed', `Authored UI control geometry violates declared bounds or minima: ${path}: ${geometryIssues[0]}${geometryIssues.length > 1 ? ` (${geometryIssues.length - 1} more; run content validation)` : ''}`)
      add('ui-layout', path)
    }
    if (document.kind === 'scene-2d' || document.kind === 'scene-3d') {
      add('scene-layout', path)
      const ids = new Set(document.data.nodes.filter(node => node.components?.some(component => component.type === 'tilemap')).map(node => node.id))
      if (ids.size) tilemapNodes.set(path, ids)
    }
    if (document.assetRefs.length) add('resource-binding', path)
  }
  if (bindDesignSources || requireEditableContent) {
    if (index.documents?.length !== index.files.length ||
        !index.documents.some(entry => entry.id === index.entryScene && isContentEntryKind(entry.kind, index.dimension) && entry.loadPhase === 'startup'))
      return diagnostic('report-invalid', 'Runtime registry files and startup entryScene must agree')
    if (requireEditableContent && !index.documents.some(entry => entry.kind === 'ui-screen' || entry.kind === 'ui-hud'))
      return diagnostic('verification-incomplete', 'Required editable UI document must be registered')
  }
  if (bindDesignSources) {
    const issues = designContentLinkIssues(workspace, runtimeUi, runtimeScenes)
    if (issues.length) return diagnostic('verification-incomplete', issues.join('; '))
  }
  const checks = verification?.contentChecks ?? []
  for (const check of checks) {
    if (!required.get(check.kind)?.has(check.document)) return diagnostic('report-invalid', `Content binding check does not reference applicable registered content: ${check.kind}, ${check.document}.`)
    if (!nodeIds.get(check.document)?.has(check.nodeId)) return diagnostic('report-invalid', `Content binding check references an unknown node: ${check.document}, ${check.nodeId}.`)
    if (check.property === 'tilemap' && !tilemapNodes.get(check.document)?.has(check.nodeId))
      return diagnostic('report-invalid', `Content binding tilemap check references a node without a Tilemap: ${check.document}, ${check.nodeId}.`)
    if (check.status !== 'passed') return diagnostic(check.status === 'failed' ? 'product-failed' : 'verification-incomplete', `Content binding ${check.kind} is ${check.status}: ${check.observed}`)
    if (check.evidencePaths.some(path => !evidencePaths.includes(path)))
      return diagnostic('report-invalid', `Content binding ${check.kind} evidence must be included in evidencePaths.`)
    // Authored bytes describe the input, not the observed effect of consuming it.
    // Resolve aliases just as requirement evidence does; attachments may still
    // include sources when the actual check cites a separate runtime observation.
    for (const path of check.evidencePaths)
      if (authoredInputs.has(await realpath(resolve(workspace, path))))
        return diagnostic('report-invalid', `Content binding ${check.kind} needs a runtime observation, not authored content: ${path}.`)
  }
  const missing = [...required].flatMap(([kind, paths]) => [...paths].filter(document =>
    !checks.some(check => check.kind === kind && check.document === document &&
      (kind !== 'scene-layout' || check.property === 'transform'))).map(path => `${kind} (${path})`))
  for (const [document, nodes] of tilemapNodes) for (const nodeId of nodes)
    if (!checks.some(check => check.kind === 'scene-layout' && check.document === document && check.property === 'tilemap' && check.nodeId === nodeId))
      missing.push(`scene-layout/tilemap (${document}#${nodeId})`)
  if (missing.length) return diagnostic('verification-incomplete', `Content data consumption is unverified: ${missing.join(', ')}. Loading JSON or changing text alone does not verify layout/resource bindings.`)
}

function blocked(error: unknown): RuntimeAcceptance {
  const detail = error instanceof z.ZodError
    ? error.issues.slice(0, 8).map(issue => `${issue.path.join('.') || 'report'}: ${issue.message}`).join('; ')
    : error instanceof Error ? error.message : String(error)
  return { status: 'blocked',
    diagnostic: diagnostic('report-invalid', detail),
    summary: `Invalid runtime acceptance record: ${detail}`,
    environment: 'not-established', evidence: [] }
}
