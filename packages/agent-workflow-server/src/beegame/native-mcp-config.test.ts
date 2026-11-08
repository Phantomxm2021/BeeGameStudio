import { DEFAULT_REQUEST_TIMEOUT_MSEC } from '@modelcontextprotocol/sdk/shared/protocol.js'
import { expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { prepareNativeMcpConfig, NATIVE_MCP_CONFIG_ENV } from './native-mcp-config'
import { mergeRuntimeEnv } from './session-manager'

test('BGS MCP adapts only enabled bound servers, keeps secrets private and discovers a synthetic native tool',async()=>{
  const root = await realpath(await mkdtemp(join(tmpdir(),'bgs-mcp-config-test-')))
  const require = createRequire(import.meta.url)
  const code = `import {McpServer} from ${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/mcp.js'))};
import {StdioServerTransport} from ${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/stdio.js'))};
const server=new McpServer({name:'fixture',version:'1'});
server.registerTool('export_fixture',{inputSchema:{}},async()=>{
  if(process.platform!=='win32') {
    const {createServer}=await import('node:net');const {join}=await import('node:path');
    const socket=createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(join(process.env.PWTEST_SOCKETS_DIR,'fixture.sock'),resolve)});
    await new Promise((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));
  }
  return {content:[{type:'text',text:process.env.FIXTURE_SECRET==='private-value'?'configured':'missing'}]};
});
await server.connect(new StdioServerTransport());`
  const server = {id:'fixture',name:'Fixture',enabled:true,autoStart:true,scope:'project',cwd:root,
    transport:'stdio',command:process.execPath,args:['--eval',code],env:[{key:'FIXTURE_SECRET',value:'private-value'}]}
  const explicit=join(root,'explicit-sockets');await mkdir(explicit);await writeFile(join(explicit,'retained'),'user-owned')
  const env = {TMPDIR:join(root,'long-project-context-'.repeat(16)),[NATIVE_MCP_CONFIG_ENV]:JSON.stringify([server,
    {...server,id:'explicit',env:[{key:'PWTEST_SOCKETS_DIR',value:explicit}]},
    {...server,id:'empty',env:[{key:'PWTEST_SOCKETS_DIR',value:''}]},
    {...server,id:'global-default',scope:'global',cwd:undefined},
    {...server,id:'disabled',enabled:false},
    {...server,id:'manual',autoStart:false},{...server,id:'unbound',cwd:undefined}])}
  let prepared:Awaited<ReturnType<typeof prepareNativeMcpConfig>>|undefined
  const client = new Client({name:'test',version:'1'})
  let socketDirectory: string | undefined
  try {
    prepared = await prepareNativeMcpConfig(env,root)
    const configuration = prepared.config.mcp_servers as Record<string, any>
    expect(Object.keys(configuration)).toEqual(['bgs-fixture','bgs-explicit','bgs-empty'])
    socketDirectory=configuration['bgs-fixture'].env.PWTEST_SOCKETS_DIR
    expect(socketDirectory).toEqual(expect.any(String))
    if(process.platform!=='win32') {
      expect(Buffer.byteLength(socketDirectory!+'/fixture.sock')).toBeLessThan(103)
      expect((await stat(socketDirectory!)).mode & 0o777).toBe(0o700)
    }
    expect(configuration['bgs-fixture'].env).not.toHaveProperty('TMPDIR')
    expect(env.TMPDIR.length).toBeGreaterThan(300)
    expect(configuration['bgs-explicit'].env.PWTEST_SOCKETS_DIR).toBe(explicit)
    expect(configuration['bgs-empty'].env.PWTEST_SOCKETS_DIR).toBe('')
    const independent=await prepareNativeMcpConfig(env,root)
    const other=(independent.config.mcp_servers as Record<string,any>)['bgs-fixture'].env.PWTEST_SOCKETS_DIR
    expect(other).not.toBe(socketDirectory)
    await independent.close()
    await expect(access(other)).rejects.toMatchObject({code:'ENOENT'})
    expect(configuration['bgs-fixture'].startup_timeout_sec).toBe(DEFAULT_REQUEST_TIMEOUT_MSEC / 1000)
    expect(prepared.context).toContain('unbound: not bound')
    expect(prepared.context).not.toContain('private-value')
    expect(mergeRuntimeEnv({env:{[NATIVE_MCP_CONFIG_ENV]:'model-override'}} as any,env)[NATIVE_MCP_CONFIG_ENV]).toBe(env[NATIVE_MCP_CONFIG_ENV])
    await client.connect(new StdioClientTransport({...configuration['bgs-fixture'],cwd:root}))
    expect((await client.listTools()).tools.map(tool=>tool.name)).toEqual(['export_fixture'])
    expect(await client.callTool({name:'export_fixture',arguments:{}})).toMatchObject({content:[{text:'configured'}]})
    await client.close()
  } finally {
    await client.close();await prepared?.close();await prepared?.close()
    if(socketDirectory)await expect(access(socketDirectory)).rejects.toMatchObject({code:'ENOENT'})
    expect((await stat(join(explicit,'retained'))).isFile()).toBe(true)
    await rm(root,{recursive:true,force:true})
  }
})

test('no host read MCP is prepared for an empty native configuration',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-empty-mcp-')))
  try {
    const prepared=await prepareNativeMcpConfig({},root)
    expect(prepared.config).toEqual({})
    expect(prepared.context).toBe('')
    await prepared.close()
  }finally{await rm(root,{recursive:true,force:true})}
})

