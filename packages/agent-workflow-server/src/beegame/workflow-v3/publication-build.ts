import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WorkflowError, type Run } from './state'
import { buildEditableProject, projectFiles, projectDependencies, sameFiles, AGENT_EVIDENCE_DIRECTORY } from './editable-project'
import { measurementRequest, registeredContentChecks } from './agent-measurement'
import { runArtifactCheck } from './runtime-checks'
import { requiresBgsEditableContent } from './web-project-start'
import type { PreparedPublication } from '../deployment-manager'

/** Read-only eligibility: old measurement verdicts do not gate a fresh build. */
export async function publicationBuildPlan(run: Run): Promise<{ runtimeArtifact: string }> {
  let manifest: { scripts?: { build?: unknown } }
  try { manifest = JSON.parse(await readFile(join(run.workspacePath, 'package.json'), 'utf8')) }
  catch { throw new WorkflowError('deployment-build-unavailable', 'Publishing requires a saved package.json with a build script') }
  if (typeof manifest.scripts?.build !== 'string' || !manifest.scripts.build.trim())
    throw new WorkflowError('deployment-build-unavailable', 'Publishing requires a package.json build script')
  // Reuse the declared output location only, never its saved bytes or verdict.
  // New static Web projects use the conventional dist output directory.
  const declared = run.agentTurns?.flatMap(turn => turn.measurements ?? []).at(-1)?.runtimeArtifact ?? 'dist'
  const parsed = measurementRequest.shape.runtimeArtifact.safeParse(declared)
  if (!parsed.success) throw new WorkflowError('deployment-build-unavailable', 'The saved build output directory is invalid')
  return { runtimeArtifact: parsed.data }
}

/** Publication-owned build evidence; never rewrites an agent's old receipt. */
export async function rebuildPublication(run: Run, plan: { runtimeArtifact: string }, directory: string,
  validateRun: () => Promise<void>): Promise<PreparedPublication> {
  await validateRun()
  const build = await buildEditableProject(run.workspacePath, { editableProject: true,
    runtimeArtifact: plan.runtimeArtifact, writablePaths: [plan.runtimeArtifact + '/**'] }, [],
    [AGENT_EVIDENCE_DIRECTORY], undefined, directory)
  if (build.status !== 'passed' || !build.projectBuild)
    throw new Error('Publication build failed: ' + build.observation)
  const proof = build.projectBuild
  const validate = async () => {
    await validateRun()
    if (!sameFiles(proof.files, await projectFiles(run.workspacePath, plan.runtimeArtifact, proof.excludedReports)) ||
        proof.dependencySha256 !== await projectDependencies(run.workspacePath))
      throw new WorkflowError('publication-source-changed', 'Project sources or dependencies changed during publication; publish the current version again')
  }
  await validate()
  const content = await registeredContentChecks(run.workspacePath, run.requirements.constraints, requiresBgsEditableContent(run))
  const failedContent = content.filter(check => check.status === 'failed' || check.status === 'execution-error' ||
    check.id === 'content-structure' && check.status === 'unverified')
  if (failedContent.length) throw new Error('Publication content check failed: ' +
    failedContent.map(check => check.id + ': ' + check.observation).join('\n'))
  const smoke = await runArtifactCheck(directory, 'runtime-smoke', { runtimeArtifact: plan.runtimeArtifact, expectedOutputs: [] },
    [], run.requirements.constraints)
  if (smoke.status !== 'passed') throw new Error('Publication page check failed: ' + smoke.observation)
  await validate()
  return { artifact: proof.artifact, validate,
    buildLog: JSON.stringify({ protocol: run.protocol, runId: run.id, requirementsRevision: run.requirements.revision,
      operation: 'Rebuilt current sources in an isolated copy and checked the fresh static build before publication.',
      quality: 'unverified', checks: [build, ...content, smoke] }) }
}
