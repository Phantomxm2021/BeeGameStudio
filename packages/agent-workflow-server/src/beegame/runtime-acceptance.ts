import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod/v4'
import { contentRuntimeCheckSchema } from './content-runtime-contract'
import { parseBeeGameContentDocument, parseBeeGameContentIndex } from './game-content-schema'
import { auditUiInteractiveBounds, readUiLayoutCameras } from './ui-layout-audit'
import { designHandoffPath, readDesignAcceptanceRequirements } from './design-handoff'
import { PROJECT_DOCUMENTS } from './project-content-authority'
import { designReviewResultSchema, type DesignFinding } from './design-handoff'

export const DESIGN_RUNTIME_REPORT_INSTRUCTION = 'The reviewed .beegame/design-handoffs/<document stem>.json is a small output/acceptance index; the pointed prose section owns each expectation. For outputs declaring acceptance, verification.requirementChecks records actual results: {document:design filename,id:owned output ID,documentSha256:SHA-256 of current docs/<document> bytes,handoffSha256:SHA-256 of its current index JSON bytes,method:"test"|"target-runtime"|"inspection",scenario:actual conditions/actions checked,observed:actual outcome,status:"passed"|"failed"|"unverified",evidencePaths:string[]}. Read the acceptance section for the expected result; do not invent an easier expectation in the report. Cover all declared requirements and their applicable scenarios, matching the source method and version. Existing reusable tests/observations may supply results; this is not a new stage or a separate test plan. Every evidence path must also appear in the report evidencePaths. Report failed or unverified checks honestly; they cannot accompany a delivery PASS. Evidence records must be actual test logs, runtime observations/captures or direct inspections, not a review verdict or copied design prose. Host-maintained design versions/hashes and structural coverage do not establish truthful observation, complete requirements or game quality.'

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
export async function readRuntimeAcceptanceReport(workspace: string, reportPath: string): Promise<RuntimeAcceptance | undefined> {
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
    const report = reportSchema.parse(raw)
    let limitation = report.scope !== 'request' && report.status === 'passed'
      ? deliveryLimitation(report) : undefined
    if (report.designIssues?.length && report.status === 'passed')
      limitation = diagnostic('product-failed', 'Design issues remain unresolved; a passed report cannot release them.')
    if (report.scope !== 'request' && report.status === 'passed' && !report.artifactPaths?.length)
      limitation ??= diagnostic('verification-incomplete', 'The tested deployment artifacts are not recorded.')
    if (report.scope !== 'request' && report.status === 'passed' && !limitation)
      limitation = await contentBindingLimitation(workspace, report.verification, report.evidencePaths)
    if (report.scope !== 'request' && report.status === 'passed' && !limitation)
      limitation = designRequirementLimitation(workspace, report.verification, report.evidencePaths)
    if (report.status === 'passed' && report.scope !== 'request' && !report.evidencePaths.length)
      throw new Error('Passed runtime acceptance requires saved evidence')
    const evidence = await Promise.all([...new Set(report.evidencePaths)].map(async path => {
      if (path === reportPath) throw new Error('The acceptance report cannot be its own evidence')
      return { path, sha256: await artifactDigest(workspace, path) }
    }))
    // Bind the actual tested output, even when build directories are excluded
    // from source identity. No build command, output layout or engine is imposed.
    const artifacts = await Promise.all([...new Set(report.artifactPaths ?? [])].map(async path =>
      ({ path, sha256: await artifactDigest(workspace, path, true) })))
    return { ...(report.scope ? { scope: report.scope } : {}),
      ...(report.verification ? { verification: report.verification } : {}),
      ...(report.designIssues ? { designIssues: report.designIssues } : {}),
      status: limitation ? 'blocked' : report.status,
      diagnostic: limitation ?? (report.status === 'failed' ? diagnostic('product-failed', report.summary)
        : report.status === 'blocked' ? diagnostic('verification-incomplete', report.summary) : undefined),
      summary: limitation?.message ?? report.summary,
      environment: report.environment, evidence, artifacts }
  } catch (error) { return blocked(error) }
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

/** Checks declared requirement coverage/version, not the truth of an observation
 * or whether the author declared all necessary release requirements. */
