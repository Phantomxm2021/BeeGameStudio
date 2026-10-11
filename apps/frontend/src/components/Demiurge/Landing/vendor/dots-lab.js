// Dots Lab renderer adapted from https://dots-lab.pages.dev/ (2026-10-01).
// Upstream geometry, facial catalog and choreography retain their comments.
const TAU=Math.PI*2,PI=Math.PI;

const dpr=()=>Math.min(window.devicePixelRatio||1,2.5);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function hexToRgb(h){h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h,16);return[n>>16&255,n>>8&255,n&255]}
function rgba(h,a){const[r,g,b]=hexToRgb(h);return`rgba(${r},${g},${b},${a})`}
/* couleur complémentaire (teinte + 180°), clarté et saturation recalées pour rester vive ; les neutres prennent un rose vif */
function complement(h){let[r,g,b]=hexToRgb(h).map(v=>v/255);const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let hu=0;
  if(d<.12)return'#FF5AA5';
  hu=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;hu=(hu*60+180+360)%360;
  const sat=.78,l=.58,c=(1-Math.abs(2*l-1))*sat,x=c*(1-Math.abs((hu/60)%2-1)),m=l-c/2;
  const[a1,b1,c1]=hu<60?[c,x,0]:hu<120?[x,c,0]:hu<180?[0,c,x]:hu<240?[0,x,c]:hu<300?[x,0,c]:[c,0,x];
  return'#'+[a1,b1,c1].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('')}
function lum(h){const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};const[r,g,b]=hexToRgb(h);return .2126*f(r)+.7152*f(g)+.0722*f(b)}
function ell(c,x,y,rx,ry,rot=0){c.beginPath();c.ellipse(x,y,Math.max(rx,1e-4),Math.max(ry,1e-4),rot,0,TAU)}
function rrect(c,x,y,w,h,r){r=Math.max(0,Math.min(r,w/2,h/2));c.beginPath();if(c.primRect){c.primRect(x,y,w,h,r);return}c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.arc(x+w-r,y+r,r,-PI/2,0);c.lineTo(x+w,y+h-r);c.arc(x+w-r,y+h-r,r,0,PI/2);c.lineTo(x+r,y+h);c.arc(x+r,y+h-r,r,PI/2,PI);c.lineTo(x,y+r);c.arc(x+r,y+r,r,PI,PI*1.5);c.closePath()}
function sparkle(c,x,y,r,inner=.3){c.beginPath();for(let k=0;k<4;k++){const a=k*PI/2-PI/2,b=a+PI/2;if(!k)c.moveTo(x+Math.cos(a)*r,y+Math.sin(a)*r);c.quadraticCurveTo(x+Math.cos(a+PI/4)*r*inner,y+Math.sin(a+PI/4)*r*inner,x+Math.cos(b)*r,y+Math.sin(b)*r)}c.closePath()}
function pathOf(p){const q=new Path2D();p.forEach(([x,y],i)=>i?q.lineTo(x,y):q.moveTo(x,y));q.closePath();q.pts=p;return q}
function fit(cv,w,h){const d=dpr(),W=Math.round(w*d),H=Math.round(h*d);if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}cv.style.width=w+'px';cv.style.height=h+'px';const x=cv.getContext('2d');x.setTransform(d,0,0,d,0,0);x.clearRect(0,0,w,h);return x}

/* ================= formes : aplats, coins très arrondis ================= */
function superE(n,a,b,N){const p=[];for(let i=0;i<N;i++){const t=TAU*i/N,c=Math.cos(t),s=Math.sin(t);p.push([a*Math.sign(c)*Math.pow(Math.abs(c),2/n),b*Math.sign(s)*Math.pow(Math.abs(s),2/n)])}return p}
function param(N,f){const p=[];for(let i=0;i<N;i++)p.push(f(TAU*i/N));return p}
function polar(N,f){const p=[];for(let i=0;i<N;i++){const a=TAU*i/N,r=f(a);p.push([r*Math.sin(a),-r*Math.cos(a)])}return p}
/* polygone à coins arrondis : chaque sommet devient une quadratique */
function rpoly(V,t,n=18){const p=[],L=V.length;for(let i=0;i<L;i++){const P=V[(i-1+L)%L],Q=V[i],R=V[(i+1)%L];
  const A=[Q[0]+(P[0]-Q[0])*t,Q[1]+(P[1]-Q[1])*t],B=[Q[0]+(R[0]-Q[0])*t,Q[1]+(R[1]-Q[1])*t];
  for(let k=0;k<=n;k++){const u=k/n,m=1-u;p.push([m*m*A[0]+2*m*u*Q[0]+u*u*B[0],m*m*A[1]+2*m*u*Q[1]+u*u*B[1]])}}return p}
