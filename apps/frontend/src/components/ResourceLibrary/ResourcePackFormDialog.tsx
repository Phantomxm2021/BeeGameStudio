import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ResourcePackPrimaryCategory, ResourcePackSummary } from '../../services/resourceLibraryApi'
import { CONFIGURED_PRODUCTION_SETTING_OPTIONS } from '../../config/productionSettingOptions'

export type ResourcePackFormValues = {
  name: string
  styles: string[]
  dimension: ResourcePackSummary['dimension']
  gameTypes: string[]
  primaryCategory: ResourcePackPrimaryCategory | ''
  description: string
  tags: string
  version: string
  license: string
  author: string
  source: string
  licenseEvidence: string
  compatibleEngines: string
}

type Props = {
  open: boolean
  title: string
  submitLabel: string
  submittingLabel: string
  initialValues: ResourcePackFormValues
  onClose: () => void
  onSubmit: (values: ResourcePackFormValues, cover: File | null) => Promise<void>
  allowCover?: boolean
  formTestId?: string
  contentTestId?: string
  metadataTestId?: string
}

const primaryCategoryOptions: ReadonlyArray<readonly [ResourcePackPrimaryCategory, string]> = [
  ['2d-art', 'primaryCategories.2d-art'], ['3d-assets', 'primaryCategories.3d-assets'], ['animation-rig', 'primaryCategories.animation-rig'],
  ['ui-kit', 'primaryCategories.ui-kit'], ['vfx', 'primaryCategories.vfx'], ['audio', 'primaryCategories.audio'], ['fonts', 'primaryCategories.fonts'],
  ['world-scene', 'primaryCategories.world-scene'], ['mixed', 'primaryCategories.mixed'],
]