function designRequirementLimitation(workspace: string, verification: z.infer<typeof verificationSchema> | undefined, evidencePaths: string[]): AcceptanceDiagnostic | undefined {
  const requirements = readDesignAcceptanceRequirements(workspace)
  const checks = verification?.requirementChecks ?? []
  for (const check of checks) {
    const source = requirements.find(requirement => requirement.document === check.document && requirement.id === check.id)
    if (!source) return diagnostic('report-invalid', `Requirement check has no declared acceptance source: ${check.document}#${check.id}.`)
    if (source.documentSha256 !== check.documentSha256 || source.handoffSha256 !== check.handoffSha256)
      return diagnostic('verification-incomplete', `Requirement source changed: ${check.document}#${check.id}; revalidate affected evidence against the current design.`)
    if (source.method !== check.method)
      return diagnostic('report-invalid', `Requirement ${check.document}#${check.id} requires ${source.method}, not ${check.method}.`)
    if (check.status !== 'passed')
      return diagnostic(check.status === 'failed' ? 'product-failed' : 'verification-incomplete', `Requirement ${check.document}#${check.id} is ${check.status}: ${check.observed}`)
    if (check.evidencePaths.some(path => !evidencePaths.includes(path) || path === `docs/${check.document}` || path === designHandoffPath(check.document)))
      return diagnostic('report-invalid', `Requirement ${check.document}#${check.id} needs recorded result evidence, not its design source.`)
  }
  const missing = requirements.filter(source => !checks.some(check => check.document === source.document && check.id === source.id))
  if (missing.length) return diagnostic('verification-incomplete', `Design requirements are unverified: ${missing.map(source => `${source.document}#${source.id}`).join(', ')}.`)
}

/** Verify coverage and evidence identity, not source-code patterns or claimed
 * visual correctness. The Agent remains responsible for the observed result. */
async function contentBindingLimitation(workspace: string, verification: z.infer<typeof verificationSchema> | undefined, evidencePaths: string[]): Promise<AcceptanceDiagnostic | undefined> {
  const indexPath = 'content/index.json'
  try { await artifactDigest(workspace, indexPath) }
  catch (error) {
    if (((error as Error).cause as NodeJS.ErrnoException)?.code === 'ENOENT') return
    throw error
  }
  const index = parseBeeGameContentIndex(JSON.parse(await readFile(resolve(workspace, indexPath), 'utf8')))
  const required = new Map<string, Set<string>>()
  const nodeIds = new Map<string, Set<string>>()
  const tilemapNodes = new Map<string, Set<string>>()
  const add = (kind: string, path: string) => {
    if (!required.has(kind)) required.set(kind, new Set())
    required.get(kind)!.add(path)
  }
  for (const file of index.files) {
    if (isAbsolute(file) || file.replaceAll('\\', '/').split('/').includes('..'))
      throw new Error(`Invalid content path: ${file}`)
    const path = `content/${file}`
    await artifactDigest(workspace, path)
    const document = parseBeeGameContentDocument(JSON.parse(await readFile(resolve(workspace, path), 'utf8')))
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
  const checks = verification?.contentChecks ?? []
  for (const check of checks) {
    if (!required.get(check.kind)?.has(check.document)) return diagnostic('report-invalid', `Content binding check does not reference applicable registered content: ${check.kind}, ${check.document}.`)
    if (!nodeIds.get(check.document)?.has(check.nodeId)) return diagnostic('report-invalid', `Content binding check references an unknown node: ${check.document}, ${check.nodeId}.`)
    if (check.property === 'tilemap' && !tilemapNodes.get(check.document)?.has(check.nodeId))
      return diagnostic('report-invalid', `Content binding tilemap check references a node without a Tilemap: ${check.document}, ${check.nodeId}.`)
    if (check.status !== 'passed') return diagnostic(check.status === 'failed' ? 'product-failed' : 'verification-incomplete', `Content binding ${check.kind} is ${check.status}: ${check.observed}`)
    if (check.evidencePaths.some(path => !evidencePaths.includes(path)))
      return diagnostic('report-invalid', `Content binding ${check.kind} evidence must be included in evidencePaths.`)
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

export async function runtimeEvidenceIsCurrent(workspace: string, reports: RuntimeAcceptance[]): Promise<boolean> {
  if (!reports.length) return false
  try {
    for (const report of reports) {
      if (report.scope === 'request' || report.status !== 'passed' || !report.summary?.trim() || !report.environment?.trim() || !report.evidence?.length) return false
      if (deliveryLimitation(report)) return false
      if (await contentBindingLimitation(workspace, report.verification, report.evidence.map(file => file.path))) return false
      if (designRequirementLimitation(workspace, report.verification, report.evidence.map(file => file.path))) return false
      if (!report.artifacts?.length) return false
      for (const artifact of report.evidence)
        if (await artifactDigest(workspace, artifact.path) !== artifact.sha256) return false
      for (const artifact of report.artifacts)
        if (await artifactDigest(workspace, artifact.path, true) !== artifact.sha256) return false
    }
    return true
  } catch { return false }
}
