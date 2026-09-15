import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Box, Eye, File, LibraryBig, Image as ImageIcon, Plus, Search, X } from 'lucide-react'
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from './components/ui/context-menu'
import { AssetModelPreview } from './viewport'
import { dataUri, fromDataUri } from './assets'
import type { SceneAsset } from './model'

export type AssetLibrarySource = { url: string; label: string }
type Entry = { name: string; path: string; mimeType: string; size: number; url?: string; asset?: SceneAsset }
const isModel = (entry: Entry) => entry.path.toLowerCase().endsWith('.glb')
const isImage = (entry: Entry) => /\.(png|jpe?g|webp|gif|avif)$/i.test(entry.path)
async function loadEntry(entry: Entry, signal: AbortSignal): Promise<SceneAsset> {
  if (entry.asset) return entry.asset
  if (!entry.url) throw Error('The selected asset is unavailable.')
  const response = await fetch(entry.url, { signal })
  if (!response.ok) throw Error('Unable to load the selected asset.')
  return { id: `asset-${crypto.randomUUID()}`, name: entry.name, path: entry.path, mimeType: entry.mimeType, bytes: dataUri(new Uint8Array(await response.arrayBuffer()), entry.mimeType) }
}

export function AssetLibraryDialog({ source, assets, onAdd, trigger, open: controlledOpen, onOpenChange }: {
  source?: AssetLibrarySource
  assets: Record<string, SceneAsset>
  onAdd: (asset: SceneAsset) => boolean
  trigger?: ReactNode | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = controlledOpen ?? internalOpen
  const setOpen = (value: boolean) => {
    if (!isControlled) setInternalOpen(value)
    onOpenChange?.(value)
  }
  const [entries, setEntries] = useState<Entry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [preview, setPreview] = useState<{ entry: Entry; asset?: SceneAsset } | null>(null)
  const [error, setError] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pending = useRef<AbortController | null>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const gallery = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setError(''); setSelected(null); setQuery(''); setPreview(null)
    if (!source) { setEntries(Object.values(assets).map(asset => ({ name: asset.name, path: asset.path, mimeType: asset.mimeType, size: asset.bytes ? fromDataUri(asset.bytes).length : 0, asset }))); return }
    setLoading(true); setEntries([])
    fetch(source.url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error('Unable to read the asset directory.')
      const catalog = await response.json()
      if (!Array.isArray(catalog.assets)) throw Error('Invalid asset directory listing.')
      setEntries(catalog.assets)
    }).catch(error => { if (!controller.signal.aborted) setError(String(error)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, source, assets])
  useEffect(() => () => pending.current?.abort(), [])
  useEffect(() => {
    if (preview) backButton.current?.focus()
    else gallery.current?.querySelector<HTMLButtonElement>('[aria-pressed=true]')?.focus()
  }, [preview?.entry.path])
  const run = async (entry: Entry, action: 'preview' | 'add') => {
    pending.current?.abort()
    const controller = new AbortController(); pending.current = controller
    setError('')
    if (action === 'preview') setPreview({ entry }); else setAdding(true)
    try {
      const asset = await loadEntry(entry, controller.signal)
      if (controller.signal.aborted) return
      if (action === 'preview') setPreview({ entry, asset })
      else if (onAdd(asset)) setOpen(false)
    } catch (error) { if (!controller.signal.aborted) setError(String(error)) }
    finally { if (!controller.signal.aborted) setAdding(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value) { pending.current?.abort(); setAdding(false) }; setOpen(value) }}>
    {trigger === undefined ? <DialogTrigger className="icon-button" aria-label="Asset library" title="Open asset library"><LibraryBig size={18} /></DialogTrigger> : trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
    <DialogContent className="asset-library-dialog">
      <div className={`settings-heading ${preview ? 'asset-preview-heading' : ''}`}>
        {preview && <button ref={backButton} className="icon-button" title="Back to asset library" aria-label="Back to asset library" onClick={() => { pending.current?.abort(); setPreview(null); setError('') }}><ArrowLeft size={18} /></button>}
        <div><DialogTitle>{preview ? preview.entry.name : 'Asset library'}</DialogTitle><DialogDescription>{preview ? isModel(preview.entry) ? 'Drag to orbit · Scroll to zoom' : 'Image preview' : source?.label ?? 'Current scene assets'}</DialogDescription></div>
      </div>
      {preview ? <div className="asset-preview" aria-label={`Preview ${preview.entry.name}`}>
        {preview.asset ? isModel(preview.entry) ? <AssetModelPreview asset={preview.asset} assets={assets} onDiagnostic={setError} /> : <img src={preview.asset.bytes} alt={preview.entry.name} onError={() => setError('Unable to preview this image.')} /> : !error && <p role="status">Loading preview…</p>}
      </div> : <div className="asset-library-body">
        <div className="asset-search"><Search size={14} /><input ref={searchInputRef} title="Search library assets" aria-label="Search assets" placeholder="Search assets" value={query} onChange={event => setQuery(event.target.value)} />{query.length > 0 && <button type="button" className="search-clear" aria-label="Clear assets search" title="Clear search" onClick={() => { setQuery(''); searchInputRef.current?.focus() }}><X size={14} /></button>}</div>
        <div ref={gallery} className="asset-grid" aria-label="Library assets">
          {entries.filter(item => `${item.name} ${item.path}`.toLowerCase().includes(query.toLowerCase())).map(item => {
            const Icon = item.mimeType.startsWith('image/') ? ImageIcon : /\.gl(tf|b)$/i.test(item.path) ? Box : File
            return <ContextMenu key={item.path} onOpenChange={value => { if (value) setSelected(item.path) }}>
              <ContextMenuTrigger asChild><button className="asset-card" aria-pressed={selected === item.path} title={`${item.name} · Right-click for actions`} onClick={() => setSelected(item.path)} onDoubleClick={() => { if (isModel(item) || isImage(item)) void run(item, 'preview') }}><Icon size={32} strokeWidth={1.3} /><strong>{item.name}</strong><span>{item.path}</span></button></ContextMenuTrigger>
              <ContextMenuContent collisionPadding={8} aria-label={`${item.name} actions`}>
                <ContextMenuItem title="Preview asset" disabled={adding || (!isModel(item) && !isImage(item))} onSelect={() => void run(item, 'preview')}><Eye size={14} />Preview</ContextMenuItem>
                <ContextMenuItem title="Add model to scene" disabled={adding || !isModel(item)} onSelect={() => void run(item, 'add')}><Plus size={14} />Add to scene</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          })}
          {loading ? <p role="status">Reading asset directory…</p> : !entries.length && <p>No assets in this directory.</p>}
        </div>
        {adding && <p role="status">Adding model…</p>}
      </div>}
      {error && <p className="settings-error asset-library-error" role="alert">{error}</p>}
    </DialogContent>
  </Dialog>
}
