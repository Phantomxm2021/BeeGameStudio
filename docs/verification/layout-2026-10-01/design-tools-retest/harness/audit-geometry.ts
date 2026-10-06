import { join } from 'node:path'
import { readFile,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root=import.meta.dir
const workspace=join(root,'projects/users/spatial-test/design-tools-retest-breakout-20261001')
const scene=join(workspace,'content/scenes/breakout_level.json')
const sha256=createHash('sha256').update(await readFile(scene)).digest('hex')
const observations=[]
for(const [width,height] of [[1280,720],[1024,576],[960,540],[960,720],[960,900]]){
  const proc=Bun.spawn([process.execPath,'.beegame/delivery/check-content.mjs','--layout-draft','content/scenes/breakout_level.json',String(width),String(height)],{cwd:workspace,stdout:'pipe',stderr:'pipe'})
  const stdout=await new Response(proc.stdout).text(),stderr=await new Response(proc.stderr).text()
  const exit=await proc.exited
  if(exit!==0)throw Error(stderr||stdout)
  const result=JSON.parse(stdout)
  observations.push({width,height,staticInspectionOnly:true,
    allowedByUiDimensionRule:width>=960&&height>=540&&width>=height,
    outsideNodes:result.nodes.filter((n:any)=>n.fullyInside===false).map((n:any)=>({id:n.id,screenBounds:n.screenBounds,fullyInside:n.fullyInside})),
    view:result.view})
}
const record={source:'content/scenes/breakout_level.json',sha256,projectUnmodified:true,observations}
await writeFile(join(root,'geometry-independent-audit.json'),JSON.stringify(record,null,2))
console.log(JSON.stringify(observations.map(o=>({width:o.width,height:o.height,allowed:o.allowedByUiDimensionRule,outsideNodes:o.outsideNodes.map(n=>n.id)})),null,2))
