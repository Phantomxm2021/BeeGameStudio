import { resolve } from 'node:path'
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from './runner'
import { BEEGAME_USER_RESPONSE_SCOPE } from '../beegame/user-response-scope'
import { bgsCommand, toml } from './client'
import { createRequire } from 'node:module'

// The outer agent sandbox cannot nest macOS Seatbelt. Run explicitly on the
// host against synthetic files and a local Responses fixture; no paid model.
const sandboxTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
sandboxTest('pinned Bgs completes a real app-server turn against a local Responses fixture', async () => {
  const root = await mkdtemp('/private/tmp/bgs-bgs-real-'), game = join(root, 'game')
  await mkdir(game)
  const catalog = join(root,'catalog'),skill = join(catalog,'synthetic')
  await mkdir(skill,{recursive:true})
  await writeFile(join(skill,'SKILL.md'),'---\nname: bgs-synthetic-skill\ndescription: Local fixture skill.\n---\nSYNTHETIC_SKILL_BODY_MARKER\n')
  const requests: string[] = [], events: any[] = [], usage: any[] = [], toolCatalogs: string[] = []
  const require = createRequire(import.meta.url)
  const mcpCode = `import {McpServer} from ${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/mcp.js'))};import {StdioServerTransport} from ${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/stdio.js'))};const server=new McpServer({name:'fixture',version:'1'});server.registerTool('fixture_echo',{inputSchema:{}},async()=>({content:[{type:'text',text:process.env.MCP_FIXTURE_TOKEN}]}));await server.connect(new StdioServerTransport());`
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
    requests.push(new URL(request.url).pathname)
    if (new URL(request.url).pathname === '/mcp' && request.method === 'GET') return new Response(null,{status:405})
    const body = await request.json() as any
    if (new URL(request.url).pathname === '/mcp') {
      if (body.method === 'initialize') return Response.json({jsonrpc:'2.0',id:body.id,result:{
        protocolVersion:body.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'http-fixture',version:'1'}}})
      if (!body.id) return new Response(null,{status:202})
      return Response.json({jsonrpc:'2.0',id:body.id,result:body.method==='tools/list'
        ? {tools:[{name:'fixture_http_echo',description:'Offline HTTP tool',inputSchema:{type:'object',properties:{}}}]} : {}})
    }
    toolCatalogs.push(JSON.stringify(body.tools))
    expect(JSON.stringify(body)).not.toContain('synthetic-mcp-secret')
    expect(JSON.stringify(body.input)).toContain('SYNTHETIC_SKILL_BODY_MARKER')
    const developerText = body.input.filter((item: any) => item.role === 'developer')
      .flatMap((item: any) => item.content ?? []).map((part: any) => part.text ?? '').join('\n')
    expect(developerText).toContain(BEEGAME_USER_RESPONSE_SCOPE)
    const message = { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Local fixture completed', annotations: [] }] }
    const response = { id: 'resp_fixture', object: 'response', created_at: 1, model: body.model, status: 'completed', output: [message],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 10 }, output_tokens_details: { reasoning_tokens: 0 } } }
    const stream = [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', item_id: message.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: 'Local fixture completed' },
      { type: 'response.output_text.done', item_id: message.id, output_index: 0, content_index: 0, text: 'Local fixture completed' },
      { type: 'response.content_part.done', item_id: message.id, output_index: 0, content_index: 0, part: message.content[0] },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response },
    ].map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('')
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  let runtime
  try {
    runtime = await createBgsRunner({resolveOutboundTarget: async value => ({url:new URL(value),addresses:['127.0.0.1'],
      lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)})}).start({ sessionId: 'offline', cwd: game,
      env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR:catalog, OPENAI_API_KEY: 'synthetic-local-key',
        OPENAI_BASE_URL: server.url.toString().replace(/\/$/, '') + '/v1', BEEGAME_MODEL: 'fixture-model',
        BEEGAME_NATIVE_MCP_SERVERS_JSON: JSON.stringify([{id:'fixture',enabled:true,autoStart:true,scope:'global',transport:'stdio',command:process.execPath,args:['-e',mcpCode],env:[{key:'MCP_FIXTURE_TOKEN',value:'synthetic-mcp-secret'}]},
          {id:'http-fixture',enabled:true,autoStart:true,scope:'global',transport:'http',url:server.url.origin+'/mcp'}]) },
      onNativeUsage: value => { usage.push(value) }, requestPermission: async () => ({ behavior: 'deny' }) })
    await runtime.submit({ prompt: '$bgs-synthetic-skill Return the fixture answer', signal: AbortSignal.timeout(15_000),
      onMessage: message => { events.push(message) }, requestPermission: async () => ({ behavior: 'deny' }) })
    expect(requests.filter(path => path === '/v1/responses')).toHaveLength(1)
    expect(toolCatalogs.join('')).toContain('fixture_echo')
    expect(toolCatalogs.join('')).toContain('fixture_http_echo')
    expect(events.filter(e => e.eventType?.startsWith('assistant.')).map(e => e.text).join('')).toContain('Local fixture completed')
    expect(usage.at(-1)).toEqual({ prompt_tokens: 90, completion_tokens: 20, cache_read_tokens: 10, cache_creation_tokens: 0, total_tokens: 120 })
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 30_000)

