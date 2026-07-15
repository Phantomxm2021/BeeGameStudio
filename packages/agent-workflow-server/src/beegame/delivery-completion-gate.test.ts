import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  evaluateDeliveryCompletion,
  readDeliveryReportSignature,
  readProjectMutationSignature,
} from './delivery-completion-gate'

describe('native delivery completion gate', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('accepts an evidence-complete report returned by a synchronous validator', async () => {
    const report = validReport()
    workspace = await createWorkspaceWithReport(report)

    expect(evaluateDeliveryCompletion({
      workspace,
      messages: validatorMessages(report),
    })).toEqual({ allowed: true, outcome: 'passed', issues: [] })
  })

  test('rejects a report authored without a matching native validator result', async () => {
    const report = validReport()
    workspace = await createWorkspaceWithReport(report)

    const result = evaluateDeliveryCompletion({ workspace, messages: [] })

    expect(result.allowed).toBe(false)
    expect(result.issues).toContain(
      'The report is not the collected terminal JSON returned by a beegame-acceptance-validator Agent call in this turn.',
    )
  })

  test('accepts a native background validator only after its TaskOutput result is collected', async () => {
    const report = validReport()
    workspace = await createWorkspaceWithReport(report)

    expect(evaluateDeliveryCompletion({
      workspace,
      messages: backgroundValidatorMessages(report),
    })).toEqual({ allowed: true, outcome: 'passed', issues: [] })
  })

  test('requires observed Skill provenance when the native transcript is available', async () => {
    const report = validReport()
    workspace = await createWorkspaceWithReport(report)
    const messages = validatorMessages(report)
    const withoutSkill = evaluateDeliveryCompletion({
      workspace,
      messages,
      readValidatorTranscript: () => [],
    })
    expect(withoutSkill.allowed).toBe(false)
    expect(withoutSkill.issues).toContain(
      'The validator transcript does not contain a beegame-game-acceptance Skill invocation.',
    )

    expect(evaluateDeliveryCompletion({
      workspace,
      messages,
      readValidatorTranscript: () => [{
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'skill-use',
            name: 'Skill',
            input: { skill: 'beegame-game-acceptance' },
          }],
        },
      }],
    })).toEqual({ allowed: true, outcome: 'passed', issues: [] })
  })

  test('blocks a failed validator result so Claude Code continues the same turn', async () => {
    const report = {
      ...validReport(),
      status: 'failed',
      requirements: [{
        id: 'requirement-primary',
        status: 'failed',
        evidence: [{ kind: 'test', source: 'tests/acceptance.test.ts', detail: 'Assertion failed.' }],
      }],
      playerPaths: [{ id: 'path-primary', status: 'failed', evidence: [] }],
      findings: [{
        requirementId: 'requirement-primary',
        requirement: 'Primary behavior',
        status: 'failed',
        detail: 'Observed assertion failed.',
        evidence: [],
      }],
    }
    workspace = await createWorkspaceWithReport(report)

    const result = evaluateDeliveryCompletion({
      workspace,
      messages: validatorMessages(report),
    })

    expect(result.allowed).toBe(false)
    expect(result.issues).toContain(
      'Acceptance failed. Repair the findings and invoke a fresh validator before stopping.',
    )
  })

  test('allows a concrete external blocker without claiming delivery passed', async () => {
    const report = {
      ...validReport(),
      status: 'blocked',
      requirements: [{
        id: 'requirement-primary',
        status: 'blocked',
        evidence: [{ kind: 'runtime', source: 'path-primary', detail: 'Required external device is unavailable.' }],
      }],
      playerPaths: [{ id: 'path-primary', status: 'blocked', evidence: [] }],
      findings: [{
        requirementId: 'requirement-primary',
        requirement: 'Primary behavior',
        status: 'blocked',
        detail: 'A required external capability is unavailable.',
        evidence: [],
      }],
    }
    workspace = await createWorkspaceWithReport(report)

    expect(evaluateDeliveryCompletion({
      workspace,
      messages: validatorMessages(report),
    })).toEqual({ allowed: true, outcome: 'blocked', issues: [] })
  })

  test('rejects a stale report from an earlier turn', async () => {
    const report = validReport()
    workspace = await createWorkspaceWithReport(report)
    const baseline = readDeliveryReportSignature(workspace)

    const result = evaluateDeliveryCompletion({
      workspace,
      messages: [],
      reportBaseline: baseline,
    })

    expect(result.allowed).toBe(false)
    expect(result.issues).toContain('The validation report was not refreshed during this delivery turn.')
  })

  test('rejects a passed report when the canonical asset contract is invalid', async () => {
    const report = validReport()
    workspace = await createWorkspaceWithReport(report)
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: ['portable-model'] },
      slots: [{ id: 'visual-primary', status: 'integrated', target: { path: 'assets/visual.portable-model' } }],
    }))

    const result = evaluateDeliveryCompletion({
      workspace,
      messages: validatorMessages(report),
    })

    expect(result.allowed).toBe(false)
    expect(result.issues.some(issue => issue.startsWith('Asset contract: visual-primary:'))).toBe(true)
  })

  test('detects project mutations while ignoring BeeGame diagnostic output', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-project-mutation-'))
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'entry.portable'), 'initial')
    const initial = readProjectMutationSignature(workspace)

    await mkdir(join(workspace, 'logs'), { recursive: true })
    await writeFile(join(workspace, 'logs', 'runtime.log'), 'diagnostic')
    expect(readProjectMutationSignature(workspace)).toBe(initial)

    await writeFile(join(workspace, 'src', 'entry.portable'), 'changed')
    expect(readProjectMutationSignature(workspace)).not.toBe(initial)
  })
})

