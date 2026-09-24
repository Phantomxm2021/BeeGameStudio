import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ResourcePackPrimaryCategory, ResourcePackSummary } from '../../services/resourceLibraryApi'
import { CONFIGURED_PRODUCTION_SETTING_OPTIONS } from '../../config/productionSettingOptions'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { ProjectSelect } from '../beui/project-select'

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
  finalFocus?: () => HTMLElement | null
}

const primaryCategoryOptions: ReadonlyArray<readonly [ResourcePackPrimaryCategory, string]> = [
  ['2d-art', '2D 美术包'], ['3d-assets', '3D 资产包'], ['animation-rig', '动画与骨骼包'],
  ['ui-kit', 'UI Kit'], ['vfx', 'VFX 包'], ['audio', '音频包'], ['fonts', '字体包'],
  ['world-scene', '世界与场景包'], ['mixed', '综合资源包'],
]

const fallbackCopy: Record<string, string> = {
  'resourceLibrary.createRequired': '请填写 Pack 名称、风格和适用游戏类型，并选择主分类',
  'resourceLibrary.close': '关闭', 'resourceLibrary.name': '名称', 'resourceLibrary.dimension': '维度',
  'resourceLibrary.mixed': '混合', 'resourceLibrary.category': '主分类',
  'resourceLibrary.selectResourceType': '请选择资源类型', 'resourceLibrary.cover': '封面',
  'resourceLibrary.coverOptional': '可选；保存时先上传', 'resourceLibrary.uploadCover': '上传封面',
  'resourceLibrary.metadata.description': '描述', 'resourceLibrary.metadata.tags': '标签',
  'resourceLibrary.metadata.version': '版本', 'resourceLibrary.metadata.license': '许可证',
  'resourceLibrary.metadata.author': '作者', 'resourceLibrary.metadata.source': '来源',
  'resourceLibrary.metadata.licenseEvidence': '许可证凭证',
  'resourceLibrary.metadata.compatibleTargets': '兼容目标', 'resourceLibrary.style': '风格',
  'resourceLibrary.gameTypes': '适用游戏类型', 'resourceLibrary.multiSelect': '可多选',
  'resourceLibrary.customStyle': '添加自定义风格',
  'resourceLibrary.customGameType': '添加自定义类型', 'resourceLibrary.add': '添加',
}

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
  finalFocus,
}: Props) {
  const { t: translate } = useTranslation()
  const t = (key: string) => {
    const value = translate(key)
    return value === key ? fallbackCopy[key] ?? key : value
  }
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
      setError(t('resourceLibrary.createRequired'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSubmit({ ...values, name: values.name.trim() }, cover)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : submitLabel)
    } finally {
      setSaving(false)
    }
  }
  const chipClass = (selected: boolean) => `h-9 rounded-lg border px-3 text-sm transition-colors ${selected ? 'border-primary/50 bg-accent text-foreground' : 'border-border bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'}`

  return <Dialog open={open} onOpenChange={value => { if (!value) onClose() }}>
    <DialogContent aria-label={title} finalFocus={finalFocus} className="max-h-[calc(100dvh-48px)] max-w-[640px] overflow-hidden p-0">
    <form data-testid={formTestId} onSubmit={submit} className="relative flex min-w-0 max-h-[calc(100dvh-48px)] w-full max-w-[640px] flex-col overflow-y-auto bg-background p-5 text-foreground sm:p-6">
      <header className="relative z-10 flex items-start justify-between gap-6"><DialogTitle className="type-modal-title min-w-0 text-xl">{title}</DialogTitle><button type="button" onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-accent" aria-label={t('resourceLibrary.close')}><X className="size-4" aria-hidden="true" /></button></header>
      <div data-testid={contentTestId} className="relative z-10 mt-6 grid min-h-0 min-w-0 w-full flex-1 gap-6 overflow-y-auto pr-1">
        <div data-testid={metadataTestId} className="min-w-0 grid gap-5 sm:grid-cols-2"><label className="type-label min-w-0 grid gap-2 text-foreground sm:col-span-2">{t('resourceLibrary.name')}<input autoFocus value={values.name} onChange={event => update('name', event.target.value)} className="min-w-0 max-w-full border border-input bg-background type-input h-11 rounded-xl px-3" placeholder="例如：Painterly Forest" /></label><div className="type-label min-w-0 grid gap-2 text-foreground">{t('resourceLibrary.dimension')}<ProjectSelect ariaLabel={t('resourceLibrary.dimension')} value={values.dimension} onValueChange={value => update('dimension', value as ResourcePackSummary['dimension'])} options={[{ value: 'agnostic', label: t('resourceLibrary.mixed') }, { value: '2D', label: '2D' }, { value: '3D', label: '3D' }]} className="min-w-0" triggerClassName="type-input h-11 rounded-xl" /></div><div className="type-label min-w-0 grid gap-2 text-foreground">{t('resourceLibrary.category')}<ProjectSelect ariaLabel={t('resourceLibrary.category')} value={values.primaryCategory} onValueChange={value => update('primaryCategory', value as ResourcePackPrimaryCategory)} placeholder={t('resourceLibrary.selectResourceType')} options={primaryCategoryOptions.map(([value, label]) => ({ value, label }))} className="min-w-0" triggerClassName="type-input h-11 rounded-xl" /></div></div>
        {allowCover ? <label className="type-label min-w-0 grid gap-2 text-foreground">{t('resourceLibrary.cover')} <span className="type-caption font-normal text-muted-foreground">{t('resourceLibrary.coverOptional')}</span><input aria-label={t('resourceLibrary.uploadCover')} type="file" accept="image/*,video/mp4,video/webm" onChange={event => setCover(event.target.files?.[0] || null)} className="min-w-0 max-w-full border border-input bg-background type-input h-11 rounded-xl px-3 py-2" />{cover ? <span className="type-caption font-normal text-muted-foreground">{cover.name}</span> : null}</label> : null}
        <div className="min-w-0 grid gap-5 sm:grid-cols-2"><label className="type-label min-w-0 grid gap-2 text-foreground sm:col-span-2">{t('resourceLibrary.metadata.description')}<textarea value={values.description} onChange={event => update('description', event.target.value)} className="min-w-0 max-w-full border border-input bg-background type-input min-h-20 rounded-xl px-3 py-2" /></label><label className="type-label min-w-0 grid gap-2 text-foreground sm:col-span-2">{t('resourceLibrary.metadata.tags')}<input value={values.tags} onChange={event => update('tags', event.target.value)} className="min-w-0 max-w-full border border-input bg-background type-input h-11 rounded-xl px-3" placeholder="foliage, outdoor, low-poly" /></label><label className="type-label min-w-0 grid gap-2 text-foreground">{t('resourceLibrary.metadata.version')}<input value={values.version} onChange={event => update('version', event.target.value)} className="min-w-0 max-w-full border border-input bg-background type-input h-11 rounded-xl px-3" /></label><label className="type-label min-w-0 grid gap-2 text-foreground">{t('resourceLibrary.metadata.license')}<input value={values.license} onChange={event => update('license', event.target.value)} className="min-w-0 max-w-full border border-input bg-background type-input h-11 rounded-xl px-3" /></label><label className="type-label min-w-0 grid gap-2 text-foreground">{t('resourceLibrary.metadata.author')}<input value={values.author} onChange={event => update('author', event.target.value)} className="min-w-0 max-w-full border border-input bg-background type-input h-11 rounded-xl px-3" /></label><label className="type-label min-w-0 grid gap-2 text-foreground">{t('resourceLibrary.metadata.source')}<input value={values.source} onChange={event => update('source', event.target.value)} className="min-w-0 max-w-full border border-input bg-background type-input h-11 rounded-xl px-3" /></label><label className="type-label min-w-0 grid gap-2 text-foreground sm:col-span-2">{t('resourceLibrary.metadata.licenseEvidence')}<input value={values.licenseEvidence} onChange={event => update('licenseEvidence', event.target.value)} className="min-w-0 max-w-full border border-input bg-background type-input h-11 rounded-xl px-3" /></label><label className="type-label min-w-0 grid gap-2 text-foreground sm:col-span-2">{t('resourceLibrary.metadata.compatibleTargets')}<input value={values.compatibleEngines} onChange={event => update('compatibleEngines', event.target.value)} className="min-w-0 max-w-full border border-input bg-background type-input h-11 rounded-xl px-3" placeholder="filesystem, desktop, mobile" /></label></div>
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0"><legend className="type-label block p-0 text-foreground">{t('resourceLibrary.style')} <span className="type-caption ml-1 font-normal text-muted-foreground">{t('resourceLibrary.multiSelect')}</span></legend><div className="flex flex-wrap gap-3">{styleOptions.map(option => <button key={option} type="button" aria-pressed={values.styles.includes(option)} onClick={() => toggleListValue('styles', option)} className={chipClass(values.styles.includes(option))}>{option}</button>)}</div><div className="flex gap-3"><input value={customStyle} onChange={event => setCustomStyle(event.target.value)} className="min-w-0 max-w-full border border-input bg-background type-input h-10 min-w-0 flex-1 rounded-xl px-3" placeholder={t('resourceLibrary.customStyle')} /><button type="button" className="rounded-md border border-border bg-secondary text-secondary-foreground type-button h-10 px-4" onClick={() => addCustomValue('styles', customStyle, () => setCustomStyle(''))}>{t('resourceLibrary.add')}</button></div></fieldset>
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0"><legend className="type-label block p-0 text-foreground">{t('resourceLibrary.gameTypes')} <span className="type-caption ml-1 font-normal text-muted-foreground">{t('resourceLibrary.multiSelect')}</span></legend><div className="flex flex-wrap gap-3">{gameTypeOptions.map(option => <button key={option} type="button" aria-pressed={values.gameTypes.includes(option)} onClick={() => toggleListValue('gameTypes', option)} className={chipClass(values.gameTypes.includes(option))}>{option}</button>)}</div><div className="flex gap-3"><input value={customGameType} onChange={event => setCustomGameType(event.target.value)} className="min-w-0 max-w-full border border-input bg-background type-input h-10 min-w-0 flex-1 rounded-xl px-3" placeholder={t('resourceLibrary.customGameType')} /><button type="button" className="rounded-md border border-border bg-secondary text-secondary-foreground type-button h-10 px-4" onClick={() => addCustomValue('gameTypes', customGameType, () => setCustomGameType(''))}>{t('resourceLibrary.add')}</button></div></fieldset>
      </div>
      {error ? <p role="alert" className="relative z-10 mt-5 rounded-xl border border-destructive/40 bg-destructive/10 p-3 type-footnote text-destructive">{error}</p> : null}
      <footer className="relative z-10 mt-6 flex shrink-0 justify-end"><button disabled={saving} className="rounded-md border border-transparent bg-primary text-primary-foreground type-button h-11 px-6 disabled:cursor-not-allowed disabled:opacity-50">{saving ? submittingLabel : submitLabel}</button></footer>
    </form>
    </DialogContent>
  </Dialog>
}

function cloneValues(values: ResourcePackFormValues): ResourcePackFormValues {
  return { ...values, styles: [...values.styles], gameTypes: [...values.gameTypes] }
}
