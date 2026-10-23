import { describe, expect, it } from 'vitest'
import { toPermissionDisplayModel, toProjectRuntimeDisplayModel } from './displayModels'

describe('displayModels', () => {
  it('maps the native project runtime and build state without legacy workflow fields', () => {
    const display = toProjectRuntimeDisplayModel({
      project_id: ' project-1 ',
      phase: ' running ',
      blocked: false,
      active_subagents: [' agent-use-1 '],
      acceptance: { status: 'passed', summary: 'Verified' },
      build_report: {
        status: 'passed',
        agents: [' builder '],
        generated_paths: [' dist/index.html '],
        checks: [{ name: ' bundle ', status: 'passed' }],
      },
      workflow: { status: 'running' },
    } as never)

    expect(display).toMatchObject({
      project_id: 'project-1',
      phase: 'running',
      active_subagents: ['agent-use-1'],
      acceptance: { status: 'passed', summary: 'Verified' },
      build_report: {
        status: 'passed',
        agents: ['builder'],
        generated_paths: ['dist/index.html'],
        checks: [{ name: 'bundle', status: 'passed' }],
      },
    })
    expect(display).not.toHaveProperty('workflow')
  })

  it('maps only canonical tool-permission fields', () => {
    const permission = {
      gate_id: 'permission-1',
      type: 'BEEGAME_PERMISSION' as const,
      title: 'Bash permission',
      permission_tool_name: 'Bash',
      artifact: { input: { command: 'npm test' } },
      summary: { block_reason: 'Tool approval required.' },
    }
    expect(toPermissionDisplayModel(permission)).toEqual({
      ...permission,
      task_id: undefined,
      raw: permission,
    })
  })
})
