import { useState, type FormEvent } from 'react'
import { Check, ChevronDown, ChevronLeft, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CONFIGURED_PRODUCTION_SETTING_OPTIONS } from '../../config/productionSettingOptions'
import { useToastContext } from '../../contexts/ToastContext'
import type { CreateResourcePackInput, ResourcePackPrimaryCategory, ResourcePackSummary } from '../../services/resourceLibraryApi'
import { ProjectSelect } from '../beui/project-select'
import { MorphPopover, MorphPopoverContent, MorphPopoverTrigger } from '../beui/registry/components/motion/popover-morph'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'

type Props = {
  open: boolean
  onClose: () => void
  onCreate: (input: CreateResourcePackInput) => Promise<ResourcePackSummary>
  availableTags?: readonly string[]
}

type FormValues = {
  name: string
  dimension: ResourcePackSummary['dimension']
  primaryCategory: ResourcePackPrimaryCategory | ''
  styles: string[]
  gameTypes: string[]
  description: string
  tags: string[]
  version: string
  license: string
  author: string
  source: string
  licenseEvidence: string
}

const emptyValues = (): FormValues => ({
  name: '', dimension: 'agnostic', primaryCategory: '', styles: [], gameTypes: [],
  description: '', tags: [], version: '0.1.0', license: '', author: '', source: '', licenseEvidence: '',
})

const primaryCategoryOptions: readonly ResourcePackPrimaryCategory[] = [
  '2d-art', '3d-assets', 'animation-rig', 'ui-kit', 'vfx', 'audio', 'fonts', 'world-scene', 'mixed',
]

const inputClass = 'type-input h-11 min-w-0 w-full rounded-xl border border-transparent bg-muted px-3.5 text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20'
const labelClass = 'type-label grid min-w-0 gap-2 text-foreground'

type MultiSelectFieldProps = {
  label: string
  customLabel: string
  addLabel: string
  options: readonly string[]
  value: readonly string[]
  onChange: (value: string[]) => void
  tags?: boolean
}

function MultiSelectField({ label, customLabel, addLabel, options, value, onChange, tags = false }: MultiSelectFieldProps) {
  const [custom, setCustom] = useState('')
  const choices = [...new Set([...options, ...value])]
  const toggle = (item: string) => onChange(value.includes(item) ? value.filter(selected => selected !== item) : [...value, item])
  const add = () => {
    const additions = tags ? custom.split(',').map(item => item.trim()).filter(Boolean) : [custom.trim()].filter(Boolean)
    if (additions.length) onChange([...new Set([...value, ...additions])])
    setCustom('')
  }

  return <div className={labelClass}>
    <span>{label}</span>
    <MorphPopover className="block min-w-0 w-full">
      <MorphPopoverTrigger>
        <button type="button" aria-label={value.length ? `${label}：${value.join('，')}` : label} className="flex h-11 min-w-0 w-full items-center gap-2 rounded-xl border border-transparent bg-muted px-3.5 text-left text-sm text-foreground transition hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {tags && value.length ? <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"><span className="min-w-0 max-w-full truncate rounded-md bg-background px-2 py-1 text-xs">{value[0]}</span>{value.length > 1 ? <span className="shrink-0 text-xs text-muted-foreground">+{value.length - 1}</span> : null}</span> : <span className={`min-w-0 flex-1 truncate ${value.length ? '' : 'text-muted-foreground'}`}>{value.length ? value.join(', ') : label}</span>}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </MorphPopoverTrigger>
      <MorphPopoverContent ariaLabel={label} side={tags ? 'bottom' : 'top'} align="start" onOpenAutoFocus={content => content.querySelector('input')?.focus()} className="w-[min(330px,calc(100vw-2rem))] max-h-[min(280px,60vh)] overflow-y-auto bg-popover p-2 text-popover-foreground">
        {choices.length ? <div role="group" aria-label={label} className="grid grid-cols-3 gap-1">
          {choices.map(option => <button key={option} type="button" aria-pressed={value.includes(option)} onClick={() => toggle(option)} className={`flex min-w-0 items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs transition ${value.includes(option) ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}`}><span className="min-w-0 flex-1 truncate">{option}</span>{value.includes(option) ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}</button>)}
        </div> : null}
        <div className={`flex min-w-0 gap-1 ${choices.length ? 'mt-2 border-t border-border pt-2' : ''}`}>
          <input aria-label={customLabel} value={custom} onChange={event => setCustom(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add() } }} placeholder={customLabel} className="type-input h-9 min-w-0 flex-1 rounded-lg bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <button type="button" aria-label={addLabel} onClick={add} className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground hover:bg-accent"><Plus className="size-4" aria-hidden="true" /></button>
        </div>
      </MorphPopoverContent>
    </MorphPopover>
  </div>
}

export function CreateResourcePackDialog(props: Props) {
  return props.open ? <CreateResourcePackDialogContent {...props} /> : null
}

