import { expect, test } from 'bun:test'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { prepareNativeMcpConfig, NATIVE_MCP_CONFIG_ENV } from './native-mcp-config'
import { nativeRuntimeEnvironment, appendWorkingFilesInstruction } from './native-cli-process-runner'
import { mergeRuntimeEnv } from './session-manager'

test('BGS MCP adapts only enabled bound servers, keeps secrets private and discovers a synthetic native tool',async()=>{
  const root = await realpath(await mkdtemp(join(tmpdir(),'bgs-mcp-config-test-')))
  const require = createRequire(import.meta.url)
  const code = `import {McpServer} from ${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/mcp.js'))};
import {StdioServerTransport} from ${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/stdio.js'))};
const server=new McpServer({name:'fixture',version:'1'});
server.registerTool('export_fixture',{inputSchema:{}},async()=>({content:[{type:'text',text:process.env.FIXTURE_SECRET==='private-value'?'configured':'missing'}]}));
await server.connect(new StdioServerTransport());`
  const server = {id:'fixture',name:'Fixture',enabled:true,autoStart:true,scope:'project',cwd:root,
    transport:'stdio',command:process.execPath,args:['--eval',code],env:[{key:'FIXTURE_SECRET',value:'private-value'}]}
  const env = {[NATIVE_MCP_CONFIG_ENV]:JSON.stringify([server,{...server,id:'disabled',enabled:false},
    {...server,id:'manual',autoStart:false},{...server,id:'unbound',cwd:undefined}])}
  let prepared:Awaited<ReturnType<typeof prepareNativeMcpConfig>>|undefined
  const client = new Client({name:'test',version:'1'})
  try {
    prepared = await prepareNativeMcpConfig(env,root)
    const path=prepared.flags[1]!, configuration=JSON.parse(await readFile(path,'utf8'))
    expect(Object.keys(configuration.mcpServers)).toEqual(['bgs-fixture'])
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(path.startsWith(root+'/')).toBe(false)
    expect(prepared.context).toContain('unbound: not bound')
    expect(prepared.context).not.toContain('private-value')
    expect(nativeRuntimeEnvironment(env)).not.toHaveProperty(NATIVE_MCP_CONFIG_ENV)
    expect(mergeRuntimeEnv({env:{[NATIVE_MCP_CONFIG_ENV]:'model-override'}} as any,env)[NATIVE_MCP_CONFIG_ENV]).toBe(env[NATIVE_MCP_CONFIG_ENV])
    await client.connect(new StdioClientTransport(configuration.mcpServers['bgs-fixture']))
    expect((await client.listTools()).tools.map(tool=>tool.name)).toEqual(['export_fixture'])
    expect(await client.callTool({name:'export_fixture',arguments:{}})).toMatchObject({content:[{text:'configured'}]})
    await client.close()
    await prepared.close()
    await expect(readFile(path)).rejects.toThrow()
    const command=appendWorkingFilesInstruction(['--append-system-prompt','Original'],root,['/approved/tool'])
    expect(command[1]).toContain('/approved/tool')
    expect(command[1]).toContain('not proof of executable compatibility')
  } finally { await client.close();await prepared?.close();await rm(root,{recursive:true,force:true}) }
})
