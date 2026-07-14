import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  auditGameProductionCompletion,
  findLastValidatorReportInText,
  findLatestValidatorReport,
  readValidatorReportFromTaskOutput,
} from './production-completion-audit'
import { GAME_PRODUCTION_DOCUMENT_PATHS } from './production-planning-contract'

describe('production completion validator evidence', () => {
  test('extracts only a structured result from the managed acceptance agent', () => {
    const result = JSON.stringify({
      validatorId: 'beegame-acceptance-validator',
      status: 'passed',
      summary: 'Observed.',
      requirements: [],
      playerPaths: [],
      findings: [],
      verifiedCapabilities: [],
    })
    const messages = [{
      type: 'assistant',
      message: { content: [{
        type: 'tool_use',
        id: 'acceptance-call',
        name: 'Agent',
        input: { subagent_type: 'beegame-acceptance-validator' },
      }] },
    }, {
      type: 'user',
      message: { content: [{
        type: 'tool_result',
        tool_use_id: 'acceptance-call',
        content: `${result}\nagentId: managed-agent`,
      }] },
    }]

    expect(findLatestValidatorReport(messages)).toMatchObject({ status: 'passed' })
    expect(findLatestValidatorReport([{
      type: 'delivery.validation',
      report: JSON.parse(result),
    }])).toMatchObject({ status: 'passed' })
  })

  test('rejects empty, truncated and unrelated agent results', () => {
    const messages = [{
      type: 'assistant',
      message: { content: [{
        type: 'tool_use',
        id: 'other-call',
        name: 'Agent',
        input: { subagent_type: 'general-purpose' },
      }] },
    }, {
      type: 'user',
      message: { content: [{
        type: 'tool_result',
        tool_use_id: 'other-call',
        content: '{"validatorId":"beegame-acceptance-validator"',
      }] },
    }]

    expect(findLatestValidatorReport(messages)).toBeUndefined()
  })

  test('reads the final valid report from a native task output file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'beegame-validator-output-'))
    const taskId = 'native-validator'
    const outputFile = join(directory, `${taskId}.output`)
    const report = JSON.stringify({
      validatorId: 'beegame-acceptance-validator',
      status: 'blocked',
      summary: 'A required runtime capability was unavailable.',
      requirements: [],
      playerPaths: [],
      findings: [],
      verifiedCapabilities: [],
    })
    await writeFile(outputFile, `diagnostic\n${report}\n`)

    expect(findLastValidatorReportInText(`diagnostic\n${report}`)).toMatchObject({ status: 'blocked' })
    expect(readValidatorReportFromTaskOutput(taskId, outputFile)).toMatchObject({ status: 'blocked' })
    expect(readValidatorReportFromTaskOutput('other-task', outputFile)).toBeUndefined()
  })

  test('accepts completion only when validator evidence covers the declared player path', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-production-complete-'))
    for (const path of GAME_PRODUCTION_DOCUMENT_PATHS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), path.endsWith('.json') ? '{}' : '# specification\n')
    }
    await writeFile(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
      project_target: { asset_format_capabilities: [] },
      slots: [],
    }))
    await writeFile(join(workspace, 'docs/delivery-contract.json'), JSON.stringify({
      version: 1,
      requirements: [{
        id: 'REQ-1',
        title: 'Observable behavior',
        scope: 'mvp',
        evidenceRequired: ['runtime'],
        sourceRefs: [{ path: 'docs/specs/GDD.md', locator: 'specification' }],
      }],
      acceptanceCriteria: [{
        id: 'AC-1',
        sourceRef: { path: 'docs/specs/ACCEPTANCE_CRITERIA.md', locator: 'specification' },
        requirementIds: ['REQ-1'],
        playerPathIds: ['PATH-1'],
      }],
      requiredCapabilities: [],
      playerPaths: [{
        id: 'PATH-1',
        requirementIds: ['REQ-1'],
        phases: {
          entry: [{ action: { type: 'project-native-entry' }, assertions: [{ type: 'entry-visible' }] }],
          core_action: [{ action: { type: 'project-native-action' }, assertions: [{ type: 'state-changed' }] }],
          state_change: [{ action: { type: 'observe-state' }, assertions: [{ type: 'state-observed' }] }],
          completion: [{ action: { type: 'complete-session' }, assertions: [{ type: 'completion-visible' }] }],
          recovery: [{ action: { type: 'restart-session' }, assertions: [{ type: 'restart-succeeds' }] }],
        },
      }],
    }))
    await mkdir(join(workspace, 'docs/superpowers/plans'), { recursive: true })
    await writeFile(join(workspace, 'docs/superpowers/plans/implementation.md'), '# plan\n')
    await writeFile(join(workspace, 'docs/superpowers/plan-index.json'), JSON.stringify({
      version: 1,
      planPath: 'docs/superpowers/plans/implementation.md',
      tasks: [{
        id: 'TASK-1',
        requirementIds: ['REQ-1'],
        playerPathIds: ['PATH-1'],
        files: ['source/runtime.file'],
        assetSlotIds: [],
        preconditions: [{ description: 'The approved contract exists.' }],
        actions: [{ description: 'Implement the observable player path.' }],
        assertions: [{ description: 'The declared runtime state is observable.' }],
        check: {
          command: 'project-native-runtime-check',
          evidenceKinds: ['runtime'],
          assertions: [{ description: 'The complete player path passes.' }],
        },
      }],
    }))
    await writeFile(join(workspace, 'docs/validation-report.md'), '# observed validation\n')

    const validatorResult = JSON.stringify({
      validatorId: 'beegame-acceptance-validator',
      status: 'passed',
      summary: 'Observed the declared path.',
      requirements: [{
        id: 'REQ-1',
        status: 'passed',
        evidence: [{ kind: 'runtime', source: 'PATH-1', detail: 'Observed state transition.' }],
      }],
      playerPaths: [{
        id: 'PATH-1',
        status: 'passed',
        evidence: [{ kind: 'runtime', source: 'PATH-1', detail: 'Completed the declared path.' }],
      }],
      findings: [],
      verifiedCapabilities: [],
    })
    await writeFile(join(workspace, 'docs/validation-report.json'), validatorResult)
    const messages = [{
      message: { content: [{
        type: 'tool_use', id: 'acceptance-call', name: 'Agent',
        input: { subagent_type: 'beegame-acceptance-validator' },
      }] },
    }, {
      message: { content: [{
        type: 'tool_result', tool_use_id: 'acceptance-call', content: validatorResult,
      }] },
    }]

    expect(auditGameProductionCompletion(workspace, messages)).toMatchObject({ valid: true })
    const wrongPathMessages = structuredClone(messages)
    const wrongPathResult = JSON.parse(validatorResult) as {
      requirements: Array<{ evidence: Array<{ source: string }> }>
    }
    wrongPathResult.requirements[0]!.evidence[0]!.source = 'PATH-UNDECLARED'
    ;(wrongPathMessages[1]!.message.content[0] as { content: string }).content = JSON.stringify(wrongPathResult)
    expect(auditGameProductionCompletion(workspace, wrongPathMessages).valid).toBe(false)
  })
})