/* union de disques vue depuis l'origine (nuage, trèfle) */
function discs(C,N){return polar(N,a=>{const dx=Math.sin(a),dy=-Math.cos(a);let r=0;for(const[x,y,R]of C){const b=dx*x+dy*y,d=b*b-(x*x+y*y)+R*R;if(d>=0)r=Math.max(r,b+Math.sqrt(d))}return r})}
const gauss=(a,c,w)=>{let d=Math.atan2(Math.sin(a-c),Math.cos(a-c));return Math.exp(-(d/w)*(d/w))};
const SHAPE_DEFS=[
  {id:'round',label:'Round',gen:N=>superE(2,1,1,N),fy:0,fs:1},
  {id:'pebble',label:'Pebble',gen:N=>superE(2.3,1,.88,N),fy:0,fs:1},
  {id:'pill',label:'Capsule',gen:N=>superE(3.2,1,.6,N),fy:0,fs:.8},
  {id:'drop',label:'Drop',gen:N=>param(N,t=>[1.1*Math.sin(t)*Math.pow(Math.sin(t/2),.9),-Math.cos(t)]),fy:.26,fs:.82,smooth:12},
  {id:'flame',label:'Flame',gen:N=>polar(N,a=>.72+.52*gauss(a,-.22,.36)+.2*gauss(a,.5,.16)).map(([x,y])=>[x,y>0?y*.92:y]),fy:.2,fs:.84,smooth:10},
  {id:'triangle',label:'Triangle',gen:()=>rpoly([[0,-1],[1,.72],[-1,.72]],.3),fy:.3,fs:.74,smooth:6},
  {id:'square',label:'Square',gen:()=>rpoly([[-.94,-.9],[.96,-.95],[.93,.92],[-.95,.94]],.26),fy:.02,fs:.95,smooth:4},
  {id:'bag',label:'Briefcase',gen:()=>rpoly([[-1,-.56],[1,-.56],[1,.72],[-1,.72]],.16),fy:.12,fs:.9,smooth:4,handle:1,k:.94},
  {id:'star',label:'Star',gen:()=>rpoly(Array.from({length:10},(_,i)=>{const a=i*PI/5,r=i%2?.54:1;return[r*Math.sin(a),-r*Math.cos(a)]}),.26),fy:.08,fs:.76,smooth:6},
  {id:'heart',label:'Heart',gen:N=>param(N,t=>{const s=Math.sin(t);return[16*s*s*s,-(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))]}),fy:-.1,fs:.88,smooth:10},
  {id:'cloud',label:'Cloud',gen:N=>discs([[-.62,.1,.4],[-.26,-.2,.46],[.24,-.22,.44],[.62,.08,.4],[.24,.3,.4],[-.24,.3,.4]],N),fy:.04,fs:.8,smooth:3},
  {id:'clover',label:'Clover',gen:N=>discs([[-.36,-.36,.46],[.36,-.36,.46],[-.36,.36,.46],[.36,.36,.46]],N),fy:.02,fs:.88,smooth:3},
];
function smooth(p,n){for(let k=0;k<n;k++){const L=p.length;p=p.map((q,i)=>{const a=p[(i-1+L)%L],b=p[(i+1)%L];return[(a[0]+2*q[0]+b[0])/4,(a[1]+2*q[1]+b[1])/4]})}return p}
function resample(p,N){const L=p.length,d=[0];for(let i=1;i<=L;i++){const a=p[i-1],b=p[i%L];d.push(d[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1]))}
  const tot=d[L],o=[];let j=0;for(let i=0;i<N;i++){const s=tot*i/N;while(d[j+1]<s)j++;const u=(s-d[j])/((d[j+1]-d[j])||1),a=p[j],b=p[(j+1)%L];o.push([a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u])}return o}
/* bord « dessiné à la main » : ondulation lente le long de la normale */
function wobble(p,seed,amp){const L=p.length;return p.map((q,i)=>{const a=p[(i-1+L)%L],b=p[(i+1)%L];let nx=b[1]-a[1],ny=a[0]-b[0];const l=Math.hypot(nx,ny)||1;
  const th=i/L*TAU,o=amp*(Math.sin(2*th+seed)*.45+Math.sin(3*th+seed*1.7)*.35+Math.sin(5*th+seed*2.9)*.2);return[q[0]+nx/l*o,q[1]+ny/l*o]})}
