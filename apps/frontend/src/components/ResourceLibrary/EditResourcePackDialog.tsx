import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ResourcePackPrimaryCategory, ResourcePackSummary, UpdateResourcePackInput } from '../../services/resourceLibraryApi'
import { CONFIGURED_PRODUCTION_SETTING_OPTIONS } from '../../config/productionSettingOptions'

type Props = {
  open: boolean
  pack: ResourcePackSummary
  onClose: () => void
  onUploadCover: (file: File) => Promise<ResourcePackSummary>
  onSave: (input: UpdateResourcePackInput) => Promise<ResourcePackSummary>
}

const primaryCategoryOptions: ReadonlyArray<readonly [ResourcePackPrimaryCategory, string]> = [['2d-art', '2D 美术包'], ['3d-assets', '3D 资产包'], ['animation-rig', '动画与骨骼包'], ['ui-kit', 'UI Kit'], ['vfx', 'VFX 包'], ['audio', '音频包'], ['fonts', '字体包'], ['world-scene', '世界与场景包'], ['mixed', '综合资源包']]
const fallbackCopy: Record<string, string> = {
  'resourceLibrary.updateRequired': '请填写 Pack 名称、风格和适用游戏类型', 'resourceLibrary.update': '保存 Pack', 'resourceLibrary.updating': '保存中…',
  'resourceLibrary.editPack': '编辑 Pack', 'resourceLibrary.library': '资源库', 'resourceLibrary.editDescription': '更新 Pack 元数据与封面。', 'resourceLibrary.close': '关闭',
  'resourceLibrary.name': '名称', 'resourceLibrary.dimension': '维度', 'resourceLibrary.mixed': '混合', 'resourceLibrary.category': '主分类',
  'resourceLibrary.cover': '封面', 'resourceLibrary.coverOptional': '可选；保存时先上传', 'resourceLibrary.uploadCover': '上传封面',
  'resourceLibrary.metadata.description': '描述', 'resourceLibrary.metadata.tags': '标签', 'resourceLibrary.metadata.version': '版本', 'resourceLibrary.metadata.license': '许可证',
  'resourceLibrary.metadata.author': '作者', 'resourceLibrary.metadata.source': '来源', 'resourceLibrary.metadata.licenseEvidence': '许可证凭证', 'resourceLibrary.metadata.compatibleTargets': '兼容目标',
  'resourceLibrary.style': '风格', 'resourceLibrary.gameTypes': '适用游戏类型', 'resourceLibrary.multiSelect': '可多选', 'resourceLibrary.customStyle': '添加自定义风格', 'resourceLibrary.customGameType': '添加自定义类型', 'resourceLibrary.add': '添加',
}

