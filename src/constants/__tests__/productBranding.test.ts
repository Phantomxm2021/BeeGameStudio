import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { getMacroDefines } from '../../../scripts/defines'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const source = (file: string) => Bun.file(resolve(repositoryRoot, file)).text()

test('product metadata and documentation agree on the configured repository and shipped entries', async () => {
  const pkg = JSON.parse(await source('package.json'))
  const repository = 'https://github.com/Phantomxm2021/BeeGameStudio'
  expect(pkg.author).toBe('PhantomLab')
  expect(pkg.repository.url).toBe('git+' + repository + '.git')
  expect(pkg.homepage).toBe(repository + '#readme')
  expect(pkg.bugs.url).toBe(repository + '/issues')
  expect(await source('src/constants/product.ts')).toContain(repository)
  expect(pkg.bin['bee-game-studio']).toBe(pkg.bin.ccb)
  expect(pkg.bin['bee-game-studio-bun']).toBe(pkg.bin['ccb-bun'])
  const readme = await source('README.md')
  expect(readme).not.toContain('bee-game-studio/claude-code')
  expect(readme).not.toContain('ccb update')
  expect(readme).not.toContain('remote-control.bee-game-studio.win')
  expect(readme).toContain('公开 npm 发布身份尚未核实')
})

test('documentation shell and both SVG logos show BGS, without guessing replacement service URLs', async () => {
  for (const path of ['docs.json', 'mint.json']) {
    const text = await source(path)
    expect(JSON.parse(text).name).toBe('BGS Architecture')
    expect(text).not.toContain('搜索 Claude Code')
    expect(text).not.toContain('ccb.agent-aura.top')
    expect(text).not.toContain('github.com/anthropics/claude-code')
  }
  for (const path of ['docs/logo/light.svg', 'docs/logo/dark.svg']) {
    expect(await source(path)).toContain('>BGS</text>')
    expect(await source(path)).not.toContain('>CCB</text>')
  }
})

test('local messages and command guidance use BGS without renaming the channel protocol', async () => {
  const weixin = await source('packages/weixin/src/server.ts')
  expect(weixin).toContain('BGS needs your approval.')
  expect(weixin).toContain("'claude/channel'")
  expect(weixin).not.toContain('ccb weixin')
  expect(await source('packages/weixin/src/monitor.ts')).toContain('bee-game-studio weixin access pair')
  for (const path of ['src/utils/crossProjectResume.ts', 'src/components/ultraplan/UltraplanChoiceDialog.tsx']) {
    expect(await source(path)).toContain('bee-game-studio --resume')
    expect(await source(path)).not.toContain('ccb --resume')
  }
  expect(await source('src/utils/Shell.ts')).not.toContain('[CCB]')
  expect(await source('src/utils/doctorDiagnostic.ts')).not.toContain('Without it, CCB')
  expect(await source('src/services/tips/tipRegistry.ts')).not.toContain('Run ccb --continue')
  expect(await source('src/components/LogoV2/feedConfigs.tsx')).toContain('BGS release notes are not configured')
})

test('locally maintained workspace packages use product namespaces', async () => {
  const pkg = JSON.parse(await source('package.json'))
  const ink = JSON.parse(await source('packages/@ant/ink/package.json'))
  const remote = JSON.parse(await source('packages/remote-control-server/package.json'))
  expect(ink.name).toBe('@bee-game-studio/ink')
  expect(remote.name).toBe('@bee-game-studio/remote-control-server')
  expect(pkg.devDependencies['@bee-game-studio/ink']).toBe('workspace:*')
  expect(pkg.devDependencies).not.toHaveProperty('@anthropic/ink')
  expect(pkg.devDependencies['@anthropic-ai/sdk']).toBeDefined()
})

test('published files include the source notice and existing original component licenses', async () => {
  const pkg = JSON.parse(await source('package.json'))
  expect(pkg.files).toContain('NOTICE.md')
  for (const path of [
    'packages/workflow-engine/LICENSE',
    'packages/scene-editor/src/components/ui/LICENSE',
    'apps/frontend/src/components/Demiurge/Landing/vendor/BENCHO-LICENSE.txt',
    'apps/frontend/src/components/Demiurge/Landing/vendor/COMPONENTRY-LICENSE.txt',
  ]) {
    expect(pkg.files).toContain(path)
    expect((await source(path)).trim().length).toBeGreaterThan(0)
  }
  expect(await source('packages/workflow-engine/LICENSE')).toContain('Copyright (c) 2026 claude-code-best')
  expect(await source('NOTICE.md')).toContain('not a complete license clearance')
})

