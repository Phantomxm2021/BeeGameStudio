import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CreateResourcePackInput, ResourcePackPrimaryCategory, ResourcePackSummary } from '../../services/resourceLibraryApi'
import { CONFIGURED_PRODUCTION_SETTING_OPTIONS } from '../../config/productionSettingOptions'

type Props = {
  open: boolean
  onClose: () => void
  onCreate: (input: CreateResourcePackInput) => Promise<ResourcePackSummary>
}

const fallbackCopy: Record<string, string> = {
  'resourceLibrary.createRequired': '请填写 Pack 名称、风格和适用游戏类型，并选择主分类',
  'resourceLibrary.create': '创建 Pack', 'resourceLibrary.creating': '创建中…', 'resourceLibrary.close': '关闭',
  'resourceLibrary.name': '名称', 'resourceLibrary.dimension': '维度', 'resourceLibrary.mixed': '混合',
  'resourceLibrary.category': '主分类', 'resourceLibrary.selectResourceType': '请选择资源类型',
  'resourceLibrary.metadata.description': '描述', 'resourceLibrary.metadata.tags': '标签', 'resourceLibrary.metadata.version': '版本',
  'resourceLibrary.metadata.license': '许可证', 'resourceLibrary.metadata.author': '作者', 'resourceLibrary.metadata.source': '来源',
  'resourceLibrary.metadata.licenseEvidence': '许可证凭证', 'resourceLibrary.metadata.compatibleTargets': '兼容目标',
  'resourceLibrary.style': '风格', 'resourceLibrary.gameTypes': '适用游戏类型', 'resourceLibrary.multiSelect': '可多选',
  'resourceLibrary.customStyle': '添加自定义风格', 'resourceLibrary.customGameType': '添加自定义类型', 'resourceLibrary.add': '添加',
}

