import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Package the existing synthetic source files, never their workspace/home. */
export async function writeFixturePlugin(catalog: string) {
  await mkdir(join(catalog, '.codex-plugin'), { recursive: true })
  await mkdir(join(catalog, '.agents/plugins'), { recursive: true })
  const skills=(await readdir(catalog,{withFileTypes:true}))
    .filter(entry=>entry.isDirectory()&&existsSync(join(catalog,entry.name,'SKILL.md')))
    .map(entry=>'./'+entry.name)
  await writeFile(join(catalog, '.codex-plugin/plugin.json'), JSON.stringify({
    name:'bgs-game-development', version:'1.0.0', skills,
  }))
  await writeFile(join(catalog, '.agents/plugins/marketplace.json'), JSON.stringify({
    name:'bgs-professional', plugins:[{name:'bgs-game-development', source:{source:'local',path:'./'},
      policy:{installation:'INSTALLED_BY_DEFAULT',authentication:'ON_USE'},category:'Developer Tools'}],
  }))
  return catalog
}
