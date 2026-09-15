import { useEffect, useMemo, useRef, useState } from 'react'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { operations } from './commands'
import { SceneHistory } from './history'
import { DEFAULT_SCENE_SETTINGS, type SceneDocument, type SceneNode, type SceneAsset, type LightKind, type Transform } from './model'
import { exportPackage, importPackage, makeEmptyScene, sceneContentKey, canonicalJson } from './persistence'
import { transformSelection } from './selection-transform'
import { SceneViewport, type SceneViewportProps } from './viewport'
import { Hand, Move, Rotate3D, Scaling, Save, Undo2, Redo2, Magnet, ChevronDown, Globe2, Box, Scan, Square, Focus, CircleCheck, Circle, ChevronLeft, ChevronRight, Lightbulb, Search, X, Axis3D, Menu } from 'lucide-react'
import { Inspector, ModelPartInspector } from './inspector'
import { TreeNode, matchesTreeNode, navigateModelTree } from './hierarchy'
import { readModelStructure, type ModelSelection, type ModelStructure } from './model-structure'
import { currentKeyboardLabels } from './platform'
import { AssetLibraryDialog, type AssetLibrarySource } from './asset-library-dialog'
import { SceneSettingsDialog } from './scene-settings-dialog'
import { Toggle } from './components/ui/toggle'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from './components/ui/dropdown-menu'

type Mode = 'translate' | 'rotate' | 'scale' | 'hand'
type DropPosition = 'before' | 'inside' | 'after'
type ContextMenu = { id: string; x: number; y: number } | null

const SCENE_TOOLS: { mode: Mode; label: string; key: string }[] = [
  { mode: 'hand', label: 'Hand', key: 'Q' },
  { mode: 'translate', label: 'Move', key: 'W' },
  { mode: 'rotate', label: 'Rotate', key: 'E' },
  { mode: 'scale', label: 'Scale', key: 'R' },
]

const TOOL_ICONS = { hand: Hand, translate: Move, rotate: Rotate3D, scale: Scaling }

export interface SceneEditorProps { initialDocument?: SceneDocument; storageKey?: string; assetLibrary?: AssetLibrarySource; initialView?: SceneViewportProps['initialView']; initialProjection?: 'perspective' | 'orthographic'; initialExpanded?: Record<string, boolean>; onSave?: (document: SceneDocument) => void | Promise<void>; onClose?: () => void }

