import { projectHostDirectory, projectWorkDirectory } from './project-storage-paths'
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { projectExecutionAccess } from './project-execution-access'
import { nativeSessionOutputPath } from './native-runtime-process-path'
import { getSafeRuntimeProcessEnvironment } from './runtime-process-environment'
import { bgsCommand, toml } from '../bgs/client'

const localTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
localTest('dependency caches stay outside test discovery and remain writable only within the session sandbox', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-dependency-cache-')))
  const game = join(root, 'game'), pack = join(root, 'package')
  await mkdir(game); await mkdir(join(pack, 'test'), { recursive: true })
  await writeFile(join(pack, 'package.json'), JSON.stringify({name:'bgs-cache-fixture',version:'1.0.0'}))
  await writeFile(join(pack, 'test/dependency.test.js'), 'throw new Error("DEPENDENCY_CACHE_TEST_MUST_NOT_RUN")')
  await writeFile(join(game, 'package.json'), JSON.stringify({name:'synthetic-game',private:true,
    scripts:{'fixture-build':'node -e \"console.log(process.cwd())\"'},dependencies:{'bgs-cache-fixture':'file:./dependency.tgz'}}))
  await writeFile(join(game, 'game.test.js'), 'test("game smoke", () => { expect(1 + 1).toBe(2) })')
  const env = getSafeRuntimeProcessEnvironment()
  const run = async (command: string[], environment = env) => {
    const child = Bun.spawn(command, {cwd:game,env:environment,stdout:'pipe',stderr:'pipe'})
    const [code,out,err] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])
    expect(code, out + err).toBe(0)
    return out
  }
  let access: Awaited<ReturnType<typeof projectExecutionAccess>> | undefined, resumed: typeof access
  const output = nativeSessionOutputPath(game, 'fixture')
  try {
    await run(['tar','-czf',join(game,'dependency.tgz'),'-C',root,'package'])
    access = await projectExecutionAccess({workspacePath:game,sessionId:'fixture',environment:env})
    const hostRecord = join(projectHostDirectory(game), 'chat/project-events.jsonl')
    const adapter = join(projectWorkDirectory(game, 'fixture'), 'adapter.mjs')
    await mkdir(dirname(hostRecord), {recursive:true}); await writeFile(hostRecord, 'HOST_ONLY')
    await writeFile(adapter, 'CURRENT_TOOL')
    const profile = {...access.config.permissions['bgs-project'],network:{enabled:false}}
    const sandbox = (command:string[]) => bgsCommand().concat('sandbox','-C',game,'-P','bgs-project',
      '-c','permissions.bgs-project='+toml(profile),'--',...command)
    const executionEnv = {...env,...access.environment}
    // Bun must tolerate unreadable ancestors without opening the project boundary.
    expect(await run(sandbox([process.execPath,'run','fixture-build']),executionEnv)).toContain(game)
    // Exercise actual Unix IPC in the production sandbox, without networking.
    await run(bgsCommand().concat('sandbox','-C',game,'-P','bgs-project',
      '-c','permissions.bgs-project='+toml(access.config.permissions['bgs-project']),
      '--',Bun.which('node')!, '-e', `
      const net=require('node:net'),path=require('node:path');
      const socket=path.join(process.env.TMPDIR,'tsx-501','74756.pipe');
      require('node:fs').mkdirSync(path.dirname(socket),{recursive:true});
      const server=net.createServer(connection=>{connection.end('IPC_OK');server.close();});
      server.listen(socket,()=>{const client=net.connect(socket);client.on('data',data=>console.log(String(data)));});
      server.on('error',error=>{throw error});
    `),executionEnv).then(out=>expect(out).toContain('IPC_OK'))
    // Both package managers consume only the local archive; the OS denies networking.
    await run(sandbox([process.execPath,'install','--ignore-scripts','--no-progress']),executionEnv)
    await run(sandbox(['npm','cache','add','./dependency.tgz','--offline','--ignore-scripts']),executionEnv)
    expect(await readFile(join(game,'node_modules/bgs-cache-fixture/test/dependency.test.js'),'utf8'))
      .toContain('DEPENDENCY_CACHE_TEST_MUST_NOT_RUN')
    const vitest = fileURLToPath(new URL('../../../../node_modules/vitest/vitest.mjs',import.meta.url))
    const report = JSON.parse(await run([Bun.which('node')!,vitest,'run','--root',game,'--globals',
      '--maxWorkers','1','--no-file-parallelism','--reporter=json']))
    expect(report.numTotalTests).toBe(1)
    expect(report.numFailedTestSuites).toBe(0)
    for (const key of ['XDG_CACHE_HOME','BUN_INSTALL_CACHE_DIR','NPM_CONFIG_CACHE','npm_config_cache']) {
      expect(access.environment[key]!.startsWith(game + '/')).toBe(false)
      expect(access.environment[key]!.startsWith(output + '/')).toBe(true)
    }
    const cache = dirname(access.environment.BUN_INSTALL_CACHE_DIR!)
    expect(profile.filesystem[cache]).toBe('write')
    expect(profile.filesystem[output]).toBe('read')
    expect(profile.filesystem[':slash_tmp']).toBe('deny')
    await writeFile(join(game,'permissions.cjs'), `
      const fs = require('node:fs');
      if (fs.readFileSync(${JSON.stringify(adapter)}, 'utf8') !== 'CURRENT_TOOL') throw Error('Current tool is not readable');
      for (const operation of [() => fs.readdirSync(${JSON.stringify(root)}),
        () => fs.readFileSync(${JSON.stringify(join(pack,'package.json'))}, 'utf8'),
        () => fs.readFileSync(${JSON.stringify(hostRecord)}, 'utf8'),
        () => fs.writeFileSync(${JSON.stringify(hostRecord)}, 'OVERWRITE')]) {
        let denied = false; try {operation()} catch {denied = true}
        if (!denied) throw Error('Project read/write boundary was bypassed');
      }
      for (const name of ['XDG_CACHE_HOME','BUN_INSTALL_CACHE_DIR','NPM_CONFIG_CACHE']) {
        fs.mkdirSync(process.env[name], {recursive:true});
        fs.writeFileSync(require('node:path').join(process.env[name], 'probe'), 'cache');
      }
      let denied = false;
      try { fs.writeFileSync(${JSON.stringify(join(root,'outside-cache'))}, 'forbidden'); }
      catch { denied = true; }
      if (!denied) throw Error('Sibling directory became writable');
    `)
    await run(sandbox([process.execPath,join(game,'permissions.cjs')]),executionEnv)
    await run(bgsCommand().concat('sandbox','-C',game,'-P','bgs-project-review',
      '-c','permissions.bgs-project-review='+toml(access.config.permissions['bgs-project-review']),
      '--',process.execPath,join(game,'permissions.cjs')), {...env,...access.reviewEnvironment})
    expect(await readFile(hostRecord,'utf8')).toBe('HOST_ONLY')
    resumed = await projectExecutionAccess({workspacePath:game,sessionId:'fixture',environment:env})
    expect(resumed.environment.BUN_INSTALL_CACHE_DIR).toBe(access.environment.BUN_INSTALL_CACHE_DIR)
    expect(await readFile(join(resumed.environment.BUN_INSTALL_CACHE_DIR!, 'probe'),'utf8')).toBe('cache')
    // An existing alias must not redirect a later session preparation into game sources.
    await rm(cache,{recursive:true}); await symlink(game,cache,'dir')
    await expect(projectExecutionAccess({workspacePath:game,sessionId:'fixture',environment:env})).rejects.toThrow('link')
  } finally {
    await access?.close();await resumed?.close()
    await rm(output,{recursive:true,force:true})
    await rm(root,{recursive:true,force:true})
  }
}, 30000)


