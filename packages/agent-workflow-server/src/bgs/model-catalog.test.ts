import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, readFile, chmod, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBgsModelCatalog } from './model-catalog'

test('catalog advertises only the selected model while preserving metadata and withholding credentials', async () => {
  const root = await mkdtemp('/private/tmp/bgs-catalog-export-'), script = join(root, 'export.js')
  const known = {slug:'known',display_name:'Known',context_window:123000,max_context_window:234000,
    model_messages:{instructions_template:'Keep this model instruction.\n# Using skills\nOfficial generic fixture method.\n## Reading\nRead the selected method.\n# Other instructions\nKeep other instructions model-specific.'},truncation_policy:{mode:'tokens',limit:17000},custom_field:{preserved:true}}
  const source = {...known,slug:'gpt-5.6-sol',model_messages:{instructions_template:'Source identity.\n# Using skills\nGPT-5.6 fixture: use a clearly matching Skill and read it completely.\n## Reading\nKeep this subheading.\n# Other instructions\nDo not copy the source identity or this section.'}}
  try {
    await writeFile(script, `if (process.argv.slice(-3).join(' ') !== 'debug models --bundled' || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) process.exit(1);\nprocess.stdout.write(${JSON.stringify(JSON.stringify({models:[known,{...known,slug:"bgs-auto-review"},source]}))})`)
    const input = {cwd:root,command:[process.execPath,script],env:{BGS_HOME:root,OPENAI_API_KEY:'must-not-reach-export',ANTHROPIC_API_KEY:'must-not-reach-export'}}
    for (const model of ['known','unknown',undefined]) {
      const catalog = JSON.parse(await loadBgsModelCatalog({...input,env:{...input.env,...(model ? {BEEGAME_MODEL:model} : {})}}))
      expect(catalog.models).toHaveLength(model === 'known' ? 1 : 0)
      expect(catalog.models.some((entry:any)=>entry.slug==='bgs-auto-review')).toBe(false)
      if (model==='known') expect(catalog.models[0]).toEqual(known)
      if (model==='unknown') expect(catalog).toEqual({models:[]})
    }
    for (const output of ['invalid JSON',JSON.stringify({models:[]})]) {
      await writeFile(script, `process.stdout.write(${JSON.stringify(output)})`)
      await expect(loadBgsModelCatalog(input)).rejects.toThrow('invalid bundled model catalog')
    }
    await writeFile(script, "process.stderr.write('PRIVATE_EXPORT_ERROR');process.exit(1)")
    await expect(loadBgsModelCatalog(input)).rejects.toThrow('BGS could not export its bundled model catalog')
  } finally {await rm(root,{recursive:true,force:true})}
})


test('native bundled directory is shared across models and owners, but invalidated by binary replacement',async()=>{
  const root=await mkdtemp('/private/tmp/bgs-catalog-cache-'),binary=join(root,'bgs'),alias=join(root,'alias'),counter=join(root,'count')
  const catalog=(version:string)=>({models:[{slug:'first',version},{slug:'second',version}]})
  const install=async(version:string,fail=false)=>{
    await writeFile(binary,`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(counter)},'call\\n');
if(process.argv.slice(-3).join(' ')!=='debug models --bundled'||process.env.OPENAI_API_KEY)process.exit(8);
${fail?"process.exit(1)":'process.stdout.write('+JSON.stringify(JSON.stringify(catalog(version)))+')'}`)
    await chmod(binary,0o700)
  }
  const load=(model:string,home=root,command=[binary])=>loadBgsModelCatalog({cwd:root,command,env:{BEEGAME_MODEL:model,BGS_HOME:home,OPENAI_API_KEY:'never-export'}})
  try{
    await install('one');await symlink(binary,alias)
    const results=await Promise.all([load('first'),load('second',join(root,'another-owner')),load('unknown',root,[alias])])
    expect(results.map(value=>JSON.parse(value))).toEqual([{models:[{slug:'first',version:'one'}]},{models:[{slug:'second',version:'one'}]},{models:[]}])
    expect(await readFile(counter,'utf8')).toBe('call\n')
    await install('two')
    expect(JSON.parse(await load('first'))).toEqual({models:[{slug:'first',version:'two'}]})
    expect(await readFile(counter,'utf8')).toBe('call\ncall\n')
    await install('failed',true)
    await expect(load('first')).rejects.toThrow('could not export')
    await expect(load('first')).rejects.toThrow('could not export')
    expect((await readFile(counter,'utf8')).trim().split('\n')).toHaveLength(4)
    await install('recovered')
    expect(JSON.parse(await load('second'))).toEqual({models:[{slug:'second',version:'recovered'}]})
  }finally{await rm(root,{recursive:true,force:true})}
})