test('native MCP carries explicit tool selections for bound stdio and HTTP connections', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-mcp-config-test-')))
  const common = { enabled: true, autoStart: true, scope: 'project', cwd: root }
  const selected = { enabledTools: ['browser_run_code_unsafe'], disabledTools: ['browser_click'] }
  const servers = [
    { ...common, id: 'browser', transport: 'stdio', command: '/fixture/browser', ...selected },
    { ...common, id: 'remote', transport: 'http', url: 'https://fixture.example/mcp', ...selected },
    { ...common, id: 'none', transport: 'stdio', command: '/fixture/none', enabledTools: [] },
    { ...common, id: 'legacy', transport: 'stdio', command: '/fixture/legacy' },
    { ...common, id: 'other-project', transport: 'stdio', command: '/fixture/browser', cwd: undefined, ...selected },
  ]
  const prepared = await prepareNativeMcpConfig({ [NATIVE_MCP_CONFIG_ENV]: JSON.stringify(servers) }, root,
    undefined, { outboundTargetPolicyOptions: { resolve4: () => ['93.184.216.34'], resolve6: () => [] } })
  try {
    const config = prepared.config.mcp_servers as Record<string, any>
    for (const id of ['browser', 'remote']) {
      expect(config['bgs-' + id].enabled_tools).toEqual(selected.enabledTools)
      expect(config['bgs-' + id].disabled_tools).toEqual(selected.disabledTools)
      expect(config['bgs-' + id]).not.toHaveProperty('default_tools_approval_mode')
    }
    expect(config['bgs-remote'].url).toMatch(/^http:\/\/127\.0\.0\.1:/)
    expect(config['bgs-none'].enabled_tools).toEqual([])
    expect(config['bgs-legacy']).not.toHaveProperty('enabled_tools')
    expect(config['bgs-legacy']).not.toHaveProperty('disabled_tools')
    expect(config).not.toHaveProperty('bgs-other-project')
  } finally { await prepared.close(); await rm(root, { recursive: true, force: true }) }
})

test('image MCP receives the existing host decoder explicitly without forwarding unrelated environment',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-image-mcp-config-')))
  try {
    for(const decoder of ['file:///host/image-decoder.mjs','']) {
      const prepared=await prepareNativeMcpConfig({BEEGAME_SHARP_MODULE:decoder,PRIVATE_TOKEN:'not-forwarded'},root,'fixture',{},'/host/images.mjs')
      try {
        const server=(prepared.config.mcp_servers as Record<string,any>)['beegame-images']
        expect(server.env.BEEGAME_ASSET_CAPABILITY_FILE).toEqual(expect.any(String))
        expect(server.env.PRIVATE_TOKEN).toBeUndefined()
        if(decoder)expect(server.env.BEEGAME_SHARP_MODULE).toBe(decoder)
        else expect(server.env).not.toHaveProperty('BEEGAME_SHARP_MODULE')
      }finally{await prepared.close()}
    }
  }finally{await rm(root,{recursive:true,force:true})}
})
