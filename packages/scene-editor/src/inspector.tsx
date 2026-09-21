import { spriteSheetSelection, atlasFrameName } from './sprite-sheet'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AudioLines, Box, Camera, ChevronRight, CircleDot, Image, Layers, Lightbulb, LockKeyhole, Move, Sparkles, UnlockKeyhole, type LucideIcon } from 'lucide-react'
import { operations } from './commands'
import { primaryComponentType, type MaterialOverride, type SceneAsset, type SceneComponent, type SceneDocument, type SceneNode, type Transform } from './model'
import type { ModelPart, ModelStructure } from './model-structure'
import { Select } from './components/motion/select'
import { Switch } from './components/motion/switch'
import { Input } from './components/motion/input'
import { RangeSlider } from './components/motion/range-slider'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './components/ui/dialog'

const fmt = (value: number) => Number(value.toFixed(3))
type Commit = (ops: Parameters<import('./history').SceneHistory['commit']>[0], label: string) => void
const ICONS: Record<string, LucideIcon> = { camera: Camera, 'particle-system': Sparkles, 'particle-system-renderer': Sparkles, 'sprite-renderer': Image, image: Image, 'mesh-renderer': Box, 'skinned-mesh-renderer': Box, 'tilemap-renderer': Layers, 'light-2d': Lightbulb, light: Lightbulb, 'audio-source': AudioLines, 'box-collider-2d': CircleDot, 'circle-collider-2d': CircleDot, 'capsule-collider-2d': CircleDot, 'polygon-collider-2d': CircleDot, 'rect-transform': Move, transform: Box }
export function ObjectIcon({ kind, size = 15 }: { kind: string; lightKind?: string; size?: number }) { const Icon = ICONS[kind] ?? Box; return <Icon size={size} strokeWidth={1.6} /> }
function ComponentSection({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) { return <details className="inspector-component" open><summary><ChevronRight size={12} className="component-chevron" /><Icon size={14} /><span>{title}</span></summary><div className="component-body">{children}</div></details> }
function Property({ label, children }: { label: string; children: ReactNode }) { return <div className="property-row"><span className="property-label">{label}</span><div className="property-value">{children}</div></div> }

export function ModelPartInspector({ part, assetName, onFocus }: { part: ModelPart; structure: ModelStructure; assetName: string; onFocus: () => void }) {
  return <div className="inspector-scroll"><section className="object-header"><div className="object-heading"><span className="object-avatar"><ObjectIcon kind={part.kind} size={23} /></span><strong>{part.name}</strong><LockKeyhole size={13} /></div><div className="object-subtitle"><span>IMPORTED {part.kind.toUpperCase()}</span><button onClick={onFocus}>Focus F</button></div></section><ComponentSection title="Source" icon={Box}><Property label="Asset"><span>{assetName}</span></Property></ComponentSection></div>
}

function labelFor(component: SceneComponent): string { return component.type.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') }
function isCollider(component: SceneComponent): component is Extract<SceneComponent, { isTrigger: boolean }> { return ['box-collider-2d', 'circle-collider-2d', 'capsule-collider-2d', 'polygon-collider-2d', 'box-collider', 'sphere-collider', 'capsule-collider', 'mesh-collider'].includes(component.type) }
const IMAGE_COMPONENTS = new Set<SceneComponent['type']>(['sprite-renderer', 'image'])
const MATERIAL_COMPONENTS = new Set<SceneComponent['type']>(['mesh-renderer'])
const MODEL_COMPONENTS = new Set<SceneComponent['type']>(['mesh-filter', 'skinned-mesh-renderer', 'mesh-collider'])
function assetAccepted(component: SceneComponent, asset: SceneAsset): boolean {
  if (IMAGE_COMPONENTS.has(component.type)) return asset.mimeType.startsWith('image/')
  if (MATERIAL_COMPONENTS.has(component.type)) return asset.mimeType.includes('material') || /\.(mat|material)$/i.test(asset.name)
  if (component.type === 'particle-system-renderer') return asset.mimeType.startsWith('image/')
  if (MODEL_COMPONENTS.has(component.type)) return asset.mimeType.startsWith('model/') || /\.(glb|gltf|fbx|obj)$/i.test(asset.name)
  if (component.type === 'audio-source') return asset.mimeType.startsWith('audio/')
  if (component.type === 'animator') return asset.mimeType.includes('json')
  if (component.type === 'tilemap') return asset.mimeType.startsWith('image/') || asset.mimeType.includes('json')
  return false
}
function componentAssetId(component: SceneComponent): string | undefined {
  if ('assetId' in component) return component.assetId
  return undefined
}
function clearMember<T extends { member?: string }>(component: T): T {
  const withoutMember = { ...component }
  delete withoutMember.member
  return withoutMember
}
function clearAsset<T extends { assetId?: string }>(component: T): T {
  const withoutAsset = { ...component }
  delete withoutAsset.assetId
  return withoutAsset
}
function setTextureAsset(material: MaterialOverride, assetId: string | undefined): MaterialOverride {
  const next = { ...material }
  delete next.textureAssetId
  if (assetId !== undefined) next.textureAssetId = assetId
  return next
}
function memberFromAssetId(assetId: string | undefined): string | undefined {
  if (!assetId) return undefined
  const separator = assetId.indexOf(':')
  return separator < 0 ? undefined : assetId.slice(separator + 1) || undefined
}
function setMember<T extends { member?: string }>(component: T, assetId: string | undefined): T {
  const next = clearMember(component)
  const member = memberFromAssetId(assetId)
  if (member) next.member = member
  return next
}
export function withAsset(component: SceneComponent, assetId: string | undefined, asset?: SceneAsset): SceneComponent {
  if (component.type === 'sprite-renderer') {
    // Frame/animation and the derived texture region belong to the previous
    // sprite. Keeping them after an asset replacement can point beyond the new
    // image and make the newly selected sprite appear blank.
    const next = setMember(component, assetId)
    delete next.frame
    delete next.animation
    const material = { ...next.material }
    delete material.textureRegion
    const properties = { ...next.properties }
    delete properties.frame
    delete properties.frameTable
    delete properties.member
    delete properties.initialFacing
    const selection = spriteSheetSelection(asset?.spriteSheet)
    return { ...next, assetId: assetId!, properties, ...selection, material: { ...setTextureAsset(material, assetId), ...(selection.frame ? { textureRegion: selection.frame } : {}) } }
  }
  if (component.type === 'image') {
    const next = clearAsset(setMember(component, assetId))
    const material = { ...component.material }
    delete material.textureRegion
    const properties = { ...next.properties }
    delete properties.frame
    const { frame } = spriteSheetSelection(asset?.spriteSheet)
    return { ...next, properties, ...(assetId === undefined ? {} : { assetId }), material: { ...setTextureAsset(material, assetId), ...(frame ? { textureRegion: frame } : {}) } }
  }
  if (component.type === 'mesh-renderer') return { ...clearAsset(component), ...(assetId === undefined ? {} : { assetId }) }
  if (component.type === 'particle-system-renderer') {
    const next = { ...component }
    delete next.assetId
    delete next.textureAssetId
    const properties = { ...next.properties }
    delete properties.member
    const member = memberFromAssetId(assetId)
    if (member) properties.member = member
    return { ...next, ...(assetId === undefined ? {} : { assetId, textureAssetId: assetId }), material: setTextureAsset(component.material, assetId), properties }
  }
  if (component.type === 'mesh-filter' || component.type === 'skinned-mesh-renderer' || component.type === 'tilemap') return { ...setMember(component, assetId), assetId: assetId! }
  if (component.type === 'mesh-collider' || component.type === 'audio-source' || component.type === 'animator') return { ...clearAsset(component), ...(assetId === undefined ? {} : { assetId }) }
  return component
}
function assetPreviewUrl(asset: SceneAsset | undefined): string | undefined {
  if (!asset) return undefined
  if (asset.bytes?.startsWith('data:')) return asset.bytes
  if (asset.uri?.startsWith('data:') || asset.uri?.startsWith('blob:')) return asset.uri
  return undefined
}
function imageAssets(document: SceneDocument): SceneAsset[] {
  const byPath = new Map<string, SceneAsset>()
  for (const asset of Object.values(document.assets).filter(asset => asset.mimeType.startsWith('image/'))) {
    const current = byPath.get(asset.path)
    if (!current || (!current.id.includes(':') && asset.id.includes(':'))) byPath.set(asset.path, asset)
  }
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name))
}
function ImageAssetProperty({ component, document, replace }: { component: Extract<SceneComponent, { type: 'sprite-renderer' | 'image' | 'particle-system-renderer' }>; document: SceneDocument; replace: (next: SceneComponent, label: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const assets = useMemo(() => imageAssets(document), [document.assets])
  const current = componentAssetId(component)
  const selected = current ? document.assets[current] : undefined
  const required = component.type === 'sprite-renderer'
  const label = component.type === 'particle-system-renderer' ? 'Texture' : component.type === 'image' ? 'Source Image' : 'Sprite'
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (value) setQuery("") }}>
    <div className="scene-image-picker-control"><div className="scene-source-image-field"><span>{label}</span><DialogTrigger asChild><button type="button" className="scene-source-image" aria-label={`Choose ${component.type === 'sprite-renderer' ? 'sprite' : 'source image'}`}>
      {assetPreviewUrl(selected) ? <img src={assetPreviewUrl(selected)} alt="" /> : <Image size={15} />}
      <span>{('member' in component ? component.member : undefined) ?? (typeof component.properties.member === 'string' ? component.properties.member : undefined) ?? selected?.name?.replace(/\.[^.]+$/, '') ?? current ?? 'None'}</span><ChevronRight size={12} />
    </button></DialogTrigger></div></div>
    <DialogContent className="scene-image-asset-dialog" aria-label="Project image assets">
      <div className="settings-heading"><DialogTitle>Select {label}</DialogTitle><DialogDescription>{assets.length} project image{assets.length === 1 ? '' : 's'} available</DialogDescription></div>
      <div className="scene-picker-search"><Input aria-label="Search image assets" placeholder="Search images…" value={query} onChange={setQuery} /></div>
      <div className="scene-asset-picker">
      {!required ? <button type="button" className="scene-asset-card none" aria-label="No source image" onClick={() => { replace(withAsset(component, undefined), 'Remove image'); setOpen(false) }}><span>×</span><small>None</small></button> : null}
      {assets.filter(asset => asset.name.toLowerCase().includes(query.toLowerCase())).map(asset => <button type="button" className={`scene-asset-card${current === asset.id ? ' selected' : ''}`} aria-label={`Use image ${asset.name}`} key={asset.id} onClick={() => { replace(withAsset(component, asset.id, asset), `Replace ${component.type === 'sprite-renderer' ? 'sprite' : 'image'}`); setOpen(false) }}>
        {assetPreviewUrl(asset) ? <img loading="lazy" src={assetPreviewUrl(asset)} alt="" /> : <Image size={18} />}<small title={asset.name}>{asset.name.replace(/\.[^.]+$/, '')}</small>
      </button>)}
      {!assets.some(asset => asset.name.toLowerCase().includes(query.toLowerCase())) ? <p>{query ? "No matching images." : "No image assets are available in this project."}</p> : null}
      </div>
    </DialogContent>
  </Dialog>
}
function AssetProperty({ component, document, replace }: { component: SceneComponent; document: SceneDocument; replace: (next: SceneComponent, label: string) => void }) {
  if (component.type === 'sprite-renderer' || component.type === 'image' || component.type === 'particle-system-renderer') return <ImageAssetProperty component={component} document={document} replace={replace} />
  const current = componentAssetId(component)
  const required = ['mesh-filter', 'skinned-mesh-renderer', 'tilemap'].includes(component.type)
  const assets = Object.values(document.assets).filter(asset => assetAccepted(component, asset))
  const label = component.type === 'audio-source' ? 'Audio clip' : component.type === 'animator' ? 'Controller' : component.type === 'tilemap' ? 'Tilemap' : MATERIAL_COMPONENTS.has(component.type) ? 'Material' : 'Mesh'
  return <Property label={label}><Select className="asset-picker" ariaLabel={`${labelFor(component)} ${label.toLowerCase()}`} value={current ?? ''} onValueChange={value => replace(withAsset(component, value || undefined), `Replace ${label.toLowerCase()}`)} options={[{ value: '', label: 'None', disabled: required }, ...assets.map(asset => ({ value: asset.id, label: asset.name }))]} /></Property>
}
function SpriteFrameProperty({ component, document, replace }: { component: Extract<SceneComponent, { type: 'sprite-renderer' | 'image' }>; document: SceneDocument; replace: (next: SceneComponent, label: string) => void }) {
  const sheet = component.assetId ? document.assets[component.assetId]?.spriteSheet : undefined
  const atlas = sheet && 'frames' in sheet ? sheet : undefined
  const strip = sheet && !('frames' in sheet) ? sheet : undefined
  const directional = Boolean(strip?.facings?.length)
  const names = atlas ? Object.keys(atlas.frames) : directional ? strip?.facings : strip?.states
  if (!names?.length) return null
  const property = directional ? 'initialFacing' : 'frame'
  const selection = spriteSheetSelection(sheet, component.properties)
  const value = directional ? selection.animation?.initialFacing ?? names[0] : atlas ? (typeof component.properties.frame === 'string' ? atlasFrameName(component.properties.frame) : names[0]) : names[Math.round((selection.frame?.x ?? 0) / strip!.frameWidth)] ?? names[0]
  return <Property label={directional ? 'Facing' : 'Frame'}><Select ariaLabel={directional ? 'Sprite facing' : 'Sprite frame'} value={value} options={names.map(name => ({ value: name, label: name }))}
    onValueChange={value => {
      const properties = { ...component.properties, [property]: value }
      const selection = spriteSheetSelection(sheet, properties)
      replace({ ...component, ...(component.type === 'sprite-renderer' ? selection : {}), properties,
        material: { ...component.material, ...(selection.frame ? { textureRegion: selection.frame } : {}) } }, 'Change sprite frame')
    }} /></Property>
}
function TextInspector({ component, replace }: { component: Extract<SceneComponent, { type: 'text' }>; replace: (next: SceneComponent, label: string) => void }) {
  const [text, setText] = useState(component.text)
  useEffect(() => setText(component.text), [component.text])
  return <ComponentSection title="Text" icon={Image}>
    <Property label="Text"><textarea aria-label="Text content" value={text} onChange={event => setText(event.target.value)} onBlur={() => { if (text !== component.text) replace({ ...component, text }, 'Change text') }} /></Property>
    <Property label="Font size"><DraftScalar aria-label="Text font size" type="number" min="1" step="1" value={Number(component.properties.fontSize) || 32} parse={Number} onCommit={value => replace({ ...component, properties: { ...component.properties, fontSize: Math.max(1, Number(value) || 1) } }, 'Change text font size')} /></Property>
    <Property label="Color"><input aria-label="Text color" type="color" value={typeof component.properties.color === 'string' ? component.properties.color : '#ffffff'} onChange={event => replace({ ...component, properties: { ...component.properties, color: event.target.value } }, 'Change text color')} /></Property>
  </ComponentSection>
}
function NumberProperty({ label, value, min, step = '0.1', onCommit }: { label: string; value: number; min?: number; step?: string; onCommit: (value: number) => void }) {
  return <Property label={label}><DraftScalar aria-label={label} type="number" min={min === undefined ? undefined : String(min)} step={step} value={value} parse={Number} onCommit={next => onCommit(Number(next))} /></Property>
}
function Vec2Property({ label, value, onCommit }: { label: string; value: [number, number]; onCommit: (value: [number, number]) => void }) {
  return <Property label={label}><span className="vector-inline">{value.map((entry, index) => <label key={index}><b>{'XY'[index]}</b><DraftScalar aria-label={`${label} ${'XY'[index]}`} type="number" step="0.1" value={entry} parse={Number} onCommit={next => onCommit(value.map((current, currentIndex) => currentIndex === index ? Number(next) : current) as [number, number])} /></label>)}</span></Property>
}
function ComponentInspector({ node, component, document, commit }: { node: SceneNode; component: SceneComponent; document: SceneDocument; commit: Commit }) {
  const Icon = ICONS[component.type] ?? Box
  const replace = (next: SceneComponent, label: string) => { if (JSON.stringify(component) !== JSON.stringify(next)) commit([operations.component(node.id, next)], label) }
  if (component.type === 'text') return <TextInspector component={component} replace={replace} />
  if (component.type === 'sprite-renderer' || component.type === 'image' || component.type === 'mesh-renderer' || component.type === 'skinned-mesh-renderer' || component.type === 'tilemap-renderer' || component.type === 'particle-system-renderer') return <ComponentSection title={labelFor(component)} icon={Icon}>{component.type !== 'tilemap-renderer' && <AssetProperty component={component} document={document} replace={replace} />}{(component.type === 'sprite-renderer' || component.type === 'image') && <SpriteFrameProperty component={component} document={document} replace={replace} />}{document.dimension === '2d' && (component.type === 'sprite-renderer' || component.type === 'tilemap-renderer') ? <NumberProperty label="Order in Layer" step="1" value={Number(component.properties.sortingOrder ?? node.order ?? 0)} onCommit={value => { if (Number.isFinite(value)) replace({ ...component, properties: { ...component.properties, sortingOrder: Math.round(value) } }, 'Change render order') }} /> : null}<Property label="Color"><input type="color" value={component.material.color} onChange={event => replace({ ...component, material: { ...component.material, color: event.target.value } }, 'Change renderer color')} /></Property><Property label="Opacity"><span data-edit-gesture className="scene-opacity-control"><RangeSlider aria-label="Renderer opacity" min={0} max={1} step={.01} showTicks={false} value={component.material.opacity} onValueChange={opacity => replace({ ...component, material: { ...component.material, opacity, alphaMode: opacity < 1 ? 'blend' : 'opaque' } }, 'Change renderer opacity')} className="scene-opacity-slider" /></span></Property></ComponentSection>
  if (component.type === 'mesh-filter' || component.type === 'tilemap' || component.type === 'animator') return <ComponentSection title={labelFor(component)} icon={Icon}><AssetProperty component={component} document={document} replace={replace} /></ComponentSection>
  if (component.type === 'particle-system') return <ParticleInspector component={component} replace={replace} />
  if (component.type === 'light-2d' || component.type === 'light') return <ComponentSection title={labelFor(component)} icon={Icon}><Property label="Type"><Select ariaLabel="Light type" value={component.light.kind} onValueChange={value => replace({ ...component, light: { ...component.light, kind: value as typeof component.light.kind } }, 'Change light type')} options={['ambient', 'directional', 'point', 'spot'].map(kind => ({ value: kind, label: kind }))} /></Property><Property label="Color"><input aria-label="Light color" type="color" value={component.light.color} onChange={event => replace({ ...component, light: { ...component.light, color: event.target.value } }, 'Change light color')} /></Property><NumberProperty label="Intensity" value={component.light.intensity} min={0} onCommit={value => replace({ ...component, light: { ...component.light, intensity: Math.max(0, value) } }, 'Change light intensity')} />{component.light.kind === 'point' || component.light.kind === 'spot' ? <NumberProperty label="Range" value={component.light.distance ?? 10} min={0} onCommit={value => replace({ ...component, light: { ...component.light, distance: Math.max(0, value) } }, 'Change light range')} /> : null}{component.light.kind === 'spot' ? <NumberProperty label="Angle °" value={(component.light.angle ?? Math.PI / 3) * 180 / Math.PI} min={1} step="1" onCommit={value => replace({ ...component, light: { ...component.light, angle: Math.max(1, value) * Math.PI / 180 } }, 'Change spot angle')} /> : null}</ComponentSection>
  if (component.type === 'camera') return <ComponentSection title="Camera" icon={Icon}><Property label="Orthographic"><Switch aria-label="Camera orthographic" checked={component.orthographic} onCheckedChange={checked => replace({ ...component, orthographic: checked }, 'Change camera projection')} /></Property>{component.orthographic ? <NumberProperty label="Orthographic size" value={component.orthographicSize ?? 3.6} min={.01} step="0.01" onCommit={value => replace({ ...component, orthographicSize: Math.max(.01, value) }, 'Change orthographic size')} /> : null}<NumberProperty label="Near clip" value={component.nearClip ?? .1} min={.001} step="0.01" onCommit={value => replace({ ...component, nearClip: Math.max(.001, value) }, 'Change near clip')} /><NumberProperty label="Far clip" value={component.farClip ?? 1000} min={.01} onCommit={value => replace({ ...component, farClip: Math.max(.01, value) }, 'Change far clip')} /></ComponentSection>
  if (component.type === 'rect-transform') return <ComponentSection title="Rect Transform" icon={Icon}><Vec2Property label="Anchor min" value={component.anchorMin} onCommit={value => replace({ ...component, anchorMin: value }, 'Change anchor min')} /><Vec2Property label="Anchor max" value={component.anchorMax} onCommit={value => replace({ ...component, anchorMax: value }, 'Change anchor max')} /><Vec2Property label="Pivot" value={component.pivot} onCommit={value => replace({ ...component, pivot: value }, 'Change pivot')} /><Vec2Property label="Position" value={component.anchoredPosition} onCommit={value => replace({ ...component, anchoredPosition: value }, 'Change anchored position')} /><Vec2Property label="Size" value={component.sizeDelta} onCommit={value => replace({ ...component, sizeDelta: value }, 'Change rect size')} /></ComponentSection>
  if (isCollider(component)) return <ComponentSection title={labelFor(component)} icon={Icon}>{component.type === "mesh-collider" && <AssetProperty component={component} document={document} replace={replace} />}<Property label="Trigger"><Switch aria-label={`${labelFor(component)} trigger`} checked={component.isTrigger} onCheckedChange={checked => replace({ ...component, isTrigger: checked }, 'Change trigger')} /></Property>{'radius' in component ? <NumberProperty label="Radius" value={component.radius} min={0} onCommit={value => replace({ ...component, radius: Math.max(0, value) }, 'Change collider radius')} /> : null}{'size' in component && Array.isArray(component.size) && component.size.length === 2 ? <Vec2Property label="Size" value={component.size as [number, number]} onCommit={value => replace({ ...component, size: value } as SceneComponent, 'Change collider size')} /> : null}</ComponentSection>
  if (component.type === 'audio-source') return <ComponentSection title="Audio Source" icon={Icon}><AssetProperty component={component} document={document} replace={replace} /><Property label="Loop"><Switch aria-label="Audio loop" checked={component.properties.loop === true} onCheckedChange={checked => replace({ ...component, properties: { ...component.properties, loop: checked } }, 'Change audio loop')} /></Property><NumberProperty label="Volume" value={Number(component.properties.volume ?? 1)} min={0} step="0.05" onCommit={value => replace({ ...component, properties: { ...component.properties, volume: Math.max(0, value) } }, 'Change audio volume')} /></ComponentSection>
  return <ComponentSection title={labelFor(component)} icon={Icon}><Property label="Enabled"><Switch aria-label={`${labelFor(component)} enabled`} checked={component.enabled} onCheckedChange={checked => replace({ ...component, enabled: checked }, 'Change component state')} /></Property></ComponentSection>
}