const SHAPES=SHAPE_DEFS.map((d,si)=>{
  let p=resample(smooth(d.gen(200),d.smooth||2),220);let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
  for(const[x,y]of p){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}
  const cx=(x0+x1)/2,cy=(y0+y1)/2,s=(d.k||1)/Math.max((x1-x0)/2,(y1-y0)/2);
  p=p.map(([x,y])=>[(x-cx)*s,(y-cy)*s]);
  let top=0,bottom=0;for(const[x,y]of p){top=Math.min(top,y);bottom=Math.max(bottom,y)}
  const handle=d.handle?{x:-.34,y:top-.3,w:.68,h:.5,r:.16,lw:.13}:null;
  if(handle)top=handle.y-.06;
  const edge=new Array(72).fill(0);for(const[x,y]of p){const b=Math.round(((Math.atan2(x,-y)+TAU)%TAU)/TAU*72)%72;edge[b]=Math.max(edge[b],Math.hypot(x,y))}
  for(let k=0;k<72;k++)if(!edge[k])edge[k]=Math.max(edge[(k+71)%72],edge[(k+1)%72]);
  return{...d,pts:p,path:pathOf(p),wpath:pathOf(wobble(p,si*1.37+.5,.042)),top,bottom,handle,edge};
});

/* ================= catalogue du visage ================= */
const EYES=[
  {id:'toon',label:'Toon',gap:.2},{id:'pill',label:'Pills',gap:.15},{id:'dot',label:'Dots',gap:.22},{id:'ring',label:'Rings',gap:.32},
  {id:'happy',label:'Happy',gap:.3},{id:'plus',label:'Plus',gap:.32},{id:'dash',label:'Dashes',gap:.2},{id:'slash',label:'Slashes',gap:.3},
  {id:'squint',label:'> <',gap:.28},{id:'wink',label:'Wink',gap:.22},
];
const BROWS=[{id:'none',label:'None'},{id:'flat',label:'Straight'},{id:'angry',label:'Angry'},{id:'worried',label:'Worried'},{id:'sceptic',label:'Skeptical'}];
const MOUTHS=[{id:'none',label:'None'},{id:'smile',label:'Smile'},{id:'open',label:'Open'},{id:'o',label:'Small o'},{id:'flat',label:'Neutral'}];
/* roue : couronne extérieure = teintes vives (dans l'ordre du cercle chromatique), couronne intérieure = neutres et pastels */
const PALETTE=[
  {hex:'#8A5A3A',label:'Hazel',ring:0},{hex:'#EE7433',label:'Orange',ring:0},{hex:'#FFC20E',label:'Sun',ring:0},{hex:'#A8D13B',label:'Lime',ring:0},
  {hex:'#5CCB77',label:'Mint',ring:0},{hex:'#1ED8C0',label:'Lagoon',ring:0},{hex:'#3F95F5',label:'Sky',ring:0},{hex:'#2F6BF0',label:'Royal blue',ring:0},
  {hex:'#9966FF',label:'Lilac',ring:0},{hex:'#8844EE',label:'Violet',ring:0},{hex:'#FF5AA5',label:'Pink',ring:0},{hex:'#FF5A5A',label:'Tomato',ring:0},
  {hex:'#E4E4E1',label:'Chalk',ring:1},{hex:'#F7B8CF',label:'Powder pink',ring:1},{hex:'#B07350',label:'Leather',ring:1},
  {hex:'#161618',label:'Ink',ring:1},{hex:'#8E8E8E',label:'Grey',ring:1},{hex:'#BFE0F5',label:'Pale blue',ring:1},
];
const INKS=[{id:'auto',label:'Auto'},{id:'dark',label:'Black'},{id:'light',label:'White'}];
const STATES=[
  {id:'idle',label:'Idle'},{id:'listen',label:'Listening'},{id:'think',label:'Thinking',look:[.8,-.9]},{id:'write',label:'Writing',look:[.1,.9]},
  {id:'success',label:'Success',hop:1},{id:'alert',label:'Alert'},{id:'error',label:'Error',shake:1},{id:'sleep',label:'Asleep',slow:1},
];
const STATUS_COL={alert:'#FFA42B',error:'#F2545B'};
const DARK='#141416',WHITE='#FFFFFF',FACE=1.45;

const shapeOf=o=>SHAPES.find(s=>s.id===o.shape)||SHAPES[0];
const eyeDef=id=>EYES.find(e=>e.id===id)||EYES[0];
/* encre auto : capsules et tirets blancs (réf. pastilles), le reste noir sauf sur fond très sombre */
function inkOf(o){if(o.ink==='dark')return DARK;if(o.ink==='light')return WHITE;const L=lum(o.color);
  return(o.eyes==='pill'||o.eyes==='dash')?(L>.6?DARK:WHITE):(L<.05?WHITE:DARK)}

