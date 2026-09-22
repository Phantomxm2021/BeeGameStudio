import { useRef } from 'react'
import { act,render,cleanup } from '@testing-library/react'
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest'
import { Group,OrthographicCamera,Vector3 } from 'three'
import { useTilemapBrush,type TileBrush } from '../../../../../packages/scene-editor/src/tilemap-brush'
import type { GridData,TilemapData } from '../../../../../packages/scene-editor/src/tilemap-data'

const state=vi.hoisted(()=>({context:{} as any}))
vi.mock('@react-three/fiber',()=>({useThree:()=>state.context}))
const grid:GridData={schema:'grid.v1',cellSize:[32,32]}
const base:TilemapData={schema:'tilemap.v1',gridNodeId:'grid',cells:[]}
let canvas:HTMLCanvasElement,group:Group,camera:OrthographicCamera,brush:TileBrush
const diagnose=vi.fn()
function Harness({active=brush,data=base}:{active?:TileBrush;data?:TilemapData}){
  const ref=useRef(group)
  const {map}=useTilemapBrush(ref,grid,data,32,active,diagnose)
  return <output data-testid="draft">{map.cells.length}</output>
}
function pointer(type:string,x:number,y:number,button=0){
  const event=new MouseEvent(type,{clientX:x,clientY:y,button,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true})
  Object.defineProperty(event,'pointerId',{value:1})
  act(()=>{canvas.dispatchEvent(event)})
}
function point(x:number,y:number){
  const p=new Vector3(x+.5,-y-.5,0);group.localToWorld(p);p.project(camera)
  return [(p.x+1)*100,(1-p.y)*100] as const
}
beforeEach(()=>{
  vi.useFakeTimers();diagnose.mockClear()
  canvas=document.createElement('canvas');document.body.append(canvas)
  canvas.getBoundingClientRect=()=>({left:0,top:0,right:200,bottom:200,width:200,height:200,x:0,y:0,toJSON:()=>({})})
  let captured=false
  canvas.setPointerCapture=()=>{captured=true}
  canvas.hasPointerCapture=()=>captured
  canvas.releasePointerCapture=()=>{captured=false}
  camera=new OrthographicCamera(-5,5,5,-5,.1,100);camera.position.z=10;camera.updateMatrixWorld()
  group=new Group()
  state.context={gl:{domElement:canvas},camera}
  brush={nodeId:'map',tool:'paint',tileId:'ground',onPick:vi.fn(),onCommit:vi.fn()}
})
afterEach(()=>{cleanup();canvas.remove();vi.useRealTimers()})
describe('Tilemap pointer stroke lifecycle',()=>{
  it('previews while dragging, then commits one complete stroke on release',()=>{
    const view=render(<Harness/>)
    pointer('pointerdown',...point(0,0));pointer('pointermove',...point(3,0))
    act(()=>vi.advanceTimersByTime(20))
    expect(view.getByTestId('draft').textContent).toBe('4')
    expect(brush.onCommit).not.toHaveBeenCalled()
    pointer('pointerup',...point(3,0))
    expect(brush.onCommit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(brush.onCommit).mock.calls[0][2]).toHaveLength(4)
    expect(base.cells).toEqual([])
  })
  it.each(['Escape','blur','pointercancel','lostpointercapture'])('discards the draft on %s',reason=>{
    const view=render(<Harness/>)
    pointer('pointerdown',...point(0,0));pointer('pointermove',...point(2,0))
    act(()=>vi.advanceTimersByTime(20))
    act(()=>{
      if(reason==='Escape')window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
      else if(reason==='blur')window.dispatchEvent(new Event('blur'))
      else canvas.dispatchEvent(new Event(reason))
    })
    pointer('pointerup',...point(2,0))
    expect(view.getByTestId('draft').textContent).toBe('0')
    expect(brush.onCommit).not.toHaveBeenCalled()
  })
  it('cancels on target change and removes handlers on unmount',()=>{
    const view=render(<Harness/>)
    pointer('pointerdown',...point(0,0))
    view.rerender(<Harness active={{...brush,nodeId:'other'}}/>)
    pointer('pointerup',...point(2,0))
    expect(brush.onCommit).not.toHaveBeenCalled()
    view.unmount()
    pointer('pointerdown',...point(0,0));pointer('pointerup',...point(2,0))
    expect(brush.onCommit).not.toHaveBeenCalled()
  })
  it('uses the actual parent translation, rotation and scale for cell coordinates',()=>{
    const parent=new Group();parent.position.set(1,1,0);parent.rotation.z=.7;parent.scale.set(1.3,.8,1)
    parent.add(group);group.position.set(-1,0,0);parent.updateMatrixWorld(true)
    render(<Harness/>)
    pointer('pointerdown',...point(-1,1));pointer('pointerup',...point(-1,1))
    expect(vi.mocked(brush.onCommit).mock.calls[0][2]).toEqual([{x:-1,y:1,tileId:'ground'}])
  })
  it('leaves right/middle mouse navigation alone',()=>{
    render(<Harness/>)
    for(const button of [1,2]){pointer('pointerdown',...point(0,0),button);pointer('pointermove',...point(2,0),button);pointer('pointerup',...point(2,0),button)}
    expect(brush.onCommit).not.toHaveBeenCalled()
  })
  it('picks the authored cell, not an overlapping tall sprite, without a commit',()=>{
    brush.tool='pick'
    render(<Harness data={{...base,cells:[{x:1,y:1,tileId:'tree'}]}}/>)
    pointer('pointerdown',...point(1,0))
    expect(brush.onPick).not.toHaveBeenCalled()
    pointer('pointerdown',...point(1,1))
    expect(brush.onPick).toHaveBeenCalledWith('tree')
    expect(brush.onCommit).not.toHaveBeenCalled()
  })
  it('shrinks box previews to the current rectangle and commits only its final area',()=>{
    brush.tool='box'
    const view=render(<Harness/>)
    pointer('pointerdown',...point(0,0));pointer('pointermove',...point(3,3))
    act(()=>vi.advanceTimersByTime(20))
    expect(view.getByTestId('draft').textContent).toBe('16')
    pointer('pointermove',...point(1,1))
    act(()=>vi.advanceTimersByTime(20))
    expect(view.getByTestId('draft').textContent).toBe('4')
    pointer('pointerup',...point(1,1))
    expect(vi.mocked(brush.onCommit).mock.calls[0][2]).toHaveLength(4)
  })
})
