import {test,expect} from 'bun:test'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,symlink,access} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {readProjectGuide,projectGuideContext,PROJECT_GUIDE_TEMPLATE,projectNavigationSnapshot,projectGuideTemplate,initializeProjectGuide,refreshProjectGuide} from './project-guide'
import {runGameContentCommand} from '../game-content-validation-cli'

test('template is read-only and remains available with an older saved content format',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-guide-template-')))
  try {
    await mkdir(join(root,'.beegame/delivery'),{recursive:true})
    const file=join(root,'.beegame/delivery/content-format.json'),saved='{"coordinates":{"saved":true},"index":{"documentRevision":"must-copy-manually"},"uiDocument":{"obsolete":true}}'
    await writeFile(file,saved)
    expect(runGameContentCommand(root,['--format','projectGuide'])).toMatchObject({ok:true,value:projectGuideTemplate(root).value})
    expect(runGameContentCommand(root,['--format'])).toMatchObject({sections:expect.arrayContaining(['projectGuide'])})
    expect(runGameContentCommand(root,['--format','coordinates'])).not.toMatchObject({value:{saved:true}})
    expect((runGameContentCommand(root,['--format','index']) as any).value).not.toHaveProperty('documentRevision')
    expect((runGameContentCommand(root,['--format','uiDocument']) as any).value.data.nodes[0].data.referenceResolution).toHaveLength(2)
    expect(PROJECT_GUIDE_TEMPLATE).toContain('before related design or implementation decisions')
    expect(PROJECT_GUIDE_TEMPLATE).not.toContain('GDD.md')
    expect(await readFile(file,'utf8')).toBe(saved)
    await expect(access(join(root,'CLAUDE.md'))).rejects.toThrow()
  }finally{await rm(root,{recursive:true,force:true})}
})

