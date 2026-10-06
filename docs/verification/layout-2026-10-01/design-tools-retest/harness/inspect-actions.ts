import { readFile } from 'node:fs/promises'
import { join,basename } from 'node:path'
const workspace=join(import.meta.dir,'projects/users/spatial-test/design-tools-retest-breakout-20261001')
const prefix=join(workspace,'.beegame/config/projects')
const rows:any[]=[]
for await(const path of new Bun.Glob('**/*.jsonl').scan({cwd:prefix,dot:true,onlyFiles:true})) {
  for(const line of (await readFile(join(prefix,path),'utf8')).split('\n')) {
    try {
      const r=JSON.parse(line)
      for(const b of r.message?.content??[]) {
        if(b.type!=='tool_use')continue
        rows.push({time:r.timestamp,actor:basename(path),tool:b.name,
          ...(['Write','Read','Edit'].includes(b.name)?{file:b.input?.file_path}:{}),
          ...(b.name==='Agent'?{description:b.input?.description,resume:b.input?.resume??null}:{}),
          ...(b.name==='Bash'?{description:b.input?.description,command:b.input?.command?.slice(0,500)}:{})})
      }
    }catch{}
  }
}
const filter=process.argv[2]
console.log(JSON.stringify(rows.filter(r=>!filter||JSON.stringify(r).includes(filter)).sort((a,b)=>a.time.localeCompare(b.time)).slice(-Number(process.argv[3]??20)),null,2))
