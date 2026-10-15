// Test-only adapter for exercising the same content and runtime checkers used by Agent measurement.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { contentDocumentSchema } from '../game-content-schema'
import { runContentCheck } from './content-checks'
import { runArtifactCheck } from './runtime-checks'
import { currentCheckVersion } from './check-versions'
import { checkIsCurrent, commandCheck, readVersion } from './checks'
import type { CheckResult, FileVersion, TaskSpec } from './state'

export async function runChecks(root: string, task: TaskSpec, inputs: FileVersion[], signal?: AbortSignal, constraints: Record<string, unknown> = {}): Promise<{ checks: CheckResult[]; outputs: FileVersion[] }> {
  let outputs: FileVersion[] = []
  const checks: CheckResult[] = []
  const collectOutputs = async () => {
    const current: FileVersion[] = []
    for (const file of task.expectedOutputs) try { current.push(await readVersion(root, file)) } catch { /* Missing outputs are unverified, never empty PASS. */ }
    return current
  }
  // Build is a producer: checking for its outputs before running it prevented
  // legitimate first builds. Other checks consume the resulting current bytes.
  const order: TaskSpec['checks'] = task.checks.includes('build')
    ? ['build', ...task.checks.filter(id => id !== 'build')] : task.checks
  for (const id of order) {
    outputs = await collectOutputs()
    const files = [...inputs, ...outputs], complete = outputs.length === task.expectedOutputs.length
    let result: CheckResult = { id, version: currentCheckVersion(id, task), status: 'unverified', inputs: files,
      observation: 'This check driver is not connected in the first slice; it cannot authorize release.', createdAt: new Date().toISOString() }
    try {
      if (signal?.aborted) throw new Error('Check cancelled')
      if (!complete && id !== 'build' && id !== 'rule-tests') result.observation = 'Required output missing or outside the workspace: '+task.expectedOutputs.filter(p => !outputs.some(v => v.path === p)).join(', ')
      else if (id === 'content-structure' || id === 'content-layout' || id === 'content-resources') result = await runContentCheck(root, id, task, files, constraints)
      else if (id === 'runtime-smoke' || id === 'delivery-package' || id === 'ui-data-consumption' || id === 'scene-data-consumption' || id === 'pixel-data-consumption' || id === 'font-data-consumption' || id === 'audio-data-consumption') result = await runArtifactCheck(root, id, task, files, constraints, signal)
      else if (id === 'artifact-json' || id === 'content-schema') {
        if (task.expectedOutputs.some(file => !file.endsWith('.json'))) result.observation = 'All declared outputs must be JSON for this check.'
        else {
          for (const file of task.expectedOutputs.filter(file => id !== 'content-schema' || file !== task.bindingPlan)) {
            const data = JSON.parse(await readFile(resolve(root, file), 'utf8'))
            if (id === 'content-schema') contentDocumentSchema.parse(data)
          }
          result.status = 'passed'; result.observation = id === 'artifact-json' ? 'Actual saved JSON parsed; no gameplay or semantic claim.' : 'Saved content documents match the existing strict Schema; resources, layout and runtime are not verified.'
        }
      } else if (id === 'build' && task.editableProject) {
        const {buildEditableProject}=await import('./editable-project')
        result=await buildEditableProject(root,task,inputs,[],signal)
        outputs=await collectOutputs()
        if(result.status==='passed' && outputs.length!==task.expectedOutputs.length) {
          result.status='unverified';result.observation+='\nDeclared task outputs are missing; build exit zero alone is insufficient.'
        }
      } else if (id === 'build' || id === 'rule-tests') {
        const file = await readVersion(root, 'package.json'); result.inputs = [...inputs, file]
        const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
        const script = id === 'build' ? 'build' : 'test:rules'
        if (typeof pkg.scripts?.[script] !== 'string' || !pkg.scripts[script].trim()) result.observation = 'No actual package script: '+script
        else {
          const observation = await commandCheck(root, script, signal)
          result.status = observation.code === 0 ? 'passed' : 'failed'
          result.observation = 'Host executed bun run '+script+'; exit '+observation.code+'\n'+observation.log
          outputs = await collectOutputs(); result.inputs.push(...outputs)
          if (result.status === 'passed' && outputs.length !== task.expectedOutputs.length) {
            result.status = 'unverified'; result.observation += '\nDeclared build/task outputs are missing; exit zero alone is insufficient.'
          }
          result.coverage = { files: result.inputs.map(file => file.path), limitations: ['Command result and declared input/output versions only; not proof of requirement coverage or actual target-runtime/data consumption.'] }
        }
      }
    } catch (error) {
      result.status = ['artifact-json', 'content-schema'].includes(id) ? 'failed' : 'execution-error'
      result.observation = error instanceof Error ? error.message : 'Check execution failed'
    }
    if (result.status === 'passed' && !await checkIsCurrent(root, result, task)) {
      result.status = 'unverified'; result.observation = 'Checked inputs, artifacts or driver version changed during execution; result is not current.'
    }
    checks.push(result)
  }
  outputs = await collectOutputs()
  return { outputs, checks }
}
