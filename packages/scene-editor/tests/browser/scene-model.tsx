// Synthetic local GLB: an embedded two-colour texture and a separate animated part.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AnimationClip, BoxGeometry, CanvasTexture, Mesh, MeshBasicMaterial, NearestFilter, Scene, SRGBColorSpace, VectorKeyframeTrack } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { SceneEditor } from '../../src/editor'
import { makeFixture, type CameraComponent, type SceneDocument } from '../../src/model'
import { dataUri } from '../../src/assets'
import '../../src/styles.css'

async function mount() {
  const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 2
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ff0000'; context.fillRect(0, 0, 2, 2)
  context.fillStyle = '#00ff00'; context.fillRect(2, 0, 2, 2)
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace
  texture.magFilter = NearestFilter; texture.minFilter = NearestFilter
  const body = new Mesh(new BoxGeometry(1.6, 1.2, .2), new MeshBasicMaterial({ map: texture }))
  body.name = 'TexturedBody'
  const part = new Mesh(new BoxGeometry(.35, .35, .35), new MeshBasicMaterial({ color: '#0000ff' }))
  part.name = 'MovingPart'; part.position.set(-.8, 1.1, 0)
  const model = new Scene(); model.add(body, part)
  const motion = new AnimationClip('SlidePart', 2, [new VectorKeyframeTrack('MovingPart.position', [0, 1, 2], [-.8, 1.1, 0, .8, 1.1, 0, -.8, 1.1, 0])])
  const glb = await new GLTFExporter().parseAsync(model, { binary: true, animations: [motion] }) as ArrayBuffer
  body.geometry.dispose(); body.material.dispose(); part.geometry.dispose(); part.material.dispose(); texture.dispose()

  const doc = makeFixture(); doc.dimension = '3d'; doc.cameraNodeId = 'camera'
  for (const id of ['hive', 'flower', 'sun']) delete doc.nodes[id]
  doc.nodes.root.children = ['camera']; doc.nodes.camera.transform.position = [0, 0, 6]
  const camera = doc.nodes.camera.components[0] as CameraComponent
  camera.orthographic = true; camera.orthographicSize = 2; camera.nearClip = .1; camera.farClip = 100
  camera.properties = { viewport: { width: 800, height: 600 }, framing: 'keep-height' }
  doc.settings = { background: '#000000', showGrid: false, ambientColor: '#ffffff', ambientIntensity: 2, exposure: 1, fogEnabled: false, fogColor: '#000000', fogNear: 10, fogFar: 60 }
  doc.assets = { GLB: { id: 'GLB', name: 'textured-parts.glb', path: 'textured-parts.glb', mimeType: 'model/gltf-binary', bytes: dataUri(new Uint8Array(glb), 'model/gltf-binary') } }
  if (new URLSearchParams(window.location.search).has('override')) {
    doc.nodes.root.children.push('model')
    doc.nodes.model = { id: 'model', name: 'Explicit material', parentId: 'root', children: [], active: true, locked: false, tags: [], transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
      { id: 'mesh', type: 'mesh-filter', enabled: true, assetId: 'GLB', properties: {} },
      { id: 'renderer', type: 'mesh-renderer', enabled: true, properties: {}, material: { mode: 'unlit', color: '#ff0000', metalness: 0, roughness: 1, opacity: 1, alphaMode: 'opaque' } },
    ] }
  }
  const fixture = { doc, before: JSON.stringify(doc), saved: null as SceneDocument | null }
  ;(window as any).sceneModelFixture = fixture
  createRoot(document.getElementById('root')!).render(<div style={{ width: '100vw', height: '100vh' }}>
    <SceneEditor initialDocument={doc} initialView={{ position: [0, 0, 6], target: [0, 0, 0], showGizmos: false }} onSave={saved => { fixture.saved = saved }} />
  </div>)
}
void mount()