/* ================= visage ================= */
let pageInk='#18181B';
function faceSpec(o,st,live){
  let eye=o.eyes,brows=o.brows,mouth='none',k=1;
  if(st.id==='success')eye='happy';else if(st.id==='error'&&!live)eye='x';else if(st.id==='sleep')eye='closed';
  if(st.id==='alert'){k=1.22;brows=brows==='none'?'none':'worried'}
  if(st.id==='listen')k=1.08;
  if(st.id==='error'&&brows!=='none')brows='worried';
  /* la bouche n'est pas un réglage : elle ponctue seulement les états qui l'exigent */
  if(st.id==='success')mouth='open';else if(st.id==='alert')mouth='o';else if(st.id==='error')mouth='frown';
  return{eye,brows,mouth,k};
}
function eyeHalf(t,k){return({toon:.175,pill:.11,dot:.09,ring:.11}[t]||.1)*k}
function drawEye(c,t,s,k,ink,a){
  const b=a.blink,lx=a.look.x,ly=a.look.y;
  c.fillStyle=ink;c.strokeStyle=ink;c.lineCap='round';c.lineJoin='round';
  switch(t){
    case'toon':{const rx=.14*k,ry=.175*k*(1-b*.92);c.fillStyle=WHITE;ell(c,0,0,rx,ry);c.fill();
      if(b<.6){c.save();ell(c,0,0,rx,ry);c.clip();c.fillStyle=DARK;ell(c,-s*.012*k+lx*.045*k,.025*k+ly*.05*k,.085*k,.092*k);c.fill();c.restore()}break}
    case'pill':{const h=.22*k*(1-b*.85);rrect(c,-.04*k,-h/2,.08*k,h,.04*k);c.fill();break}
    case'dot':ell(c,0,0,.085*k,.09*k*(1-b*.9));c.fill();break;
    case'ring':c.lineWidth=.05*k;ell(c,0,0,.09*k,.105*k*(1-b*.85));c.stroke();break;
    case'happy':c.lineWidth=.05*k;c.beginPath();c.moveTo(-.085*k,.05*k);c.lineTo(0,-.07*k);c.lineTo(.085*k,.05*k);c.stroke();break;
    case'plus':c.lineWidth=.055*k;c.beginPath();c.moveTo(-.1*k,0);c.lineTo(.1*k,0);c.moveTo(0,-.1*k);c.lineTo(0,.1*k);c.stroke();break;
    case'dash':{const h=.075*k;rrect(c,-.11*k,-h/2,.22*k,h,h/2);c.fill();break}
    case'slash':c.lineWidth=.05*k;c.beginPath();c.moveTo(-.07*k,.11*k);c.lineTo(.07*k,-.11*k);c.stroke();break;
    case'squint':c.lineWidth=.05*k;c.beginPath();c.moveTo(-s*.07*k,-.08*k);c.lineTo(s*.07*k,0);c.lineTo(-s*.07*k,.08*k);c.stroke();break;
    case'x':c.lineWidth=.05*k;c.beginPath();c.moveTo(-.075*k,-.075*k);c.lineTo(.075*k,.075*k);c.moveTo(.075*k,-.075*k);c.lineTo(-.075*k,.075*k);c.stroke();break;
    case'closed':c.lineWidth=.05*k;c.beginPath();c.arc(0,-.04*k,.09*k,PI*.15,PI*.85);c.stroke();break;
  }
}
function spiral(c,R,rot,ink,lw){c.strokeStyle=ink;c.lineWidth=lw;c.lineCap='round';c.beginPath();
  for(let i=0;i<=48;i++){const u=i/48,an=rot+u*PI*3.2,r=R*u;i?c.lineTo(Math.cos(an)*r,Math.sin(an)*r):c.moveTo(0,0)}c.stroke()}
function drawFace(c,o,f,a,ink){
  const sz=o.size/100,gp=o.gap/100,base=eyeDef(o.eyes).gap,x=base*gp,k=f.k*sz;
  const M=a.merge??0,ex=a.eyeDX??0,ey=a.eyeDY??0,pop=a.eyePop??1,esx=(a.eyeSX??1)*pop,esy=(a.eyeSY??1)*pop,sw=a.swirl??0;
  for(const s of[-1,1]){
    let t=f.eye;if(t==='wink')t=s<0?'toon':'squint';
    c.save();c.translate(s*x+ex+((a.mx??0)-(s*x+ex))*M,ey+((a.my??0)-ey)*M);c.scale(esx,esy);
    if(M>.001){const r=eyeHalf(t,k)*.75+(.11-eyeHalf(t,k)*.75)*M;c.fillStyle=ink;ell(c,0,0,r,r*(1-(a.blink??0)*.9));c.fill()}
    else{
      if(sw<.999){c.save();c.globalAlpha*=1-sw;c.scale(1-sw*.5,1-sw*.5);drawEye(c,t,s,k,ink,a);c.restore()}
      if(sw>.001){c.save();c.globalAlpha*=sw;spiral(c,.1*k*(.4+.6*sw),(a.t??0)*7*s,ink,.04*k);c.restore()}
    }
    c.restore();
  }
  if(f.brows!=='none'&&M<.999){c.save();c.globalAlpha*=1-M;c.translate(ex*.6,ey*.5-(pop-1)*.12);
    const hh=eyeHalf(f.eye==='wink'?'toon':f.eye,k),by=-hh-.075*k,bw=.2*k,bh=.055*k;
    c.fillStyle=ink;
    for(const s of[-1,1]){
      let rot=0,dy=0;
      if(f.brows==='angry')rot=-s*.32;else if(f.brows==='worried')rot=s*.28;
      else if(f.brows==='sceptic'){if(s<0){rot=.3}else{dy=-.05*k;rot=.06}}
      c.save();c.translate(s*x,by+dy-(s>0?(a.browRaise??0):0));c.rotate(rot);rrect(c,-bw/2,-bh/2,bw,bh,bh/2);c.fill();c.restore();
    }
    c.restore();
  }
  const my=Math.max(eyeHalf(f.eye,k),.08)+.1;c.save();c.globalAlpha*=1-clamp((a.eyeDY??0)/.12,0,1);c.translate(a.look.x*.01,my);
  c.fillStyle=ink;c.strokeStyle=ink;c.lineCap='round';c.lineWidth=.045;
  switch(f.mouth){
    case'smile':c.beginPath();c.arc(0,-.04,.075,PI*.18,PI*.82);c.stroke();break;
    case'open':c.beginPath();c.moveTo(-.08,0);c.lineTo(.08,0);c.arc(0,0,.08,0,PI);c.closePath();c.fill();c.save();c.clip();c.fillStyle=WHITE;c.fillRect(-.03,-.01,.06,.035);c.restore();break;
    case'o':ell(c,0,.02,.04,.05);c.fill();break;
    case'flat':c.beginPath();c.moveTo(-.055,.01);c.lineTo(.055,.01);c.stroke();break;
    case'frown':c.beginPath();c.arc(0,.1,.075,PI*1.2,PI*1.8);c.stroke();break;
  }
  c.restore();
}

