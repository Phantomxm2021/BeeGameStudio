// Independent audit of this incomplete test. No Agent product writes or model calls.
import { join } from 'node:path'
import { writeFile, copyFile } from 'node:fs/promises'
const root=import.meta.dir
const destination='/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/docs/verification/layout-2026-10-01/contract-retest'
const workspace=join(root,'projects/users/spatial-test/contract-retest-breakout-20261001')
const frozen=join(destination,'final')
const rows=async(path:string)=>(await Bun.file(path).text()).split('\n').filter(Boolean).map(l=>JSON.parse(l))
const main=join(workspace,'.beegame/config/projects/-private-tmp-bgs-contract-retest-VYYNeO-projects-users-spatial-test-contract-retest-breakout-20261001/e8c0406c-3f05-4a98-83b6-73bc50efb222.jsonl')
const child=main.replace(/\.jsonl$/, '/subagents/agent-a5326ccb12750346a.jsonl')
const events=await Bun.file(join(root,'author-4-events.json')).json()
const handoff={mainRows:(await rows(main)).filter(r=>r.timestamp>='2026-10-01T11:40:00Z'),childFinalRows:(await rows(child)).slice(-6),currentTurnTerminalCounts:{completed:events.filter((e:any)=>e.type==='turn.completed').length,failed:events.filter((e:any)=>e.type==='turn.failed').length,stopped:events.filter((e:any)=>e.type==='session.stopped').length},bgsResults:events.filter((e:any)=>e.type==='result').map((e:any)=>({createdAt:e.createdAt,turnId:e.turnId,payload:e.payload}))}
await writeFile(join(destination,'handoff-evidence.json'),JSON.stringify(handoff,null,2),{mode:0o600})
await copyFile(join(root,'author-4-events.json'),join(destination,'author-4-events.json'))
const geometry=await Bun.file(join(destination,'independent-geometry.json')).json()
const game=geometry.geometry.find((g:any)=>g.file==='content/ui/game-hud.json'&&g.viewport[0]===960&&g.viewport[1]===540)
const hud=game.nodes.find((n:any)=>n.id==='hud-strip')
const plane=game.nodes.find((n:any)=>n.id==='camera-plane')
const declared=geometry.geometry.flatMap((g:any)=>g.declaredRegions??[])
const numeric={speed:540,paddleSpeed:1080,radius:14,paddleHalfWidth:110,paddleY:960,paddleHeight:28,brickBottom:478,angleDeg:5,reactionDelay:0.25}
const delta=numeric.paddleY-numeric.paddleHeight/2-numeric.radius-(numeric.brickBottom+numeric.radius)
const theta=numeric.angleDeg*Math.PI/180,time=delta/(numeric.speed*Math.cos(theta))
const atBrickX=1716,paddleAtBrickX=960,ballAtPaddleX=atBrickX+delta*Math.tan(theta)
const record={verdict:'Incomplete real test; BGS/native background handoff stalled, then normal cancellation. No combined Review or Asset Plan was produced.',sourceChangesDuringRun:geometry.sourceChangesDuringRun??[],runtimeVerified:false,fontMeasured:false,
  lifecycle:{parentForegroundReturn:'2026-10-01T11:42:36.771Z',autoBackgroundAfterSeconds:120,childEndTurnAndCompletionEnqueue:'2026-10-01T12:10:58.625Z',resumedParentAfterCompletion:false,normalCancellation:true,currentTurnCompletedCount:handoff.currentTurnTerminalCounts.completed,stateBeforeCancel:{phase:'author',authorBatch:3},stateAfterCancel:{phase:'author',authorBatch:4},interpretation:'Cancellation caused settlement to see the previous turn.completed via an unscoped findLast in project-conversation.ts. This state advancement is not a successful batch-4 completion.',rootCauseScope:'Observed native completion queue was not consumed while the BGS runner awaited parent completion. Precise CLI scheduling defect is not yet isolated.'},
  geometry:{hostCheck:geometry.hostGeometry,declaredOcclusionRegionCount:declared.length,misplacedCanonicalLayoutFieldsRecurred:false,scope:'Nine current UI files parse and pass supported geometric checks. No protected/occluder declarations means the added occlusion check was not exercised.',hud:{viewport:[960,540],hudBounds:hud.bounds,cameraPlaneBounds:plane.bounds,sceneProposedWorldBand:[0,60],projectedBandBottom:plane.bounds.top+60*(plane.bounds.bottom-plane.bounds.top)/1080,hudBottom:hud.bounds.bottom,comparison:'UI sections 5.3 and 16 call its fixed 52 host-pixel HUD inside the proposed 60 world-pixel band; at scale .5 the latter is only 30 host pixels. This is an incorrect unit comparison, not proof of ball/brick occlusion.'}},
  numeric:{...numeric,actualBrickToPaddleCenterContactDistance:delta,actualTimeAt5Deg:time,documentUsedCorridorDistance:402,documentClaimedMinimumDownwardTime:0.74,counterexample:{atBrick:{ballX:atBrickX,ballY:numeric.brickBottom+numeric.radius,paddleX:paddleAtBrickX},ballAtPaddleX,minimumPaddleCenterForOverlap:ballAtPaddleX-numeric.paddleHalfWidth-numeric.radius,maximumPaddleCenterAfterReaction:paddleAtBrickX+numeric.paddleSpeed*(time-numeric.reactionDelay),reachablePrecedingState:'A prior centered paddle bounce at x=1716-440*tan(5deg) sends the ball upward/right at 5deg. During its ~.818s upward trip the paddle can move left to x=960 before the right-bottom brick contact.',scope:'Refutes the stated universal interception proof under its .25s reaction assumption; does not establish global game unfairness or impossibility.'}},
  authority:{gdd:'GDD line 115 still delegates to an unnamed interaction contract as well as UI/UX.',tech:'Technical draft lines 195/248 retain interaction-contract references. No such deliverable exists in the eight-document workflow.',status:'Draft authority-reference risk remains; final Tech batch and combined Review were not reached.'},
  notVerified:['Final Asset frame/core size mapping','Final Tech/Asset SFX production/loading consistency','Combined Review reconciliation','Resource production','Game runtime and fonts'],
  nextStep:'First repair native background completion/parent handoff and prevent stopped turns from advancing with another turn’s completion; use deterministic local regression evidence before authorizing another paid run. Then examine the missing geometric declaration handoff without case-specific numeric answers.'}
await writeFile(join(destination,'independent-audit.json'),JSON.stringify(record,null,2))
await copyFile(import.meta.path,join(destination,'independent-audit.ts'))
console.log(JSON.stringify(record,null,2))