test('built feedback guidance is nonempty and reports the unavailable upload service', () => {
  const macros = getMacroDefines()
  expect(JSON.parse(macros['MACRO.ISSUES_EXPLAINER']!)).toContain('automated feedback upload is unavailable')
  expect(JSON.parse(macros['MACRO.FEEDBACK_CHANNEL']!)).toContain('BGS project maintainer')
})

test('feedback instructions use the configured destination, not an upstream internal Slack channel', async () => {
  const source = await Bun.file(resolve(import.meta.dir, '../prompts.ts')).text()
  expect(source).toContain('unexpected behavior with BGS itself')
  expect(source).toContain('configured feedback destination: ${MACRO.ISSUES_EXPLAINER}')
  expect(source).not.toContain('#claude-code-feedback')
  expect(source).not.toContain('C07VBSHV7EV')
})

test('feedback without a BGS ingestion service collects nothing and makes no upload or title-model request', async () => {
  const source = await Bun.file(resolve(import.meta.dir, '../../components/Feedback.tsx')).text()
  expect(source).toContain('Automatic feedback upload is not configured')
  expect(source).toContain('nothing was uploaded')
  expect(source).not.toContain('axios')
  expect(source).not.toContain('submitFeedback')
  expect(source).not.toContain('queryHaiku')
  expect(source).not.toContain('loadAllSubagentTranscriptsFromDisk')
  expect(source).not.toContain('claude_cli_feedback')
  expect(source).not.toContain('github.com/anthropics')
  // The separate transcript-sharing feature still imports this redactor.
  expect(source).toContain('export function redactSensitiveInfo')
})

test('survey follow-up describes availability rather than promising a BGS feedback upload', async () => {
  const source = await Bun.file(resolve(import.meta.dir, '../../components/FeedbackSurvey/FeedbackSurvey.tsx')).text()
  expect(source).toContain('view feedback availability')
  expect(source).toContain('automated feedback upload is unavailable')
  // Genuine third-party sharing must still identify its actual recipient.
  const consent = await Bun.file(resolve(import.meta.dir, '../../components/FeedbackSurvey/TranscriptSharePrompt.tsx')).text()
  expect(consent).toContain('Can Anthropic look at your session transcript')
})

test('local home-directory guidance uses BGS without renaming third-party referral services', async () => {
  const source = await Bun.file(resolve(import.meta.dir, '../../components/LogoV2/feedConfigs.tsx')).text()
  expect(source).toContain('You have launched BGS in your home directory')
  expect(source).not.toContain('You have launched claude in your home directory')
  expect(source).toContain('Share Claude Code with friends')
})