/* ================= rendu d'un blob ================= */
function drawBlob(c,W,o,a,opt={}){
  const sh=shapeOf(o),C=o.color,ink=inkOf(o),f=faceSpec(o,a.st,!!opt.hero),u=W*(opt.u||.3),sc=a.scale??1;
  if(a.eyeOverride)f.eye=a.eyeOverride;if(a.mouthOverride)f.mouth=a.mouthOverride;
  const tilt=(o.tilt+a.sway)*PI/180,path=sh.path;
  c.save();
  c.translate(W/2+a.shake*u,W*(opt.cy||.5));
  const baseY=u*sh.bottom;
  c.translate(0,baseY-a.hop*u*.42);
  c.scale((1+a.squash)*sc,(1-a.squash)*sc);
  c.translate(0,-baseY);
  c.rotate(tilt);
  c.scale(u,u);
  c.fillStyle=C;
  if(sh.handle){const h=sh.handle;c.strokeStyle=C;c.lineWidth=h.lw;rrect(c,h.x,h.y,h.w,h.h,h.r);c.stroke()}
  c.fill(path);
  c.save();c.translate(a.look.x*.1,sh.fy+a.look.y*.07);c.scale(sh.fs*FACE,sh.fs*FACE);drawFace(c,o,f,a,ink);c.restore();
  c.restore();
  if(opt.hero)drawExtras(c,W,o,a,u,sh,W*(opt.cy||.5)-(a.hop||0)*u*.42);
}
/* petits signes d'état, synchronisés sur la phase p de la chorégraphie */
function drawExtras(c,W,o,a,u,sh,cy){
  const st=a.st,t=a.t,p=a.p??0,cx=W/2,fg=pageInk.startsWith('#')?pageInk:'#141416',
    // A light avatar needs dark badge symbols, not white-on-white in dark mode.
    lightBody=lum(o.color)>.179,badgeInk=lightBody?DARK:WHITE,
    [r0,g0,b0]=hexToRgb(o.color),tint=`rgb(${[r0,g0,b0].map(v=>Math.round(v+(255-v)*.62)).join(',')})`,
    edge=an=>sh.edge[Math.round(((an%TAU+TAU)%TAU)/TAU*72)%72],
    Q=(deg,off)=>{const an=deg*PI/180,r=edge(an)+off;return[cx+Math.sin(an)*r*u,cy-Math.cos(an)*r*u]};
  c.save();c.lineCap='round';c.lineJoin='round';
  if(st.id==='think'){/* bulles de pensée dans une teinte claire du blob, qui partent du bord */
    [[36,.1,.05],[41,.27,.075],[46,.5,.12]].forEach(([d,off,r],i)=>{const k=easeBack(span(p,.1+.07*i,.22+.07*i))*(1-easeIO(span(p,.84,.92)));if(k<=0)return;
      const[X,Y]=Q(d,off);ell(c,X,Y+Math.sin(t*2.2+i)*.015*u,r*u*k*(i===2?1.3:1),r*u*k);c.fillStyle=tint;c.fill()})}
  if(st.id==='write'){const[X,Y]=Q(45,.08),w=.5*u,h=.24*u;rrect(c,X-w/2,Y-h/2,w,h,h/2);c.fillStyle=tint;c.fill();
    c.fillStyle=lightBody?DARK:o.color;for(let k=0;k<3;k++){ell(c,X+(k-1)*.13*u,Y-Math.max(0,Math.sin(t*8-k*.9))*.04*u,.032*u,.032*u);c.fill()}}
  if(a.hearts!=null){c.fillStyle='#FF5AA5';[-28,4,34].forEach((d,k)=>{const v=span(a.hearts,.04+k*.1,.75+k*.08);if(v<=0||v>=1)return;const[X,Y]=Q(d,.08+v*.55),r=.075*u*Math.sin(v*PI);
    c.beginPath();c.arc(X-r/2,Y,r/2,PI,0);c.arc(X+r/2,Y,r/2,PI,0);c.lineTo(X,Y+r*1.15);c.closePath();c.fill()})}
  if(st.id==='success'){c.fillStyle=o.color;
    [-60,-35,-12,12,35,60].forEach((d,i)=>{const v=span(p,.1+.03*i,.62+.03*i);if(v<=0||v>=1)return;const k=Math.sin(v*PI),[X,Y]=Q(d,.12+.3*easeIO(v));sparkle(c,X,Y,(.09+.04*(i%2))*u*k);c.fill()})}
  if(st.id==='alert'||(st.id==='error'&&p>.2)){const k=st.id==='alert'?easeBack(span(p,.05,.2)):easeBack(span(p,.21,.33)),r=.17*u*k*(1+.05*Math.sin(t*6)),[X,Y]=Q(45,.02);
    if(r>0){c.fillStyle=o.color;ell(c,X,Y,r,r);c.fill();c.save();c.translate(X,Y);c.scale(k*.9,k*.9);c.strokeStyle=badgeInk;c.fillStyle=badgeInk;c.lineWidth=.05*u;
      if(st.id==='alert'){c.beginPath();c.moveTo(0,-.09*u);c.lineTo(0,.02*u);c.stroke();ell(c,0,.08*u,.03*u,.03*u);c.fill()}else{c.beginPath();c.moveTo(-.06*u,-.06*u);c.lineTo(.06*u,.06*u);c.moveTo(.06*u,-.06*u);c.lineTo(-.06*u,.06*u);c.stroke()}c.restore()}}
  if(st.id==='sleep'){c.strokeStyle=fg;c.lineWidth=.04*u;for(let k=0;k<3;k++){const ph=(p+k/3)%1,s=(.04+k*.012)*u,[X,Y]=Q(30+ph*14,.05+ph*.4);
    c.globalAlpha=.55*(ph<.16?ph/.16:ph<.72?1:1-(ph-.72)/.28);c.beginPath();c.moveTo(X-s,Y-s);c.lineTo(X+s,Y-s);c.lineTo(X-s,Y+s);c.lineTo(X+s,Y+s);c.stroke()}}
  c.restore();
}
const easeIO=x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
const easeBack=x=>{const k=2.2;return 1+(k+1)*Math.pow(x-1,3)+k*Math.pow(x-1,2)};
const span=(p,a,b)=>clamp((p-a)/(b-a),0,1);
const bump=(p,a,b)=>{const v=span(p,a,b);return v>0&&v<1?Math.sin(v*PI):0};
function blinkAmt(p,list,cyc){let o=1;for(const b of list){const m=b.q?.7:1,cN=.09*m/cyc,oN=.14*m/cyc;let d=p-b.c;if(d>.5)d-=1;if(d<-.5)d+=1;
  if(d>=-cN&&d<=oN)o=Math.min(o,d<0?.5*(1+Math.cos(PI*(d+cN)/cN)):.5*(1-Math.cos(PI*d/oN)))}return 1-o}
