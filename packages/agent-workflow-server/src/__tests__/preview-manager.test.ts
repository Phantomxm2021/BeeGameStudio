import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseVitePreviewHostOptions } from '../beegame/vite-preview-host'
import { BeeGamePreviewManager, type BeeGamePreviewProcess } from '../beegame/preview-manager'

describe('BeeGamePreviewManager generic Vite contract', () => {
  const workspaces: string[] = []

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map(workspace => rm(workspace, { recursive: true, force: true })))
  })

  test('production selection never silently reuses development or starts a build', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'preview-modes-'))
    workspaces.push(workspace)
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', preview: 'vite preview', build: 'vite build' }, devDependencies: { vite: '*' } }))
    const calls: { command: string[]; env: Record<string, string> }[] = []
    let stopped = 0
    const manager = new BeeGamePreviewManager((command, options) => {
      calls.push({ command, env: options.env }); return { kill() { stopped++ } }
    }, 63100, async () => 63100, async () => true)
    try {
      await manager.start({ sessionId: 'test', workspacePath: workspace })
      const production = await manager.start({ sessionId: 'test', workspacePath: workspace, mode: 'production' })
      expect(calls).toHaveLength(2)
      expect(stopped).toBe(1)
      expect(production.mode).toBe('production')
      expect(calls[1]!.command).toContain('preview')
      expect(calls[1]!.command).not.toContain('build')
      expect(calls[1]!.env.NODE_ENV).toBe('production')
      await manager.start({ sessionId: 'test', workspacePath: workspace, mode: 'production' })
      expect(calls).toHaveLength(2)
    } finally { manager.dispose() }
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
    const missing = await manager.start({ sessionId: 'missing', workspacePath: workspace, mode: 'production' })
    expect(missing.status).toBe('unsupported')
    expect(calls).toHaveLength(2)
  })

  test('isolates a Vite development client from a production runtime environment', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'generic-vite-preview-'))
    workspaces.push(workspace)
    await writeFile(join(workspace, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite' },
      devDependencies: { vite: '^8.0.0', '@vitejs/plugin-react': '^6.0.0' },
    }))

    const originalNodeEnv = process.env.NODE_ENV
    const originalSecret = process.env.BEEGAME_SKILLS_SERVICE_TOKEN
    const originalCwd = process.cwd()
    const captured: { command?: string[]; env?: Record<string, string> } = {}
    const processes: BeeGamePreviewProcess[] = []
    process.env.NODE_ENV = 'production'
    process.env.BEEGAME_SKILLS_SERVICE_TOKEN = 'must-not-reach-project-preview'
    try {
      const manager = new BeeGamePreviewManager(
        (command, options) => {
          captured.command = command
          captured.env = options.env
          const process = { kill: () => {}, exited: new Promise(() => {}) }
          processes.push(process)
          return process
        },
        63100,
        async () => 63100,
        async () => true,
      )
      await manager.start({ sessionId: 'generic-session', workspacePath: workspace })
      expect(manager.runningForWorkspace(workspace)?.sessionId).toBe('generic-session')
      expect(manager.runningForWorkspace(join(workspace, 'different-project'))).toBeUndefined()
      manager.stop('generic-session', workspace)
      expect(manager.runningForWorkspace(workspace)).toBeUndefined()
    } finally {
      process.chdir(originalCwd)
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = originalNodeEnv
      if (originalSecret === undefined) delete process.env.BEEGAME_SKILLS_SERVICE_TOKEN
      else process.env.BEEGAME_SKILLS_SERVICE_TOKEN = originalSecret
    }

    expect(processes).toHaveLength(1)
    expect(captured.env?.NODE_ENV).toBe('development')
    expect(captured.env?.BEEGAME_SKILLS_SERVICE_TOKEN).toBeUndefined()
    expect(captured.command?.[0]).toBe(process.execPath)
    expect(captured.command?.[1]).toEndWith('vite-preview-host.ts')
    expect(captured.command).toContain('--base')
    expect(captured.command).toContain('/previews/generic-session/')
  })

  test('stops every owned preview process when the server lifecycle is disposed', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'generic-vite-preview-dispose-'))
    workspaces.push(workspace)
    await writeFile(join(workspace, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite' },
      devDependencies: { vite: '^8.0.0' },
    }))
    let killed = 0
    const manager = new BeeGamePreviewManager(
      () => ({
        kill: () => { killed += 1 },
        exited: new Promise(() => {}),
      }),
      63100,
      async () => 63100,
      async () => true,
    )

    await manager.start({ sessionId: 'generic-dispose-session', workspacePath: workspace })
    manager.dispose()

    expect(killed).toBe(1)
    expect(manager.status('generic-dispose-session', workspace).status).toBe('idle')
  })

  const sandboxTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
  sandboxTest('default preview runner keeps dev scripts inside the project sandbox', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preview-sandbox-'))
    const workspace = join(root, 'project')
    const outside = join(root, 'outside')
    await mkdir(workspace, { recursive: true })
    await mkdir(outside, { recursive: true })
    const outsideSecret = join(outside, 'secret.txt')
    const outsideMarker = join(outside, 'marker.txt')
    await writeFile(outsideSecret, 'sandbox-secret')
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { dev: 'node dev.cjs' } }))
    await writeFile(join(workspace, 'dev.cjs'), `const fs=require('node:fs');const path=require('node:path');const outside=path.resolve(process.cwd(),'..','outside');let read=false,write=false;try{fs.readFileSync(path.join(outside,'secret.txt'));read=true}catch{}try{fs.writeFileSync(path.join(outside,'marker.txt'),'escaped');write=true}catch{}fs.mkdirSync(process.env.BGS_VITE_CACHE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.BGS_VITE_CACHE_DIR,'fixture'),'cache');fs.writeFileSync(path.join(process.cwd(),'sandbox-result.json'),JSON.stringify({read,write,cacheDir:process.env.BGS_VITE_CACHE_DIR,runtimeHome:process.env.HOME}));process.on('SIGTERM',()=>{});require('node:http').createServer((_req,res)=>res.end('ok')).listen(Number(process.env.PORT),'127.0.0.1')`)
    const readiness = async (url: string): Promise<boolean> => {
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        try {
          const response = await fetch(url)
          await response.body?.cancel()
          if (response.ok) return true
        } catch { /* The child may still be starting. */ }
        await Bun.sleep(25)
      }
      return false
    }
    const manager = new BeeGamePreviewManager(undefined, 63100, undefined, readiness)
    try {
      const snapshot = await manager.start({ sessionId: 'sandbox-preview', workspacePath: workspace })
      expect(snapshot.status,JSON.stringify({snapshot,current:manager.status('sandbox-preview',workspace)})).toBe('running')
      const result = JSON.parse(await Bun.file(join(workspace, 'sandbox-result.json')).text()) as { read: boolean; write: boolean; cacheDir: string; runtimeHome: string }
      expect(result).toEqual({ read: false, write: false, cacheDir: join(result.runtimeHome,'cache','vite'), runtimeHome: result.runtimeHome })
      expect(result.cacheDir).not.toContain(workspace)
      expect(await readFile(join(result.cacheDir,'fixture'),'utf8')).toBe('cache')
      expect(await Bun.file(outsideMarker).exists()).toBe(false)
      expect(await Bun.file(outsideSecret).text()).toBe('sandbox-secret')
      manager.dispose()
      await Bun.sleep(1_100)
      await expect(fetch(`http://127.0.0.1:${snapshot.port}/`)).rejects.toThrow()
      await expect(stat(result.runtimeHome)).rejects.toMatchObject({code:'ENOENT'})
      // Exercise the real parent -> CLI sandbox -> existing host launch. The
      // small module fixture captures arguments; real Vite refresh is covered
      // by project-execution-cache.native.test.ts.
      const viteRoot=join(workspace,'node_modules/vite')
      await mkdir(viteRoot,{recursive:true})
      await writeFile(join(viteRoot,'package.json'),JSON.stringify({name:'vite',type:'module',main:'index.mjs'}))
      await writeFile(join(viteRoot,'index.mjs'), `
        import {writeFileSync} from 'node:fs';
        import {createServer as httpServer} from 'node:http';
        export async function createServer(config) {
          writeFileSync('vite-start.json',JSON.stringify({argv:process.argv,watch:config.server.watch,cache:config.cacheDir}));
          const server=httpServer((_req,res)=>res.end('VITE_FIXTURE'));
          return {listen:()=>new Promise(resolve=>server.listen(config.server.port,config.server.host,resolve)),
            close:()=>new Promise(resolve=>server.close(resolve)),
            printUrls:()=>console.log('http://127.0.0.1:'+config.server.port+'/')};
        }
      `)
      await writeFile(join(workspace,'package.json'),JSON.stringify({scripts:{dev:'vite'},devDependencies:{vite:'*'}}))
      const viteSnapshot=await manager.start({sessionId:'sandbox-vite',workspacePath:workspace})
      expect(viteSnapshot.status,JSON.stringify(viteSnapshot)).toBe('running')
      const launch=JSON.parse(await readFile(join(workspace,'vite-start.json'),'utf8'))
      expect(launch.argv.slice(-2)).toEqual(['--vite-entry',await realpath(join(viteRoot,'index.mjs'))])
      expect(launch.watch).toEqual(process.platform==='darwin'?{usePolling:true}:undefined)
      expect(launch.cache).not.toContain(workspace)
      await manager.stopAndWait('sandbox-vite',workspace)
      await expect(fetch(`http://127.0.0.1:${viteSnapshot.port}/`)).rejects.toThrow()

    } finally {
      manager.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})


