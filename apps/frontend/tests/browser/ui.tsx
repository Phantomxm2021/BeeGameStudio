// Isolated UI menu check: no API, project mutations, or model calls.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { UiEditorOverlay } from '../../src/components/Workspace/UiEditorOverlay'
import { beeGameAdapter, type BeeGameUiContentDocument } from '../../src/services/beeGameAdapter'
import '../../src/index.css'

const screen = (id:string):BeeGameUiContentDocument => ({
  schema:'beegame-content.v1',id,kind:'ui-screen',assetRefs:[],
  data:{rootId:'root',nodes:[
    {id:'root',role:'screen-root',name:id,layout:{size:[960,540]}},
    {id:'title',parentId:'root',role:'text',name:'Title',text:'Menu verification',layout:{position:[100,100],size:[320,50]}},
  ]},
})
beeGameAdapter.getProjectGameContent = async () => ({state:'ready',documents:['title','pause'].map(id=>({
  path:`content/ui/${id}.json`,revision:'a'.repeat(64),document:screen(id),
}))})
beeGameAdapter.getProjectAssets = async () => ({contract_state:'ready',version:1,requirements:[],resources:[]})
createRoot(document.getElementById('root')!).render(<UiEditorOverlay projectId="menu-fixture" onClose={()=>{}}/>)