function track(tr,p){for(let k=0;k<tr.length-1;k++){const A=tr[k],B=tr[k+1];if(p>=A[0]&&p<=B[0]){const e=(B[3]||easeIO)((p-A[0])/((B[0]-A[0])||1));return[A[1]+(B[1]-A[1])*e,A[2]+(B[2]-A[2])*e]}}return[0,0]}
/* chute des yeux en erreur : parabole puis 3 rebonds amortis */
const BH=[.3,.09,.027],BT=1+2*BH.reduce((q,h)=>q+Math.sqrt(h),0);
function fallH(v){let x=v*BT;if(x<1)return 1-x*x;x-=1;for(const h of BH){const d=2*Math.sqrt(h),r=Math.sqrt(h);if(x<d)return Math.max(0,h-(x-r)*(x-r));x-=d}return 0}
const CYC={idle:5.5,listen:4,think:5.5,write:3.75,success:3.2,alert:3,error:5.5,sleep:3.4};
const TRK={
  idle:[[0,0,0],[.12,0,0],[.2,.75,-.55,easeBack],[.42,.75,-.55],[.5,-.65,.3,easeBack],[.7,-.65,.3],[.78,0,0,easeBack],[1,0,0]],
  alert:[[0,0,0],[.3,0,0],[.36,-.85,-.1,easeBack],[.5,-.85,-.1],[.56,.85,-.1,easeBack],[.7,.85,-.1],[.78,0,0,easeBack],[1,0,0]],
};
function choreo(id,p,T){
  const C={look:null,blink:0,hop:0,squash:0,sway:0,shake:0,eyeDX:0,eyeDY:0,eyeSX:1,eyeSY:1,eyePop:1,merge:0,mx:0,my:0,swirl:0};
  const cyc=CYC[id];
  switch(id){
    case'idle':C.look=track(TRK.idle,p);C.blink=blinkAmt(p,[{c:.3},{c:.8},{c:.87,q:1}],cyc);C.squash=Math.sin(TAU*T/3.2)*.02;C.sway=Math.sin(T*1.1)*1.5;break;
    case'listen':{const nod=bump(p,.12,.24)+bump(p,.28,.4);C.hop=-nod*.1;C.squash=nod*.05+Math.sin(TAU*T/3)*.015;C.blink=blinkAmt(p,[{c:.62}],cyc);C.look=[0,.1];break}
    case'think':{const lk=track([[0,0,0],[.08,.65,-.7,easeBack],[.46,.65,-.7],[.54,-.6,-.65,easeBack],[.84,-.6,-.65],[.9,0,-.05,easeBack],[1,0,0]],p),
        sq=easeIO(span(p,.56,.64))*(1-easeIO(span(p,.8,.86))),aha=bump(p,.88,.97);
      C.look=lk;C.sway=lk[0]*6;C.eyeSY=1-.28*sq;C.eyePop=1+.14*aha;C.hop=.08*aha;C.squash=-.05*aha+.05*(bump(p,.24,.3)+bump(p,.34,.4))+Math.sin(TAU*T/3.4)*.012;
      C.blink=blinkAmt(p,[{c:.5}],cyc);break}
    case'write':{const fr=(p*3)%1,row=Math.floor(p*3)%3,ry=[-.5,-.1,.3],dx=fr<.82?-1+2*(fr/.82):1-2*easeIO((fr-.82)/.18),
      dy=fr<.82?ry[row]:ry[row]+(ry[(row+1)%3]-ry[row])*easeIO((fr-.82)/.18);
      C.look=[dx*.8,dy];C.sway=-2.2*dx;C.squash=Math.max(0,Math.sin(T*9))*.02;C.blink=blinkAmt(p,[{c:.303,q:1},{c:.637,q:1},{c:.97,q:1}],cyc);break}
    case'success':{const j=span(p,.08,.4),land=span(p,.4,.62),cel=easeIO(span(p,.45,.55))*(1-easeIO(span(p,.86,.97)));
      C.hop=j>0&&j<1?Math.sin(j*PI):0;
      C.squash=p<.08?.14*Math.sin(span(p,0,.08)*PI/2):j<1?-.09*Math.sin(j*PI)+.14*(1-span(p,.08,.14)):.17*Math.exp(-land*5)*Math.cos(land*16);
      C.eyeDX=cel*.07*Math.sin(TAU*7*p);C.eyeDY=-cel*.05-C.hop*.04;C.sway=cel*9*Math.sin(TAU*7*p);C.look=[0,-.2];break}
    case'alert':{const pop=easeBack(span(p,.05,.17))*(1-easeIO(span(p,.78,.92)));C.eyePop=1+.28*pop;
      C.hop=bump(p,.05,.2)*.28;C.squash=p<.05?.1*Math.sin(span(p,0,.05)*PI/2):-.08*bump(p,.05,.2);
      C.shake=p>.17&&p<.3?.018*Math.sin(T*70)*(1-span(p,.17,.3)):0;C.look=track(TRK.alert,p);C.blink=blinkAmt(p,[{c:.9}],cyc);break}
    case'error':{const v=span(p,.1,.45),h=v<=0?1:fallH(v),drop=.24,up=easeBack(span(p,.82,.95));
      C.eyeDY=drop*(1-h)*(1-up);
      if(v>0&&v<1){const cq=clamp(1-h/.07,0,1);C.eyeSY=1.12+(.55-1.12)*cq;C.eyeSX=1/Math.sqrt(C.eyeSY)}
      const p0=.1+.35/BT,w=span(p,p0,p0+.13);if(w>0&&w<1){const dec=(1-w)*(1-w);C.shake=.06*dec*Math.sin(TAU*8*w+1);C.hop=-.12*dec*Math.sin(TAU*9*w)}
      C.swirl=easeIO(span(p,.45,.55))*(1-easeIO(span(p,.72,.82)));C.squash=.05*span(p,.2,.3)*(1-span(p,.82,.9));C.sway=-3*span(p,.2,.3)*(1-span(p,.82,.9));
      C.blink=blinkAmt(p,[{c:.07}],cyc);C.look=[0,.15];break}
    case'sleep':C.squash=.035*Math.sin(TAU*p);C.sway=-3+Math.sin(TAU*p);C.eyeDY=.04;C.look=[0,.35];break;
  }
  return C;
}

