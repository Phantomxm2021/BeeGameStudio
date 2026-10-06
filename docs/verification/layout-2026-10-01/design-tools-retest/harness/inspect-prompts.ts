import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
const prefix=join(import.meta.dir,'projects/users/spatial-test/design-tools-retest-breakout-20261001/.beegame/config/projects')
for await(const path of new Bun.Glob('**/*.jsonl').scan({cwd:prefix,dot:true,onlyFiles:true})) {
  for(const line of (await readFile(join(prefix,path),'utf8')).split('\n')){
    try{
      const r=JSON.parse(line)
      for(const b of r.message?.content??[]){
        if(b.type==='tool_use'&&b.name==='Agent'&&JSON.stringify(b.input).includes(process.argv[2]??''))
          console.log(JSON.stringify({time:r.timestamp,description:b.input.description,resume:b.input.resume??null,background:b.input.run_in_background??null,prompt:b.input.prompt},null,2))
      }
    }catch{}
  }
}
