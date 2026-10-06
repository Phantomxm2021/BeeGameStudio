// Independent read-only check of the first paddle event, not a repaired game/model.
import { readFile,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const root=import.meta.dir,workspace=join(root,'projects/users/spatial-test/design-tools-retest-breakout-20261001')
const modelBytes=await readFile(join(workspace,'docs/balance_model.mjs'))
const sceneBytes=await readFile(join(workspace,'content/scenes/breakout_level.json'))
const model=modelBytes.toString(),scene=JSON.parse(sceneBytes.toString())
const constant=(key:string)=>{
  const match=model.match(new RegExp('\\b'+key+':\\s*([\\d.]+)'))
  if(!match)throw Error('Missing model parameter: '+key)
  return Number(match[1])
}
const nodes=Object.fromEntries(scene.data.nodes.map((n:any)=>[n.id,n]))
const comp=(n:any,type:string)=>n.components.find((c:any)=>c.type===type).data
const radius=comp(nodes.ball,'circle-collider-2d').radius
const start=nodes.ball.transform.position,angle=constant('serveAngleDeg')*Math.PI/180,speed=constant('ballBaseSpeed')
const vx=speed*Math.sin(angle),vy=-speed*Math.cos(angle)
const candidateBricks=scene.data.nodes.filter((n:any)=>/^brick-r\d+-c\d+$/.test(n.id)).map((n:any)=>{
  const [w,h]=comp(n,'box-collider-2d').size,[x,y]=n.transform.position
  const t=(y+h/2+radius-start[1])/vy,xAt=start[0]+vx*t
  return {id:n.id,t,xAt,bottom:y+h/2+radius,faceInterior:xAt>=x-w/2&&xAt<=x+w/2}
}).filter((b:any)=>b.t>0&&b.faceInterior).sort((a:any,b:any)=>a.t-b.t)
const first=candidateBricks[0]
if(!first)throw Error('No first face collision')
const [pw,ph]=comp(nodes.paddle,'box-collider-2d').size,half=pw/2
const paddleContactY=nodes.paddle.transform.position[1]-ph/2-radius
const tBack=(paddleContactY-first.bottom)/(-vy),xAt=first.xAt+vx*tBack
const bounds=nodes.paddle.data.behaviors.find((b:any)=>b.kind==='paddle.movement').config.bounds
const centerMin=bounds.minX+half,centerMax=bounds.maxX-half
const requestedH=xAt>=centerMin+0.95*half?-0.95:0.95
const paddleCenter=Math.max(centerMin,Math.min(centerMax,xAt-requestedH*half))
const observedH=(xAt-paddleCenter)/half
const maxAngle=constant('maxBounceAngleDeg')
const rightWall=nodes['wall-right'],wallLeft=rightWall.transform.position[0]-comp(rightWall,'box-collider-2d').size[0]/2
const wallTime=(wallLeft-radius-first.xAt)/vx
if(!(tBack<wallTime))throw Error('An intervening side collision needs separate analysis')
const record={method:'Read-only independent first face-hit and return-to-paddle calculation; no product or simulation model edited.',
  sourceHashes:{model:createHash('sha256').update(modelBytes).digest('hex'),scene:createHash('sha256').update(sceneBytes).digest('hex')},
  firstBrick:first,returnContact:{xAt,paddleContactY,paddleCenter,requestedH,observedH,claimedAngleDegrees:requestedH*maxAngle,angleFromAuthoredHitPointRule:observedH*maxAngle},
  interveningWallCollision:false,consistent:Math.abs(requestedH-observedH)<1e-6}
await writeFile(join(root,'balance-independent-audit.json'),JSON.stringify(record,null,2))
console.log(JSON.stringify(record,null,2))
