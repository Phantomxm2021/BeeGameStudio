import { readdir, readFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
const root=import.meta.dir
const workspace=join(root,'projects/users/spatial-test/design-tools-retest-breakout-20261001')
const summary=[]
for (const directory of ['docs','content/ui','assets']) {
  try { summary.push({directory,files:await readdir(join(workspace,directory))}) } catch {}
}
const activity=[]
for (const directory of ['transcripts','.beegame/config/projects']) {
  for await (const path of new Bun.Glob('**/*.jsonl').scan({cwd:join(workspace,directory),dot:true,onlyFiles:true})) {
    const bytes=await readFile(join(workspace,directory,path),'utf8')
    for (const line of bytes.split('\n').slice(-20)) {
      try {
        const row=JSON.parse(line), message=row.message??row.payload??row
        for (const block of message.content??[]) {
          if (block.type==='tool_use') activity.push({time:row.timestamp,actor:basename(path),tool:block.name,
            ...(block.name==='Agent'?{description:block.input?.description,resume:Boolean(block.input?.resume)}:{}),
            ...(['Read','Write','Edit'].includes(block.name)?{file:basename(block.input?.file_path??'')}:{}),
            ...(block.name==='Skill'?{skill:block.input?.skill}:{}),
          })
        }
      } catch {}
    }
  }
}
console.log(JSON.stringify({files:summary,activity:activity.sort((a,b)=>(a.time??'').localeCompare(b.time??'')).slice(-15)},null,2))