test('preview host parses the parent-resolved entry without changing host/port/base', () => {
  expect(parseVitePreviewHostOptions(['--vite-entry','/current/project/node_modules/vite/dist/node/index.js',
    '--host','127.0.0.1','--port','63101','--base','/previews/project/'])).toEqual({
      viteEntry:'/current/project/node_modules/vite/dist/node/index.js',host:'127.0.0.1',port:63101,base:'/previews/project/'})
})

test('cancelled preview startup stops and awaits its process even when readiness is pending', async () => {
  const root=await mkdtemp(join(tmpdir(),'preview-start-cancel-'))
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{dev:'node dev.cjs'}}))
  const controller=new AbortController()
  let spawned=0,killed=0,exited=false,finish!:()=>void
  const exit=new Promise<void>(resolve=>{finish=()=>{exited=true;resolve()}})
  const manager=new BeeGamePreviewManager(()=>{spawned++;return {kill(){killed++},exited:exit}},
    63100,async()=>63100,async()=>new Promise<boolean>(()=>{}))
  try {
    const starting=manager.start({sessionId:'cancel',workspacePath:root,signal:controller.signal})
    for(let i=0;i<100 && !spawned;i++)await Bun.sleep(1)
    expect(spawned).toBe(1)
    let settled=false
    const result=starting.catch(error=>error).finally(()=>{settled=true})
    controller.abort(new Error('Synthetic pause'))
    await Bun.sleep(5)
    expect(killed).toBe(1);expect(settled).toBe(false)
    finish()
    expect((await result).message).toBe('Synthetic pause')
    expect(exited).toBe(true)
    expect(manager.status('cancel',root).status).toBe('stopped')
    const restored=new BeeGamePreviewManager(()=>{let finish!:()=>void;return {kill(){finish()},exited:new Promise<void>(resolve=>{finish=resolve})}},63100,async()=>63100,async()=>true)
    try {
      expect((await restored.start({sessionId:'cancel',workspacePath:root})).status).toBe('running')
      await restored.stopAndWait('cancel',root)
    }finally{restored.dispose()}
  }finally{finish();manager.dispose();await rm(root,{recursive:true,force:true})}
})


