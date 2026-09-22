import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod/v4'

// A result record, not a test plan: the Agent chooses its own checks/tools.
const verificationSchema = z.object({
  target: z.enum(['development', 'deployment']),
  knownIssues: z.array(z.string().trim().min(1)),
  unverified: z.array(z.string().trim().min(1)),
})
const reportSchema = z.object({
  scope: z.enum(['request', 'delivery']).optional(),
  status: z.enum(['passed', 'failed', 'blocked']),
  summary: z.string().trim().min(1),
  environment: z.string().trim().min(1),
  evidencePaths: z.array(z.string().trim().min(1)),
  artifactPaths: z.array(z.string().trim().min(1)).optional(),
  verification: verificationSchema.optional(),
})
export type RuntimeAcceptance = {
  scope?: 'request' | 'delivery'
  status: 'passed' | 'failed' | 'blocked'
  summary: string
  environment: string
  verification?: z.infer<typeof verificationSchema>
  evidence: Array<{ path: string; sha256: string }>
  artifacts?: Array<{ path: string; sha256: string }>
}

export function runtimeAcceptancePath(dispatchId: string): string {
  if (!/^[\w-]+$/.test(dispatchId)) throw new Error('Invalid acceptance dispatch ID')
  return `.beegame/workflow/evidence/runtime-${dispatchId}.json`
}

async function artifactDigest(workspace: string, path: string, allowDirectory = false): Promise<string> {
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

export async function readRuntimeAcceptance(workspace: string, dispatchId: string): Promise<RuntimeAcceptance | undefined> {
  let text: string
  try {
    const path = runtimeAcceptancePath(dispatchId)
    await artifactDigest(workspace, path) // Reject symlink escapes before reading the report.
    text = await readFile(resolve(workspace, path), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' ||
        ((error as Error).cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return undefined
    return blocked(error)
  }
  try {
    const report = reportSchema.parse(JSON.parse(text))
    let limitation = report.scope !== 'request' && report.status === 'passed'
      ? deliveryLimitation(report) : undefined
    if (report.scope !== 'request' && report.status === 'passed' && !report.artifactPaths?.length)
      limitation ??= 'The tested deployment artifacts are not recorded.'
    if (report.status === 'passed' && report.scope !== 'request' && !report.evidencePaths.length)
      throw new Error('Passed runtime acceptance requires saved evidence')
    const evidence = await Promise.all([...new Set(report.evidencePaths)].map(async path => {
      if (path === runtimeAcceptancePath(dispatchId)) throw new Error('The acceptance report cannot be its own evidence')
      return { path, sha256: await artifactDigest(workspace, path) }
    }))
    // Bind the actual tested output, even when build directories are excluded
    // from source identity. No build command, output layout or engine is imposed.
    const artifacts = await Promise.all([...new Set(report.artifactPaths ?? [])].map(async path =>
      ({ path, sha256: await artifactDigest(workspace, path, true) })))
    return { ...(report.scope ? { scope: report.scope } : {}),
      ...(report.verification ? { verification: report.verification } : {}),
      status: limitation ? 'blocked' : report.status,
      summary: limitation ? `${limitation}\nAgent report: ${report.summary}` : report.summary,
      environment: report.environment, evidence, artifacts }
  } catch (error) { return blocked(error) }
}

function deliveryLimitation(report: { verification?: z.infer<typeof verificationSchema> }): string | undefined {
  const checked = verificationSchema.safeParse(report.verification)
  if (!checked.success) return 'Delivery verification coverage is not recorded; this is not a full delivery pass.'
  // Limitations are disclosed observations; the agent's explicit verdict decides
  // whether they prevent delivery. The host checks evidence and build identity.
  if (checked.data.target !== 'deployment') return 'Development verification does not establish deployment readiness.'
}

function blocked(error: unknown): RuntimeAcceptance {
  return { status: 'blocked', summary: `Invalid runtime acceptance record: ${error instanceof Error ? error.message : String(error)}`,
    environment: 'not-established', evidence: [] }
}

export async function runtimeEvidenceIsCurrent(workspace: string, reports: RuntimeAcceptance[]): Promise<boolean> {
  if (!reports.length) return false
  try {
    for (const report of reports) {
      if (report.scope === 'request' || report.status !== 'passed' || !report.summary?.trim() || !report.environment?.trim() || !report.evidence?.length) return false
      if (deliveryLimitation(report)) return false
      if (!report.artifacts?.length) return false
      for (const artifact of report.evidence)
        if (await artifactDigest(workspace, artifact.path) !== artifact.sha256) return false
      for (const artifact of report.artifacts)
        if (await artifactDigest(workspace, artifact.path, true) !== artifact.sha256) return false
    }
    return true
  } catch { return false }
}