localTest('development file watching observes source writes under the actual native project sandbox', async () => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-development-watch-')))
  const game=join(root,'game')
  await mkdir(game)
  const output=nativeSessionOutputPath(game,'watch')
  const env=getSafeRuntimeProcessEnvironment()
  let access: Awaited<ReturnType<typeof projectExecutionAccess>> | undefined
  try {
    await writeFile(join(game,'source.js'),'before')
    await writeFile(join(game,'watch.cjs'), `
      const fs=require('node:fs');
      let observed=false,failure=null;
      const changed=()=>{if(fs.readFileSync('source.js','utf8')==='after')observed=true;};
      const polling=process.argv.includes('--poll');
      const watcher=polling?null:fs.watch('.', {recursive:true}, changed);
      if(polling)fs.watchFile('source.js',{interval:100},changed);
      watcher?.on('error',error=>{failure=error.code;watcher.close();});
      setTimeout(()=>fs.writeFileSync('source.js','after'),100);
      setTimeout(()=>{watcher?.close();fs.unwatchFile('source.js');console.log(JSON.stringify({polling,observed,failure}));},1200);
    `)
    const baseline=Bun.spawn([Bun.which('node')!,join(game,'watch.cjs')],{cwd:game,env,stdout:'pipe',stderr:'pipe'})
    const [baselineCode,baselineOut,baselineErr]=await Promise.all([baseline.exited,new Response(baseline.stdout).text(),new Response(baseline.stderr).text()])
    expect(baselineCode,baselineOut+baselineErr).toBe(0)
    expect(JSON.parse(baselineOut)).toMatchObject({observed:true})
    await writeFile(join(game,'source.js'),'before')
    access=await projectExecutionAccess({workspacePath:game,sessionId:'watch',environment:env})
    const profile={...access.config.permissions['bgs-project'],network:{enabled:false}}
    const command=bgsCommand().concat('sandbox','-C',game,'-P','bgs-project','-c','permissions.bgs-project='+toml(profile),'--',Bun.which('node')!,join(game,'watch.cjs'))
    const child=Bun.spawn(command,{cwd:game,env:{...env,...access.environment},stdout:'pipe',stderr:'pipe'})
    const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])
    expect(code,out+err).toBe(0)
    expect(JSON.parse(out)).toMatchObject(process.platform==='darwin'
      ? {observed:false,failure:'EMFILE'} : {observed:true,failure:null})
    await writeFile(join(game,'source.js'),'before')
    const pollingChild=Bun.spawn([...command,'--poll'],{cwd:game,env:{...env,...access.environment},stdout:'pipe',stderr:'pipe'})
    const [pollCode,pollOut,pollErr]=await Promise.all([pollingChild.exited,new Response(pollingChild.stdout).text(),new Response(pollingChild.stderr).text()])
    expect(pollCode,pollOut+pollErr).toBe(0)
    expect(JSON.parse(pollOut)).toMatchObject({polling:true,observed:true,failure:null})
    expect(access.reviewEnvironment.CHOKIDAR_USEPOLLING).toBeUndefined()
    expect(profile.filesystem[root]).not.toBe('write')
    // Reuse installed Vite as a read-only fixture dependency. No dev port,
    // browser, package install or project-under-test is involved.
    const modules=fileURLToPath(new URL('../../../../node_modules',import.meta.url))
    const vite=fileURLToPath(new URL('../../../../node_modules/vite/dist/node/index.js',import.meta.url))
    await writeFile(join(game,'vite-watch.mjs'), `
      import {startVitePreviewHost} from ${JSON.stringify(fileURLToPath(new URL('./vite-preview-host.ts',import.meta.url)))};
      import {writeFile} from 'node:fs/promises';
      await writeFile('source.js','export default "before";');
      await writeFile('package.json','{"type":"module"}');
      await writeFile('vite.config.mjs','export default {optimizeDeps:{noDiscovery:true}}');
      const server=await startVitePreviewHost(process.cwd(),{host:'127.0.0.1',port:0,base:'/',viteEntry:${JSON.stringify(await realpath(vite))}});
      try {
        const before=await server.transformRequest('/source.js');
        let observed=false;
        server.watcher.on('change',file=>{if(file.endsWith('/source.js'))observed=true;});
        await new Promise(resolve=>setTimeout(resolve,200));
        await writeFile('source.js','export default "after";');
        await new Promise(resolve=>setTimeout(resolve,1000));
        const after=await server.transformRequest('/source.js');
        console.log(JSON.stringify({observed,before:before.code.includes('"before"'),after:after.code.includes('"after"'),useFsEvents:server.watcher.options.useFsEvents,sandbox:process.env.CODEX_SANDBOX}));
      } finally {await server.close();}
    `)
    profile.filesystem[modules]='read'
    profile.filesystem[fileURLToPath(new URL('.',import.meta.url))]='read'
    profile.network.enabled=true
    const viteCommand=bgsCommand().concat('sandbox','-C',game,'-P','bgs-project','-c','permissions.bgs-project='+toml(profile),'--',process.execPath,join(game,'vite-watch.mjs'))
    const viteChild=Bun.spawn(viteCommand,{cwd:game,env:{...env,...access.environment,BGS_VITE_CACHE_DIR:join(access.environment.XDG_CACHE_HOME!,'vite')},stdout:'pipe',stderr:'pipe'})
    const [viteCode,viteOut,viteErr]=await Promise.all([viteChild.exited,new Response(viteChild.stdout).text(),new Response(viteChild.stderr).text()])
    expect(viteCode,viteOut+viteErr).toBe(0)
    expect(JSON.parse(viteOut.trim().split('\n').at(-1)!)).toEqual({observed:true,before:true,after:true,useFsEvents:false,...(process.platform==='darwin'?{sandbox:'seatbelt'}:{})})
  }finally{await access?.close();await rm(output,{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},15000)


localTest('native document authoring writes docs while source, control files and verification remain read-only',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-native-docs-'))),game=join(root,'game')
  await mkdir(join(game,'assets/manifest'),{recursive:true})
  await writeFile(join(game,'AGENTS.md'),'HOST_GUIDE')
  await writeFile(join(game,'source.js'),'SOURCE')
  await writeFile(join(game,'assets/asset-manifest.json'),'REGISTRY')
  const env=getSafeRuntimeProcessEnvironment()
  let author:Awaited<ReturnType<typeof projectExecutionAccess>>|undefined
  let verifier:typeof author
  const run=async(access:NonNullable<typeof author>,code:string,review=false)=>{
    const profile={...access.config.permissions[review?'bgs-project-review':'bgs-project'],network:{enabled:false}}
    const child=Bun.spawn(bgsCommand().concat('sandbox','-C',game,'-P','bgs-project',
      '-c','permissions.bgs-project='+toml(profile),'--',Bun.which('node')!,'-e',code),
      {cwd:game,env:{...env,...access.environment},stdout:'pipe',stderr:'pipe'})
    const [status,out,error]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])
    expect(status,out+error).toBe(0)
  }
  try {
    author=await projectExecutionAccess({workspacePath:game,sessionId:'author',environment:env,readOnly:true,documentPath:'docs/GDD.md'})
    await run(author,`const fs=require('node:fs');fs.writeFileSync('docs/GDD.md','FIRST');fs.writeFileSync('docs/draft.tmp','REVISED');fs.renameSync('docs/draft.tmp','docs/GDD.md');
      for(const path of ['source.js','AGENTS.md','assets/asset-manifest.json']){let denied=false;try{fs.writeFileSync(path,'BAD')}catch{denied=true}if(!denied)throw Error('Unexpected write: '+path)}`)
    expect(await readFile(join(game,'docs/GDD.md'),'utf8')).toBe('REVISED')
    const rejectWrite=`let denied=false;try{require('node:fs').writeFileSync('docs/GDD.md','BAD')}catch{denied=true}if(!denied)throw Error('Read-only scope allowed document changes')`
    await run(author,rejectWrite,true)
    verifier=await projectExecutionAccess({workspacePath:game,sessionId:'verifier',environment:env,readOnly:true})
    await run(verifier,rejectWrite)
    await author.close();author=await projectExecutionAccess({workspacePath:game,sessionId:'author',environment:env,readOnly:true,documentPath:'docs/GDD.md'})
    await run(author,`require('node:fs').appendFileSync('docs/GDD.md',' RESUMED')`)
    expect(await readFile(join(game,'docs/GDD.md'),'utf8')).toBe('REVISED RESUMED')
    expect(await readFile(join(game,'source.js'),'utf8')).toBe('SOURCE')
    expect(await readFile(join(game,'AGENTS.md'),'utf8')).toBe('HOST_GUIDE')
    expect(await readFile(join(game,'assets/asset-manifest.json'),'utf8')).toBe('REGISTRY')
  }finally{await author?.close();await verifier?.close();await rm(nativeSessionOutputPath(game,'author'),{recursive:true,force:true});await rm(nativeSessionOutputPath(game,'verifier'),{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
},15000)