export function EditResourcePackDialog({ open, pack, onClose, onUploadCover, onSave }: Props) {
  const { t: translate } = useTranslation()
  const t = (key: string) => {
    const value = translate(key)
    return value === key ? fallbackCopy[key] ?? key : value
  }
  const [name, setName] = useState(pack.name)
  const [styles, setStyles] = useState<string[]>(() => pack.styles?.length ? [...pack.styles] : pack.style.split('/').map((value) => value.trim()).filter(Boolean))
  const [dimension, setDimension] = useState(pack.dimension)
  const [gameTypes, setGameTypes] = useState<string[]>(() => [...(pack.gameTypes || [])])
  const [primaryCategory, setPrimaryCategory] = useState<ResourcePackPrimaryCategory>(pack.primaryCategory)
  const [description, setDescription] = useState(pack.description || '')
  const [tags, setTags] = useState((pack.tags || []).join(', '))
  const [source, setSource] = useState(pack.source || '')
  const [author, setAuthor] = useState(pack.author || '')
  const [license, setLicense] = useState(pack.license || '')
  const [licenseEvidence, setLicenseEvidence] = useState(pack.licenseEvidence || '')
  const [compatibleEngines, setCompatibleEngines] = useState((pack.compatibleEngines || []).join(', '))
  const [version, setVersion] = useState(pack.version || '')
  const [cover, setCover] = useState<File | null>(null)
  const [customStyle, setCustomStyle] = useState('')
  const [customGameType, setCustomGameType] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (!open) return null
  const chipClass = (selected: boolean) => `h-9 rounded-full border px-4 text-[14px] font-medium transition-colors ${selected ? 'border-orange-200/45 bg-orange-200/10 text-orange-100' : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-200'}`
  const toggle = (value: string, setValues: React.Dispatch<React.SetStateAction<string[]>>) => setValues((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  const styleOptions = [...CONFIGURED_PRODUCTION_SETTING_OPTIONS.styles, ...styles.filter((value) => !CONFIGURED_PRODUCTION_SETTING_OPTIONS.styles.includes(value as never))]
  const gameTypeOptions = [...CONFIGURED_PRODUCTION_SETTING_OPTIONS.genres, ...gameTypes.filter((value) => !CONFIGURED_PRODUCTION_SETTING_OPTIONS.genres.includes(value as never))]
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || styles.length === 0 || gameTypes.length === 0) { setError(t('resourceLibrary.updateRequired')); return }
    setSaving(true); setError('')
    try {
      if (cover) await onUploadCover(cover)
      await onSave({
        name: name.trim(), styles, dimension, primaryCategory, gameTypes,
        description: description.trim(), tags: splitList(tags), source: source.trim(), author: author.trim(),
        license: license.trim(), licenseEvidence: licenseEvidence.trim(), compatibleEngines: splitList(compatibleEngines), version: version.trim(),
      })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('resourceLibrary.update')) } finally { setSaving(false) }
  }
  return <div role="dialog" aria-modal="true" aria-label={t('resourceLibrary.editPack')} className="fixed inset-0 z-[260] flex items-center justify-center overflow-y-auto bg-black/70 p-6 backdrop-blur-sm">
    <form onSubmit={save} className="input-surface relative my-auto w-full max-w-[760px] rounded-[28px] border border-white/15 bg-[#18191d] p-8 shadow-2xl shadow-black/60">
      <header className="relative z-10 flex items-start justify-between gap-8"><div><p className="text-[14px] font-semibold text-orange-200">{t('resourceLibrary.library')}</p><h2 className="mt-2 text-[36px] font-bold leading-none tracking-[-0.035em] text-zinc-50">{t('resourceLibrary.editPack')}</h2><p className="mt-4 text-[18px] leading-7 text-zinc-500">{t('resourceLibrary.editDescription')}</p></div><button type="button" onClick={onClose} className="glass-icon-button h-11 w-11 shrink-0 text-2xl" aria-label={t('resourceLibrary.close')}>×</button></header>
      <div className="relative z-10 mt-10 grid gap-8">
        <div className="grid gap-6 sm:grid-cols-2"><label className="grid gap-3 text-[18px] font-semibold text-zinc-200 sm:col-span-2">{t('resourceLibrary.name')}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="glass-control type-input h-14 rounded-2xl px-4 text-[18px]" /></label><label className="grid gap-3 text-[18px] font-semibold text-zinc-200">{t('resourceLibrary.dimension')}<select value={dimension} onChange={(event) => setDimension(event.target.value as ResourcePackSummary['dimension'])} className="glass-control type-input h-14 rounded-2xl px-4 text-[18px]"><option value="agnostic">{t('resourceLibrary.mixed')}</option><option value="2D">2D</option><option value="3D">3D</option></select></label><label className="grid gap-3 text-[18px] font-semibold text-zinc-200">{t('resourceLibrary.category')}<select value={primaryCategory} onChange={(event) => setPrimaryCategory(event.target.value as ResourcePackPrimaryCategory)} className="glass-control type-input h-14 rounded-2xl px-4 text-[18px]">{primaryCategoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <label className="grid gap-3 text-[18px] font-semibold text-zinc-200">{t('resourceLibrary.cover')} <span className="-mt-2 text-[14px] font-normal text-zinc-500">{t('resourceLibrary.coverOptional')}</span><input aria-label={t('resourceLibrary.uploadCover')} type="file" accept="image/*,video/mp4,video/webm" onChange={(event) => setCover(event.target.files?.[0] || null)} className="glass-control type-input h-12 rounded-2xl px-4 py-2" />{cover ? <span className="text-[14px] font-normal text-zinc-400">{cover.name}</span> : null}</label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-[14px] font-medium text-zinc-300 sm:col-span-2">{t('resourceLibrary.metadata.description')}<textarea value={description} onChange={(event) => setDescription(event.target.value)} className="glass-control type-input min-h-20 rounded-xl px-3 py-2" /></label><label className="grid gap-2 text-[14px] font-medium text-zinc-300 sm:col-span-2">{t('resourceLibrary.metadata.tags')}<input value={tags} onChange={(event) => setTags(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" placeholder="以逗号分隔" /></label><label className="grid gap-2 text-[14px] font-medium text-zinc-300">{t('resourceLibrary.metadata.version')}<input value={version} onChange={(event) => setVersion(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="grid gap-2 text-[14px] font-medium text-zinc-300">{t('resourceLibrary.metadata.license')}<input value={license} onChange={(event) => setLicense(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="grid gap-2 text-[14px] font-medium text-zinc-300">{t('resourceLibrary.metadata.author')}<input value={author} onChange={(event) => setAuthor(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="grid gap-2 text-[14px] font-medium text-zinc-300">{t('resourceLibrary.metadata.source')}<input value={source} onChange={(event) => setSource(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="grid gap-2 text-[14px] font-medium text-zinc-300 sm:col-span-2">{t('resourceLibrary.metadata.licenseEvidence')}<input value={licenseEvidence} onChange={(event) => setLicenseEvidence(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" /></label><label className="grid gap-2 text-[14px] font-medium text-zinc-300 sm:col-span-2">{t('resourceLibrary.metadata.compatibleTargets')}<input value={compatibleEngines} onChange={(event) => setCompatibleEngines(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" placeholder="以逗号分隔" /></label></div>
        <fieldset className="m-0 grid gap-4 border-0 p-0"><legend className="text-[18px] font-semibold text-zinc-200">{t('resourceLibrary.style')} <span className="ml-1 text-[14px] font-normal text-zinc-500">{t('resourceLibrary.multiSelect')}</span></legend><div className="flex flex-wrap gap-3">{styleOptions.map((option) => <button key={option} type="button" aria-pressed={styles.includes(option)} onClick={() => toggle(option, setStyles)} className={chipClass(styles.includes(option))}>{option}</button>)}</div><div className="flex gap-3"><input value={customStyle} onChange={(event) => setCustomStyle(event.target.value)} className="glass-control type-input h-12 min-w-0 flex-1 rounded-2xl px-4" placeholder={t('resourceLibrary.customStyle')} /><button type="button" className="secondary-pill type-button h-12 px-5" onClick={() => { const value = customStyle.trim(); if (value && !styles.includes(value)) setStyles((current) => [...current, value]); setCustomStyle('') }}>{t('resourceLibrary.add')}</button></div></fieldset>
        <fieldset className="m-0 grid gap-4 border-0 p-0"><legend className="text-[18px] font-semibold text-zinc-200">{t('resourceLibrary.gameTypes')} <span className="ml-1 text-[14px] font-normal text-zinc-500">{t('resourceLibrary.multiSelect')}</span></legend><div className="flex flex-wrap gap-3">{gameTypeOptions.map((option) => <button key={option} type="button" aria-pressed={gameTypes.includes(option)} onClick={() => toggle(option, setGameTypes)} className={chipClass(gameTypes.includes(option))}>{option}</button>)}</div><div className="flex gap-3"><input value={customGameType} onChange={(event) => setCustomGameType(event.target.value)} className="glass-control type-input h-12 min-w-0 flex-1 rounded-2xl px-4" placeholder={t('resourceLibrary.customGameType')} /><button type="button" className="secondary-pill type-button h-12 px-5" onClick={() => { const value = customGameType.trim(); if (value && !gameTypes.includes(value)) setGameTypes((current) => [...current, value]); setCustomGameType('') }}>{t('resourceLibrary.add')}</button></div></fieldset>
      </div>
      {error ? <p role="alert" className="relative z-10 mt-5 rounded-xl border border-red-300/20 bg-red-400/10 p-3 type-footnote text-red-200">{error}</p> : null}
      <footer className="relative z-10 mt-8 flex justify-end"><button disabled={saving} className="primary-pill type-button h-14 px-7 text-[18px] disabled:cursor-not-allowed disabled:opacity-50">{saving ? t('resourceLibrary.updating') : t('resourceLibrary.update')}</button></footer>
    </form>
  </div>
}

function splitList(value: string): string[] {
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
}
