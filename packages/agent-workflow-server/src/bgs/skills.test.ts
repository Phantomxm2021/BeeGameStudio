import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, lstat, realpath, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BgsClient } from './client'
import { configureBgsSkills } from './skills'

for (const mode of ['first', 'warm', 'disabled', 'disabled-uninstalled', 'global-disabled', 'legacy-disabled', 'relocated', 'foreign-source', 'failure'] as const)
test('native plugin preparation preserves native state and removes old discovery: '+mode, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-shared-skills-'))), home = join(root, 'home'), builtins = join(root, 'package', 'bgs-game-skills')
  const directory = join(home, 'skills'), source = join(builtins, 'fixture'), cache = join(root, 'cache')
  await mkdir(directory, {recursive:true}); await mkdir(source, {recursive:true}); await mkdir(join(cache,'fixture'), {recursive:true})
  await writeFile(join(source, 'SKILL.md'), 'Shared source')
  const legacy = join(directory, 'bgs-builtin-fixture')
  await symlink(source, legacy); await symlink(source, join(directory, 'bgs-user-old'))
  await symlink(source, join(directory, 'personal-link'))
  await writeFile(join(directory, 'bgs-builtin-personal-file'), 'Keep')
  const previousSource=join(root,'previous-source')
  if(mode==='relocated') await symlink(builtins,previousSource)
  if(mode==='foreign-source') await mkdir(previousSource)
  const calls: string[] = []
  let installed = mode === 'warm' || mode === 'disabled' || mode === 'legacy-disabled' || mode === 'relocated'
  let disabled = mode === 'disabled' || mode === 'disabled-uninstalled'
  const rules: Array<{path?:string;name?:string;enabled:boolean}>=mode==='legacy-disabled'||mode==='relocated'?[{path:join(mode==='relocated'?join(previousSource,'fixture'):source,'SKILL.md'),enabled:false}]:[]
  const configuration = {config:{marketplaces:mode==='relocated'||mode==='foreign-source'?{'bgs-professional':{source_type:'local',source:previousSource}}:undefined},origins:{},layers:[{name:{type:'user',file:join(home,'config.toml')},version:'fixture',disabledReason:null,config:{features:{plugins:mode!=='global-disabled'},
    plugins:disabled?{'bgs-game-development@bgs-professional':{enabled:false}}:{},skills:{config:rules}}}]}
  const client = {requestNative:async(method:string,params:any)=>{
    calls.push(method)
    if(method==='config/read')return configuration
    if(method==='skills/list')return {data:[{skills:installed?[{name:'bgs-game-development:fixture',pluginId:'bgs-game-development@bgs-professional',enabled:!disabled,path:join(cache,'fixture/SKILL.md')}]:[]}]}
    if(method==='skills/config/write'){expect(params).toEqual({name:'bgs-game-development:fixture',enabled:false});disabled=true;rules.push(params);return {effectiveEnabled:false}}
    if(method==='marketplace/add') {
      expect(params.source).toBe(builtins)
      if(mode==='foreign-source')throw Error('marketplace already added from a different source')
      configuration.config.marketplaces={'bgs-professional':{source_type:'local',source:builtins}}
      return {installedRoot:params.source}
    }
    expect(params).toEqual({marketplacePath:join(mode==='relocated'?previousSource:builtins,'.agents/plugins/marketplace.json'),pluginName:'bgs-game-development'})
    if(method==='plugin/install') {if(mode==='failure')throw Error('native install denied');installed=true;return {authPolicy:'ON_USE',appsNeedingAuth:[]}}
    if(method==='plugin/read') return {plugin:{summary:{installed,enabled:installed&&!disabled},skills:installed?[{path:join(cache,'fixture','SKILL.md')}]:[]}}
    throw Error('Unexpected native method '+method)
  }} as Pick<BgsClient,'requestNative'>
  try {
    if(mode==='failure'||mode==='foreign-source') {
      await expect(configureBgsSkills(client,home,builtins)).rejects.toThrow(mode==='failure'?'native install denied':'different source')
      expect((await lstat(legacy)).isSymbolicLink()).toBe(true)
      return
    }
    const prepared=await configureBgsSkills(client,home,builtins)
    expect(Object.is(prepared.configuration,configuration)).toBe(true)
    expect(prepared.readRoots).toEqual(installed&&!disabled&&mode!=='global-disabled'?[await realpath(cache)]:[])
    expect(calls.filter(call=>call==='plugin/install')).toHaveLength(mode==='first'?1:0)
    expect(calls).not.toContain('skills/extraRoots/set')
    expect(await lstat(legacy).catch(()=>undefined)).toBeUndefined()
    expect(await lstat(join(directory,'bgs-user-old')).catch(()=>undefined)).toBeUndefined()
    expect((await lstat(join(directory,'personal-link'))).isSymbolicLink()).toBe(true)
    expect(await readFile(join(directory,'bgs-builtin-personal-file'),'utf8')).toBe('Keep')
    expect(calls.filter(call=>call==='skills/config/write')).toHaveLength(mode==='legacy-disabled'||mode==='relocated'?1:0)
    if(mode==='warm'||mode==='legacy-disabled'||mode==='relocated') {
      const writes=calls.filter(call=>call==='marketplace/add').length
      await Promise.all(Array.from({length:4},()=>configureBgsSkills(client,home,builtins)))
      expect(calls).not.toContain('plugin/install')
      expect(calls.filter(call=>call==='marketplace/add')).toHaveLength(writes)
      expect(calls.filter(call=>call==='skills/config/write')).toHaveLength(mode==='warm'?0:1)
    }
  } finally {await rm(root,{recursive:true,force:true})}
})