test('generated navigation refreshes from saved sources, retains authored text and does not rewrite unchanged facts',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-guide-refresh-')))
  try {
    await initializeProjectGuide(root)
    const path=join(root,'CLAUDE.md'),initial=await readFile(path,'utf8')
    const suffix='\n## Project decisions\nConfirmed entry: src/main.ts\nUSER_NOTES_UNCHANGED\n'
    await writeFile(path,initial+suffix)
    for(const dir of ['docs','src','tests'])await mkdir(join(root,dir))
    await writeFile(join(root,'docs/design.md'),'PROJECT_PROSE_NOT_COPIED')
    await writeFile(join(root,'src/main.ts'),'PROJECT_CODE_NOT_COPIED')
    await writeFile(join(root,'tests/game.test.ts'),'')
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{dev:'actual-dev-command',build:'actual-build-command'}}))
    expect(await refreshProjectGuide(root)).toBe(true)
    const updated=await readFile(path,'utf8')
    for(const value of ['docs/design.md','src/main.ts','tests/game.test.ts','actual-dev-command','actual-build-command'])expect(updated).toContain(value)
    expect(updated).not.toContain('PROJECT_PROSE_NOT_COPIED')
    expect(updated).not.toContain('PROJECT_CODE_NOT_COPIED')
    expect(updated.slice(updated.indexOf('## Professional methods'))).toBe((initial+suffix).slice(initial.indexOf('## Professional methods')))
    expect(await refreshProjectGuide(root)).toBe(false)
    await rm(join(root,'src/main.ts'))
    await writeFile(join(root,'src/new-entry.ts'),'')
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{dev:'changed-dev-command'}}))
    expect(await refreshProjectGuide(root)).toBe(true)
    const changed=await readFile(path,'utf8'),navigation=changed.slice(0,changed.indexOf('## Professional methods'))
    expect(navigation).toContain('src/new-entry.ts')
    expect(navigation).toContain('changed-dev-command')
    expect(navigation).not.toContain('src/main.ts')
    expect(navigation).not.toContain('actual-build-command')
    expect(changed.endsWith(suffix)).toBe(true)
    await writeFile(path,changed.replace('<!-- bgs:source-navigation:end -->',''))
    const malformed=await readFile(path,'utf8')
    await expect(refreshProjectGuide(root)).rejects.toThrow('markers are incomplete')
    expect(await readFile(path,'utf8')).toBe(malformed)
    await writeFile(path,'USER_GUIDE_WITHOUT_MANAGED_BLOCK')
    expect(await refreshProjectGuide(root)).toBe(false)
    await rm(path)
    expect(await refreshProjectGuide(root)).toBe(false)
    await expect(access(path)).rejects.toThrow()
    await writeFile(join(root,'outside.md'),initial)
    await symlink(join(root,'outside.md'),path)
    expect(await refreshProjectGuide(root)).toBe(false)
    expect(await readFile(join(root,'outside.md'),'utf8')).toBe(initial)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('one navigation batch supplies saved commands and actual pointers without prose, values, receipts, capabilities or writes',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-guide-facts-')))
  try {
    for(const dir of ['docs','src','tests','content/scenes','.beegame/tmp'])await mkdir(join(root,dir),{recursive:true})
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{dev:'actual-dev-command',test:'touch MUST_NOT_RUN'}}))
    await writeFile(join(root,'project.godot'),'NATIVE_ROUTE_AUTHORITY')
    await writeFile(join(root,'docs/merged.md'),'PRIVATE_PROSE_PARAMETERS 0.6s 13/13 PASS')
    await writeFile(join(root,'src/game.ts'),'GAME_SOURCE_NOT_COPIED')
    await writeFile(join(root,'tests/journey.mjs'),'TEST_PRECONDITIONS_NOT_GUESSED')
    await writeFile(join(root,'content/index.json'),JSON.stringify({documents:[{path:'scenes/native.json'}]}))
    await writeFile(join(root,'content/scenes/native.json'),JSON.stringify({customNumbers:'NOT_NAVIGATION'}))
    await writeFile(join(root,'.beegame/tmp/private.txt'),'CAPABILITY_SECRET')
    await writeFile(join(root,'CLAUDE.md'),'AUTHOR_ADDED_PROSE_NOT_TEMPLATE')
    const first=projectGuideTemplate(root),before=await readFile(join(root,'CLAUDE.md'),'utf8')
    expect(first.facts).toMatchObject({designFiles:['docs/merged.md'],codeFiles:['src/game.ts'],testFiles:['tests/journey.mjs'],
      registeredContent:['content/scenes/native.json'],commands:{dev:'actual-dev-command',test:'touch MUST_NOT_RUN'},issues:[]})
    for(const path of ['project.godot','docs/merged.md','src/game.ts','tests/journey.mjs','content/scenes/native.json'])expect(first.value).toContain(path)
    for(const absent of ['PRIVATE_PROSE','0.6s','13/13','PASS','NOT_NAVIGATION','CAPABILITY_SECRET','.beegame/tmp/','.beegame/delivery/','AUTHOR_ADDED_PROSE','BEEGAME_PREVIEW_TEST_MODULE','Vite'])
      expect(first.value).not.toContain(absent)
    await expect(access(join(root,'MUST_NOT_RUN'))).rejects.toThrow()
    expect(await readFile(join(root,'CLAUDE.md'),'utf8')).toBe(before)
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{dev:'changed-command'}}))
    expect(projectNavigationSnapshot(root).commands).toEqual({dev:'changed-command'})
    expect(runGameContentCommand(root,['--format','coordinates','projectGuide'])).toMatchObject({ok:true,
      values:{projectGuide:expect.stringContaining('changed-command')}})
  }finally{await rm(root,{recursive:true,force:true})}
})