sandboxTest('Bgs sandbox enforces protected writes and external reads against real shell commands', async () => {
  const root = await mkdtemp('/private/tmp/bgs-bgs-boundary-'), game = join(root, 'game'), home = join(root, 'home')
  await mkdir(join(game, 'docs'), { recursive: true }); await mkdir(home)
  const protectedFile = join(game, 'docs/GDD.md'), external = join(root, 'external.txt')
  await writeFile(protectedFile, 'locked'); await writeFile(external, 'synthetic-secret')
  await symlink(external, join(game, 'alias.txt'))
  try {
    const profile = { filesystem: { ':root': 'deny', ':minimal': 'read', ':slash_tmp': 'deny', [game]: 'write', [protectedFile]: 'read', [process.execPath]: 'read' }, network: { enabled: false } }
    const script = `const fs=require('node:fs');let denied=0;for(const action of [()=>fs.writeFileSync(${JSON.stringify(protectedFile)},'bad'),()=>fs.readFileSync(${JSON.stringify(external)}),()=>fs.readFileSync('alias.txt'),()=>fs.renameSync('docs','renamed-docs')]){try{action()}catch{denied++}}fs.writeFileSync('ordinary.txt','allowed');console.log(JSON.stringify({denied}));if(denied!==4)process.exit(2)`
    const child = Bun.spawn(bgsCommand().concat('sandbox', '-C', game, '-P', 'bgs-test', '-c', 'permissions.bgs-test=' + toml(profile), '--', process.execPath, '-e', script), {
      cwd: game, env: { PATH: process.env.PATH, HOME: home, BGS_HOME: home }, stdout: 'pipe', stderr: 'pipe' })
    const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ code, output, errors }).toMatchObject({ code: 0, output: expect.stringContaining('"denied":4') })
    expect(await readFile(protectedFile, 'utf8')).toBe('locked')
    expect(await readFile(join(game, 'ordinary.txt'), 'utf8')).toBe('allowed')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30_000)