test('system identity uses BGS for compatible routes and preserves genuine vendor prefixes', () => {
  // Isolate the settings mock so it cannot affect the rest of the test suite.
  const settings = resolve(import.meta.dir, '../../utils/settings/settings.ts')
  const system = resolve(import.meta.dir, '../system.ts')
  const debug = resolve(import.meta.dir, '../../utils/debug.ts')
  const growthbook = resolve(import.meta.dir, '../../services/analytics/growthbook.ts')
  const result = Bun.spawnSync([process.execPath, '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    let modelType;
    mock.module(${JSON.stringify(settings)}, () => ({ getInitialSettings: () => ({ modelType }) }));
    mock.module(${JSON.stringify(debug)}, () => ({ logForDebugging: () => {} }));
    mock.module(${JSON.stringify(growthbook)}, () => ({ getFeatureValue_CACHED_MAY_BE_STALE: () => true }));
    const { getCLISyspromptPrefix: prefix, BGS_SYSTEM_IDENTITY, CLI_SYSPROMPT_PREFIXES } = await import(${JSON.stringify(system)});
    for (const key of ['BEDROCK','VERTEX','FOUNDRY','OPENAI','GEMINI','GROK']) delete process.env['BGS_USE_' + key];
    delete process.env.ANTHROPIC_BASE_URL;
    for (const value of ['openai','gemini','grok']) {
      modelType = value;
      assert.equal(prefix(), BGS_SYSTEM_IDENTITY);
      assert.equal(prefix({ isNonInteractive: true, hasAppendSystemPrompt: true }), BGS_SYSTEM_IDENTITY);
    }
    modelType = undefined;
    process.env.ANTHROPIC_BASE_URL = 'https://fixture.invalid/v1';
    assert.equal(prefix(), BGS_SYSTEM_IDENTITY);
    delete process.env.ANTHROPIC_BASE_URL;
    assert.equal(prefix(), "You are Claude Code, Anthropic's official CLI for Claude.");
    assert.match(prefix({ isNonInteractive: true, hasAppendSystemPrompt: false }), /Claude Agent SDK/);
    for (const route of ['BEDROCK','VERTEX','FOUNDRY']) {
      process.env['BGS_USE_' + route] = '1';
      assert.notEqual(prefix(), BGS_SYSTEM_IDENTITY);
      delete process.env['BGS_USE_' + route];
    }
    assert(CLI_SYSPROMPT_PREFIXES.has(BGS_SYSTEM_IDENTITY));
  `], { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().slice(-2500))
  expect(result.exitCode).toBe(0)
})

test('bare prompt uses product identity rather than claiming an Anthropic CLI', async () => {
  const source = await Bun.file(resolve(import.meta.dir, '../prompts.ts')).text()
  expect(source.includes('${BGS_SYSTEM_IDENTITY}\\n\\nCWD:')).toBe(true)
})

test('full environment guidance does not reintroduce vendor product identity or model preference', async () => {
  const source = await Bun.file(resolve(import.meta.dir, '../prompts.ts')).text()
  expect(source).toContain('This session runs BGS, developed by PhantomLab.')
  expect(source).not.toContain('When building AI applications, default to')
  expect(source).not.toContain('Claude Code is available as a CLI')
  expect(source).not.toContain('Fast mode for Claude Code uses')
})

test('local skills, command examples and labels use the product name while preserving native paths', async () => {
  for (const relative of [
    '../../skills/bundled/debug.ts', '../../skills/bundled/updateConfig.ts',
    '../../services/PromptSuggestion/promptSuggestion.ts', '../../cli/handlers/templateJobs.ts',
  ]) {
    const source = await Bun.file(resolve(import.meta.dir, relative)).text()
    expect(source).not.toContain('Claude Code')
    expect(source).not.toContain('claude --debug')
    expect(source).not.toContain('claude job ')
  }
  const mcp = await Bun.file(resolve(import.meta.dir, '../../cli/handlers/mcp.tsx')).text()
  expect(mcp).not.toContain('claude mcp remove')
  expect(mcp).toContain('bee-game-studio mcp remove')
  const config = await Bun.file(resolve(import.meta.dir, '../../skills/bundled/updateConfig.ts')).text()
  expect(config).toContain('.claude/settings.json')
  expect(config).toContain('claude-plugins-official')
})

test('product commands do not request an unrelated vendor reviewer or recommend a nonexistent local executable', async () => {
  const pr = await Bun.file(resolve(import.meta.dir, '../../commands/commit-push-pr.ts')).text()
  expect(pr).not.toContain('--reviewer anthropics/claude-code')
  expect(pr).not.toContain('--add-reviewer anthropics/claude-code')
  for (const file of ['../../commands/mcp/addCommand.ts', '../../commands/mcp/xaaIdpCommand.ts',
    '../../commands/plugin/ValidatePlugin.tsx', '../../components/mcp/MCPListPanel.tsx']) {
    const source = await Bun.file(resolve(import.meta.dir, file)).text()
    expect(source).not.toMatch(/\bclaude (?:mcp|plugin|--debug)/)
    expect(source).toContain('bee-game-studio')
  }
})

test('guide distinguishes local BGS evidence from actual vendor products and keeps its compatibility identifier', async () => {
  const guide = await Bun.file(resolve(import.meta.dir, '../../../packages/builtin-tools/src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts')).text()
  expect(guide).toContain('You are the BGS guide agent')
  expect(guide).toContain('Check local help, source and project documentation first')
  expect(guide).toContain('https://platform.claude.com/llms.txt')
  expect(guide).toContain("'claude-code-guide'")
  expect(guide).toContain('third-party Claude Agent SDK')
})

test('local installation and URI registration cannot fall back to an unrelated vendor CLI or bare runtime', async () => {
  const local = await Bun.file(resolve(import.meta.dir, '../../utils/localInstaller.ts')).text()
  expect(local).toContain('node_modules/.bin/bee-game-studio')
  expect(local).not.toContain('node_modules/.bin/claude')
  expect(local).toContain("if (!MACRO.PACKAGE_URL) return 'install_failed'")
  const doctor = await Bun.file(resolve(import.meta.dir, '../../utils/doctorDiagnostic.ts')).text()
  expect(doctor).not.toContain("which('claude')")
  expect(doctor).not.toContain('npm -g uninstall @anthropic-ai/claude-code')
  const protocol = await Bun.file(resolve(import.meta.dir, '../../utils/deepLink/registerProtocol.ts')).text()
  expect(protocol).toContain('com.phantomlab.bgs-url-handler')
  expect(protocol).toContain('if (isInBundledMode()) return process.execPath')
  expect(protocol).toContain('if (!claudePath) return')
})