test('guide delegates discovery to native Skills without installation paths or a second catalog',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-guide-methods-'))),workspace=join(root,'project')
  const previous=process.env.BEEGAME_BUILTIN_SKILLS_DIR
  try {
    await mkdir(workspace)
    const guide=join(workspace,'CLAUDE.md'),saved='EXISTING_USER_NAVIGATION'
    await writeFile(guide,saved)
    process.env.BEEGAME_BUILTIN_SKILLS_DIR=join(root,'old-installation')
    const result=projectGuideTemplate(workspace)
    expect(result.facts).toEqual(projectNavigationSnapshot(workspace))
    expect(result.value).toContain("current session's native metadata")
    expect(result.value).toContain('base directory supplied by that invocation')
    expect(result.value).not.toContain(root)
    expect(result.value).not.toContain('Collection navigator:')
    expect(result.value).not.toContain('Built-in Skill index')
    expect(await readFile(guide,'utf8')).toBe(saved)
    process.env.BEEGAME_BUILTIN_SKILLS_DIR=join(root,'relocated-installation')
    expect(projectGuideTemplate(workspace)).toEqual(result)
    expect(await readFile(guide,'utf8')).toBe(saved)
  } finally {
    if(previous===undefined)delete process.env.BEEGAME_BUILTIN_SKILLS_DIR;else process.env.BEEGAME_BUILTIN_SKILLS_DIR=previous
    await rm(root,{recursive:true,force:true})
  }
})

test('initial guide stays portable and never overwrites a saved file or link',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-guide-initialize-')))
  try {
    const path=join(root,'CLAUDE.md')
    await initializeProjectGuide(root)
    const guide=await readFile(path,'utf8')
    expect(guide.split('\n').length).toBeLessThan(200)
    expect(guide).toContain('with the Skill tool')
    expect(guide).toContain('only the references needed for the task')
    expect(guide).toContain('Do not duplicate the catalog')
    expect(guide).not.toContain('bgs-builtins:')
    expect(guide).not.toContain('Collection navigator:')
    expect(guide).not.toContain(root)
    expect(projectGuideContext(await readProjectGuide(root))).toContain(guide)
    for(const saved of ['USER_AUTHORED_GUIDE','']) {
      await writeFile(path,saved)
      await initializeProjectGuide(root)
      expect(await readFile(path,'utf8')).toBe(saved)
    }
    await rm(path)
    const target=join(root,'user-guide.md')
    await writeFile(target,'USER_LINK_TARGET')
    await symlink(target,path)
    await initializeProjectGuide(root)
    expect(await readFile(target,'utf8')).toBe('USER_LINK_TARGET')
    expect((await readProjectGuide(root)).status).toBe('unavailable')
  }finally{await rm(root,{recursive:true,force:true})}
})

test('navigation diagnoses metadata aliases, malformed/oversized inputs and unsafe registered paths without reading them',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-guide-facts-unsafe-'))),workspace=join(root,'project')
  try {
    await mkdir(workspace);await mkdir(join(workspace,'content'))
    await writeFile(join(root,'secret.json'),'PRIVATE_SIBLING_METADATA')
    await symlink(join(root,'secret.json'),join(workspace,'package.json'))
    await symlink(root,join(workspace,'docs'))
    await writeFile(join(workspace,'content/index.json'),JSON.stringify({documents:[{path:'../../secret.json'},{path:'.private.json'},{path:'missing.json'}]}))
    const unsafe=projectGuideTemplate(workspace)
    expect(unsafe.facts.issues.length).toBe(5)
    expect(unsafe.facts.registeredContent).toEqual([])
    expect(JSON.stringify(unsafe)).not.toContain('PRIVATE_SIBLING_METADATA')
    await rm(join(workspace,'package.json'));await writeFile(join(workspace,'package.json'),'x'.repeat(65537))
    expect(projectNavigationSnapshot(workspace).issues.join('\n')).toContain('no truncated facts')
    await writeFile(join(workspace,'package.json'),'invalid json')
    expect(projectNavigationSnapshot(workspace).commands).toEqual({})
    await writeFile(join(workspace,'package.json'),'{"scripts":"not-an-object"}')
    expect(projectNavigationSnapshot(workspace).issues).toContain('package.json: scripts must be an object')
  }finally{await rm(root,{recursive:true,force:true})}
})

