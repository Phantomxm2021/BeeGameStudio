import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBgsModelCatalog } from './model-catalog'

test('catalog export preserves known metadata and adds only current compatibility defaults without credentials', async () => {
  const root = await mkdtemp('/private/tmp/bgs-catalog-export-'), script = join(root, 'export.js')
  const known = {slug:'known',display_name:'Known',context_window:123000,max_context_window:234000,
    model_messages:{instructions_template:'Keep this model instruction.'},custom_field:{preserved:true}}
  try {
    await writeFile(script, `if (process.argv.slice(-3).join(' ') !== 'debug models --bundled' || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) process.exit(1);\nprocess.stdout.write(${JSON.stringify(JSON.stringify({models:[known]}))})`)
    const input = {cwd:root,command:[process.execPath,script],env:{BGS_HOME:root,OPENAI_API_KEY:'must-not-reach-export',ANTHROPIC_API_KEY:'must-not-reach-export'}}
    for (const model of ['known','unknown']) {
      const catalog = JSON.parse(await loadBgsModelCatalog({...input,env:{...input.env,BEEGAME_MODEL:model}}))
      expect(catalog.models[0]).toEqual(known)
      expect(catalog.models).toHaveLength(model==='known'?1:2)
      if (model==='unknown') expect(catalog.models[1]).toMatchObject({slug:'unknown',display_name:'unknown',
        context_window:272000,max_context_window:272000,effective_context_window_percent:95,
        include_skills_usage_instructions:true,visibility:'none'})
    }
    for (const output of ['invalid JSON',JSON.stringify({models:[]})]) {
      await writeFile(script, `process.stdout.write(${JSON.stringify(output)})`)
      await expect(loadBgsModelCatalog(input)).rejects.toThrow('invalid bundled model catalog')
    }
    await writeFile(script, "process.stderr.write('PRIVATE_EXPORT_ERROR');process.exit(1)")
    await expect(loadBgsModelCatalog(input)).rejects.toThrow('BGS could not export its bundled model catalog')
  } finally {await rm(root,{recursive:true,force:true})}
})
