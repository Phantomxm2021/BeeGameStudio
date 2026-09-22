// Test page only: count live WebGL handles to check disposal across edits/reopen.
// This does not estimate GPU bytes, FPS, or production performance.
const contexts: Array<{buffers:Set<unknown>;textures:Set<unknown>}>=[]
const original=HTMLCanvasElement.prototype.getContext
const seen=new WeakSet<object>()
HTMLCanvasElement.prototype.getContext=function(...args:any[]){
  const gl=(original as any).apply(this,args)
  if(gl && /^webgl2?$/.test(args[0]) && !seen.has(gl)){
    seen.add(gl)
    const counts={buffers:new Set<unknown>(),textures:new Set<unknown>()};contexts.push(counts)
    for(const [kind,set] of [['Buffer',counts.buffers],['Texture',counts.textures]] as const){
      const create=gl['create'+kind].bind(gl),remove=gl['delete'+kind].bind(gl)
      gl['create'+kind]=()=>{const value=create();if(value)set.add(value);return value}
      gl['delete'+kind]=(value:unknown)=>{set.delete(value);return remove(value)}
    }
    this.addEventListener('webglcontextlost',()=>{counts.buffers.clear();counts.textures.clear()})
  }
  return gl
} as typeof original
export function gpuHandles(){
  return contexts.reduce((total,c)=>({buffers:total.buffers+c.buffers.size,textures:total.textures+c.textures.size}),{buffers:0,textures:0})
}
