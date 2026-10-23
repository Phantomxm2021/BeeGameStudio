import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('publication follows both registries, preserves nested paths and refuses source/output aliases',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-runtime-files-')))
  const {copyRegisteredRuntimeFiles}=await import(new URL('./registered-runtime-files.mjs',import.meta.url).href)
  try {
    for(const dir of ['content/scenes','assets/manifest','assets/runtime','assets/visual','licenses'])
      await mkdir(join(root,dir),{recursive:true})
    await writeFile(join(root,'content/index.json'),JSON.stringify({files:['scenes/main.json']}))
    await writeFile(join(root,'content/scenes/main.json'),JSON.stringify({assetRefs:['library']}))
    await writeFile(join(root,'assets/asset-manifest.json'),JSON.stringify({version:9,
      modules:{requirements:'assets/manifest/requirements.json',resources:['assets/manifest/library.json']}}))
    await writeFile(join(root,'assets/manifest/requirements.json'),'{"requirements":[]}')
    await writeFile(join(root,'assets/manifest/library.json'),JSON.stringify({root_path:'assets/runtime/main.bin',
      file_paths:['assets/runtime/main.bin','assets/runtime/dependency.bin'],
      dependencies:[{local_path:'assets/runtime/dependency.bin'}]}))
    await writeFile(join(root,'assets/runtime/main.bin'),'main')
    await writeFile(join(root,'assets/runtime/dependency.bin'),'dependency')
    await writeFile(join(root,'assets/visual/reference.png'),'not runtime')
    await writeFile(join(root,'licenses/library.txt'),'fixture licence')
    const copied=await copyRegisteredRuntimeFiles(root,'dist',['licenses/library.txt'])
    expect(copied).toContain('assets/runtime/dependency.bin')
    expect(await readFile(join(root,'dist/assets/runtime/dependency.bin'),'utf8')).toBe('dependency')
    expect(await readFile(join(root,'dist/licenses/library.txt'),'utf8')).toBe('fixture licence')
    expect(await Bun.file(join(root,'dist/assets/visual/reference.png')).exists()).toBe(false)
    await expect(copyRegisteredRuntimeFiles(root,'assets')).rejects.toThrow('sources')
    await expect(copyRegisteredRuntimeFiles(root,'../outside')).rejects.toThrow('project-relative')
    await mkdir(join(root,'alias-output'))
    await symlink(join(root,'assets'),join(root,'alias-output/assets'))
    await expect(copyRegisteredRuntimeFiles(root,'alias-output')).rejects.toThrow('parent')
    expect(await readFile(join(root,'assets/runtime/main.bin'),'utf8')).toBe('main')
  } finally { await rm(root,{recursive:true,force:true}) }
})