export function Inspector({ node, document, commit, onFocus, onSave, onReparent }: { node: SceneNode; document: SceneDocument; structure?: ModelStructure | null; commit: Commit; onFocus: () => void; onSave?: () => void; onReparent: (parentId: string | null) => void }) {
  const [name, setName] = useState(node.name); useEffect(() => setName(node.name), [node.id, node.name])
  const readOnly = node.locked || node.editable === false
  const update = (part: Partial<Transform>) => commit([operations.transform(node.id, { ...node.transform, ...part }, node.transform)], 'Change transform')
  const number = (value: number, onChange: (value: number) => void, label = 'Value') => <DraftScalar aria-label={label} type="number" step="0.1" value={value} parse={Number} onCommit={next => onChange(Number(next))} onSave={onSave} />
  const descendants = new Set<string>(); const collect = (id: string) => { descendants.add(id); document.nodes[id]?.children.forEach(collect) }; collect(node.id)
  const primary = primaryComponentType(node)
  return <div className="inspector-scroll"><section className="object-header"><div className="object-heading"><span className="object-avatar"><ObjectIcon kind={primary} size={23} /></span><Switch aria-label="Active" disabled={readOnly} checked={node.active} onCheckedChange={checked => commit([operations.active(node.id, checked, node.active)], 'Change active state')} /><input className="name-input" disabled={readOnly} value={name} onChange={event => setName(event.target.value)} onBlur={() => { const next = name.trim(); if (next && next !== node.name) commit([operations.rename(node.id, next, node.name)], 'Rename GameObject'); else setName(node.name) }} /><button className="object-lock" disabled={node.editable === false} onClick={() => commit([operations.locked(node.id, !node.locked, node.locked)], 'Change lock')}>{node.locked ? <LockKeyhole size={13} /> : <UnlockKeyhole size={13} />}</button></div><div className="object-subtitle"><span>GAMEOBJECT · {primary.toUpperCase()}</span><button onClick={onFocus}>Focus F</button></div><Property label="Parent"><Select ariaLabel="Parent" disabled={readOnly} value={node.parentId ?? ''} onValueChange={value => onReparent(value || null)} options={[{ value: '', label: 'Scene Root' }, ...Object.values(document.nodes).filter(item => !descendants.has(item.id)).map(item => ({ value: item.id, label: item.name }))]} /></Property></section><fieldset className="inspector-fields" disabled={readOnly} inert={readOnly}><ComponentSection title="Transform" icon={Move}><Vector label="Position" values={node.transform.position} set={(i, value) => update({ position: node.transform.position.map((v, index) => index === i ? value : v) as [number, number, number] })} number={number} /><Vector label="Rotation °" values={node.transform.rotation.map(value => value * 180 / Math.PI) as [number, number, number]} set={(i, value) => update({ rotation: node.transform.rotation.map((v, index) => index === i ? value * Math.PI / 180 : v) as [number, number, number] })} number={number} /><Vector label="Scale" values={node.transform.scale} set={(i, value) => update({ scale: node.transform.scale.map((v, index) => index === i ? value : v) as [number, number, number] })} number={number} /></ComponentSection>{node.components.map(component => <ComponentInspector key={component.id} node={node} component={component} document={document} commit={commit} />)}</fieldset></div>
}

