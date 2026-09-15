import { useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { DEFAULT_SCENE_SETTINGS, type SceneDocument, type SceneSettings } from './model'
import { assertSceneSettings } from './validation'
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from './components/ui/dialog'
import { Toggle } from './components/ui/toggle'

export function SceneSettingsDialog({ document, onApply, onSave }: {
  document: SceneDocument
  onApply: (name: string, settings: SceneSettings) => boolean
  onSave: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [open, setOpen] = useState(false)
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
    <DialogTrigger className="icon-button" aria-label="Scene settings" title="Scene settings"><Settings2 size={18} /></DialogTrigger>
    <DialogContent className="scene-settings-dialog" onOpenAutoFocus={event => { event.preventDefault(); headingRef.current?.focus() }}>
      <div className="settings-heading"><DialogTitle ref={headingRef} tabIndex={-1}>Scene settings</DialogTitle><DialogDescription>Configure this scene’s appearance and environment.</DialogDescription></div>
      <form onSubmit={event => { event.preventDefault(); apply() }} onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          if (event.currentTarget.reportValidity()) apply(true)
        }
      }}>
        <div className="settings-scroll">
          <label className="settings-field">Scene name<input title="Scene name" value={name} required onChange={event => setName(event.target.value)} /></label>
          <fieldset><legend>Environment</legend>
            <label className="settings-row">Background<input title="Scene background color" type="color" value={settings.background} onChange={event => patch({ background: event.target.value })} /></label>
            <label className="settings-row">Exposure<input title="Scene exposure" type="number" min="0.1" max="5" step="0.1" value={settings.exposure} onChange={event => patch({ exposure: Number(event.target.value) })} /></label>
          </fieldset>
          <fieldset><legend>Ambient lighting</legend>
            <label className="settings-row">Ambient color<input title="Ambient light color" type="color" value={settings.ambientColor} onChange={event => patch({ ambientColor: event.target.value })} /></label>
            <label className="settings-row">Ambient intensity<input title="Ambient light intensity" type="number" min="0" max="20" step="0.1" value={settings.ambientIntensity} onChange={event => patch({ ambientIntensity: Number(event.target.value) })} /></label>
          </fieldset>
          <fieldset><legend>Selection highlight</legend>
            <label className="settings-row">Outline color<input title="Selection outline color" type="color" value={settings.selectionColor ?? '#ffad46'} onInput={event => patch({ selectionColor: event.currentTarget.value })} onChange={event => patch({ selectionColor: event.target.value })} /></label>
            <label className="settings-row">Outline width (px)<input title="Selection outline width in pixels" type="number" min="1" max="8" step="0.5" value={settings.selectionWidth ?? 3} onChange={event => patch({ selectionWidth: Number(event.target.value) })} /></label>
          </fieldset>
          <fieldset><legend>Fog</legend>
            <div className="settings-row"><span>Enable fog</span><Toggle aria-label="Enable fog" title="Enable or disable scene fog" pressed={settings.fogEnabled} onPressedChange={value => patch({ fogEnabled: value })}>{settings.fogEnabled ? 'On' : 'Off'}</Toggle></div>
            <label className="settings-row">Fog color<input title="Fog color" type="color" value={settings.fogColor} onChange={event => patch({ fogColor: event.target.value })} /></label>
            <div className="settings-columns">
              <label className="settings-field">Fog near<input title="Distance where fog begins" type="number" min="0" max={settings.fogFar - .1} step="0.1" value={settings.fogNear} onChange={event => patch({ fogNear: Number(event.target.value) })} /></label>
              <label className="settings-field">Fog far<input title="Distance where fog reaches full density" type="number" min={settings.fogNear + .1} step="0.1" value={settings.fogFar} onChange={event => patch({ fogFar: Number(event.target.value) })} /></label>
            </div>
          </fieldset>
          <div className="settings-row"><span>Scene grid</span><Toggle aria-label="Show grid" title="Show or hide the scene grid" pressed={settings.showGrid} onPressedChange={value => patch({ showGrid: value })}>{settings.showGrid ? 'Visible' : 'Hidden'}</Toggle></div>
          {error && <p className="settings-error" role="alert">{error}</p>}
        </div>
        <div className="settings-actions"><DialogClose title="Discard changes and close" type="button">Cancel</DialogClose><button title="Apply scene settings" className="primary" type="submit">Apply changes</button></div>
      </form>
    </DialogContent>
  </Dialog>
}
