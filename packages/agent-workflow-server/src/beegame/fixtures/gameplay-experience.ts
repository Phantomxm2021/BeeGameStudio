/** Synthetic playable fixtures, not generated BGS projects or production artwork. */
export const experienceGames = ['collection', 'platformer', 'puzzle', 'defense'] as const
export type ExperienceGame = typeof experienceGames[number]

export function experienceFixture(game: ExperienceGame): string {
  const scripts: Record<ExperienceGame, string> = {
    collection: `
let drops=[],score=0,misses=0,x=80,next=0;
function reset(){ /* restart cleanup */ score=0;misses=0;x=80;next=5;drops.push({x:320,y:30}); }
function step(dt){
 x=Math.max(20,Math.min(620,x+((keys.ArrowRight?1:0)-(keys.ArrowLeft?1:0))*240*dt));
 next-=dt;if(next<=0){drops.push({x:320,y:30});next=2;}
 for(const d of drops){d.y+=180*dt;if(d.y>=300&&!d.done){d.done=true;if(Math.abs(d.x-x)<42){score++;log('caught',score);}else{misses++;log('missed',misses);}}}
 drops=drops.filter(d=>d.y<370);if(score>=3)state='Won';if(misses>=3)state='Lost';
 ctx.fillStyle='#e5a530';for(const d of drops){ctx.beginPath();ctx.arc(d.x,d.y,12,0,7);ctx.fill();}
 ctx.fillStyle='#2a6040';ctx.fillRect(x-30,302,60,24);text='Score '+score+' / 3; Misses '+misses+' / 3';
}`,
    platformer: `
let x=50,y=290,vy=0,grounded=true;
function reset(){x=50;y=290;vy=0;grounded=true;}
function step(dt){
 const oldY=y;x+=((keys.ArrowRight?1:0)-(keys.ArrowLeft?1:0))*200*dt;
 if(keys.Space&&grounded){vy=-480;grounded=false;log('jump');}vy+=1000*dt;y+=vy*dt;
 const floor=x<240||x>380;if(floor&&oldY<=290&&y>=290&&vy>0){y=290;vy=0;grounded=true;}
 if(!floor)grounded=false;if(y>380){state='Lost';log('fall');}if(x>580&&y<=290){state='Won';log('goal');}
 ctx.fillStyle='#546d83';ctx.fillRect(0,320,240,40);ctx.fillRect(380,320,260,40);
 ctx.fillStyle='#e3b43b';ctx.fillRect(590,220,6,100);ctx.fillRect(596,220,30,20);
 ctx.fillStyle='#b94859';ctx.fillRect(x-12,y,24,30);text=grounded?'Grounded':'Airborne';
}`,
    puzzle: `
let lights=[1,0,1],history=[];
function reset(){lights=[1,0,1];history=[];}
for(const [label,index] of [['Toggle left',0],['Toggle middle',1],['Toggle right',2]]){
 const b=button(label,()=>{if(state!=='Playing')return;history.push([...lights]);for(let j=index-1;j<=index+1;j++)if(j>=0&&j<3)lights[j]^=1;log('toggle',index);step();if(lights.every(v=>!v)){state='Won';log('solved');}});}
button('Undo',()=>{if(history.length){lights=history.pop();state='Playing';step();log('undo');}});
function step(){for(let i=0;i<3;i++){ctx.fillStyle=lights[i]?'#efbe45':'#344353';ctx.fillRect(110+i*150,100,100,100);}text='Lights '+lights.join('');}
`,
    defense: `
let tower='',enemy=20,hp=4,bank=1,kills=0;
function reset(){tower='';enemy=20;hp=4;bank=1;kills=0;}
for(const lane of ['top','bottom'])button('Build '+lane,()=>{if(state==='Playing'&&bank){tower=lane;bank--;log('build',lane);}});
function step(dt){enemy+=100*dt;if(tower==='top'&&Math.abs(enemy-320)<140){hp-=5*dt;if(hp<=0){kills++;state='Won';log('defended');}}
 if(enemy>610){state='Lost';log('base-hit');}
 ctx.strokeStyle='#829da7';ctx.lineWidth=12;for(const y of [110,250]){ctx.beginPath();ctx.moveTo(20,y);ctx.lineTo(620,y);ctx.stroke();}
 ctx.fillStyle='#d84d58';ctx.fillRect(enemy-10,100,20,20);ctx.fillStyle='#4caa7d';if(tower)ctx.fillRect(308,tower==='top'?80:220,24,48);
 text='Incoming top lane; Budget '+bank+'; Defended '+kills;
}`,
  }
  const instructions: Record<ExperienceGame, string> = {
    collection: 'Move with left/right arrows. Catch 3 falling tokens; miss 3 and lose. Tokens fall down the central lane.',
    platformer: 'Arrow keys move; Space jumps. Cross the gap and reach the flag. Falling loses; restart tries again.',
    puzzle: 'Turn every light off. A switch changes itself and its immediate neighbours. Undo reverses a move.',
    defense: 'One tower budget. Choose a lane before the announced enemy reaches the base. A tower attacks enemies in its own lane.',
  }
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${game} observation fixture</title>
<style>body{font:16px system-ui;background:#14202c;color:#f4eee1;margin:12px}canvas{background:#20374a;display:block;border:2px solid #aab9b6}h1{font-size:24px;margin:8px 0}button{font:inherit;padding:8px;margin:4px;border-radius:8px}p{max-width:680px;margin:8px 0}</style>
<h1>${game} — synthetic gameplay fixture</h1><p>${instructions[game]}</p><div id="controls"></div>
<canvas width="640" height="360" aria-label="Game field"></canvas><p role="status" id="status"></p>
<script>
const ctx=document.querySelector('canvas').getContext('2d'),status=document.querySelector('#status'),keys={};let state='Ready',text='';
function log(event,value){console.log('game-event',JSON.stringify({event,value,state,at:performance.now()}));}
function button(name,action){const b=document.createElement('button');b.textContent=name;b.onclick=action;document.querySelector('#controls').append(b);return b;}
addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Space'].includes(e.code)){e.preventDefault();keys[e.code]=true;log('key-down',e.code);}});
addEventListener('keyup',e=>{keys[e.code]=false;log('key-up',e.code);});
button('Start',()=>{state='Playing';reset();log('start');});button('Restart',()=>{for(const key in keys)delete keys[key];reset();state='Playing';log('restart');});
${scripts[game]}
let last=performance.now();function frame(now){const dt=Math.min((now-last)/1000,.04);last=now;if(state==='Playing'){ctx.clearRect(0,0,640,360);step(dt);}status.textContent=state+' — '+text;requestAnimationFrame(frame);}requestAnimationFrame(frame);
</script></html>`
}
