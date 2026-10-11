import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { wrapCommandWithSandboxMacOS } from '@anthropic-ai/sandbox-runtime/dist/sandbox/macos-sandbox-utils.js'
import { projectExecutionAccess } from './project-execution-access'
import { appendWorkingFilesInstruction, nativeRuntimeCommand } from './native-cli-process-runner'
import { subagentSystemPrompt } from '../../../../packages/builtin-tools/src/tools/AgentTool/subagentSystemPrompt'
import { asSystemPrompt } from '../../../../src/utils/systemPromptType'
import { sharedPlaywright } from './shared-playwright'
import { sharedContentChecker, CONTENT_CHECKER_ENTRY } from './content-checker-runtime'
import { CONTENT_CHECKER_PATH, materializeSceneUiFormat } from './scene-ui-content-authoring'
import { sceneLayoutFixture, uiLayoutFixture } from './fixtures/layout-fixture'
import { materializeBalanceCalculator } from './balance-calculation'
import { nativeSessionOutputPath } from './native-runtime-process-path'

test('native project temp environment resolves inside the project before Bash tools run', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-temp-env-')))
  const workspace = join(root, 'game')
  try {
    await mkdir(workspace)
    const access = await projectExecutionAccess({
      workspacePath: workspace, sessionId: 'temp', environment: {},
    })
    expect(access.environment.TMPDIR).toBe(access.temporary)
    expect(access.environment.CLAUDE_CODE_TMPDIR).toBe(access.nativeOutput)
    expect(access.nativeOutput.startsWith(workspace + '/')).toBe(false)
    expect(access.settings.sandbox.filesystem.allowWrite).toContain(access.nativeOutput)
    expect(access.settings.sandbox.filesystem.allowWrite).not.toContain(dirname(access.nativeOutput))
    expect(access.environment.BEEGAME_NATIVE_TOOL_RESULTS_DIR).toBeUndefined()
    const playwright = sharedPlaywright()
    expect(access.environment.BEEGAME_PLAYWRIGHT_MODULE).toBe(playwright.moduleUrl)
    const helperPath = fileURLToPath(access.environment.BEEGAME_PREVIEW_TEST_MODULE!)
    expect(access.settings.sandbox.filesystem.allowRead).toContain(await realpath(helperPath))
    expect(access.settings.sandbox.filesystem.allowWrite).not.toContain(helperPath)
    expect(access.settings.sandbox.filesystem.allowRead).toContain(playwright.root)
    expect(access.settings.sandbox.filesystem.allowWrite).not.toContain(playwright.root)
    const checkerPath = fileURLToPath(access.environment.BEEGAME_CONTENT_CHECKER_MODULE!)
    expect(access.settings.sandbox.filesystem.allowRead).toContain((await sharedContentChecker()).root)
    expect(access.settings.sandbox.filesystem.allowWrite).not.toContain(checkerPath)
    expect(checkerPath.startsWith(workspace + '/')).toBe(false)
    const modulePath = fileURLToPath(new URL('../../../../src/utils/permissions/filesystem.ts', import.meta.url))
    const promptPath = fileURLToPath(new URL('../../../../src/constants/prompts.ts', import.meta.url))
    const child = Bun.spawn([process.execPath, '-e',
      'import { getClaudeTempDir } from ' + JSON.stringify(modulePath) +
      '; import { computeSimpleEnvInfo, enhanceSystemPromptWithEnvDetails } from ' + JSON.stringify(promptPath) +
      '; const main=await computeSimpleEnvInfo("configured"); const agent=(await enhanceSystemPromptWithEnvDetails(["Independent Agent"],"configured")).join("\\n");' +
      'delete process.env.BEEGAME_PROJECT_EXECUTION; const ordinary=await computeSimpleEnvInfo("configured");' +
      'console.log(JSON.stringify({temp:process.env.TMPDIR,native:getClaudeTempDir(),main,agent,ordinary}))'], {
      cwd: workspace, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...access.environment },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [code, output, error] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    expect(code, error).toBe(0)
    const actual = JSON.parse(output)
    expect(actual.temp).toBe(access.temporary)
    expect(actual.native.startsWith(access.nativeOutput + '/')).toBe(true)
    for (const prompt of [actual.main, actual.agent, actual.ordinary]) {
      expect(prompt).not.toContain('Project temporary working directory')
      expect(prompt).not.toContain('/private/tmp/claude')
    }
    const command = appendWorkingFilesInstruction(nativeRuntimeCommand({
      sessionId: 'temp', cwd: workspace, env: {},
    }), access.temporary)
    const appended = command[command.indexOf('--append-system-prompt') + 1]!
    expect(appended).toContain(JSON.stringify(access.temporary))
    expect(appended).toContain('File tools require literal paths')
    expect(appended).toContain("keep maintained tests in the project's normal test structure")
    expect(subagentSystemPrompt(asSystemPrompt([actual.agent]), appended)).toContain(appended)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 20000)

test('scoped Review requests host permission before every role tool and cannot bypass it through sandbox autoallow or hooks', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-scoped-review-')))
  try {
    const access = await projectExecutionAccess({ workspacePath: root, sessionId: 'review', environment: {},
      scopedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'AskUserQuestion', 'WebFetch', 'WebSearch'] })
    expect(access.settings.permissions.ask).toContain('Bash')
    expect(access.settings.permissions.ask).toContain('AskUserQuestion')
    expect(access.settings.permissions.ask).toContain('Write')
    expect(access.settings.sandbox.autoAllowBashIfSandboxed).toBe(false)
    expect(access.settings.disableAllHooks).toBe(true)
    expect(access.settings.sandbox.failIfUnavailable).toBe(true)
    expect(access.settings.sandbox.allowUnsandboxedCommands).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('native outputs stay outside source scans, resume the same Chat and never expose sibling sessions or symlink targets', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-output-isolation-')))
  const outputs: string[] = []
  try {
    const a = await projectExecutionAccess({ workspacePath: root, sessionId: 'a', environment: {} })
    const b = await projectExecutionAccess({ workspacePath: root, sessionId: 'b', environment: {} })
    outputs.push(a.nativeOutput,b.nativeOutput)
    expect(() => nativeSessionOutputPath(root,'a',root)).toThrow('outside the game workspace')
    expect((await projectExecutionAccess({workspacePath:root,sessionId:'a',environment:{}})).nativeOutput).toBe(a.nativeOutput)
    expect(a.nativeOutput).not.toBe(b.nativeOutput)
    expect(a.settings.sandbox.filesystem.allowRead).not.toContain(b.nativeOutput)
    expect(a.settings.sandbox.filesystem.allowWrite).not.toContain(b.nativeOutput)
    await writeFile(join(root,'game.md'),'SOURCE_FIXTURE_NEEDLE')
    await writeFile(join(a.nativeOutput,'output.txt'),'OUTPUT_ONLY_FIXTURE_NEEDLE')
    const scan = Bun.spawn(['rg','--hidden','--no-ignore','--files-with-matches','OUTPUT_ONLY_FIXTURE_NEEDLE','.'],
      {cwd:root,stdout:'pipe',stderr:'pipe'})
    expect(await scan.exited).toBe(1); expect(await new Response(scan.stdout).text()).toBe('')
    expect(await a.isReferenceRead('Read',{file_path:join(a.nativeOutput,'output.txt')})).toBe(true)
    expect(await a.isReferenceRead('Read',{file_path:join(b.nativeOutput,'output.txt')})).toBe(false)
    await symlink(join(root,'game.md'),join(a.nativeOutput,'redirect.md'))
    expect(await a.isReferenceRead('Read',{file_path:join(a.nativeOutput,'redirect.md')})).toBe(false)
    const redirect = nativeSessionOutputPath(root,'redirect',await realpath(tmpdir()))
    outputs.push(redirect); await symlink(root,redirect)
    await expect(projectExecutionAccess({workspacePath:root,sessionId:'redirect',environment:{}})).rejects.toThrow('link')
    expect(await readFile(join(a.nativeOutput,'output.txt'),'utf8')).toBe('OUTPUT_ONLY_FIXTURE_NEEDLE')
  } finally {
    for (const output of outputs) await rm(output,{recursive:true,force:true})
    await rm(root,{recursive:true,force:true})
  }
})

test('public native cache reads are scoped without exposing transcripts, host config or symlink targets', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-results-symlink-')))
  try {
    const workspace = join(root, 'game'), outside = join(root, 'outside')
    await mkdir(workspace); await mkdir(outside)
    const cache = join(root, 'native-config/projects/project/session/tool-results')
    await mkdir(cache, { recursive: true }); await writeFile(join(cache, 'result.txt'), 'actual archived output')
    await writeFile(join(outside, 'secret'), 'SECRET'); await symlink(join(outside, 'secret'), join(cache, 'escape.txt'))
    const access = await projectExecutionAccess({ workspacePath: workspace, sessionId: 'test', environment: {}, toolResultsDirectory: cache })
    expect(await access.isReferenceRead('Read', { file_path: join(cache, 'result.txt') })).toBe(true)
    expect(await access.isReferenceRead('Read', { file_path: join(cache, 'escape.txt') })).toBe(false)
    expect(await access.isReferenceRead('Read', { file_path: join(cache, '../transcript.jsonl') })).toBe(false)
    expect(await access.isReferenceRead('Write', { file_path: join(cache, 'result.txt') })).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('published skills stay readable without granting their enclosing runtime directory', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-skills-')))
  try {
    const workspace = join(root, 'game')
    const skills = join(root, 'config/skills')
    await mkdir(workspace)
    await mkdir(skills, { recursive: true })
    await writeFile(join(skills, 'reference.md'), 'REFERENCE')
    await writeFile(join(root, 'config/private.json'), 'PRIVATE')
    await symlink(join(root, 'config/private.json'), join(skills, 'escape.json'))
    const access = await projectExecutionAccess({ workspacePath: workspace, sessionId: 'skills',
      environment: { BEEGAME_CONFIG_DIR: join(root, 'config') } })
    expect(await access.isReferenceRead('Read', { file_path: join(skills, 'reference.md') })).toBe(true)
    expect(await access.isReferenceRead('Read', { file_path: join(skills, 'escape.json') })).toBe(false)
    expect(await access.isReferenceRead('Write', { file_path: join(skills, 'reference.md') })).toBe(false)
    expect(await access.isReferenceRead('Glob', { path: skills, pattern: '../*' })).toBe(false)
    expect(access.settings.sandbox.filesystem.allowRead).not.toContain(join(root, 'config'))
    expect(access.flags).not.toContain('--tools')
    expect(access.flags).not.toContain('--disallowedTools')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.skipIf(process.platform !== 'darwin')('project shell supports Git and local development without host reads', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-execution-')))
  const workspace = join(root, 'game')
  await mkdir(workspace)
  await writeFile(join(root, 'host-source.ts'), 'PRIVATE_HOST_FIXTURE')
  await symlink(join(root, 'host-source.ts'), join(workspace, 'escape.ts'))
  const access = await projectExecutionAccess({ workspacePath: workspace, sessionId: 'test', environment: {} })
  const fs = access.settings.sandbox.filesystem
  const run = async (command: string) => {
    const previous = process.cwd()
    let wrapped: string
    try {
      process.chdir(workspace)
      wrapped = wrapCommandWithSandboxMacOS({ command, binShell: '/bin/bash',
        needsNetworkRestriction: false, allowGitConfig: fs.allowGitConfig,
        readConfig: { denyOnly: fs.denyRead, allowWithinDeny: fs.allowRead },
        writeConfig: { allowOnly: fs.allowWrite, denyWithinAllow: fs.denyWrite } })
    } finally { process.chdir(previous) }
    const child = Bun.spawn(['/bin/bash', '-c', wrapped], { cwd: workspace,
      env: { HOME: process.env.HOME, ...access.environment }, stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited,
      new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, stdout, stderr }
  }
  try {
    await materializeSceneUiFormat(workspace)
    expect(await readFile(join(workspace, CONTENT_CHECKER_PATH), 'utf8')).toBe(CONTENT_CHECKER_ENTRY)
    // An accidental whole-file Read sees only the entry, not the WASM/schema bundle.
    const readerUrl = new URL('../../../../src/utils/readFileInRange.ts', import.meta.url).href
    const { readFileInRange } = await import(readerUrl)
    expect((await readFileInRange(join(workspace, CONTENT_CHECKER_PATH), 0, undefined, 256 * 1024)).content)
      .toBe(CONTENT_CHECKER_ENTRY)
    const checker = await sharedContentChecker()
    expect(access.settings.sandbox.filesystem.allowRead).not.toContain(join(checker.root, '..'))
    const help = await run(`${JSON.stringify(process.execPath)} ${CONTENT_CHECKER_PATH} --help`)
    expect(help.code, help.stderr || help.stdout).toBe(0)
    expect(help.stdout).toContain('Usage: bun .beegame/delivery/check-content.mjs')
    await writeFile(join(workspace, 'ui.json'), JSON.stringify(uiLayoutFixture()))
    const geometry = await run(`${JSON.stringify(process.execPath)} ${CONTENT_CHECKER_PATH} --layout-draft ui.json 960 540`)
    expect(geometry.code, geometry.stderr || geometry.stdout).toBe(0)
    expect(JSON.parse(geometry.stdout)).toMatchObject({ ok: true, scope: 'layout-draft-inspection' })
    await mkdir(join(workspace, 'content/scenes'), { recursive: true })
    await writeFile(join(workspace, 'content/scenes/level with spaces.json'), JSON.stringify(sceneLayoutFixture()))
    const batch = await run(`${JSON.stringify(process.execPath)} ${CONTENT_CHECKER_PATH} --scene-layouts 960 540 600 360`)
    expect(batch.code, batch.stderr || batch.stdout).toBe(0)
    expect(JSON.parse(batch.stdout).inspections).toHaveLength(2)
    await materializeBalanceCalculator(workspace)
    await writeFile(join(workspace, 'model.mjs'), `export const calculate = ({scenes}) => ({
      tables:[{title:'Saved fixtures',columns:['count'],rows:[[scenes.length]]}],
      checks:[{name:'Fixture count',passed:scenes.length===1,details:'One actual input'}],limitations:['Not game rules']});`)
    const calculation = await run(`${JSON.stringify(process.execPath)} .beegame/delivery/calculate-balance.mjs model.mjs result.md --scenes`)
    expect(calculation.code, calculation.stderr || calculation.stdout).toBe(0)
    const freshness = await run(`${JSON.stringify(process.execPath)} .beegame/delivery/calculate-balance.mjs --check-result result.md`)
    expect(freshness.code, freshness.stderr || freshness.stdout).toBe(0)
    expect(JSON.parse(freshness.stdout).scope).toBe('calculation-input-freshness')
    await mkdir(join(workspace, 'assets'))
    await writeFile(join(workspace, 'assets/pixel.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>')
    await writeFile(join(workspace, 'media-request.json'), JSON.stringify({ operation: 'images',
      jobs: [{ input: 'assets/pixel.svg', output: 'assets/pixel.png' }] }))
    const media = await run(`${JSON.stringify(process.execPath)} .beegame/delivery/media.mjs media-request.json`)
    expect(media.code, media.stderr || media.stdout).toBe(0)
    expect(JSON.parse(media.stdout)).toMatchObject({ valid: true, outputs: [{ path: 'assets/pixel.png', width: 2, height: 2 }] })
    const protectedChecker = await run(`printf bad > ${JSON.stringify(checker.path)}`)
    expect(protectedChecker.code).not.toBe(0)
    const git = await run('git init -q && printf game > game.txt && git add game.txt && git -c user.name=Fixture -c user.email=fixture@example.test commit -qm first && git status --porcelain')
    expect(git.code, git.stderr).toBe(0)
    expect(git.stderr).toBe('')
    expect(git.stdout).not.toContain('game.txt')
    const local = await run(`${JSON.stringify(process.execPath)} -e 'const s=Bun.serve({port:0,fetch:()=>new Response("ok")}); console.log(await (await fetch("http://127.0.0.1:"+s.port)).text()); s.stop();'`)
    expect(local.code, local.stderr).toBe(0)
    expect(local.stdout.trim()).toBe('ok')
    const client = await run(`${JSON.stringify(process.execPath)} -e 'const {chromium}=await import(process.env.BEEGAME_PLAYWRIGHT_MODULE); console.log(typeof chromium.connectOverCDP)'`)
    expect(client.code, client.stderr).toBe(0)
    expect(client.stdout.trim()).toBe('function')
    const node = Bun.which('node')
    expect(node).not.toBeNull()
    const nodeClient = await run(`${JSON.stringify(node)} --input-type=module -e 'const {chromium}=await import(process.env.BEEGAME_PLAYWRIGHT_MODULE); console.log(typeof chromium.connectOverCDP)'`)
    expect(nodeClient.code, nodeClient.stderr).toBe(0)
    expect(nodeClient.stdout.trim()).toBe('function')
    const helper = await run(`${JSON.stringify(node)} --input-type=module -e 'const {withPreviewPage}=await import(process.env.BEEGAME_PREVIEW_TEST_MODULE); console.log(typeof withPreviewPage)'`)
    expect(helper.code, helper.stderr).toBe(0)
    expect(helper.stdout.trim()).toBe('function')
    for (const command of ['cat ../host-source.ts', 'cat escape.ts',
      'printf bad > ../host-source.ts', 'printf bad > escape.ts',
      '/bin/bash -c "cat ../host-source.ts"']) {
      const result = await run(command)
      expect(result.code, command).not.toBe(0)
      expect(result.stdout).not.toContain('PRIVATE_HOST_FIXTURE')
    }
    expect(await readFile(join(root, 'host-source.ts'), 'utf8')).toBe('PRIVATE_HOST_FIXTURE')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 20000)