export function CreateResourcePackDialog({ open, onClose, onCreate }: Props) {
  const { t: translate } = useTranslation()
  const t = (key: string) => {
    const value = translate(key)
    return value === key ? fallbackCopy[key] ?? key : value
  }
  const [name, setName] = useState('')
  const [styles, setStyles] = useState<string[]>([])
  const [dimension, setDimension] = useState<CreateResourcePackInput['dimension']>('agnostic')
  const [gameTypes, setGameTypes] = useState<string[]>([])
  const [customStyle, setCustomStyle] = useState('')
  const [customGameType, setCustomGameType] = useState('')
  const [primaryCategory, setPrimaryCategory] = useState<ResourcePackPrimaryCategory | ''>('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [version, setVersion] = useState('0.1.0')
  const [license, setLicense] = useState('')
  const [author, setAuthor] = useState('')
  const [source, setSource] = useState('')
  const [licenseEvidence, setLicenseEvidence] = useState('')
  const [compatibleEngines, setCompatibleEngines] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  if (!open) return null
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || styles.length === 0 || gameTypes.length === 0 || !primaryCategory) {
      setError(t('resourceLibrary.createRequired'))
      return
    }
    setSaving(true); setError('')
    try {
      await onCreate({ name: name.trim(), styles, dimension, primaryCategory, gameTypes, categories: [], ...(description.trim() ? { description: description.trim() } : {}), ...(tags.trim() ? { tags: tags.split(',').map(value => value.trim()).filter(Boolean) } : {}), ...(version.trim() ? { version: version.trim() } : {}), ...(license.trim() ? { license: license.trim() } : {}), ...(author.trim() ? { author: author.trim() } : {}), ...(source.trim() ? { source: source.trim() } : {}), ...(licenseEvidence.trim() ? { licenseEvidence: licenseEvidence.trim() } : {}), ...(compatibleEngines.trim() ? { compatibleEngines: compatibleEngines.split(',').map(value => value.trim()).filter(Boolean) } : {}) })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建 Pack 失败') } finally { setSaving(false) }
  }
  const chipClass = (selected: boolean) => `type-button h-9 rounded-full border px-4 transition-colors ${selected ? 'border-orange-200/45 bg-orange-200/10 text-orange-100' : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-200'}`
  const styleOptions = [...CONFIGURED_PRODUCTION_SETTING_OPTIONS.styles, ...styles.filter((value) => !CONFIGURED_PRODUCTION_SETTING_OPTIONS.styles.includes(value as never))]
  const gameTypeOptions = [...CONFIGURED_PRODUCTION_SETTING_OPTIONS.genres, ...gameTypes.filter((value) => !CONFIGURED_PRODUCTION_SETTING_OPTIONS.genres.includes(value as never))]
  const primaryCategoryOptions: ReadonlyArray<readonly [ResourcePackPrimaryCategory, string]> = [['2d-art', '2D 美术包'], ['3d-assets', '3D 资产包'], ['animation-rig', '动画与骨骼包'], ['ui-kit', 'UI Kit'], ['vfx', 'VFX 包'], ['audio', '音频包'], ['fonts', '字体包'], ['world-scene', '世界与场景包'], ['mixed', '综合资源包']]
  return <div role="dialog" aria-modal="true" aria-label={t('resourceLibrary.create')} className="fixed inset-0 z-[260] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6">
    <form data-testid="create-pack-dialog" onSubmit={submit} className="input-surface relative flex w-full max-w-[640px] max-h-[calc(100dvh-48px)] flex-col overflow-hidden rounded-[24px] border border-white/15 bg-[#18191d] p-6 shadow-2xl shadow-black/60 sm:p-7">
      <header className="relative z-10 flex items-start justify-between gap-6"><h2 className="type-modal-title min-w-0 text-zinc-50">{t('resourceLibrary.create')}</h2><button type="button" onClick={onClose} className="glass-icon-button h-10 w-10 shrink-0 text-xl" aria-label={t('resourceLibrary.close')}>×</button></header>
      <div data-testid="create-pack-content" className="relative z-10 mt-6 grid min-h-0 flex-1 gap-6 overflow-y-auto pr-1">
        <div data-testid="create-pack-metadata" className="grid gap-5 sm:grid-cols-2"><label className="type-label grid gap-2 text-zinc-300 sm:col-span-2">{t('resourceLibrary.name')}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" placeholder="例如：Painterly Forest" /></label><label className="type-label grid gap-2 text-zinc-300">{t('resourceLibrary.dimension')}<select value={dimension} onChange={(event) => setDimension(event.target.value as CreateResourcePackInput['dimension'])} className="glass-control type-input h-11 rounded-xl px-3"><option value="agnostic">{t('resourceLibrary.mixed')}</option><option value="2D">2D</option><option value="3D">3D</option></select></label><label className="type-label grid gap-2 text-zinc-300">{t('resourceLibrary.category')}<select value={primaryCategory} onChange={(event) => setPrimaryCategory(event.target.value as ResourcePackPrimaryCategory)} className="glass-control type-input h-11 rounded-xl px-3"><option value="">{t('resourceLibrary.selectResourceType')}</option>{primaryCategoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <div className="grid gap-5 sm:grid-cols-2"><label className="type-label grid gap-2 text-zinc-300 sm:col-span-2">{t('resourceLibrary.metadata.description')}<textarea value={description} onChange={event => setDescription(event.target.value)} className="glass-control type-input min-h-20 rounded-xl px-3 py-2" /></label><label className="type-label grid gap-2 text-zinc-300 sm:col-span-2">{t('resourceLibrary.metadata.tags')}<input value={tags} onChange={event => setTags(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" placeholder="foliage, outdoor, low-poly" /></label><label className="type-label grid gap-2 text-zinc-300">{t('resourceLibrary.metadata.version')}<input value={version} onChange={event => setVersion(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="type-label grid gap-2 text-zinc-300">{t('resourceLibrary.metadata.license')}<input value={license} onChange={event => setLicense(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="type-label grid gap-2 text-zinc-300">{t('resourceLibrary.metadata.author')}<input value={author} onChange={event => setAuthor(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="type-label grid gap-2 text-zinc-300">{t('resourceLibrary.metadata.source')}<input value={source} onChange={event => setSource(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="type-label grid gap-2 text-zinc-300 sm:col-span-2">{t('resourceLibrary.metadata.licenseEvidence')}<input value={licenseEvidence} onChange={event => setLicenseEvidence(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="type-label grid gap-2 text-zinc-300 sm:col-span-2">{t('resourceLibrary.metadata.compatibleTargets')}<input value={compatibleEngines} onChange={event => setCompatibleEngines(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" placeholder="filesystem, desktop, mobile" /></label></div>
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0"><legend className="type-label block p-0 text-zinc-300">{t('resourceLibrary.style')} <span className="type-caption ml-1 font-normal text-zinc-500">{t('resourceLibrary.multiSelect')}</span></legend><div className="flex flex-wrap gap-3">{styleOptions.map((option) => <button key={option} type="button" aria-pressed={styles.includes(option)} onClick={() => setStyles((current) => current.includes(option) ? current.filter((value) => value !== option) : [...current, option])} className={chipClass(styles.includes(option))}>{option}</button>)}</div><div className="flex gap-3"><input value={customStyle} onChange={(event) => setCustomStyle(event.target.value)} className="glass-control type-input h-10 min-w-0 flex-1 rounded-xl px-3" placeholder={t('resourceLibrary.customStyle')} /><button type="button" className="secondary-pill type-button h-10 px-4" onClick={() => { const value = customStyle.trim(); if (value && !styles.includes(value)) setStyles((current) => [...current, value]); setCustomStyle('') }}>{t('resourceLibrary.add')}</button></div></fieldset>
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0"><legend className="type-label block p-0 text-zinc-300">{t('resourceLibrary.gameTypes')} <span className="type-caption ml-1 font-normal text-zinc-500">{t('resourceLibrary.multiSelect')}</span></legend><div className="flex flex-wrap gap-3">{gameTypeOptions.map((option) => <button key={option} type="button" aria-pressed={gameTypes.includes(option)} onClick={() => setGameTypes((current) => current.includes(option) ? current.filter((value) => value !== option) : [...current, option])} className={chipClass(gameTypes.includes(option))}>{option}</button>)}</div><div className="flex gap-3"><input value={customGameType} onChange={(event) => setCustomGameType(event.target.value)} className="glass-control type-input h-10 min-w-0 flex-1 rounded-xl px-3" placeholder={t('resourceLibrary.customGameType')} /><button type="button" className="secondary-pill type-button h-10 px-4" onClick={() => { const value = customGameType.trim(); if (value && !gameTypes.includes(value)) setGameTypes((current) => [...current, value]); setCustomGameType('') }}>{t('resourceLibrary.add')}</button></div></fieldset>
      </div>
      {error ? <p role="alert" className="relative z-10 mt-5 rounded-xl border border-red-300/20 bg-red-400/10 p-3 type-footnote text-red-200">{error}</p> : null}
      <footer className="relative z-10 mt-6 flex shrink-0 justify-end"><button disabled={saving} className="primary-pill type-button h-11 px-6 disabled:cursor-not-allowed disabled:opacity-50">{saving ? t('resourceLibrary.creating') : t('resourceLibrary.create')}</button></footer>
    </form>
  </div>
}
