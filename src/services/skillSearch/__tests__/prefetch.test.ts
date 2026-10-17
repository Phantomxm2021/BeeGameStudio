import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { feature } from 'bun:bundle'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ToolUseContext } from '../../../Tool.js'
import { clearCommandsCache, getSkillToolCommands } from '../../../commands.js'
import { getTurnZeroSkillDiscovery, startSkillDiscoveryPrefetch } from '../prefetch.js'
import { clearSkillIndexCache, getSkillIndex, searchSkills } from '../localSearch.js'
import { clearSkillCaches } from '../../../skills/loadSkillsDir.js'
import { getAllowedSettingSources, getInlinePlugins, setAllowedSettingSources, setInlinePlugins } from '../../../bootstrap/state.js'
import { filterToBundledAndMcp, getSkillListingAttachments, resetSentSkillNames } from '../../../utils/attachments.js'
import { clearPluginCache } from '../../../utils/plugins/pluginLoader.js'
import { SkillTool } from '@bee-game-studio/builtin-tools/tools/SkillTool/SkillTool.js'
import { createUserMessage } from '../../../utils/messages.js'
import { parseFrontmatter } from '../../../utils/frontmatterParser.js'

let root: string
let previousCwd: string
let previousPlugins: string[]
const originalEnv = { ...process.env }
const unusedContext = {} as ToolUseContext

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-search-prefetch-'))
  previousCwd = process.cwd()
  previousPlugins = getInlinePlugins()
  setInlinePlugins([])
  clearPluginCache()
  process.chdir(root)
  process.env = { ...originalEnv }
  process.env.BEEGAME_CONFIG_DIR = join(root, 'config')
  process.env.CLAUDE_SKILL_LEARNING_HOME = join(root, 'learning')
  process.env.SKILL_SEARCH_ENABLED = '1'
  process.env.SKILL_LEARNING_ENABLED = '1'
  process.env.NODE_ENV = 'test'
  process.env.ANTHROPIC_API_KEY = 'test-key'
  clearCommandsCache()
  clearSkillCaches()
  clearSkillIndexCache()
})

afterEach(() => {
  process.chdir(previousCwd)
  setInlinePlugins(previousPlugins)
  clearPluginCache()
  process.env = { ...originalEnv }
  clearCommandsCache()
  clearSkillCaches()
  clearSkillIndexCache()
  try {
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  } catch {
    // Windows can keep transient handles after dynamic command loading.
  }
})

function useSkillCatalog(directory: string, name = 'bgs-builtins') {
  const plugin = join(root, 'plugins', name)
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  writeFileSync(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({
    name, skills: './' + relative(plugin, directory),
  }))
  setInlinePlugins([...getInlinePlugins(), plugin])
  clearPluginCache(); clearCommandsCache()
}