test('partial server/client startup failure closes the already-started server', async () => {
  const root=await mkdtemp(join(tmpdir(),'preview-partial-start-'))
  await mkdir(join(root,'client'));await mkdir(join(root,'server'))
  await writeFile(join(root,'package.json'),'{}')
  await writeFile(join(root,'client/package.json'),JSON.stringify({scripts:{dev:'vite'},devDependencies:{vite:'*'}}))
  await writeFile(join(root,'server/package.json'),JSON.stringify({scripts:{dev:'node server.cjs'}}))
  let calls=0,killed=0
  const manager=new BeeGamePreviewManager(()=>{
    if(++calls===2)throw Error('Synthetic missing client dependency')
    let finish!:()=>void
    return {kill(){killed++;finish()},exited:new Promise<void>(resolve=>{finish=resolve})}
  },63100,async start=>start,async()=>true)
  try {
    await expect(manager.start({sessionId:'partial',workspacePath:root})).rejects.toThrow('Synthetic missing client dependency')
    expect(calls).toBe(2);expect(killed).toBe(1)
    expect(manager.runningForWorkspace(root)).toBeUndefined()
  }finally{manager.dispose();await rm(root,{recursive:true,force:true})}
})


test('output from a stopped preview cannot overwrite its replacement after recovery', async () => {
  const root=await mkdtemp(join(tmpdir(),'preview-late-output-'))
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{dev:'node dev.cjs'}}))
  const output:Array<(text:string)=>void>=[]
  let port=63100
  const manager=new BeeGamePreviewManager((_command,options)=>{
    output.push(options.onOutput);let finish!:()=>void
    return {kill(){finish()},exited:new Promise<void>(resolve=>{finish=resolve})}
  },63100,async()=>port++,async()=>true)
  try {
    await manager.start({sessionId:'same-chat',workspacePath:root})
    await manager.stopAndWait('same-chat',root)
    output[0]!('http://127.0.0.1:60000/')
    expect(manager.status('same-chat',root).status).toBe('stopped')
    const replacement=await manager.start({sessionId:'same-chat',workspacePath:root})
    output[0]!('http://127.0.0.1:60000/')
    expect(manager.status('same-chat',root)).toEqual(replacement)
    expect(manager.internalUrl('same-chat')).toBe('http://127.0.0.1:63101/')
    await manager.stopAndWait('same-chat',root)
  }finally{manager.dispose();await rm(root,{recursive:true,force:true})}
})


