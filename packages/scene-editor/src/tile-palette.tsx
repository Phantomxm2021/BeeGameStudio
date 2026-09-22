import { useState } from 'react'
import { Brush,Eraser,Pipette,PaintBucket,MousePointer2,X } from 'lucide-react'
import type { SceneDocument,SceneAsset } from './model'
import { componentOf } from './model'
import { tileSprite } from './tilemap-preview'
import type { TileDefinition } from './tilemap-data'
import type { TilePaintTool } from './tilemap-paint'
import { Button } from './components/motion/button'
import { Select } from './components/motion/select'

const tools=[['paint','Paint','B',Brush],['erase','Erase','D',Eraser],['pick','Pick','I',Pipette],['box','Box Fill','U',PaintBucket]] as const
function Thumbnail({tile,assets}:{tile:TileDefinition;assets:Record<string,SceneAsset>}){
  const [size,setSize]=useState<[number,number]>([0,0])
  try{
    const {image,frame}=tileSprite(assets,tile),uri=image.bytes ?? image.uri
    if(!uri)return <span>?</span>
    if(!frame)return <img src={uri} alt="" draggable={false}/>
    return <><img src={uri} alt="" draggable={false} style={{display:'none'}} onLoad={e=>setSize([e.currentTarget.naturalWidth,e.currentTarget.naturalHeight])}/>
      <svg viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`} aria-hidden="true"><image href={uri} width={size[0]} height={size[1]}/></svg></>
  }catch{return <span>?</span>}
}
export function TilePalette({document,target,editable,tool,tileId,onTarget,onTool,onTile,onClose}:{document:SceneDocument;target:string;editable:boolean;tool:TilePaintTool|null;tileId:string;onTarget:(id:string)=>void;onTool:(tool:TilePaintTool|null)=>void;onTile:(id:string)=>void;onClose:()=>void}){
  const maps=Object.values(document.nodes).filter(n=>componentOf(n,'tilemap'))
  const node=document.nodes[target],map=node&&componentOf(node,'tilemap'),set=map&&document.assets[map.assetId]?.tileSet
  return <section className="tile-palette" aria-label="Tile Palette">
    <header><strong>Tile Palette</strong><Button aria-label="Close Tile Palette" onClick={onClose}><X size={14}/></Button></header>
    <label>Active Target<Select ariaLabel="Active Tilemap" value={target} onValueChange={onTarget} options={maps.map(n=>({value:n.id,label:n.name}))}/></label>
    <div role="toolbar" aria-label="Tile painting tools">
      <Button aria-label="Object selection" aria-pressed={tool===null} title="Return to object selection" onClick={()=>onTool(null)}><MousePointer2 size={16}/></Button>
      {tools.map(([value,label,key,Icon])=><Button key={value} disabled={!editable} aria-label={label} aria-pressed={editable&&tool===value} title={`${label} (${key})`} onClick={()=>onTool(value)}><Icon size={16}/></Button>)}
    </div>
    <div className="tile-palette-items" aria-label="Available tiles">
      {Object.entries(set?.tiles??{}).map(([id,tile])=><Button key={id} disabled={!editable} aria-label={`Tile ${id}`} aria-pressed={id===tileId} title={id} onClick={()=>onTile(id)}><Thumbnail tile={tile} assets={document.assets}/><span>{id}</span></Button>)}
    </div>
    {!set || !Object.keys(set.tiles).length ? <p>No tiles in this TileSet.</p> : null}
    <p>{!editable?'Choose a visible, unlocked, enabled Tilemap in 2D view.':tool===null?'Select a tool to edit tiles.':'Left-drag to paint · Middle/right-drag to pan'}<br/>Escape cancels the current stroke.</p>
  </section>
}