type DraftScalarProps = { type: 'color' | 'number'; value: string | number; parse: (value: string) => string | number; onCommit: (value: string | number) => void; onSave?: () => void; min?: string; max?: string; step?: string; ['aria-label']?: string }
function Vector({ label, values, set, number }: { label: string; values: [number, number, number]; set: (index: number, value: number) => void; number: (value: number, onChange: (value: number) => void, label?: string) => ReactNode }) { return <div className="vector"><span>{label}</span><div>{values.map((value, index) => <label key={index}><b>{'XYZ'[index]}</b>{number(fmt(value), next => set(index, next), `${label.split(' ')[0]} ${'XYZ'[index]}`)}</label>)}</div></div> }
function DraftScalar({ value, parse, onCommit, onSave, ...inputProps }: DraftScalarProps) { const [draft, setDraft] = useState(String(value)), [editing, setEditing] = useState(false); useEffect(() => { if (!editing) setDraft(String(value)) }, [value, editing]); const commitDraft = () => { if (!editing) return; setEditing(false); const next = parse(draft); if (next !== value) onCommit(next) }; return <input title={inputProps['aria-label']} {...inputProps} value={draft} onFocus={() => setEditing(true)} onChange={event => setDraft(event.target.value)} onBlur={commitDraft} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); commitDraft(); setTimeout(() => onSave?.(), 0) } }} /> }