sandboxTest('catalog-advertised skill paths are readable in the sandbox while credentials and skill writes stay denied', async () => {
  const { BgsClient } = await import('./client')
  const { configureBgsSkills } = await import('./skills')
  const root = await mkdtemp('/private/tmp/bgs-bgs-skills-'), builtins=join(root,'catalog'), home=join(root,'home')
  const skill = join(builtins,'synthetic-skill')
  await mkdir(skill,{recursive:true})
  await writeFile(join(skill,'SKILL.md'),'---\nname: bgs-synthetic-skill\ndescription: Synthetic skill for offline catalog verification.\n---\nSynthetic instructions.\n')
  let client
  try {
    await mkdir(home,{recursive:true})
    client = await BgsClient.connect({cwd:root,env:{PATH:process.env.PATH!,HOME:home,BGS_HOME:home},config:{cli_auth_credentials_store:'file'}})
    await configureBgsSkills(client,home,builtins,join(root,'user-skills'))
    const result = await client.request('skills/list',{cwds:[root],forceReload:true})
    expect(result.data.flatMap((entry:any)=>entry.errors)).toEqual([])
    const advertised = result.data.flatMap((entry:any)=>entry.skills).find((entry:any)=>entry.name==='bgs-synthetic-skill')
    expect(advertised?.path).toBe(join(skill,'SKILL.md'))
    const game=join(root,'game'), credentials=join(home,'auth.json'), otherUserSkill=join(root,'other-user-skill.md')
    await mkdir(game); await writeFile(credentials,'synthetic-secret'); await writeFile(otherUserSkill,'Other user private skill')
    const filesystem: Record<string,string> = { ':root':'deny', ':minimal':'read', ':slash_tmp':'deny',
      [game]:'write', [builtins]:'read', [join(home,'skills')]:'read', [process.execPath]:'read' }
    const run = async (script:string) => {
      const child=Bun.spawn(bgsCommand().concat('sandbox','-C',game,'-P','bgs-test','-c',
        'permissions.bgs-test='+toml({filesystem,network:{enabled:false}}),'--',process.execPath,'-e',script),
        {cwd:game,env:{PATH:process.env.PATH,HOME:home,BGS_HOME:home},stdout:'pipe',stderr:'pipe'})
      const [code,output,errors]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])
      return {code,output,errors}
    }
    expect((await readdir(join(home,'skills'))).some(name=>name.startsWith('bgs-builtin-'))).toBe(false)
    const escape=join(home,'skills','credential-alias')
    await symlink(credentials,escape)
    const read=`const fs=require('node:fs');console.log(fs.readFileSync(${JSON.stringify(advertised.path)},'utf8'))`
    const script=read+`;let denied=0;for(const action of [()=>fs.readFileSync(${JSON.stringify(credentials)}),()=>fs.writeFileSync(${JSON.stringify(advertised.path)},'bad'),()=>fs.readFileSync(${JSON.stringify(escape)}),()=>fs.readFileSync(${JSON.stringify(otherUserSkill)})]){try{action()}catch{denied++}}console.log(JSON.stringify({denied}));if(denied!==4)process.exit(2)`
    expect(await run(script)).toMatchObject({code:0,output:expect.stringContaining('"denied":4')})
    expect(await readFile(join(skill,'SKILL.md'),'utf8')).toContain('Synthetic instructions.')
    expect(await readFile(credentials,'utf8')).toBe('synthetic-secret')
  } finally {await client?.close();await rm(root,{recursive:true,force:true})}
},15000)