test('single-file guide is current text, not a search, include expansion, setting or command',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-guide-read-'))),workspace=join(root,'game')
  try {
    await mkdir(workspace);await mkdir(join(workspace,'.claude'))
    await writeFile(join(root,'CLAUDE.md'),'PARENT_PRIVATE_NAVIGATION')
    await writeFile(join(workspace,'.claude/CLAUDE.md'),'NESTED_UNREQUESTED_NAVIGATION')
    await writeFile(join(workspace,'extra.md'),'INCLUDED_UNREQUESTED_NAVIGATION')
    await writeFile(join(workspace,'.claude/settings.json'),'{"hooks":{"Stop":[]}}')
    expect(await readProjectGuide(workspace)).toMatchObject({status:'missing'})
    const text='# Project navigation\nRoute: actual Unity\n@extra.md\nCommand: touch SHOULD_NOT_RUN\n'
    const path=join(workspace,'CLAUDE.md');await writeFile(path,text)
    const first=await readProjectGuide(workspace),context=projectGuideContext(first)
    expect(first).toMatchObject({status:'loaded',text,bytes:Buffer.byteLength(text)})
    expect(context).toContain('@extra.md')
    for(const forbidden of ['PARENT_PRIVATE_NAVIGATION','NESTED_UNREQUESTED_NAVIGATION','INCLUDED_UNREQUESTED_NAVIGATION'])
      expect(context).not.toContain(forbidden)
    await expect(access(join(workspace,'SHOULD_NOT_RUN'))).rejects.toThrow()
    expect(await readProjectGuide(workspace)).toEqual(first)
    await writeFile(path,text+'Entry: actual native scene\n')
    const changed=await readProjectGuide(workspace)
    expect(changed.status).toBe('loaded')
    if(first.status==='loaded' && changed.status==='loaded')expect(changed.sha256).not.toBe(first.sha256)
    await rm(path);expect(projectGuideContext(await readProjectGuide(workspace))).not.toContain('actual Unity')
    await writeFile(path,' \n');expect(await readProjectGuide(workspace)).toMatchObject({status:'empty'})
  }finally{await rm(root,{recursive:true,force:true})}
})

test('unsafe, non-text and oversized guides are diagnosed without stale content or truncation',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-guide-input-'))),workspace=join(root,'game')
  try {
    await mkdir(workspace)
    const path=join(workspace,'CLAUDE.md'),outside=join(root,'outside.md')
    await writeFile(outside,'PRIVATE_OUTSIDE_GUIDE');await symlink(outside,path)
    const linked=await readProjectGuide(workspace)
    expect(linked.status).toBe('unavailable');expect(projectGuideContext(linked)).not.toContain('PRIVATE_OUTSIDE_GUIDE')
    await rm(path);await symlink('missing-target',path)
    // A dangling link is also never followed; O_NOFOLLOW reports ELOOP.
    expect((await readProjectGuide(workspace)).status).toBe('unavailable')
    await rm(path);await mkdir(path)
    expect((await readProjectGuide(workspace)).status).toBe('unavailable')
    await rm(path,{recursive:true});await writeFile(path,Buffer.from([0xff,0xfe]))
    expect((await readProjectGuide(workspace)).status).toBe('unavailable')
    await writeFile(path,'binary\u0000text')
    expect((await readProjectGuide(workspace)).status).toBe('unavailable')
    await writeFile(path,'x'.repeat(65537))
    const large=await readProjectGuide(workspace)
    expect(large).toMatchObject({status:'unavailable',reason:expect.stringContaining('no truncated guide')})
    expect(await readFile(path,'utf8')).toHaveLength(65537)
  }finally{await rm(root,{recursive:true,force:true})}
})