function CreateResourcePackDialogContent({ open, onClose, onCreate, availableTags = [] }: Props) {
  const { t } = useTranslation('resourceLibrary')
  const { showError } = useToastContext()
  const [values, setValues] = useState<FormValues>(emptyValues)
  const [step, setStep] = useState<1 | 2>(1)
  const [saving, setSaving] = useState(false)

  const update = <Key extends keyof FormValues>(key: Key, value: FormValues[Key]) => {
    setValues(current => ({ ...current, [key]: value }))
  }
  const styleOptions = [...new Set([...CONFIGURED_PRODUCTION_SETTING_OPTIONS.styles, ...values.styles])]
  const gameTypeOptions = [...new Set([...CONFIGURED_PRODUCTION_SETTING_OPTIONS.genres, ...values.gameTypes])]
  const tagOptions = [...new Set([...availableTags, ...values.tags])]

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    if (step === 1) {
      if (!values.name.trim() || !values.primaryCategory || !values.styles.length || !values.gameTypes.length) {
        showError(t('createRequired'))
        return
      }
      setStep(2)
      return
    }
    setSaving(true)
    try {
      await onCreate({
        name: values.name.trim(),
        dimension: values.dimension,
        primaryCategory: values.primaryCategory || 'mixed',
        styles: values.styles,
        gameTypes: values.gameTypes,
        categories: [],
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
        ...(values.tags.length ? { tags: values.tags } : {}),
        ...(values.version.trim() ? { version: values.version.trim() } : {}),
        ...(values.license.trim() ? { license: values.license.trim() } : {}),
        ...(values.author.trim() ? { author: values.author.trim() } : {}),
        ...(values.source.trim() ? { source: values.source.trim() } : {}),
        ...(values.licenseEvidence.trim() ? { licenseEvidence: values.licenseEvidence.trim() } : {}),
      })
      onClose()
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : t('create'))
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={value => { if (!value) onClose() }}>
    <DialogContent aria-label={t('create')} className="h-[480px] max-h-[calc(100dvh-32px)] max-w-[600px] overflow-hidden rounded-[22px] p-0">
      <form data-testid="create-pack-dialog" onSubmit={submit} className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
        <header className="flex shrink-0 items-center justify-between gap-4 px-7 py-4 max-sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            {step === 2 ? <button type="button" onClick={() => setStep(1)} aria-label={t('createBack')} className="grid size-8 shrink-0 place-items-center border-0 bg-transparent text-muted-foreground hover:text-foreground"><ChevronLeft className="size-5" aria-hidden="true" /></button> : null}
            <DialogTitle className="type-modal-title min-w-0 text-[26px] tracking-tight">{step === 1 ? t('create') : t('createMoreInfo')}</DialogTitle>
          </div>
          <button type="button" onClick={onClose} aria-label={t('close')} className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-accent"><X className="size-4" aria-hidden="true" /></button>
        </header>

        <div data-testid="create-pack-content" className="min-h-0 flex-1 overflow-y-auto px-7 pb-3 max-sm:px-5">
          {step === 1 ? <div data-testid="create-pack-metadata" className="grid min-w-0 content-start gap-3">
            <label className={labelClass}>{t('name')}<input autoFocus value={values.name} onChange={event => update('name', event.target.value)} className={inputClass} placeholder={t('nameExample')} /></label>
            <div className="grid min-w-0 grid-cols-2 gap-4 max-sm:gap-2.5">
              <div className={labelClass}>{t('dimension')}<ProjectSelect portal ariaLabel={t('dimension')} value={values.dimension} onValueChange={value => update('dimension', value as ResourcePackSummary['dimension'])} options={[{ value: 'agnostic', label: t('mixed') }, { value: '2D', label: '2D' }, { value: '3D', label: '3D' }]} className="min-w-0" triggerClassName="type-input h-11 rounded-xl border-transparent bg-muted" /></div>
              <div className={labelClass}>{t('category')}<ProjectSelect portal ariaLabel={t('category')} value={values.primaryCategory} onValueChange={value => update('primaryCategory', value as ResourcePackPrimaryCategory)} placeholder={t('selectResourceType')} options={primaryCategoryOptions.map(value => ({ value, label: t(`primaryCategories.${value}`) }))} className="min-w-0" triggerClassName="type-input h-11 rounded-xl border-transparent bg-muted" /></div>
            </div>
            <MultiSelectField label={t('style')} customLabel={t('customStyle')} addLabel={t('add')} options={styleOptions} value={values.styles} onChange={value => update('styles', value)} />
            <MultiSelectField label={t('gameTypes')} customLabel={t('customGameType')} addLabel={t('add')} options={gameTypeOptions} value={values.gameTypes} onChange={value => update('gameTypes', value)} />
          </div> : <div className="grid min-w-0 content-start gap-3">
            <label className={labelClass}>{t('metadata.description')}<textarea value={values.description} onChange={event => update('description', event.target.value)} rows={2} className="type-input h-[52px] min-w-0 w-full resize-none rounded-xl border border-transparent bg-muted px-3.5 py-2 text-foreground" /></label>
            <div className="grid min-w-0 grid-cols-2 gap-4 max-sm:gap-2.5">
              <MultiSelectField tags label={t('metadata.tags')} customLabel={t('createAddTag')} addLabel={t('add')} options={tagOptions} value={values.tags} onChange={value => update('tags', value)} />
              <label className={labelClass}>{t('metadata.version')}<input value={values.version} onChange={event => update('version', event.target.value)} className={inputClass} /></label>
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-4 max-sm:gap-2.5">
              <label className={labelClass}>{t('metadata.license')}<input value={values.license} onChange={event => update('license', event.target.value)} className={inputClass} /></label>
              <label className={labelClass}>{t('metadata.author')}<input value={values.author} onChange={event => update('author', event.target.value)} className={inputClass} /></label>
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-4 max-sm:gap-2.5">
              <label className={labelClass}>{t('metadata.source')}<input value={values.source} onChange={event => update('source', event.target.value)} className={inputClass} /></label>
              <label className={labelClass}>{t('metadata.licenseEvidence')}<input value={values.licenseEvidence} onChange={event => update('licenseEvidence', event.target.value)} className={inputClass} /></label>
            </div>
          </div>}
        </div>

        <footer className="flex shrink-0 justify-end border-t border-border px-7 py-2 max-sm:px-5">
          <button type="submit" disabled={saving} className="type-button h-10 rounded-full bg-primary px-5 text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{step === 1 ? t('createContinue') : saving ? t('creating') : t('create')}</button>
        </footer>
      </form>
    </DialogContent>
  </Dialog>
}