test('concurrent preview starts share planning and process ownership without crossing workspaces',async()=>{
  const root=await mkdtemp(join(tmpdir(),'preview-concurrent-start-')),other=join(root,'other')
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{dev:'node dev.cjs'}}))
  await mkdir(other);await writeFile(join(other,'package.json'),'{}')
  let entered!:()=>void,release!:()=>void,allocations=0,spawned=0,killed=0
  const planning=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve)
  const manager=new BeeGamePreviewManager(()=>{spawned++;return {kill(){killed++}}},63100,
    async()=>{allocations++;entered();await gate;return 63100},async()=>true)
  try{
    const a=manager.start({sessionId:'same',workspacePath:root}),b=manager.start({sessionId:'same',workspacePath:root})
    await planning
    expect(manager.status('same',root).status).toBe('starting')
    await expect(manager.start({sessionId:'same',workspacePath:other})).rejects.toThrow('another workspace')
    expect(manager.stop('same',other).status).toBe('starting')
    release();const results=await Promise.all([a,b])
    expect(results[0]).toEqual(results[1]);expect(results[0]!.status).toBe('running')
    expect(allocations).toBe(1);expect(spawned).toBe(1)
    await manager.stopAndWait('same',root);expect(killed).toBe(1)
  }finally{release();manager.dispose();await rm(root,{recursive:true,force:true})}
})

for(const phase of ['planning','readiness'] as const) for(const action of ['stop','abort','dispose','restart'] as const)
  test(`${action} invalidates ${phase} preview startup without affecting its replacement`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'preview-start-superseded-'))
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{dev:'node dev.cjs'}}))
  let entered!:()=>void,release!:()=>void,releaseExit!:()=>void,allocations=0,probes=0
  const waiting=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve)
  const firstExit=new Promise<void>(resolve=>releaseExit=resolve)
  const processes:Array<{alive:boolean;kills:number}>=[]
  const controller=new AbortController()
  const manager=new BeeGamePreviewManager(()=>{
    const index=processes.length,p={alive:true,kills:0};processes.push(p)
    return {kill(){p.alive=false;p.kills++},...(phase==='readiness'&&index===0?{exited:firstExit}:{})}
  },63100,async()=>{
    const index=allocations++
    if(phase==='planning'&&index===0){entered();await gate}
    return 63100+index
  },async()=>{
    if(phase==='readiness'&&probes++===0){entered();await gate}
    return true
  })
  const original=manager.start({sessionId:'same',workspacePath:root,signal:controller.signal}).then(
    ()=>{throw Error('Cancelled startup unexpectedly succeeded')},error=>error)
  try{
    await waiting
    let replacement:ReturnType<BeeGamePreviewManager['start']>|undefined
    if(action==='stop')manager.stop('same',root)
    if(action==='abort')controller.abort(new Error('Fixture caller cancelled'))
    if(action==='dispose')manager.dispose()
    if(action==='restart')replacement=manager.restart({sessionId:'same',workspacePath:root})
    replacement??=manager.start({sessionId:'same',workspacePath:root})
    const current=await replacement
    expect(current).toMatchObject({status:'running',port:63101})
    release();releaseExit()
    expect(await original).toBeInstanceOf(Error)
    // Both late planning/readiness completion and old failure cleanup are inert.
    await Bun.sleep(0)
    expect(manager.status('same',root)).toEqual(current)
    expect(processes.at(-1)!.alive).toBe(true)
    expect(processes.length).toBe(phase==='planning'?1:2)
    if(phase==='readiness')expect(processes[0]).toEqual({alive:false,kills:1})
    await manager.stopAndWait('same',root)
    expect(processes.every(p=>!p.alive&&p.kills===1)).toBe(true)
  }finally{release();releaseExit();await original;manager.dispose();await rm(root,{recursive:true,force:true})}
})
