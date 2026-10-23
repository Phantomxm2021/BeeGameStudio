import { useEffect,useRef,useState, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Group,Matrix4,Plane,Raycaster,Vector2,Vector3 } from 'three'
import type { GridData,TilemapData,TileCell } from './tilemap-data'
import { boxCells,cellAt,cellLine,paintCells,MAX_PAINT_CELLS,type CellPoint,type TilePaintTool } from './tilemap-paint'

export type TileBrush = {
  nodeId:string; tool:TilePaintTool; tileId:string;
  onPick:(tileId:string)=>void
  onCommit:(nodeId:string,base:TilemapData,cells:TileCell[])=>void
}
export function useTilemapBrush(group:RefObject<Group|null>, grid:GridData, base:TilemapData, ppu:number, brush:TileBrush|undefined, diagnose:(message:string)=>void) {
  const {gl,camera}=useThree()
  const [draft,setDraft]=useState<TilemapData|null>(null),[hover,setHover]=useState<CellPoint|null>(null)
  const callbacks=useRef(brush);callbacks.current=brush
  useEffect(()=>{
    setDraft(null);setHover(null)
    if(!brush) return
    const canvas=gl.domElement, oldCursor=canvas.style.cursor
    canvas.style.cursor=brush.tool==='pick'?'copy':'crosshair'
    const raycaster=new Raycaster(), inverse=new Matrix4(), hit=new Vector3(), plane=new Plane(new Vector3(0,0,1),0)
    let stroke:{id:number;start:CellPoint;last:CellPoint;points:Map<string,CellPoint>}|null=null
    let frame=0
    const locate=(event:PointerEvent)=>{
      if(!group.current) return null
      const rect=canvas.getBoundingClientRect()
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom) return null
      raycaster.setFromCamera(new Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera)
      group.current.updateWorldMatrix(true,false);inverse.copy(group.current.matrixWorld).invert()
      const local=raycaster.ray.clone().applyMatrix4(inverse)
      return local.intersectPlane(plane,hit)?cellAt(grid,hit.x*ppu,-hit.y*ppu):null
    }
    const release=()=>{
      const id=stroke?.id;stroke=null
      if(id!==undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id)
    }
    const cancel=()=>{cancelAnimationFrame(frame);frame=0;release();setDraft(null);setHover(null)}
    const cells=()=>stroke ? paintCells(base.cells,brush.tool==='box'?boxCells(stroke.start,stroke.last):[...stroke.points.values()],brush.tool==='erase'?null:brush.tileId) : base.cells
    const update=(point:CellPoint)=>{
      setHover(previous=>previous?.x===point.x&&previous.y===point.y?previous:point)
      if(!stroke) return
      if(Math.max(Math.abs(point.x-stroke.last.x),Math.abs(point.y-stroke.last.y))>MAX_PAINT_CELLS) throw Error('Brush area too large; zoom in')
      if(brush.tool!=='box')for(const p of cellLine(stroke.last,point))stroke.points.set(`${p.x},${p.y}`,p)
      if(stroke.points.size>MAX_PAINT_CELLS) throw Error('Brush stroke too large; release and paint a smaller area')
      stroke.last=point
      if(!frame)frame=requestAnimationFrame(()=>{frame=0;try{if(stroke)setDraft({...base,cells:cells()})}catch(error){diagnose(String(error));cancel()}})
    }
    const down=(event:PointerEvent)=>{
      if(event.button!==0 || event.altKey || event.ctrlKey || event.metaKey) return
      const p=locate(event);if(!p)return
      event.preventDefault();event.stopImmediatePropagation();canvas.focus({preventScroll:true})
      if(brush.tool==='pick'){
        const tile=base.cells.find(c=>c.x===p.x&&c.y===p.y)
        if(tile)callbacks.current?.onPick(tile.tileId)
        return
      }
      if(brush.tool!=='erase'&&!brush.tileId)return
      stroke={id:event.pointerId,start:p,last:p,points:new Map()}
      canvas.setPointerCapture(event.pointerId)
      try{update(p)}catch(error){diagnose(String(error));cancel()}
    }
    const move=(event:PointerEvent)=>{
      if(stroke && event.pointerId!==stroke.id)return
      if(!stroke && (event.buttons || event.altKey)){setHover(null);return}
      const p=locate(event)
      if(!p){setHover(null);return}
      if(stroke){event.preventDefault();event.stopImmediatePropagation()}
      try{update(p)}catch(error){diagnose(String(error));cancel()}
    }
    const up=(event:PointerEvent)=>{
      if(!stroke || event.pointerId!==stroke.id)return
      event.preventDefault();event.stopImmediatePropagation()
      try{
        const p=locate(event);if(p)update(p)
        const next=cells()
        cancelAnimationFrame(frame);frame=0;release();setDraft(null)
        if(next.length!==base.cells.length || next.some((c,i)=>c.x!==base.cells[i].x||c.y!==base.cells[i].y||c.tileId!==base.cells[i].tileId))
          callbacks.current?.onCommit(brush.nodeId,base,next)
      }catch(error){diagnose(String(error));cancel()}
    }
    const key=(event:KeyboardEvent)=>{
      if(!stroke)return
      // Cancel a draft before Undo/Save or tool shortcuts reach the editor.
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel()}
      else if(event.metaKey||event.ctrlKey)cancel()
    }
    const leave=()=>{if(!stroke)setHover(null)}
    const lost=()=>{if(stroke)cancel()}
    const interrupt=(event:PointerEvent)=>{if(stroke&&(event.button!==0||event.altKey||event.ctrlKey||event.metaKey))cancel()}
    const click=(event:MouseEvent)=>{if(event.button===0&&!event.altKey){event.preventDefault();event.stopImmediatePropagation()}}
    canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('pointermove',move,true);canvas.addEventListener('pointerup',up,true)
    canvas.addEventListener('click',click,true);canvas.addEventListener('pointerleave',leave)
    canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',lost)
    window.addEventListener('blur',cancel);window.addEventListener('keydown',key,true)
    window.addEventListener('pointerdown',interrupt,true)
    return ()=>{
      cancel();canvas.style.cursor=oldCursor
      canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('pointermove',move,true);canvas.removeEventListener('pointerup',up,true)
      canvas.removeEventListener('click',click,true);canvas.removeEventListener('pointerleave',leave)
      canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('lostpointercapture',lost)
      window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key,true)
      window.removeEventListener('pointerdown',interrupt,true)
    }
  },[gl,camera,group,grid,base,ppu,brush?.nodeId,brush?.tool,brush?.tileId,diagnose])
  return {map:draft??base,hover}
}