function validReport(): Record<string, unknown> {
  return {
    validatorId: 'beegame-acceptance-validator',
    status: 'passed',
    summary: 'All approved behavior was observed.',
    requirements: [{
      id: 'requirement-primary',
      status: 'passed',
      evidence: [{ kind: 'test', source: 'tests/acceptance.test.ts', detail: 'Assertion passed.' }],
    }],
    playerPaths: [{
      id: 'path-primary',
      status: 'passed',
      evidence: [{ kind: 'runtime', source: 'path-primary', detail: 'Observed successful player path.' }],
    }],
    findings: [],
    verifiedCapabilities: ['skill:beegame-game-acceptance'],
  }
}

async function createWorkspaceWithReport(report: unknown): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-delivery-gate-'))
  await mkdir(join(workspace, 'docs', 'acceptance'), { recursive: true })
  await writeFile(
    join(workspace, 'docs', 'acceptance', 'validation-report.json'),
    JSON.stringify(report),
  )
  return workspace
}

function validatorMessages(report: unknown): unknown[] {
  return [
    {
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'validator-tool-use',
          name: 'Agent',
          input: {
            subagent_type: 'beegame-acceptance-validator',
            run_in_background: false,
          },
        }],
      },
    },
    {
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'validator-tool-use',
          content: JSON.stringify({
            status: 'completed',
            agentId: 'validator-agent',
            content: [{ type: 'text', text: JSON.stringify(report) }],
          }),
        }],
      },
    },
  ]
}

function backgroundValidatorMessages(report: unknown): unknown[] {
  return [
    {
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'validator-launch',
          name: 'Agent',
          input: {
            subagent_type: 'beegame-acceptance-validator',
            run_in_background: true,
          },
        }],
      },
    },
    {
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'validator-launch',
          content: JSON.stringify({ status: 'async_launched', agentId: 'validator-agent' }),
        }],
      },
    },
    {
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'validator-output',
          name: 'TaskOutput',
          input: { task_id: 'validator-agent' },
        }],
      },
    },
    {
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'validator-output',
          content: JSON.stringify({
            status: 'completed',
            content: [{ type: 'text', text: JSON.stringify(report) }],
          }),
        }],
      },
    },
  ]
}