sandboxTest('managed registration writes through the host while native registry edits and replacement stay denied', async () => {
  const { projectExecutionAccess } = await import('../beegame/project-execution-access')
  const { openAgentTools } = await import('../beegame/workflow-v3/agent-tools')
  const sharp = (await import('sharp')).default
  const root = await mkdtemp('/private/tmp/bgs-registry-boundary-')
  const game = join(root, 'game'), home = join(root, 'home')
  await mkdir(join(game, 'assets/runtime'), { recursive: true }); await mkdir(home)
  await writeFile(join(game, 'assets/runtime/apple.png'), await sharp({ create: {
    width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 },
  } }).png().toBuffer())
  const requirement = { id: 'apple', name: 'Apple', purpose: 'Local fixture', required: true,
    acquisition_profile: { dimensions: ['2D'], asset_kinds: ['sprite'], usage_tags: ['prop'], capabilities: ['alpha'], styles: ['Cartoon'] } }
  const registration = { operation: 'register', projectTarget: { platform: 'web', runtime: 'react',
    asset_format_capabilities: ['png'], resource_library_usage: 'optional', runtime_asset_root: 'assets/runtime', generated_asset_root: 'assets/generated' },
    requirements: [requirement], resources: [{ id: 'apple', fulfills: ['apple'], root_path: 'assets/runtime/apple.png',
      file_paths: ['assets/runtime/apple.png'], provisional: false, reason: 'Local fixture artwork', selection_reason: ['Local fixture'], dimension: '2D', asset_kind: 'sprite' }] }
  await writeFile(join(game, 'registration.json'), JSON.stringify(registration))
  let tools: Awaited<ReturnType<typeof openAgentTools>> | undefined
  let access: Awaited<ReturnType<typeof projectExecutionAccess>> | undefined
  try {
    access = await projectExecutionAccess({ workspacePath: game, sessionId: 'fixture', environment: {} })
    tools = await openAgentTools({ workspacePath: game, sessionId: 'fixture', getAuthToken: () => undefined })
    const profile = access.config.permissions['bgs-project']
    const env = { ...access.environment, PATH: process.env.PATH, HOME: home, BGS_HOME: home }
    const run = async (args: string[], changes = {}) => {
      const child = Bun.spawn(bgsCommand().concat('sandbox', '-C', game, '-P', 'bgs-test', '-c',
        'permissions.bgs-test=' + toml(profile), '--', process.execPath, ...args),
        { cwd: game, env: { ...env, ...changes }, stdout: 'pipe', stderr: 'pipe' })
      const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      return { code, output, errors }
    }
    const cli = resolve(game,tools.directory, 'resources.mjs')
    expect(await run([cli, 'registration.json'])).toMatchObject({ code: 0, output: expect.stringContaining('"valid":true') })
    const manifestPath = join(game, 'assets/asset-manifest.json')
    const manifestBytes = await readFile(manifestPath, 'utf8'), manifest = JSON.parse(manifestBytes)
    const modulePath = manifest.modules.resources[0], requirementPath = manifest.modules.requirements
    const moduleBytes = await readFile(join(game, modulePath), 'utf8')
    const requirementBytes = await readFile(join(game, requirementPath), 'utf8')
    const attacks = [
      "fs.writeFileSync('assets/asset-manifest.json','bad')",
      "fs.unlinkSync('assets/asset-manifest.json')",
      "fs.renameSync('assets/asset-manifest.json','moved-index.json')",
      `fs.writeFileSync(${JSON.stringify(modulePath)},'bad')`,
      `fs.unlinkSync(${JSON.stringify(modulePath)})`,
      `fs.renameSync(${JSON.stringify(modulePath)},'moved-module.json')`,
      `fs.writeFileSync(${JSON.stringify(requirementPath)},'bad')`,
      "fs.writeFileSync('assets/manifest/injected.json','bad')",
      "fs.renameSync('assets/manifest','moved-manifest')",
      "fs.rmSync('assets/manifest',{recursive:true,force:true})",
      "fs.renameSync('assets','moved-assets')",
    ]
    const attack = `const fs=require('node:fs');const denied=[];${attacks.map((s,i) => `try{${s}}catch{denied.push(${i})}`).join(';')};fs.writeFileSync('assets/runtime/ordinary.txt','allowed');console.log(JSON.stringify(denied))`
    const result = await run(['-e', attack])
    expect(result.code, result.errors).toBe(0)
    expect(JSON.parse(result.output)).toEqual(attacks.map((_, i) => i))
    expect(await readFile(manifestPath, 'utf8')).toBe(manifestBytes)
    expect(await readFile(join(game, modulePath), 'utf8')).toBe(moduleBytes)
    expect(await readFile(join(game, requirementPath), 'utf8')).toBe(requirementBytes)
    expect(await readFile(join(game, 'assets/runtime/ordinary.txt'), 'utf8')).toBe('allowed')
    // Removing the managed capability must not reopen the local registrar's write path.
    expect((await run([cli, 'registration.json'], { BEEGAME_ASSET_CAPABILITY_FILE: '' })).code).not.toBe(0)
    await writeFile(join(game, 'changed.json'), JSON.stringify({ ...registration, requirements: [{ ...requirement, required: false }] }))
    expect(await run([cli, 'changed.json'])).toMatchObject({ code: 1, output: expect.stringContaining('cannot redefine') })
    expect(await readFile(join(game, requirementPath), 'utf8')).toBe(requirementBytes)
    expect(await run([cli, 'registration.json'])).toMatchObject({ code: 0, output: expect.stringContaining('"valid":true') })
    const capability = JSON.parse(await readFile(access.environment.BEEGAME_ASSET_CAPABILITY_FILE, 'utf8'))
    const response = await fetch(capability.assets.registrationEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration: { operation: 'audio', resources: [] } }) })
    expect(response.status).toBe(409)
    await writeFile(join(game, 'wrong-workspace.json'), JSON.stringify({ ...capability, workspace: root }))
    expect((await run([cli, 'registration.json'], { BEEGAME_ASSET_CAPABILITY_FILE: join(game, 'wrong-workspace.json') })).code).toBe(1)
    await tools.close()
    expect((await run([cli, 'registration.json'])).code).toBe(1)
  } finally { await tools?.close(); await access?.close(); await rm(root, { recursive: true, force: true }) }
}, 30_000)
