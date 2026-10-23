const v = 540, r = 14, padW=220, half=110;
const rad = d => d*Math.PI/180;
console.log('== 飞行时间（逻辑秒，缩放不变）==');
console.log('402px:', (402/v).toFixed(3), ' 1080px:', (1080/v).toFixed(3));
console.log('== 960x540 s=0.5 视在 ==');
console.log('apparent speed:', v*0.5, 'host px/s; 201px:', ((402*0.5)/(v*0.5)).toFixed(3), '540px:', ((1080*0.5)/(v*0.5)).toFixed(3));
console.log('== 分量 ==');
for (const [name,a] of [['发球6',6],['最小5',5],['最大60',60]]) {
  console.log(name, 'vx=',(v*Math.sin(rad(a))).toFixed(1),'vy=',(v*Math.cos(rad(a))).toFixed(1));
}
console.log('== 挡板 ==');
console.log('行程 1920-220 =', 1920-220, '时间=',((1920-220)/1080).toFixed(3));
console.log('屏上 s=0.5: 行程', (1920-220)*0.5, '速度', 1080*0.5);
console.log('== 每帧位移 ==');
for (const f of [60,30,20,15]) console.log(f,'fps:',(v/f).toFixed(1));
console.log('== 往返 ==');
console.log('近垂直 5 单程 402/537.9=',(402/(v*Math.cos(rad(5)))).toFixed(3),'往返',(2*402/(v*Math.cos(rad(5)))).toFixed(2));
console.log('60 单程=',(402/(v*Math.cos(rad(60)))).toFixed(3),'往返',(2*402/(v*Math.cos(rad(60)))).toFixed(2));
console.log('== 发球首触 ==');
const vy=v*Math.cos(rad(6)), vx=v*Math.sin(rad(6));
const dy=926-(478+14); // 球心到砖下沿接触
const t=dy/vy;
console.log('dy=',dy,'t=',t.toFixed(3),'dx=',(vx*t).toFixed(1),'X=',(960+vx*t).toFixed(1));
console.log('c5 span 968..1120');
console.log('== 满分 ==');
console.log('55*50+5*100=',55*50+5*100, ' brick-hits=',55+5*2);
console.log('== 接球可达性 ==');
console.log('0.744s 挡板行程=',(1080*0.744).toFixed(0),' 球最大横漂=',(v*Math.sin(rad(60))*0.744).toFixed(0));
console.log('扣0.25反应: 行程=',(1080*0.494).toFixed(0));
console.log('== 子步 dt clamp ==');
for (const dt of [0.1,0.25]) { const d=v*dt; console.log(dt,'位移',d,'ceil/28=',Math.ceil(d/28),'按18目标=',Math.ceil(d/18)); }
console.log('== 砖缝 vs 球径 ==', 'gap X 16, Y 14; ball 28 -> 不可穿缝');