describe('skill search prefetch', () => {
  test('discovers Skills from initial native subagent messages with independent discovery state', async () => {
    const skillsDir = join(root, 'builtinskills')
    const skillDir = join(skillsDir, 'review-evidence')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: review-evidence',
      'description: Review evidence',
      '---',
      'Verify the original source behind the claim.',
    ].join('\n'))
    useSkillCatalog(skillsDir)
    const messages = [createUserMessage({ content:
      'Project source references and supporting material. '.repeat(30) + ' Review evidence',
    })]
    const context = (agentId: string) => ({
      cwd: root, agentId, discoveredSkillNames: new Set<string>(),
    } as unknown as ToolUseContext)
    const parent = context('parent')
    const child = context('child')
    for (const active of [parent, child]) {
      const attachments = await startSkillDiscoveryPrefetch(null, messages, active)
      const discovery = attachments[0]
      expect(discovery?.type).toBe('skill_discovery')
      if (discovery?.type !== 'skill_discovery') throw new Error('initial task did not discover Skills')
      expect(discovery.skills[0]?.name).toBe('bgs-builtins:review-evidence')
      expect(discovery.skills[0]?.autoLoaded).toBe(true)
      expect(discovery.skills[0]?.content).toContain('Verify the original source')
      expect(await startSkillDiscoveryPrefetch(null, messages, active)).toEqual([])
    }
  })

  test('discovers a standard user Skill plugin with ordinary settings disabled', async () => {
    const skillsDir = join(root, 'native-skills')
    const skillDir = join(skillsDir, 'user-level-design')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: user-level-design',
      'description: Reference for spatial level design',
      '---',
      'Use the level design reference when relevant.',
    ].join('\n'))
    useSkillCatalog(skillsDir, 'bgs-user')
    const previousSources = getAllowedSettingSources()
    setAllowedSettingSources([])
    try {
      const command = (await getSkillToolCommands(root)).find(item => item.name === 'bgs-user:user-level-design')
      expect(command?.type).toBe('prompt')
      if (command?.type !== 'prompt') throw new Error('projected skill was not loaded')
      expect(searchSkills('spatial level design', await getSkillIndex(root)).map(item => item.name))
        .toContain('bgs-user:user-level-design')
      const expanded = await command.getPromptForCommand('', unusedContext)
      expect(JSON.stringify(expanded)).toContain('Use the level design reference when relevant.')
    } finally {
      setAllowedSettingSources(previousSources)
    }
  })

  test('discovers an explicit built-in Skill plugin with ordinary settings disabled', async () => {
    const builtinsDir = join(root, 'builtinskills')
    const skillDir = join(builtinsDir, 'game-level-designer-expert')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: game-level-designer-expert',
      'description: Design game levels and encounters',
      '---',
      'Use the built-in level design reference.',
    ].join('\n'))
    useSkillCatalog(builtinsDir)
    const previousSources = getAllowedSettingSources()
    setAllowedSettingSources([])
    try {
      const command = (await getSkillToolCommands(root))
        .find(item => item.name === 'bgs-builtins:game-level-designer-expert')
      expect(command?.type).toBe('prompt')
      if (command?.type !== 'prompt') throw new Error('built-in Skill was not loaded')
      expect(searchSkills('design game levels', await getSkillIndex(root)).map(item => item.name))
        .toContain('bgs-builtins:game-level-designer-expert')
      expect(JSON.stringify(await command.getPromptForCommand('', unusedContext)))
        .toContain('Use the built-in level design reference.')
    } finally {
      setAllowedSettingSources(previousSources)
    }
  })

  test('technical design Skills load eight-document completion and later revision guidance', async () => {
    useSkillCatalog(fileURLToPath(new URL('../../../../.beegame/skills/builtinskills/', import.meta.url)))
    const commands = await getSkillToolCommands(root)
    for (const [name, timing, revision] of [
      ['game-implementation-planning', 'complete TECHNICAL_DESIGN.md and its implementation tasks/index in the eight-document design-record stage',
        'Later visual/resource/Scene/UI production updates affected references and decisions in this plan'],
      ['gameplay-programmer', 'complete TECHNICAL_DESIGN.md during the eight-document stage',
        'Later visual/resource/UI/Scene outputs revise this same design'],
      ['game-plan-execution', 'BGS technical design and tasks are completed in the eight-document stage',
        'reconcile affected task inputs with actual visual/resource/UI/Scene outputs in that same plan'],
    ]) {
      const skill = commands.find(item => item.name === 'bgs-builtins:' + name)
      if (skill?.type !== 'prompt') throw new Error(name + ' is not model-invocable')
      const prompt = JSON.stringify(await skill.getPromptForCommand('', unusedContext))
      expect(prompt).toContain(timing!)
      expect(prompt).toContain(revision!)
      expect(prompt).not.toContain('Keep early technical notes as drafts')
    }
  })

  test('loads the explicitly supplied catalog through standard plugin discovery', async () => {
    useSkillCatalog(fileURLToPath(new URL(
      '../../../../.beegame/skills/builtinskills/', import.meta.url,
    )))
    const previousSources = getAllowedSettingSources()
    setAllowedSettingSources([])
    try {
      const modelInvocableSkills = await getSkillToolCommands(root)
      const initialNames = filterToBundledAndMcp(
        modelInvocableSkills,
      ).map(skill => skill.name)
      expect(initialNames).not.toContain('bgs-builtins:game-creative-director-expert')
      expect(initialNames).not.toContain('bgs-builtins:game-ui-ux-designer')
      expect(initialNames).not.toContain('bgs-builtins:game-feel-designer')
      expect(initialNames).not.toContain('bgs-builtins:gameplay-programmer')
      expect(initialNames).not.toContain('bgs-builtins:game-technical-artist')
      expect(initialNames).not.toContain('bgs-builtins:game-content-pipeline-engineer')
      const names = modelInvocableSkills.map(skill => skill.name)
      expect(names).toContain('bgs-builtins:game-creative-director-expert')
      expect(names).toContain('bgs-builtins:game-level-designer-expert')
      expect(names).toContain('bgs-builtins:game-content-pipeline-engineer')
      expect(names).toContain('bgs-builtins:game-ui-ux-designer')
      expect(names).toContain('bgs-builtins:game-feel-designer')
      expect(names).toContain('bgs-builtins:game-audio-designer')
      expect(names).toContain('bgs-builtins:game-playtest-performance')
      expect(names).toContain('bgs-builtins:game-implementation-planning')
      expect(names).toContain('bgs-builtins:game-plan-execution')
      expect(names).toContain('bgs-builtins:root-cause-debugging')
      expect(names).toContain('bgs-builtins:evidence-before-completion')
      expect(names).toContain('bgs-builtins:spatial-computing-game-expert')
      expect(names).toContain('bgs-builtins:beegame-interaction-contracts')
      expect(names).not.toContain('brainstorming')
      expect(names).not.toContain('interview')
      expect(names).not.toContain('beegame-game-delivery')
      const skill = modelInvocableSkills.find(item => item.name === 'bgs-builtins:game-level-designer-expert')
      expect(skill?.type).toBe('prompt')
      if (skill?.type !== 'prompt') throw new Error('built-in Skill is not model-invocable')
      expect(JSON.stringify(await skill.getPromptForCommand('', unusedContext))).toContain('Game Level Designer')
      const pipeline = modelInvocableSkills.find(item => item.name === 'bgs-builtins:game-content-pipeline-engineer')
      expect(pipeline?.type).toBe('prompt')
      if (pipeline?.type !== 'prompt') throw new Error('pipeline Skill is not model-invocable')
      expect(JSON.stringify(await pipeline.getPromptForCommand('', unusedContext)))
        .toContain('Game Content Pipeline Engineer')
      const feel = modelInvocableSkills.find(item => item.name === 'bgs-builtins:game-feel-designer')
      if (feel?.type !== 'prompt' || !feel.skillRoot) {
        throw new Error('game feel Skill is not model-invocable or has no source root')
      }
      const feelSourceBody = parseFrontmatter(readFileSync(join(feel.skillRoot, 'SKILL.md'), 'utf8')).content
      const expandedFeel = (await feel.getPromptForCommand('', unusedContext))
        .filter(block => block.type === 'text').map(block => block.text).join('\n')
      expect(expandedFeel).toContain(feelSourceBody)
      const designCheck = modelInvocableSkills.find(item => item.name === 'bgs-builtins:game-design-check')
      if (designCheck?.type !== 'prompt' || !designCheck.skillRoot) {
        throw new Error('design checking Skill is not model-invocable or has no source root')
      }
      const designCheckBody = parseFrontmatter(readFileSync(join(designCheck.skillRoot, 'SKILL.md'), 'utf8')).content
      const expandedDesignCheck = (await designCheck.getPromptForCommand('', unusedContext))
        .filter(block => block.type === 'text').map(block => block.text).join('\n')
      expect(expandedDesignCheck).toContain(designCheckBody)
      const referenceLinks = [...designCheckBody.matchAll(/\[[^\]]+\]\((references\/[^)]+)\)/g)]
      expect(referenceLinks.length).toBeGreaterThan(0)
      for (const link of referenceLinks) {
        const reference = readFileSync(join(designCheck.skillRoot, link[1]!), 'utf8')
        expect(reference.length).toBeGreaterThan(0)
        expect(expandedDesignCheck).not.toContain(reference)
      }
      for (const name of ['gameplay-programmer', 'game-technical-artist']) {
        const specialist = modelInvocableSkills.find(item => item.name === 'bgs-builtins:' + name)
        if (specialist?.type !== 'prompt' || !specialist.skillRoot) {
          throw new Error(`${name} is not model-invocable or has no source root`)
        }
        const body = parseFrontmatter(readFileSync(join(specialist.skillRoot, 'SKILL.md'), 'utf8')).content
        const expanded = (await specialist.getPromptForCommand('', unusedContext))
          .filter(block => block.type === 'text').map(block => block.text).join('\n')
        expect(expanded).toContain(body)
      }
      const planning = modelInvocableSkills.find(item => item.name === 'bgs-builtins:game-implementation-planning')
      const execution = modelInvocableSkills.find(item => item.name === 'bgs-builtins:game-plan-execution')
      expect(planning?.type).toBe('prompt')
      expect(execution?.type).toBe('prompt')
      if (planning?.type !== 'prompt' || execution?.type !== 'prompt') {
        throw new Error('implementation Skills are not model-invocable')
      }
      expect(JSON.stringify(await planning.getPromptForCommand('', unusedContext)))
        .toContain('## Decompose the implementation')
      expect(JSON.stringify(await execution.getPromptForCommand('', unusedContext)))
        .toContain('## Execute one coherent slice')
      const debugging = modelInvocableSkills.find(item => item.name === 'bgs-builtins:root-cause-debugging')
      const verification = modelInvocableSkills.find(item => item.name === 'bgs-builtins:evidence-before-completion')
      expect(debugging?.type).toBe('prompt')
      expect(verification?.type).toBe('prompt')
      if (debugging?.type !== 'prompt' || verification?.type !== 'prompt') {
        throw new Error('diagnostic Skills are not model-invocable')
      }
      expect(JSON.stringify(await debugging.getPromptForCommand('', unusedContext)))
        .toContain('## 2. Test one explanation')
      if (!verification.skillRoot) throw new Error('verification Skill has no source root')
      const sourceBody = parseFrontmatter(readFileSync(join(verification.skillRoot, 'SKILL.md'), 'utf8')).content
      const expandedVerification = (await verification.getPromptForCommand('', unusedContext))
        .filter(block => block.type === 'text').map(block => block.text).join('\n')
      expect(expandedVerification).toContain(sourceBody)
      expect(expandedVerification).not.toContain('design-review.md')
      expect(expandedVerification).not.toContain('obtain an independent check')
      const index = await getSkillIndex(root)
      expect(index.every(skill => skill.source !== 'builtin')).toBe(true)
      expect(searchSkills('design game HUD buttons for gamepad focus', index).map(item => item.name))
        .toContain('bgs-builtins:game-ui-ux-designer')
      expect(searchSkills('改善操作手感、动作节奏与打击感', index)[0]?.name)
        .toBe('bgs-builtins:game-feel-designer')
      expect(searchSkills('修复运动碰撞和碰撞穿透，检查更新时序', index)[0]?.name)
        .toBe('bgs-builtins:gameplay-programmer')
      expect(searchSkills('实现受击特效和材质着色器，修复镜头表现', index)[0]?.name)
        .toBe('bgs-builtins:game-technical-artist')
      expect(searchSkills('观察玩家试玩，进行体验验证', index)[0]?.name)
        .toBe('bgs-builtins:game-playtest-performance')
      const uiTask = '美术方向完成。现在写 UI/UX 规格，逐屏给出元素、锚点几何与状态。'
      const uiMatch = searchSkills(uiTask, index)
      expect(uiMatch[0]?.name).toBe('bgs-builtins:game-ui-ux-designer')
      expect(uiMatch[0]?.score).toBeLessThan(0.30)
      const discovery = await startSkillDiscoveryPrefetch(
        null,
        [
          createUserMessage({ content: '制作一款塔防游戏' }),
          { type: 'assistant', message: { content: [{ type: 'text', text: uiTask }] } },
          createUserMessage({ content: [{ type: 'tool_result', tool_use_id: 'write_ui', content: 'done' }] }),
        ] as any,
        { cwd: root, discoveredSkillNames: new Set<string>() } as any,
      )
      expect(discovery[0]?.type).toBe('skill_discovery')
      if (discovery[0]?.type !== 'skill_discovery') throw new Error('expected task-specific discovery')
      expect(discovery[0].catalogFallback).toBe(false)
      expect(discovery[0].skills[0]?.name).toBe('bgs-builtins:game-ui-ux-designer')
      expect(discovery[0].skills[0]?.autoLoaded).not.toBe(true)
      expect(searchSkills('fix tilemap atlas frame loading in the playable runtime', index).map(item => item.name))
        .toContain('bgs-builtins:game-content-pipeline-engineer')
      expect(searchSkills('mix game audio and spatial effects', index).map(item => item.name))
        .toContain('bgs-builtins:game-audio-designer')
      expect(searchSkills('profile first interactive frame and loading', index).map(item => item.name))
        .toContain('bgs-builtins:game-playtest-performance')
      expect(searchSkills('plan a multi-step game implementation from design and scene UI documents', index).map(item => item.name))
        .toContain('bgs-builtins:game-implementation-planning')
      expect(searchSkills('execute the game implementation plan and verify playable slices', index).map(item => item.name))
        .toContain('bgs-builtins:game-plan-execution')
      expect(searchSkills('diagnose unexpected behavior and find the root cause', index).map(item => item.name))
        .toContain('bgs-builtins:root-cause-debugging')
      expect(searchSkills('check evidence before claiming game delivery passed', index).map(item => item.name))
        .toContain('bgs-builtins:game-design-check')
      expect(searchSkills('writing plans for game implementation', index).map(item => item.name))
        .toContain('bgs-builtins:game-implementation-planning')
      expect(searchSkills('executing plans for game implementation', index).map(item => item.name))
        .toContain('bgs-builtins:game-plan-execution')
      expect(searchSkills('systematic debugging for game performance issues', index).map(item => item.name))
        .toContain('bgs-builtins:root-cause-debugging')
      expect(searchSkills('verification before completion of game delivery', index).map(item => item.name))
        .toContain('bgs-builtins:evidence-before-completion')
      expect(searchSkills('根据设计文档拆解游戏实现任务', index).map(item => item.name))
        .toContain('bgs-builtins:game-implementation-planning')
      expect(searchSkills('排查测试失败的根本原因', index).map(item => item.name))
        .toContain('bgs-builtins:root-cause-debugging')
      expect(searchSkills('设计游戏界面的血条和手柄焦点', index)[0]?.name)
        .toBe('bgs-builtins:game-ui-ux-designer')
      expect(searchSkills('修复瓦片地图和图集加载', index)[0]?.name)
        .toBe('bgs-builtins:game-content-pipeline-engineer')
      expect(searchSkills('设计游戏音效和背景音乐', index)[0]?.name)
        .toBe('bgs-builtins:game-audio-designer')
      expect(searchSkills('排查游戏启动慢和掉帧', index)[0]?.name)
        .toBe('bgs-builtins:game-playtest-performance')
      expect(searchSkills('设计游戏UI和响应式布局', index)[0]?.name)
        .toBe('bgs-builtins:game-ui-ux-designer')
      expect(searchSkills('design game UI screen layout', index)[0]?.name)
        .toBe('bgs-builtins:game-ui-ux-designer')
      expect(searchSkills('tilemap 图集 加载场景', index)[0]?.name)
        .toBe('bgs-builtins:game-content-pipeline-engineer')
    } finally {
      setAllowedSettingSources(previousSources)
    }
  })

  test('does not force game plugins into the initial listing when Skill Search is enabled', async () => {
    useSkillCatalog(fileURLToPath(new URL(
      '../../../../.beegame/skills/builtinskills/', import.meta.url,
    )))
    const previousSources = getAllowedSettingSources()
    const previousNodeEnv = process.env.NODE_ENV
    setAllowedSettingSources([])
    process.env.NODE_ENV = 'development'
    resetSentSkillNames()
    try {
      const context = {
        options: { tools: [SkillTool], mainLoopModel: 'ark-code-latest' },
        getAppState: () => ({ mcp: { commands: [] } }),
      } as unknown as ToolUseContext
      const attachments = await getSkillListingAttachments(context)
      const commands = await getSkillToolCommands(root)
      expect(commands.map(skill => skill.name)).toContain('bgs-builtins:game-ui-ux-designer')
      expect(filterToBundledAndMcp(commands).map(skill => skill.name)).not.toContain('bgs-builtins:game-ui-ux-designer')
      if (feature('EXPERIMENTAL_SKILL_SEARCH')) {
        expect(JSON.stringify(attachments)).not.toContain('bgs-builtins:game-ui-ux-designer')
      } else {
        // Source-mode Bun tests do not compile this feature; ordinary listing
        // includes every plugin, exactly as upstream does without Skill Search.
        expect(JSON.stringify(attachments)).toContain('bgs-builtins:game-ui-ux-designer')
      }
    } finally {
      process.env.NODE_ENV = previousNodeEnv
      setAllowedSettingSources(previousSources)
      resetSentSkillNames()
    }
  })

  test('keeps the shipped Skill catalog visible with Skill Search disabled', async () => {
    useSkillCatalog(fileURLToPath(new URL(
      '../../../../.beegame/skills/builtinskills/', import.meta.url,
    )))
    const previousSources = getAllowedSettingSources()
    const previousNodeEnv = process.env.NODE_ENV
    const previousSearchEnabled = process.env.SKILL_SEARCH_ENABLED
    setAllowedSettingSources([])
    process.env.NODE_ENV = 'development'
    process.env.SKILL_SEARCH_ENABLED = '0'
    resetSentSkillNames()
    try {
      const context = {
        options: { tools: [SkillTool], mainLoopModel: 'ark-code-latest' },
        getAppState: () => ({ mcp: { commands: [] } }),
      } as unknown as ToolUseContext
      const attachments = await getSkillListingAttachments(context)
      expect(attachments).toHaveLength(1)
      expect(attachments[0]?.type).toBe('skill_listing')
      if (attachments[0]?.type !== 'skill_listing') throw new Error('Skill listing was not sent')
      expect(attachments[0].content).toContain('bgs-builtins:game-creative-director-expert')
      expect(attachments[0].content).toContain('bgs-builtins:game-ui-ux-designer')
    } finally {
      process.env.NODE_ENV = previousNodeEnv
      process.env.SKILL_SEARCH_ENABLED = previousSearchEnabled
      setAllowedSettingSources(previousSources)
      resetSentSkillNames()
    }
  })

  test('auto-loads high-confidence project skill content', async () => {
    const skillDir = join(root, '.claude', 'skills', 'feature-audit')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: feature-audit',
        'description: Audit feature flags and classify minimal implementations',
        '---',
        '',
        '# Feature Audit',
        '',
        'Use the feature flag audit workflow and classify flags as stub, shell, MVP, or thin-toggle.',
      ].join('\n'),
    )

    const attachment = await getTurnZeroSkillDiscovery(
      'audit feature flags for minimal implementation stubs',
      [],
      { agentId: undefined } as any,
    )

    expect(attachment?.type).toBe('skill_discovery')
    if (attachment?.type !== 'skill_discovery') {
      throw new Error('expected skill_discovery attachment')
    }
    expect(attachment.skills[0]?.name).toBe('feature-audit')
    expect(attachment.skills[0]?.autoLoaded).toBe(true)
    expect(attachment.skills[0]?.content).toContain(
      'feature flag audit workflow',
    )
  })

  test('offers newly installed skills to the agent for multilingual low-confidence requests', async () => {
    const skillsDir = join(root, 'native-skills')
    const skillDir = join(skillsDir, 'puzzle-board-designer')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: puzzle-board-designer',
      'description: Design puzzle boards and constraints',
      '---',
      'Use this reference for puzzle board design.',
    ].join('\n'))
    useSkillCatalog(skillsDir, 'bgs-user')
    const context = {
      cwd: root,
      discoveredSkillNames: new Set<string>(),
      agentId: undefined,
    } as unknown as ToolUseContext

    for (const prompt of [
      'パズルの盤面と制約を設計して',
      '퍼즐 보드와 제약 조건을 설계해줘',
      'Diseñar tableros de rompecabezas y sus restricciones',
      'Concevoir des grilles de casse-tête et leurs contraintes',
    ]) {
      const discovery = await getTurnZeroSkillDiscovery(
        prompt,
        [],
        { ...context, discoveredSkillNames: new Set<string>() },
      )
      expect(discovery?.type).toBe('skill_discovery')
      if (discovery?.type !== 'skill_discovery') throw new Error('expected catalog')
      expect(discovery.catalogFallback).toBe(true)
      expect(discovery.skills.map(skill => skill.name)).toContain('bgs-user:puzzle-board-designer')
      expect(discovery.skills.some(skill => skill.autoLoaded)).toBe(false)
      expect(discovery.gap).toBeUndefined()
    }

    const catalog = await getTurnZeroSkillDiscovery(
      'パズルの盤面と制約を設計して', [], context,
    )
    expect(catalog?.type).toBe('skill_discovery')
    expect(await getTurnZeroSkillDiscovery(
      'パズルの盤面と制約を設計して', [], context,
    )).toBeNull()

    const exact = await getTurnZeroSkillDiscovery(
      'Design puzzle boards and constraints', [], context,
    )
    expect(exact?.type).toBe('skill_discovery')
    if (exact?.type !== 'skill_discovery') throw new Error('expected exact match')
    expect(exact.skills[0]?.name).toBe('bgs-user:puzzle-board-designer')
    expect(exact.skills[0]?.autoLoaded).toBe(true)

    const addedSkillDir = join(skillsDir, 'new-camera-helper')
    mkdirSync(addedSkillDir, { recursive: true })
    writeFileSync(join(addedSkillDir, 'SKILL.md'), [
      '---',
      'name: new-camera-helper',
      'description: Diagnose camera movement and framing',
      '---',
      'Use this reference for camera movement.',
    ].join('\n'))
    clearCommandsCache()
    clearSkillCaches()
    clearSkillIndexCache()
    expect((await getSkillIndex(root)).map(skill => skill.name)).toContain('bgs-user:new-camera-helper')
    const updatedCatalog = await getTurnZeroSkillDiscovery(
      'カメラの動きと構図を調べて', [], context,
    )
    expect(updatedCatalog?.type).toBe('skill_discovery')
    if (updatedCatalog?.type !== 'skill_discovery') throw new Error('expected updated catalog')
    expect(updatedCatalog.catalogFallback).toBe(true)
    expect(updatedCatalog.skills.map(skill => skill.name)).toContain('bgs-user:new-camera-helper')

    const interTurnContext = {
      ...context,
      discoveredSkillNames: new Set<string>(),
    }
    const interTurn = await startSkillDiscoveryPrefetch(
      '카메라 움직임과 구도를 살펴봐', [], interTurnContext,
    )
    expect(interTurn[0]?.type).toBe('skill_discovery')
    if (interTurn[0]?.type !== 'skill_discovery') throw new Error('expected inter-turn catalog')
    expect(interTurn[0].catalogFallback).toBe(true)
    expect(interTurn[0].skills.map(skill => skill.name)).toContain('bgs-user:new-camera-helper')
    expect(await startSkillDiscoveryPrefetch(
      '카메라 움직임과 구도를 살펴봐', [], interTurnContext,
    )).toEqual([])
  })

  test('records a pending skill gap on the first unmatched prompt (no draft file yet)', async () => {
    const attachment = await getTurnZeroSkillDiscovery(
      'frobnicate zephyr ledger workflow',
      [],
      { agentId: undefined } as any,
    )

    expect(attachment?.type).toBe('skill_discovery')
    if (attachment?.type !== 'skill_discovery') {
      throw new Error('expected skill_discovery attachment')
    }
    expect(attachment.skills).toEqual([])
    expect(attachment.gap?.status).toBe('pending')
    expect(attachment.gap?.draftPath).toBeUndefined()
  })
})