function ViewDropdown({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger className="view-dropdown" aria-label={label} title={label}>
      {label === 'Coordinate space' ? <Globe2 size={15} /> : value === 'orthographic' ? <Square size={18} /> : <Box size={18} />}
      <span>{options.find(option => option.value === value)?.label}</span><ChevronDown size={13} />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="center" collisionPadding={8} aria-label={label}>
      <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
        {options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value} title={option.label}>{option.label}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}

function ToolbarMenu({ canUndo, canRedo, undo, redo, addLight, save, openAssets, openSettings, toggleGizmos, closeEditor }: {
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  addLight: (kind: LightKind) => void
  save: () => void
  openAssets: () => void
  openSettings: () => void
  toggleGizmos: () => void
  closeEditor?: () => void
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger className="icon-button toolbar-menu-trigger" aria-label="Scene actions" title="Scene actions"><Menu size={18} /></DropdownMenuTrigger>
    <DropdownMenuContent align="start" collisionPadding={8} aria-label="Scene actions">
      <DropdownMenuItem disabled={!canUndo} onSelect={undo}><Undo2 size={14} />Undo</DropdownMenuItem>
      <DropdownMenuItem disabled={!canRedo} onSelect={redo}><Redo2 size={14} />Redo</DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger><Lightbulb size={14} />Lighting<ChevronRight className="submenu-chevron" size={13} /></DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {(['directional', 'point', 'spot', 'ambient'] as const).map(kind => <DropdownMenuItem key={kind} onSelect={() => addLight(kind)}><Lightbulb size={14} />Add {kind} light</DropdownMenuItem>)}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem onSelect={openAssets}><Box size={14} />Asset library</DropdownMenuItem>
      <DropdownMenuItem onSelect={openSettings}><ChevronDown size={14} />Scene settings</DropdownMenuItem>
      <DropdownMenuItem onSelect={toggleGizmos}><Axis3D size={14} />Toggle gizmos</DropdownMenuItem>
      <DropdownMenuItem onSelect={save}><Save size={14} />Save scene</DropdownMenuItem>
      {closeEditor && <DropdownMenuItem onSelect={closeEditor}><X size={14} />Close editor</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>
}

export function SceneEditor({ initialDocument, storageKey = 'beegame.scene-editor.draft.v2', assetLibrary, initialView, initialProjection = 'perspective', initialExpanded, onSave, onClose }: SceneEditorProps = {}) {
  const [document, setDocument] = useState<SceneDocument>(() => {
    if (initialDocument) return initialDocument
    try { const saved = localStorage.getItem(storageKey); return saved ? importPackage(JSON.parse(saved)) : makeEmptyScene() } catch { return makeEmptyScene() }
  })
  const history = useRef<SceneHistory>(new SceneHistory(document))
  const [savedContent, setSavedContent] = useState<string | null>(() => {
    if (initialDocument) return sceneContentKey(initialDocument)
    try { const value = localStorage.getItem(storageKey); return value ? sceneContentKey(importPackage(JSON.parse(value))) : null } catch { return null }
  })
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const isSaved = useMemo(() => savedContent === sceneContentKey(document), [document, savedContent])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selected = selectedIds[0] ?? ''
  const [query, setQuery] = useState(''), [mode, setMode] = useState<Mode>('translate'), [space, setSpace] = useState<'local' | 'world'>('world')
  const [showGizmos, setShowGizmos] = useState(initialView?.showGizmos ?? true)
  const [snap, setSnap] = useState(false), [ortho, setOrtho] = useState(initialProjection === 'orthographic'), [focus, setFocus] = useState(0), [notice, setNotice] = useState('')
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false), [sceneSettingsOpen, setSceneSettingsOpen] = useState(false)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set()), [unpickableIds, setUnpickableIds] = useState<Set<string>>(() => new Set()), [expanded, setExpanded] = useState<Record<string, boolean>>(initialExpanded ?? {})
  const [renaming, setRenaming] = useState<string | null>(null), [contextMenu, setContextMenu] = useState<ContextMenu>(null), [dropPreview, setDropPreview] = useState<{ id: string; position: DropPosition } | null>(null)
  const [modelSelection, setModelSelection] = useState<ModelSelection | null>(null)
  const keyboard = currentKeyboardLabels()
  const structures = useMemo(() => Object.fromEntries(Object.entries(document.assets).map(([id, asset]) => [id, readModelStructure(asset)])), [document.assets])
  const [mobilePanel, setMobilePanel] = useState<'hierarchy' | 'inspector' | null>(null)
  const [collapsedPanels, setCollapsedPanels] = useState({ hierarchy: false, inspector: false })
  const [compactPanels, setCompactPanels] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(max-width: 900px)')
    const update = () => setCompactPanels(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const hierarchyCollapsed = compactPanels ? mobilePanel !== 'hierarchy' : collapsedPanels.hierarchy
  const inspectorCollapsed = compactPanels ? mobilePanel !== 'inspector' : collapsedPanels.inspector
  const togglePanel = (panel: 'hierarchy' | 'inspector') => {
    if (compactPanels) setMobilePanel(value => value === panel ? null : panel)
    else setCollapsedPanels(value => ({ ...value, [panel]: !value[panel] }))
  }
  const searchInputRef = useRef<HTMLInputElement>(null)
  const editorRootRef = useRef<HTMLDivElement>(null)
  const current = document.nodes[selected]
  const structure = current?.assetId ? structures[current.assetId] : null
  const selectedPart = modelSelection && structure ? structure.nodes[modelSelection.nodeIndex] : null
  const visibleIds = useMemo(() => flattenVisible(document, expanded, query, structures), [document, expanded, query])

  const setSelection = (ids: string[], primary = ids[0] ?? '') => { setModelSelection(null); const available = history.current.document.nodes; setSelectedIds([...new Set(ids.filter(id => Boolean(available[id])))].sort((a, b) => a === primary ? -1 : b === primary ? 1 : 0)) }
  const selectModelPart = (ownerId: string, nodeIndex: number) => { setSelection([ownerId]); setModelSelection({ ownerId, nodeIndex }) }
  const commit = (ops: Parameters<SceneHistory['commit']>[0], label: string) => { try { const next = history.current.commit(ops, label); setDocument({ ...next, nodes: { ...next.nodes }, assets: { ...next.assets } }); setNotice(`${label} · revision ${next.revision}`); setContextMenu(null); return true } catch (error) { setNotice(`Rejected: ${error instanceof Error ? error.message : String(error)}`); return false } }
  const addLight = (kind: LightKind) => {
    const id = `light-${crypto.randomUUID()}`
    const count = Object.values(document.nodes).filter(node => node.light?.kind === kind).length
    const label = `${kind[0].toUpperCase() + kind.slice(1)} Light`
    const node: SceneNode = { id, name: count ? `${label} ${count + 1}` : label, kind: 'light', parentId: null, children: [], visible: true, locked: false,
      transform: { position: kind === 'ambient' ? [0, 0, 0] : [2, 4, 2], rotation: [-Math.PI / 4, Math.PI / 4, 0], scale: [1, 1, 1] },
      light: { kind, color: '#ffffff', intensity: kind === 'ambient' ? .5 : kind === 'directional' ? 2 : 15, ...(kind === 'point' || kind === 'spot' ? { distance: 15 } : {}), ...(kind === 'spot' ? { angle: Math.PI / 6, penumbra: .2 } : {}) },
    }
    if (commit([{ type: 'scene.addNode', node }], `Add ${label}`)) setSelection([id])
  }
  const addModelAsset = (asset: SceneAsset) => {
    const registered = Object.values(document.assets).find(item => item.bytes === asset.bytes) ?? asset
    const id = `model-${crypto.randomUUID()}`
    const node: SceneNode = { id, name: asset.name.replace(/\.glb$/i, ''), kind: 'model', parentId: null, children: [], visible: true, locked: false, assetId: registered.id, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }
    const added = commit([...(document.assets[registered.id] ? [] : [{ type: 'scene.addAsset' as const, asset: registered }]), { type: 'scene.addNode', node }], 'Add library model')
    if (added) setSelection([id])
    return added
  }
  const duplicate = () => {
    const roots = selectedIds.filter(id => !selectedIds.some(other => other !== id && isDescendant(document, id, other)))
    const operationsToApply: any[] = []
    const copyIds: string[] = []
    for (const rootId of roots) {
      const copy = cloneSubtreeForDuplicate(document, rootId)
      operationsToApply.push(...copy.nodes.map(node => ({ type: 'scene.addNode' as const, node })))
      copyIds.push(copy.rootId)
    }
    if (!operationsToApply.length) return
    commit(operationsToApply, `Duplicate ${copyIds.length} object${copyIds.length === 1 ? '' : 's'}`)
    setSelection(copyIds, copyIds[0])
  }
  const remove = () => { const roots = selectedIds.filter(id => id !== 'root' && document.nodes[id] && !selectedIds.some(other => other !== id && isDescendant(document, id, other))); if (!roots.length) return; commit(roots.map(nodeId => ({ type: 'scene.removeNode', nodeId, expectedExists: true })), `Delete ${roots.length} object${roots.length === 1 ? '' : 's'}`); setSelection([]) }
  const changeTransform = (transform: Transform) => { if (!current) return; try { commit(transformSelection(document, selectedIds, current.id, transform), selectedIds.length > 1 ? 'Transform selection' : 'Change transform') } catch (error) { setNotice(`Rejected: ${error instanceof Error ? error.message : String(error)}`) } }
  const saveDocument = async () => {
    if (savingRef.current) return
    const currentDocument = history.current.document
    savingRef.current = true
    setSaving(true)
    try {
      if (onSave) await onSave(currentDocument)
      else localStorage.setItem(storageKey, JSON.stringify(exportPackage(currentDocument)))
      setSavedContent(sceneContentKey(currentDocument))
      setNotice('')
    } catch (error) {
      setNotice(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const toggleHidden = (id: string) => setHiddenIds(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const togglePickable = (id: string) => setUnpickableIds(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const frame = (id = selected) => { if (id) { if (modelSelection?.ownerId !== id) setSelection([id], id); setFocus(value => value + 1) } }
  const startRename = (id = selected) => { if (id && document.nodes[id] && document.nodes[id].editable !== false) setRenaming(id); setContextMenu(null) }
  const rename = (id: string, name: string) => { const trimmed = name.trim(); if (trimmed && trimmed !== document.nodes[id]?.name) commit([operations.rename(id, trimmed, document.nodes[id].name)], 'Rename node'); setRenaming(null) }
  const moveSelection = (targetId: string, position: DropPosition) => {
    const target = document.nodes[targetId]
    if (!target) return
    const roots = selectedIds.filter(id => id !== targetId && !selectedIds.some(other => other !== id && isDescendant(document, id, other)))
    if (!roots.length) return
    const parentId = position === 'inside' ? targetId : target.parentId
    if (roots.some(id => parentId === id || (parentId && isDescendant(document, parentId, id)))) { setNotice('Rejected: hierarchy cycle'); return }
    const siblings = parentId ? document.nodes[parentId]?.children ?? [] : document.rootIds
    const remaining = siblings.filter(id => !roots.includes(id))
    const targetIndex = remaining.indexOf(targetId)
    const baseIndex = position === 'inside' ? target.children.length : Math.max(0, targetIndex + (position === 'after' ? 1 : 0))
    const ops: any[] = []
    try {
      for (let movedCount = 0; movedCount < roots.length; movedCount += 1) {
        const id = roots[movedCount]
        const node = document.nodes[id]
        if (!node) continue
        const local = localTransformForWorld(document, id, parentId)
        const insertionIndex = position === 'inside' || node.parentId !== parentId ? baseIndex + movedCount : baseIndex
        ops.push(operations.reparent(id, parentId, insertionIndex, node.parentId))
        ops.push(operations.transform(id, local, node.transform))
      }
    } catch (error) {
      setNotice(`Rejected: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    commit(ops, `Move ${roots.length} object${roots.length === 1 ? '' : 's'}`)
    setDropPreview(null)
  }
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.defaultPrevented || event.isComposing) return; const root = editorRootRef.current; if (!root || (!root.contains(event.target as Node) && !root.contains(window.document.activeElement))) return; const target = event.target as HTMLElement | null; if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (window.document.activeElement instanceof HTMLElement) window.document.activeElement.blur(); queueMicrotask(() => void saveDocument()); return } if (target?.matches('input,textarea,select,[contenteditable="true"]') || target?.isContentEditable) return; const key = event.key.toLowerCase(); if (!modelSelection && structure?.roots.length && event.key === 'ArrowRight') { event.preventDefault(); if (expanded[selected] === false) setExpanded(value => ({ ...value, [selected]: true })); else selectModelPart(selected, structure.roots[0]); return } if (modelSelection && (['Delete', 'Backspace', 'F2'].includes(event.key) || ((event.metaKey || event.ctrlKey) && key === 'd'))) { event.preventDefault(); return } if (modelSelection && structure && event.key.startsWith('Arrow')) { event.preventDefault(); navigateModelTree(event.key, modelSelection, structure, expanded, setExpanded, selectModelPart, setSelection); return } if (key === 'q' && !event.repeat && !event.metaKey && !event.ctrlKey) { event.preventDefault(); setMode('hand'); return } const mod = event.metaKey || event.ctrlKey; if (!mod && !event.repeat && key === 'w') { event.preventDefault(); setMode('translate'); return } if (!mod && !event.repeat && key === 'e') { event.preventDefault(); setMode('rotate'); return } if (!mod && !event.repeat && key === 'r') { event.preventDefault(); setMode('scale'); return } if (mod && key === 's') { event.preventDefault(); void saveDocument(); return } if (mod && key === 'd') { event.preventDefault(); duplicate(); return } if (mod && key === 'z') { event.preventDefault(); try { const next = event.shiftKey ? history.current.redo() : history.current.undo(); setDocument({ ...next, nodes: { ...next.nodes }, assets: { ...next.assets } }) } catch (error) { setNotice(String(error)) } return } if (mod && key === 'y') { event.preventDefault(); const next = history.current.redo(); setDocument({ ...next, nodes: { ...next.nodes }, assets: { ...next.assets } }); return } if (event.key === 'F2') { event.preventDefault(); startRename(); return } if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); return } const index = selected ? visibleIds.indexOf(selected) : -1; if (event.key === 'ArrowDown') { event.preventDefault(); const next = visibleIds[Math.min(visibleIds.length - 1, Math.max(0, index + 1))]; if (next) setSelection([next], next) } else if (event.key === 'ArrowUp') { event.preventDefault(); const next = visibleIds[Math.max(0, index < 0 ? 0 : index - 1)]; if (next) setSelection([next], next) } else if (event.key === 'ArrowLeft') { event.preventDefault(); const node = selected ? document.nodes[selected] : undefined; if (node?.children.length && expanded[selected] !== false) setExpanded(value => ({ ...value, [selected]: false })); else if (node?.parentId) setSelection([node.parentId], node.parentId) } else if (event.key === 'ArrowRight') { event.preventDefault(); const node = selected ? document.nodes[selected] : undefined; if (node?.children.length && expanded[selected] === false) setExpanded(value => ({ ...value, [selected]: true })); else { const next = visibleIds[Math.min(visibleIds.length - 1, Math.max(0, index + 1))]; if (next) setSelection([next], next) } } else if (key === 'f') { event.preventDefault(); frame() } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [document, expanded, selected, visibleIds, selectedIds, modelSelection, structure])
  useEffect(() => { const close = () => setContextMenu(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close) }, [])

  const content = <div ref={editorRootRef} tabIndex={0} onPointerDownCapture={event => { const target = event.target as HTMLElement; if (!target.closest('button,[role=menu],[role=dialog],input,textarea,select,[contenteditable="true"]')) event.currentTarget.focus({ preventScroll: true }) }} onContextMenu={event => event.preventDefault()} className="scene-editor-host editor-shell" data-testid="scene-editor" onDragOver={event => event.preventDefault()} onDrop={event => event.preventDefault()}>
    <div className="workspace" data-testid="scene-workspace" data-mobile-panel={mobilePanel ?? ''} data-hierarchy-collapsed={hierarchyCollapsed} data-inspector-collapsed={inspectorCollapsed}>
      <aside className={`panel hierarchy hierarchy-panel ${hierarchyCollapsed ? 'is-collapsed' : ''}`} data-testid="scene-hierarchy" id="scene-hierarchy-panel" inert={hierarchyCollapsed}><PanelTitle title="HIERARCHY" meta={`${Object.keys(document.nodes).length} objects`} /><div className="panel-content"><div className="hierarchy-search"><Search size={14} /><input ref={searchInputRef} className="search" title="Search scene objects and model nodes" aria-label="Search hierarchy" placeholder="Search hierarchy" value={query} onChange={event => setQuery(event.target.value)} />{query.length > 0 && <button type="button" className="search-clear" aria-label="Clear hierarchy search" title="Clear search" onClick={() => { setQuery(''); searchInputRef.current?.focus() }}><X size={14} /></button>}</div><div className="tree" role="tree" aria-label="Scene hierarchy" aria-multiselectable="true" onClick={event => { if (event.target === event.currentTarget) setSelection([]) }}>{document.rootIds.map(id => <TreeNode key={id} id={id} document={document} structures={structures} modelSelection={modelSelection} onSelectPart={selectModelPart} onFramePart={(ownerId, nodeIndex) => { selectModelPart(ownerId, nodeIndex); setFocus(value => value + 1) }} query={query} selectedIds={selectedIds} expanded={expanded} hiddenIds={hiddenIds} unpickableIds={unpickableIds} renaming={renaming} dropPreview={dropPreview} onSelect={(id, event) => { const index = visibleIds.indexOf(id); if (event.shiftKey && selected) { const start = visibleIds.indexOf(selected); setSelection(visibleIds.slice(Math.min(start, index), Math.max(start, index) + 1), id) } else if (event.metaKey || event.ctrlKey) setSelection(selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id], id); else setSelection([id], id) }} onToggleExpand={id => setExpanded(value => ({ ...value, [id]: value[id] === false }))} onToggleHidden={toggleHidden} onTogglePickable={togglePickable} onRename={rename} onBeginRename={startRename} onFrame={frame} onDragPreview={setDropPreview} onDrop={moveSelection} setContext={setContextMenu} />)}</div>{document.rootIds.length === 0 && <div className="empty-state hierarchy-empty" data-testid="scene-empty-state"><Scan size={26} strokeWidth={1.2} /><strong>Empty scene</strong><span>No objects in this scene</span></div>}</div></aside>
      <main className="viewport" data-testid="scene-canvas" onClick={event => { if (event.target === event.currentTarget) setSelection([]) }}><div className="scene-toolbar-position">
        <div className="scene-view-bar" data-testid="scene-toolbar">
          <ToolbarMenu
            canUndo={history.current.canUndo}
            canRedo={history.current.canRedo}
            undo={() => { const next = history.current.undo(); setDocument({ ...next, nodes: { ...next.nodes }, assets: { ...next.assets } }) }}
            redo={() => { const next = history.current.redo(); setDocument({ ...next, nodes: { ...next.nodes }, assets: { ...next.assets } }) }}
            addLight={addLight}
            save={() => void saveDocument()}
            openAssets={() => setAssetLibraryOpen(true)}
            openSettings={() => setSceneSettingsOpen(true)}
            toggleGizmos={() => setShowGizmos(value => !value)}
            closeEditor={onClose}
          />
          <span className="toolbar-divider" />
          <div className="scene-tools" role="toolbar" aria-label="Scene tools" aria-orientation="horizontal">
            {SCENE_TOOLS.map(tool => { const Icon = TOOL_ICONS[tool.mode]; return <button key={tool.mode} className={`icon-button ${mode === tool.mode ? 'active' : ''}`} aria-label={tool.label} aria-pressed={mode === tool.mode} title={`${tool.label} (${tool.key})`} onClick={() => setMode(tool.mode)}><Icon size={18} /></button> })}
          </div>
          <span className="toolbar-divider" />
          <ViewDropdown label="Coordinate space" value={space} options={[{ value: 'local', label: 'Local' }, { value: 'world', label: 'World' }]} onChange={value => setSpace(value as 'local' | 'world')} />
          <ViewDropdown label="Projection" value={ortho ? 'orthographic' : 'perspective'} options={[{ value: 'perspective', label: 'Perspective' }, { value: 'orthographic', label: 'Orthographic' }]} onChange={value => setOrtho(value === 'orthographic')} />
          <Toggle pressed={snap} onPressedChange={setSnap} aria-label="Snap" title="Grid snapping"><Magnet size={16} /><span>Snap</span></Toggle>
          <AssetLibraryDialog source={assetLibrary} assets={document.assets} onAdd={addModelAsset} open={assetLibraryOpen} onOpenChange={setAssetLibraryOpen} trigger={null} />
          <SceneSettingsDialog document={document} onSave={() => void saveDocument()} onApply={(name, settings) => {
            if (name === document.name && canonicalJson(settings) === canonicalJson(document.settings ?? DEFAULT_SCENE_SETTINGS)) return true
            return commit([{ type: 'scene.configure', name, settings, expectedName: document.name, expectedSettings: document.settings ?? null }], 'Configure scene')
          }} open={sceneSettingsOpen} onOpenChange={setSceneSettingsOpen} trigger={null} />
        </div>
        </div>

        <div className="scene-render-surface" data-mode={mode}><SceneViewport showGizmos={showGizmos} initialView={initialView} ortho={ortho} document={document} selected={selected} selectedIds={selectedIds} modelSelection={modelSelection} hiddenIds={[...hiddenIds]} unpickableIds={[...unpickableIds]} onSelect={(id, modifiers = { ctrlKey: false, metaKey: false, shiftKey: false }) => { if (!id) { setSelection([]); return } if (modifiers.shiftKey && selected) { const index = visibleIds.indexOf(id); const start = visibleIds.indexOf(selected); setSelection(visibleIds.slice(Math.min(start, index), Math.max(start, index) + 1), id) } else if (modifiers.ctrlKey || modifiers.metaKey) setSelection(selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id], id); else setSelection([id], id) }} mode={mode} space={space} snap={snap} focus={focus} onTransform={changeTransform} onDiagnostic={setNotice} /></div></main>
      <aside className={`panel inspector inspector-panel ${inspectorCollapsed ? 'is-collapsed' : ''}`} data-testid="scene-inspector" id="scene-inspector-panel" inert={inspectorCollapsed}><PanelTitle title="INSPECTOR" /><div className="panel-content">{selectedIds.length > 1 ? <div className="empty-state"><strong>Multiple Selection</strong><span>{selectedIds.length} objects selected. Transform controls apply the active selection to all selected objects.</span></div> : current ? selectedPart && structure ? <ModelPartInspector part={selectedPart} structure={structure} assetName={document.assets[current.assetId!]?.name ?? current.name} onFocus={() => frame(current.id)} /> : <Inspector key={current.id} node={current} document={document} structure={structure} commit={commit} onFocus={() => frame(current.id)} onSave={() => void saveDocument()} onReparent={parentId => { try { const transform = localTransformForWorld(document, current.id, parentId); commit([operations.reparent(current.id, parentId, undefined, current.parentId), operations.transform(current.id, transform, current.transform)], 'Reparent node') } catch (error) { setNotice(`Rejected: ${String(error)}`) } }} /> : <div className="empty-state inspector-empty"><Box size={28} strokeWidth={1.2} /><strong>No selection</strong><span>Select an object in the hierarchy or scene to edit its properties.</span></div>}</div></aside>
      <PanelEdgeToggle side="hierarchy" collapsed={hierarchyCollapsed} onToggle={() => togglePanel('hierarchy')} />
      <PanelEdgeToggle side="inspector" collapsed={inspectorCollapsed} onToggle={() => togglePanel('inspector')} />
    </div>
    <footer className="bottom-bar">
      <div className="scene-status" role="status"><span className="scene-name" title={document.name}>{document.name}</span><span className={`save-status ${isSaved ? 'saved' : 'unsaved'}`} data-testid="scene-save-status">{isSaved && !saving ? <CircleCheck size={12} /> : <Circle size={9} />}{saving ? 'saving' : isSaved ? 'saved' : 'unsaved'}</span></div>
      <div className="viewport-hints" aria-label="Scene navigation hints">
        <span title={`Hold ${keyboard.altName} and left-drag to orbit`}><MouseButtonIcon button="left" /><kbd aria-label={keyboard.altName}>{keyboard.alt}</kbd><span>Orbit</span></span>
        <span title="Right-drag to look around; WASD to fly"><MouseButtonIcon button="right" /><span>Right · Look</span></span>
        <span title="Drag with the middle mouse button to pan"><MouseButtonIcon button="middle" /><span>Middle · Pan</span></span>
        <span title="Scroll to zoom"><MouseButtonIcon button="wheel" /><span>Scroll · Zoom</span></span>
        <span title="Press F to frame the selected object"><Focus size={14} /><kbd>F</kbd><span>Focus</span></span>
      </div>
    </footer>
    <div className="notice" role="alert">{/rejected|failed|missing|unable|invalid/i.test(notice) ? notice : ''}</div>
    {contextMenu && <ContextMenuView menu={contextMenu} node={document.nodes[contextMenu.id]} canAct={Boolean(document.nodes[contextMenu.id])} onClose={() => setContextMenu(null)} onRename={() => startRename(contextMenu.id)} onDuplicate={duplicate} onDelete={remove} onFrame={() => frame(contextMenu.id)} onToggleExpand={() => setExpanded(value => ({ ...value, [contextMenu.id]: value[contextMenu.id] === false }))} />}
  </div>
  return content
}

function PanelTitle({ title, meta }: { title: string; meta?: string }) {
  return <div className="panel-title"><strong>{title}</strong>{meta && <span className="panel-meta">{meta}</span>}</div>
}
function PanelEdgeToggle({ side, collapsed, onToggle }: { side: 'hierarchy' | 'inspector'; collapsed: boolean; onToggle: () => void }) {
  const Icon = (side === 'hierarchy') === collapsed ? ChevronRight : ChevronLeft
  const hint = `${collapsed ? 'Expand' : 'Collapse'} ${side === 'hierarchy' ? 'Hierarchy' : 'Inspector'}`
  return <button className={`panel-edge-toggle panel-edge-${side}`} aria-label={hint} title={hint} aria-controls={`scene-${side}-panel`} aria-expanded={!collapsed} onClick={onToggle}><Icon size={16} /></button>
}
function ContextMenuView({ menu, node, canAct, onClose, onRename, onDuplicate, onDelete, onFrame, onToggleExpand }: { menu: { id: string; x: number; y: number }; node?: SceneNode; canAct: boolean; onClose: () => void; onRename: () => void; onDuplicate: () => void; onDelete: () => void; onFrame: () => void; onToggleExpand: () => void }) { return <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={event => event.stopPropagation()}><button disabled={!canAct || node?.editable === false} title="Rename object" onClick={onRename}>Rename <kbd>F2</kbd></button><button disabled={!canAct} title="Duplicate object" onClick={onDuplicate}>Duplicate <kbd>{currentKeyboardLabels().modifier} D</kbd></button><button disabled={!canAct} title="Focus object in the scene" onClick={onFrame}>Frame <kbd>F</kbd></button><button disabled={!canAct || !node?.children.length} title="Expand or collapse children" onClick={onToggleExpand}>Expand / Collapse</button><hr /><button className="danger" disabled={!canAct} title="Delete object" onClick={onDelete}>Delete <kbd>{currentKeyboardLabels().delete}</kbd></button><button className="menu-close" title="Close menu" onClick={onClose}>Close</button></div> }
function MouseButtonIcon({ button }: { button: 'left' | 'middle' | 'right' | 'wheel' }) {
  return <svg width="14" height="16" viewBox="0 0 16 18" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><rect x="3" y="1.5" width="10" height="15" rx="5" /><path d="M3 7h10M8 1.5V7" />{button === 'left' ? <path d="M7 2.5C5 2.5 4 4 4 6h3Z" fill="currentColor" stroke="none" /> : button === 'right' ? <path d="M9 2.5c2 0 3 1.5 3 3.5H9Z" fill="currentColor" stroke="none" /> : <path d={button === 'wheel' ? 'm6 10 2-2 2 2m-4 2 2 2 2-2' : 'M8 3.5v3'} strokeWidth="2" />}</svg>
}
function flattenVisible(document: SceneDocument, expanded: Record<string, boolean>, query: string, structures: Record<string, ModelStructure | null>): string[] {
  const result: string[] = []
  const visit = (id: string) => { const node = document.nodes[id]; if (!node || !matchesTreeNode(document, id, query, structures)) return; result.push(id); if (query || expanded[id] !== false) node.children.forEach(visit) }
  document.rootIds.forEach(visit); return result
}
function isDescendant(document: SceneDocument, candidate: string, ancestor: string) { let parent = document.nodes[candidate]?.parentId; while (parent) { if (parent === ancestor) return true; parent = document.nodes[parent]?.parentId } return false }
function worldMatrix(document: SceneDocument, id: string): Matrix4 { const node = document.nodes[id]; if (!node) return new Matrix4(); const matrix = new Matrix4().compose(new Vector3(...node.transform.position), new Quaternion().setFromEuler(new Euler(...node.transform.rotation, 'XYZ')), new Vector3(...node.transform.scale)); return node.parentId ? worldMatrix(document, node.parentId).multiply(matrix) : matrix }
function localTransformForWorld(document: SceneDocument, id: string, parentId: string | null): Transform {
  const parentWorld = parentId ? worldMatrix(document, parentId) : new Matrix4()
  if (Math.abs(parentWorld.determinant()) < 1e-10) throw new Error('Cannot reparent under a singular transform')
  const local = parentWorld.clone().invert().multiply(worldMatrix(document, id))
  if (Math.abs(local.determinant()) < 1e-10) throw new Error('Cannot reparent a singular transform')
  const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3()
  local.decompose(position, quaternion, scale)
  const recomposed = new Matrix4().compose(position, quaternion, scale)
  if (local.elements.some((value, index) => Math.abs(value - recomposed.elements[index]) > 1e-5)) throw new Error('Cannot reparent across unsupported shear')
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
  return { position: position.toArray() as [number, number, number], rotation: [euler.x, euler.y, euler.z], scale: scale.toArray() as [number, number, number] }
}

/** Clone a complete authored subtree with fresh IDs and internal child links. */
export function cloneSubtreeForDuplicate(document: SceneDocument, rootId: string): { rootId: string; nodes: SceneNode[] } {
  if (!document.nodes[rootId]) throw new Error('Cannot duplicate a missing node')
  const idMap = new Map<string, string>()
  const collect = (id: string) => {
    const node = document.nodes[id]
    if (!node || idMap.has(id)) return
    idMap.set(id, `${node.kind}-${crypto.randomUUID().slice(0, 8)}`)
    node.children.forEach(collect)
  }
  collect(rootId)
  const nodes: SceneNode[] = []
  const build = (id: string) => {
    const source = document.nodes[id]
    if (!source) return
    const copy = structuredClone(source)
    copy.id = idMap.get(id)!
    copy.name = id === rootId ? `${copy.name} Copy` : copy.name
    copy.parentId = id === rootId ? source.parentId : idMap.get(source.parentId ?? '') ?? null
    copy.children = source.children.map(child => idMap.get(child)!).filter(Boolean)
    nodes.push(copy)
    source.children.forEach(build)
  }
  build(rootId)
  return { rootId: idMap.get(rootId)!, nodes }
}
export default SceneEditor