const B36='0123456789abcdefghijklmnopqrstuvwxyz';
export function readDotToken(t){const m=/^m1([0-9a-z]{8})([0-9a-f]{6})$/.exec(t||'');if(!m)return null;const v=[...m[1]].map(ch=>B36.indexOf(ch)),g=(arr,i)=>arr[i]?arr[i].id:null;
  const o={shape:g(SHAPES,v[0]),eyes:g(EYES,v[1]),brows:g(BROWS,v[2]),ink:g(INKS,v[3]),size:clamp(60+v[4]*5,60,150),gap:clamp(55+v[5]*5,55,160),tilt:clamp(v[6]-15,-15,15),color:'#'+m[2].toUpperCase()};
  return o.shape&&o.eyes&&o.brows&&o.ink?{o,state:v[7]}:null}

// One loop per mounted avatar. Updating its expression retains the last pose,
// so a state switch blends without a blank canvas or a restarted idle frame.
export function animateDot(canvas, initial) {
  let options=initial, frameId=0, lastPose=null, fromPose=null, transitionAt=performance.now(), stateAt=transitionAt, reactionAt=-1e9, reactionKind='tap', lookAt=-1e9;
  const gaze={x:0,y:0}, target={x:0,y:0};
  let gazeWeight=0, previousFrame=transitionAt;
  const draw=(now)=>{
    const id=options.state, T=options.reduced?0:(now-stateAt)/1000, p=options.reduced?0:(T/CYC[id])%1;
    let pose=choreo(id,p,T); pose.look={x:(pose.look||[0,0])[0],y:(pose.look||[0,0])[1]};
    const blend=options.reduced?1:easeIO(clamp((now-transitionAt)/320,0,1));
    if(fromPose && blend<1){
      for(const key of Object.keys(pose)) if(typeof pose[key]==='number') pose[key]=fromPose[key]+(pose[key]-fromPose[key])*blend;
      pose.look={x:fromPose.look.x+(pose.look.x-fromPose.look.x)*blend,y:fromPose.look.y+(pose.look.y-fromPose.look.y)*blend};
    }
    // Smooth gaze in the existing frame loop; pointer events never restart the
    // choreography or trigger a React render. Thinking retains its own gaze.
    const smoothing=1-Math.exp(-Math.max(0,now-previousFrame)/130);previousFrame=now;
    const attending=!options.reduced && (id==='idle'||id==='listen') && now-lookAt<2200;
    gaze.x+=(target.x-gaze.x)*smoothing;gaze.y+=(target.y-gaze.y)*smoothing;
    if(options.reduced)gazeWeight=0;
    else gazeWeight+=((attending?1:0)-gazeWeight)*smoothing;
    pose.look.x+=(gaze.x-pose.look.x)*gazeWeight;
    pose.look.y+=(gaze.y-pose.look.y)*gazeWeight;
    const reaction=(now-reactionAt)/(reactionKind==='tap'?800:420);
    if(!options.reduced && reaction>=0 && reaction<1){
      const pulse=Math.sin(reaction*PI);
      if(reactionKind==='input'){pose.hop-=.1*pulse;pose.squash+=.025*pulse;pose.eyePop+=.035*pulse;}
      else{pose.hop+=(reactionKind==='tap'?.7:.16)*pulse;pose.squash-=(reactionKind==='tap'?.12:.035)*pulse;}
    }
    lastPose=pose;
    const parsed=readDotToken(options.token);const dot=parsed?.o || readDotToken('m110122bj08a5a3a').o;
    const n=canvas.parentElement?.clientWidth||canvas.clientWidth||112, c=fit(canvas,n,n);
    pageInk=options.ink;
    drawBlob(c,n,{...dot,color:options.color,ink:options.color==='#181818'?'light':'dark'}, {...pose,t:T,p,st:{id},scale:1},{hero:true,u:.3,cy:.56});
  };
  const tick=now=>{draw(now);frameId=requestAnimationFrame(tick);};
  draw(performance.now());frameId=requestAnimationFrame(tick);
  return {
    update(next){if(next.state!==options.state){fromPose=lastPose;transitionAt=stateAt=performance.now();}options=next;draw(performance.now());},
    look(x,y){target.x=clamp(x,-1,1);target.y=clamp(y,-1,1);lookAt=performance.now();},
    resetLook(){lookAt=-1e9;},
    react(kind='tap'){reactionKind=kind;reactionAt=performance.now();},
    dispose(){cancelAnimationFrame(frameId);},
  };
}
