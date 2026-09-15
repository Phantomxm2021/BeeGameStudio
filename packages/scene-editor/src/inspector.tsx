import { useEffect, useState, type ReactNode } from 'react'
import { Box, Camera, ChevronRight, Layers, Lightbulb, Sun, Sunrise, Flashlight, ArrowDownToLine, LockKeyhole, Move, Palette, Shield, UnlockKeyhole, type LucideIcon } from 'lucide-react'
import { operations } from './commands'
import type { LightKind, SceneDocument, SceneNode, Transform, VolumeVisual } from './model'
import type { ModelPart, ModelStructure } from './model-structure'

const fmt = (value: number) => Number(value.toFixed(3))
type Commit = (ops: Parameters<import('./history').SceneHistory['commit']>[0], label: string) => void

export function ObjectIcon({ kind, lightKind, size = 15 }: { kind: string; lightKind?: LightKind; size?: number }) {
  const Icon = kind === 'light' ? ({ point: Sun, directional: ArrowDownToLine, spot: Flashlight, ambient: Sunrise }[lightKind ?? 'point']) : kind === 'camera' ? Camera : kind === 'empty' || kind === 'group' ? Layers : Box
  return <Icon size={size} strokeWidth={1.6} />
}

function ComponentSection({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return <details className="inspector-component" open><summary title={`Expand or collapse ${title}`}><ChevronRight size={12} className="component-chevron" /><Icon size={14} /><span>{title}</span></summary><div className="component-body">{children}</div></details>
}
function Property({ label, children }: { label: string; children: ReactNode }) {
  return <div className="property-row"><span className="property-label">{label}</span><div className="property-value">{children}</div></div>
}
function ModelMaterials({ structure, indices }: { structure: ModelStructure; indices?: number[] }) {
  const materials = indices ? indices.map(index => structure.materials[index]).filter(Boolean) : structure.materials
  if (!materials.length) return null
  return <ComponentSection title="Materials" icon={Palette}><p className="component-note">From model asset</p>{materials.map((material, index) => <div className="source-material" key={index}>
    <div className="asset-reference"><Palette size={13} /><span title={material.name}>{material.name}</span></div>
    <Property label="Shader"><span>glTF / PBR</span></Property>
    <Property label="Base color"><span className="material-swatch" style={{ background: `rgb(${material.color.slice(0, 3).map(value => Math.round(value * 255)).join(' ')})` }} /><span>{material.color.slice(0, 3).map(value => fmt(value)).join(', ')}</span></Property>
    <Property label="Texture"><span title={material.texture ?? 'None'}>{material.texture ?? 'None'}</span></Property>
    <Property label="Metallic"><span>{material.metalness}</span></Property>
    <Property label="Roughness"><span>{material.roughness}</span></Property>
  </div>)}</ComponentSection>
}

export function ModelPartInspector({ part, structure, assetName, onFocus }: { part: ModelPart; structure: ModelStructure; assetName: string; onFocus: () => void }) {
  const mesh = part.meshIndex === undefined ? undefined : structure.meshes[part.meshIndex]
  const number = (value: number, _onChange: (value: number) => void, label?: string) => <input title={`${label} · Imported value`} aria-label={label} type="number" value={value} readOnly />
  return <div className="inspector-scroll">
    <section className="object-header"><div className="object-heading"><span className="object-avatar"><ObjectIcon kind={part.kind} size={23} /></span><strong className="imported-object-name" title={part.name}>{part.name}</strong><LockKeyhole size={13} aria-label="Read-only model node" /></div><div className="object-subtitle"><span>MODEL {part.kind.toUpperCase()}</span><button title="Focus selected object (F)" onClick={onFocus}>Focus F</button></div><p className="component-note">Imported node · read-only</p></section>
    <ComponentSection title="Transform" icon={Move}>
      <Vector label="Position" values={part.transform.position} set={() => {}} number={number} />
      <Vector label="Rotation °" values={part.transform.rotation.map(value => value * 180 / Math.PI) as [number, number, number]} set={() => {}} number={number} />
      <Vector label="Scale" values={part.transform.scale} set={() => {}} number={number} />
    </ComponentSection>
    <ComponentSection title={mesh ? 'Mesh' : 'Model node'} icon={Box}>
      <Property label="Source"><span title={assetName}>{assetName}</span></Property>
      {mesh && <><Property label="Mesh"><span title={mesh.name}>{mesh.name}</span></Property><Property label="Vertices"><span>{mesh.vertices.toLocaleString()}</span></Property><Property label="Triangles"><span>{mesh.triangles.toLocaleString()}</span></Property></>}
      <p className="component-note">Select the model root to transform the whole model.</p>
    </ComponentSection>
    {mesh && <ModelMaterials structure={structure} indices={mesh.materials} />}
  </div>
}

export function Inspector({ node, document, structure, commit, onFocus, onSave, onReparent }: { node: SceneNode; document: SceneDocument; structure?: ModelStructure | null; commit: Commit; onFocus: () => void; onSave?: () => void; onReparent: (parentId: string | null) => void }) {
  const [name, setName] = useState(node.name)
  useEffect(() => setName(node.name), [node.id, node.name])
  const readOnly = node.locked || node.editable === false
  const update = (part: Partial<Transform>) => commit([operations.transform(node.id, { ...node.transform, ...part }, node.transform)], 'Change transform')
  const number = (value: number, onChange: (value: number) => void, label = 'Value') => <DraftScalar aria-label={label} type="number" step="0.1" value={value} parse={Number} onCommit={next => onChange(Number(next))} onSave={onSave} />
  const asset = node.assetId ? document.assets[node.assetId] : undefined
  const material = node.material
  const light = node.light
  const lightChange = (patch: Partial<NonNullable<SceneNode['light']>>) => commit([{ type: 'scene.setLight', nodeId: node.id, light: { ...light!, ...patch }, expectedLight: light }], 'Change light')
  const descendants = new Set<string>()
  const collect = (id: string) => { descendants.add(id); document.nodes[id]?.children.forEach(collect) }
  collect(node.id)
  return <div className="inspector-scroll">
    <section className="object-header">
      <div className="object-heading"><span className="object-avatar"><ObjectIcon kind={node.kind} lightKind={node.light?.kind} size={23} /></span><input type="checkbox" aria-label="Visible" title="Visible in scene" disabled={readOnly} checked={node.visible} onChange={event => commit([operations.visibility(node.id, event.target.checked, node.visible)], 'Change visibility')} />
        <input title="Rename object" aria-label="Object name" className="name-input" disabled={readOnly} value={name} onChange={event => setName(event.target.value)} onBlur={() => { const next = name.trim(); if (next && next !== node.name) commit([operations.rename(node.id, next, node.name)], 'Rename node'); else setName(node.name) }} />
        <button className="object-lock" aria-label={node.locked ? 'Unlock object' : 'Lock object'} aria-pressed={node.locked} title={node.editable === false ? 'Source object is read-only' : node.locked ? 'Unlock object' : 'Lock object'} disabled={node.editable === false} onClick={() => commit([operations.locked(node.id, !node.locked, node.locked)], 'Change lock')}>{node.locked ? <LockKeyhole size={13} /> : <UnlockKeyhole size={13} />}</button>
      </div>
      <div className="object-subtitle"><span title={node.id}>{node.kind.toUpperCase()}</span><button title="Focus selected object (F)" onClick={onFocus}>Focus F</button></div>
      <Property label="Parent"><select title="Change parent while preserving world transform" aria-label="Parent" disabled={readOnly} value={node.parentId ?? ''} onChange={event => onReparent(event.target.value || null)}><option value="">Scene Root</option>{Object.values(document.nodes).filter(item => !descendants.has(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Property>
    </section>
    <fieldset className="inspector-fields" disabled={readOnly}>
      <ComponentSection title="Transform" icon={Move}>
        <Vector label="Position" values={node.transform.position} set={(i, value) => update({ position: node.transform.position.map((v, index) => index === i ? value : v) as [number, number, number] })} number={number} />
        <Vector label="Rotation °" values={node.transform.rotation.map(value => value * 180 / Math.PI) as [number, number, number]} set={(i, value) => update({ rotation: node.transform.rotation.map((v, index) => index === i ? value * Math.PI / 180 : v) as [number, number, number] })} number={number} />
        <Vector label="Scale" values={node.transform.scale} set={(i, value) => update({ scale: node.transform.scale.map((v, index) => index === i ? value : v) as [number, number, number] })} number={number} />
      </ComponentSection>
      {node.kind === 'model' && <ComponentSection title="Model" icon={Box}><div className="asset-reference"><Box size={14} /><span title={asset?.path}>{asset?.name ?? 'Missing model'}</span></div><Property label="Format"><span>glTF 2.0</span></Property>{structure && <><Property label="Nodes"><span>{Object.keys(structure.nodes).length}</span></Property><Property label="Meshes"><span>{structure.meshes.length}</span></Property><Property label="Materials"><span>{structure.materials.length}</span></Property></>}</ComponentSection>}
      {material ? <ComponentSection title="Material" icon={Palette}>
        <Property label="Shader"><select title="Material shader" aria-label="Material shader" value={material.mode} onChange={event => commit([operations.material(node.id, { ...material, mode: event.target.value as 'standard' | 'unlit' }, material)], 'Change material mode')}><option value="standard">Standard</option><option value="unlit">Unlit</option></select></Property>
        <label className="color-field">Base color <DraftScalar aria-label="Material color" type="color" value={material.color} parse={value => value} onCommit={value => commit([operations.material(node.id, { ...material, color: String(value) }, material)], 'Change material color')} onSave={onSave} /><code>{material.color}</code></label>
        {(['metalness', 'roughness', 'opacity'] as const).map(key => <label className="range-field" key={key}><span>{key === 'metalness' ? 'Metallic' : key === 'roughness' ? 'Roughness' : 'Opacity'}</span><DraftScalar aria-label={key} type="range" min="0" max="1" step=".01" value={material[key]} parse={Number} onCommit={value => commit([operations.material(node.id, { ...material, [key]: Number(value), ...(key === 'opacity' && Number(value) < 1 ? { alphaMode: 'blend' as const } : {}) }, material)], `Change ${key}`)} onSave={onSave} /><output>{fmt(material[key])}</output></label>)}
      </ComponentSection> : structure && <ModelMaterials structure={structure} />}
      {light && <ComponentSection title="Light" icon={Lightbulb}>
        <Property label="Type"><select title="Light type" aria-label="Light type" value={light.kind} onChange={event => lightChange({ kind: event.target.value as typeof light.kind })}>{(['ambient', 'directional', 'point', 'spot'] as const).map(kind => <option key={kind} value={kind}>{kind[0].toUpperCase() + kind.slice(1)}</option>)}</select></Property>
        <label className="color-field">Color <DraftScalar aria-label="Light color" type="color" value={light.color} parse={value => value} onCommit={value => lightChange({ color: String(value) })} onSave={onSave} /><code>{light.color}</code></label>
        <Property label="Intensity">{number(light.intensity, intensity => lightChange({ intensity }), 'Light intensity')}</Property>
        {(light.kind === 'point' || light.kind === 'spot') && <Property label="Range">{number(light.distance ?? 0, distance => lightChange({ distance }), 'Light range')}</Property>}
        {light.kind === 'spot' && <><Property label="Angle °">{number((light.angle ?? Math.PI / 3) * 180 / Math.PI, value => lightChange({ angle: value * Math.PI / 180 }), 'Spot angle')}</Property><Property label="Penumbra">{number(light.penumbra ?? 0, penumbra => lightChange({ penumbra }), 'Spot penumbra')}</Property></>}
      </ComponentSection>}
      {(node.volume || node.kind === 'box' || node.kind === 'sphere') && <VolumeEditor node={node} commit={commit} onSave={onSave} />}
    </fieldset>
  </div>
}

type DraftScalarProps = { type: 'color' | 'range' | 'number'; value: string | number; parse: (value: string) => string | number; onCommit: (value: string | number) => void; onSave?: () => void; min?: string; max?: string; step?: string; ['aria-label']?: string }
function Vector({ label, values, set, number }: { label: string; values: [number, number, number]; set: (index: number, value: number) => void; number: (value: number, onChange: (value: number) => void, label?: string) => ReactNode }) { return <div className="vector"><span>{label}</span><div>{values.map((value, index) => <label key={index}><b>{'XYZ'[index]}</b>{number(fmt(value), next => set(index, next), `${label.split(' ')[0]} ${'XYZ'[index]}`)}</label>)}</div></div> }
function DraftScalar({ value, parse, onCommit, onSave, ...inputProps }: DraftScalarProps) { const [draft, setDraft] = useState(String(value)), [editing, setEditing] = useState(false); useEffect(() => { if (!editing) setDraft(String(value)) }, [value, editing]); const commitDraft = () => { if (!editing) return; setEditing(false); const next = parse(draft); if (next !== value) onCommit(next) }; return <input title={inputProps['aria-label'] ?? `${inputProps.type} value`} {...inputProps} value={draft} onFocus={() => setEditing(true)} onChange={event => setDraft(event.target.value)} onBlur={commitDraft} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); commitDraft(); setTimeout(() => onSave?.(), 0) } }} /> }
function VolumeEditor({ node, commit, onSave }: { node: SceneNode; commit: Commit; onSave?: () => void }) {
  const volume: VolumeVisual = node.volume ?? { role: 'collider', shape: node.kind === 'sphere' ? 'sphere' : 'box', size: [1, 1, 1], offset: [0, 0, 0], rotation: [0, 0, 0] }
  const set = (patch: Partial<VolumeVisual>) => commit([operations.volume(node.id, { ...volume, ...patch }, node.volume)], 'Change volume visual')
  const number = (value: number, change: (value: number) => void, label?: string) => <DraftScalar aria-label={label} type="number" value={value} step=".1" parse={Number} onCommit={next => change(Number(next))} onSave={onSave} />
  return <ComponentSection title="Volume visual" icon={Shield}>
    <Property label="Role"><select title="Collider or trigger visualization" aria-label="Volume role" value={volume.role} onChange={event => set({ role: event.target.value as VolumeVisual['role'] })}><option value="collider">Collider</option><option value="trigger">Trigger</option></select></Property>
    <Property label="Shape"><select title="Volume shape" aria-label="Volume shape" value={volume.shape} onChange={event => set({ shape: event.target.value as VolumeVisual['shape'] })}><option value="box">Box</option><option value="sphere">Sphere</option><option value="capsule">Capsule</option></select></Property>
    <Vector label="Size" values={volume.size} number={number} set={(index, value) => set({ size: volume.size.map((v, i) => i === index ? value : v) as [number, number, number] })} />
    <Vector label="Center" values={volume.offset} number={number} set={(index, value) => set({ offset: volume.offset.map((v, i) => i === index ? value : v) as [number, number, number] })} />
    <p className="component-note">Authoring visualization · no physics events</p>
  </ComponentSection>
}