export function ResourcePackFormDialog({
  open,
  title,
  submitLabel,
  submittingLabel,
  initialValues,
  onClose,
  onSubmit,
  allowCover = false,
  formTestId = 'resource-pack-dialog',
  contentTestId = 'resource-pack-content',
  metadataTestId = 'resource-pack-metadata',
}: Props) {
  const { t } = useTranslation('resourceLibrary')
  const [values, setValues] = useState<ResourcePackFormValues>(() => cloneValues(initialValues))
  const [cover, setCover] = useState<File | null>(null)
  const [customStyle, setCustomStyle] = useState('')
  const [customGameType, setCustomGameType] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setValues(cloneValues(initialValues))
    setCover(null)
    setCustomStyle('')
    setCustomGameType('')
    setError('')
  }, [open, initialValues])

  const styleOptions = useMemo(() => [
    ...CONFIGURED_PRODUCTION_SETTING_OPTIONS.styles,
    ...values.styles.filter(value => !CONFIGURED_PRODUCTION_SETTING_OPTIONS.styles.includes(value as never)),
  ], [values.styles])
  const gameTypeOptions = useMemo(() => [
    ...CONFIGURED_PRODUCTION_SETTING_OPTIONS.genres,
    ...values.gameTypes.filter(value => !CONFIGURED_PRODUCTION_SETTING_OPTIONS.genres.includes(value as never)),
  ], [values.gameTypes])

  if (!open) return null

  const update = <Key extends keyof ResourcePackFormValues>(key: Key, value: ResourcePackFormValues[Key]) => {
    setValues(current => ({ ...current, [key]: value }))
  }
  const toggleListValue = (key: 'styles' | 'gameTypes', value: string) => {
    update(key, values[key].includes(value) ? values[key].filter(item => item !== value) : [...values[key], value])
  }
  const addCustomValue = (key: 'styles' | 'gameTypes', value: string, clear: () => void) => {
    const normalized = value.trim()
    if (normalized && !values[key].includes(normalized)) update(key, [...values[key], normalized])
    clear()
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!values.name.trim() || values.styles.length === 0 || values.gameTypes.length === 0 || !values.primaryCategory) {
      setError(t('createRequired'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSubmit({ ...values, name: values.name.trim() }, cover)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('submitFailed'))
    } finally {
      setSaving(false)
    }
  }
  const chipClass = (selected: boolean) => `type-button h-9 rounded-full border px-4 transition-colors ${selected ? 'border-orange-200/45 bg-orange-200/10 text-orange-100' : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-200'}`

  return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[260] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6">
    <form data-testid={formTestId} onSubmit={submit} className="input-surface relative flex w-full max-w-[640px] max-h-[calc(100dvh-48px)] flex-col overflow-hidden rounded-[24px] border border-white/15 bg-[#18191d] p-6 shadow-2xl shadow-black/60 sm:p-7">
      <header className="relative z-10 flex items-start justify-between gap-6"><h2 className="type-modal-title min-w-0 text-zinc-50">{title}</h2><button type="button" onClick={onClose} className="glass-icon-button h-10 w-10 shrink-0 text-xl" aria-label={t('close')}>×</button></header>
      <div data-testid={contentTestId} className="relative z-10 mt-6 grid min-h-0 flex-1 gap-6 overflow-y-auto pr-1">
        <div data-testid={metadataTestId} className="grid gap-5 sm:grid-cols-2"><label className="type-label grid gap-2 text-zinc-300 sm:col-span-2">{t('name')}<input autoFocus value={values.name} onChange={event => update('name', event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" placeholder={t('form.namePlaceholder')} /></label><label className="type-label grid gap-2 text-zinc-300">{t('dimension')}<select value={values.dimension} onChange={event => update('dimension', event.target.value as ResourcePackSummary['dimension'])} className="glass-control type-input h-11 rounded-xl px-3"><option value="agnostic">{t('mixed')}</option><option value="2D">{t('dimensions.twoD')}</option><option value="3D">{t('dimensions.threeD')}</option></select></label><label className="type-label grid gap-2 text-zinc-300">{t('category')}<select value={values.primaryCategory} onChange={event => update('primaryCategory', event.target.value as ResourcePackPrimaryCategory)} className="glass-control type-input h-11 rounded-xl px-3"><option value="">{t('selectResourceType')}</option>{primaryCategoryOptions.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label></div>
        {allowCover ? <label className="type-label grid gap-2 text-zinc-300">{t('cover')} <span className="type-caption font-normal text-zinc-500">{t('coverOptional')}</span><input aria-label={t('uploadCover')} type="file" accept="image/*,video/mp4,video/webm" onChange={event => setCover(event.target.files?.[0] || null)} className="glass-control type-input h-11 rounded-xl px-3 py-2" />{cover ? <span className="type-caption font-normal text-zinc-400">{cover.name}</span> : null}</label> : null}
        <div className="grid gap-5 sm:grid-cols-2"><label className="type-label grid gap-2 text-zinc-300 sm:col-span-2">{t('metadata.description')}<textarea value={values.description} onChange={event => update('description', event.target.value)} className="glass-control type-input min-h-20 rounded-xl px-3 py-2" /></label><label className="type-label grid gap-2 text-zinc-300 sm:col-span-2">{t('metadata.tags')}<input value={values.tags} onChange={event => update('tags', event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" placeholder={t('form.tagsPlaceholder')} /></label><label className="type-label grid gap-2 text-zinc-300">{t('metadata.version')}<input value={values.version} onChange={event => update('version', event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="type-label grid gap-2 text-zinc-300">{t('metadata.license')}<input value={values.license} onChange={event => update('license', event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="type-label grid gap-2 text-zinc-300">{t('metadata.author')}<input value={values.author} onChange={event => update('author', event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="type-label grid gap-2 text-zinc-300">{t('metadata.source')}<input value={values.source} onChange={event => update('source', event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="type-label grid gap-2 text-zinc-300 sm:col-span-2">{t('metadata.licenseEvidence')}<input value={values.licenseEvidence} onChange={event => update('licenseEvidence', event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="type-label grid gap-2 text-zinc-300 sm:col-span-2">{t('metadata.compatibleTargets')}<input value={values.compatibleEngines} onChange={event => update('compatibleEngines', event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" placeholder={t('form.compatibleTargetsPlaceholder')} /></label></div>
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0"><legend className="type-label block p-0 text-zinc-300">{t('style')} <span className="type-caption ml-1 font-normal text-zinc-500">{t('multiSelect')}</span></legend><div className="flex flex-wrap gap-3">{styleOptions.map(option => <button key={option} type="button" aria-pressed={values.styles.includes(option)} onClick={() => toggleListValue('styles', option)} className={chipClass(values.styles.includes(option))}>{option}</button>)}</div><div className="flex gap-3"><input value={customStyle} onChange={event => setCustomStyle(event.target.value)} className="glass-control type-input h-10 min-w-0 flex-1 rounded-xl px-3" placeholder={t('customStyle')} /><button type="button" className="secondary-pill type-button h-10 px-4" onClick={() => addCustomValue('styles', customStyle, () => setCustomStyle(''))}>{t('add')}</button></div></fieldset>
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0"><legend className="type-label block p-0 text-zinc-300">{t('gameTypes')} <span className="type-caption ml-1 font-normal text-zinc-500">{t('multiSelect')}</span></legend><div className="flex flex-wrap gap-3">{gameTypeOptions.map(option => <button key={option} type="button" aria-pressed={values.gameTypes.includes(option)} onClick={() => toggleListValue('gameTypes', option)} className={chipClass(values.gameTypes.includes(option))}>{option}</button>)}</div><div className="flex gap-3"><input value={customGameType} onChange={event => setCustomGameType(event.target.value)} className="glass-control type-input h-10 min-w-0 flex-1 rounded-xl px-3" placeholder={t('customGameType')} /><button type="button" className="secondary-pill type-button h-10 px-4" onClick={() => addCustomValue('gameTypes', customGameType, () => setCustomGameType(''))}>{t('add')}</button></div></fieldset>
      </div>
      {error ? <p role="alert" className="relative z-10 mt-5 rounded-xl border border-red-300/20 bg-red-400/10 p-3 type-footnote text-red-200">{error}</p> : null}
      <footer className="relative z-10 mt-6 flex shrink-0 justify-end"><button disabled={saving} className="primary-pill type-button h-11 px-6 disabled:cursor-not-allowed disabled:opacity-50">{saving ? submittingLabel : submitLabel}</button></footer>
    </form>
  </div>
}

function cloneValues(values: ResourcePackFormValues): ResourcePackFormValues {
  return { ...values, styles: [...values.styles], gameTypes: [...values.gameTypes] }
}
