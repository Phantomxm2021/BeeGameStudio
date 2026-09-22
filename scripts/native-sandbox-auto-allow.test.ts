import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import type { ToolPermissionContext, ToolUseContext } from '../src/Tool'
import { getMacroDefines } from './defines'

Object.assign(globalThis, { MACRO: Object.fromEntries(Object.entries(getMacroDefines())
  .map(([key, value]) => [key.replace('MACRO.', ''), JSON.parse(value)])) })
const { SandboxManager } = await import('../src/utils/sandbox/sandbox-adapter')
const { bashToolHasPermission } = await import('../packages/builtin-tools/src/tools/BashTool/bashPermissions')
const mocks: Array<{ mockRestore(): void }> = []
beforeEach(() => {
  mocks.push(spyOn(SandboxManager, 'isSandboxingEnabled').mockReturnValue(true),
    spyOn(SandboxManager, 'isAutoAllowBashIfSandboxedEnabled').mockReturnValue(true),
    spyOn(SandboxManager, 'areUnsandboxedCommandsAllowed').mockReturnValue(true))
})
afterEach(() => { for (const mock of mocks.splice(0)) mock.mockRestore() })
const context = (overrides: Partial<ToolPermissionContext> = {}) => ({
  getAppState: () => ({ toolPermissionContext: {
    mode: 'default', additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {}, alwaysDenyRules: {}, alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false, ...overrides,
  } }),
  abortController: new AbortController(),
} as ToolUseContext)

test.each([
  'echo TMPDIR=$TMPDIR; ls -ld "$TMPDIR" 2>&1; touch "$TMPDIR/x" 2>&1 && echo writable',
  'for file in *.ts; do echo "$file"; done',
  "node <<'JS'\nconsole.log(`value=${JSON.stringify({ok:true})}`)\nJS",
])('sandbox auto-allow handles normal development syntax without asking: %s', async command => {
  const decision = await bashToolHasPermission({ command }, context())
  expect(decision.behavior).toBe('allow')
  expect(decision.decisionReason).toMatchObject({ reason: 'Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)' })
})

test('explicit deny on a compound subcommand still wins', async () => {
  const result = await bashToolHasPermission({ command: 'echo "$TMPDIR"; rm file.txt' },
    context({ alwaysDenyRules: { localSettings: ['Bash(rm:*)'] } }))
  expect(result.behavior).toBe('deny')
})

test('explicit command-scoped ask still prompts', async () => {
  const result = await bashToolHasPermission({ command: 'git push origin main' },
    context({ alwaysAskRules: { localSettings: ['Bash(git push:*)'] } }))
  expect(result.behavior).toBe('ask')
})

test.each(['echo "$(rm file.txt)"', 'for item in x; do rm file.txt; done'])(
  'dynamic syntax cannot hide a command from an explicit deny: %s', async command => {
    const result = await bashToolHasPermission({ command }, context({ alwaysDenyRules: { localSettings: ['Bash(rm:*)'] } }))
    expect(result.behavior).not.toBe('allow')
  },
)

test('plan mode does not inherit sandbox auto-allow', async () => {
  const result = await bashToolHasPermission({ command: 'echo "$TMPDIR"' }, context({ mode: 'plan' }))
  expect(result.decisionReason).not.toMatchObject({ reason: 'Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)' })
})

test('critical directory removal is never sandbox-auto-approved', async () => {
  expect((await bashToolHasPermission({ command: 'rm -rf /' }, context())).behavior).not.toBe('allow')
})

test('regular sandbox permissions remain opt-in, not silently auto-approved', async () => {
  mocks.push(spyOn(SandboxManager, 'isAutoAllowBashIfSandboxedEnabled').mockReturnValue(false))
  const result = await bashToolHasPermission({ command: 'echo "$TMPDIR"' }, context())
  expect(result.decisionReason).not.toMatchObject({ reason: 'Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)' })
})

test('disabling isolation or requesting an unsandboxed command never uses sandbox auto-allow', async () => {
  const command = 'echo "$TMPDIR"'
  const escalated = await bashToolHasPermission({ command, dangerouslyDisableSandbox: true }, context())
  expect(escalated.decisionReason).not.toMatchObject({ reason: 'Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)' })
  mocks.push(spyOn(SandboxManager, 'isSandboxingEnabled').mockReturnValue(false))
  const disabled = await bashToolHasPermission({ command }, context())
  expect(disabled.decisionReason).not.toMatchObject({ reason: 'Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)' })
})
