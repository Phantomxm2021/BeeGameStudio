import { useRef, useState, type ReactNode } from 'react'
import { Settings2 } from 'lucide-react'
import { DEFAULT_SCENE_SETTINGS, type SceneDocument, type SceneSettings } from './model'
import { assertSceneSettings } from './validation'
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog'
import { Button } from './components/motion/button'
import { Switch } from './components/motion/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/motion/tabs'

export function SceneSettingsDialog({ document, onApply, onSave, trigger, open: controlledOpen, onOpenChange }: {
  document: SceneDocument
  onApply: (name: string, settings: SceneSettings) => boolean
  onSave: () => void
  trigger?: ReactNode | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = controlledOpen ?? internalOpen
  const setOpen = (value: boolean) => {
    if (!isControlled) setInternalOpen(value)
    onOpenChange?.(value)
  }
  const [name, setName] = useState(document.name)
  const [settings, setSettings] = useState<SceneSettings>({ ...DEFAULT_SCENE_SETTINGS, ...document.settings })
  const [error, setError] = useState('')
  const patch = (value: Partial<SceneSettings>) => setSettings(current => ({ ...current, ...value }))
  const apply = (save = false) => {
    try {
      if (!name.trim()) throw Error('Enter a scene name.')
      assertSceneSettings(settings)
      if (!onApply(name.trim(), settings)) { setError('Unable to apply scene settings.'); return }
      if (save) onSave()
      setOpen(false)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  return <Dialog open={open} onOpenChange={value => {
    if (value) { setName(document.name); setSettings({ ...DEFAULT_SCENE_SETTINGS, ...document.settings }); setError('') }
    setOpen(value)
  }}>
    {trigger === undefined ? <DialogTrigger className="icon-button" aria-label="Scene settings" title="Scene settings"><Settings2 size={18} /></DialogTrigger> : trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
    <DialogContent className="scene-settings-dialog" onOpenAutoFocus={event => { event.preventDefault(); headingRef.current?.focus() }}>
      <div className="settings-heading"><DialogTitle ref={headingRef} tabIndex={-1}>Scene settings</DialogTitle><DialogDescription>Configure this scene’s appearance and environment.</DialogDescription></div>
      <form onSubmit={event => { event.preventDefault(); apply() }} onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          if (event.currentTarget.reportValidity()) apply(true)
        }
      }}>
        <div className="settings-scroll">
          <Tabs defaultValue="environment" className="settings-tabs">
            <TabsList label="Scene setting categories">
              <TabsTrigger value="environment">Environment</TabsTrigger>
              <TabsTrigger value="lighting">Lighting</TabsTrigger>
              <TabsTrigger value="editor">Editor</TabsTrigger>
            </TabsList>
            <TabsContent value="environment">
              <div className="settings-section">
                <label className="settings-field">Scene name<input title="Scene name" value={name} required onChange={event => setName(event.target.value)} /></label>
                <label className="settings-row">Background<input title="Scene background color" type="color" value={settings.background} onChange={event => patch({ background: event.target.value })} /></label>
                <label className="settings-row">Exposure<input className="settings-number" title="Scene exposure" type="number" min="0.1" max="5" step="0.1" value={settings.exposure} onChange={event => patch({ exposure: Number(event.target.value) })} /></label>
              </div>
            </TabsContent>
            <TabsContent value="lighting">
              <div className="settings-section">
                <label className="settings-row">Ambient color<input title="Ambient light color" type="color" value={settings.ambientColor} onChange={event => patch({ ambientColor: event.target.value })} /></label>
                <label className="settings-row">Ambient intensity<input className="settings-number" title="Ambient light intensity" type="number" min="0" max="20" step="0.1" value={settings.ambientIntensity} onChange={event => patch({ ambientIntensity: Number(event.target.value) })} /></label>
              </div>
              <div className="settings-section settings-section-divided">
                <div className="settings-row"><span>Fog</span><Switch aria-label="Enable fog" checked={settings.fogEnabled} onCheckedChange={value => patch({ fogEnabled: value })} /></div>
                <div className={settings.fogEnabled ? '' : 'settings-disabled'}>
                  <label className="settings-row">Fog color<input disabled={!settings.fogEnabled} title="Fog color" type="color" value={settings.fogColor} onChange={event => patch({ fogColor: event.target.value })} /></label>
                  <div className="settings-columns">
                    <label className="settings-field">Fog near<input disabled={!settings.fogEnabled} className="settings-number" title="Distance where fog begins" type="number" min="0" max={settings.fogFar - .1} step="0.1" value={settings.fogNear} onChange={event => patch({ fogNear: Number(event.target.value) })} /></label>
                    <label className="settings-field">Fog far<input disabled={!settings.fogEnabled} className="settings-number" title="Distance where fog reaches full density" type="number" min={settings.fogNear + .1} step="0.1" value={settings.fogFar} onChange={event => patch({ fogFar: Number(event.target.value) })} /></label>
                  </div>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="editor">
              <div className="settings-section">
                <label className="settings-row">Outline color<input title="Selection outline color" type="color" value={settings.selectionColor ?? '#ffad46'} onInput={event => patch({ selectionColor: event.currentTarget.value })} onChange={event => patch({ selectionColor: event.target.value })} /></label>
                <label className="settings-row">Outline width<input className="settings-number" title="Selection outline width in pixels" type="number" min="1" max="8" step="0.5" value={settings.selectionWidth ?? 3} onChange={event => patch({ selectionWidth: Number(event.target.value) })} /></label>
                <div className="settings-row"><span>Scene grid</span><Switch aria-label="Show grid" checked={settings.showGrid} onCheckedChange={value => patch({ showGrid: value })} /></div>
              </div>
            </TabsContent>
          </Tabs>
          {error && <p className="settings-error" role="alert">{error}</p>}
        </div>
        <div className="settings-actions"><Button title="Apply scene settings" className="settings-apply" type="submit">Apply</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}