function ParticleInspector({ component, replace }: { component: Extract<SceneComponent, { type: 'particle-system' }>; replace: (next: SceneComponent, label: string) => void }) {
  const props = component.properties
  const group = (name: string) => (props[name] && typeof props[name] === 'object' ? props[name] : {}) as Record<string, number>
  const field = (name: string, key: string, label: string, fallback: number, min?: number) => <NumberProperty key={key} label={label} value={Number(group(name)[key] ?? fallback)} min={min} onCommit={value => replace({ ...component, properties: { ...props, [name]: { ...group(name), [key]: value } } }, `Change particle ${label.toLowerCase()}`)} />
  const motion = (props.motion && typeof props.motion === 'object' ? props.motion : {}) as Record<string, unknown>
  const period = (motion.periodSecs && typeof motion.periodSecs === 'object' ? motion.periodSecs : {}) as Record<string, number>
  const countKey = props.count === undefined ? 'maxParticles' : 'count'
  return <ComponentSection title="Particle System" icon={Sparkles}>
    <NumberProperty label="Count" value={Number(props[countKey] ?? 0)} min={0} step="1" onCommit={value => replace({ ...component, properties: { ...props, [countKey]: Math.max(0, Math.round(value)) } }, 'Change particle count')} />
    {field('particleSize', 'min', 'Min size (px)', 3, 0)}
    {field('particleSize', 'max', 'Max size (px)', Number(group('particleSize').min ?? 3), 0)}
    {field('zone', 'x', 'Zone X', 0)}{field('zone', 'y', 'Zone Y', 0)}
    {field('zone', 'width', 'Zone width', 0, 0)}{field('zone', 'height', 'Zone height', 0, 0)}
    {field('alpha', 'min', 'Min alpha', .35, 0)}{field('alpha', 'max', 'Max alpha', .9, 0)}
    <NumberProperty label="Motion (px)" value={Number(motion.amplitudePx ?? 0)} min={0} onCommit={value => replace({ ...component, properties: { ...props, motion: { ...motion, amplitudePx: value } } }, 'Change particle motion')} />
    {(['min', 'max'] as const).map(key => <NumberProperty key={key} label={`${key === 'min' ? 'Min' : 'Max'} period (s)`} value={Number(period[key] ?? (key === 'min' ? 3 : 6))} min={.1} onCommit={value => replace({ ...component, properties: { ...props, motion: { ...motion, periodSecs: { ...period, [key]: value } } } }, 'Change particle period')} />)}
    <p className="component-note">Editor preview shows up to 256 particles.</p>
  </ComponentSection>
}
