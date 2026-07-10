import { useState } from 'react'
import type { CreateResourcePackInput, ResourcePackSummary } from '../../services/resourceLibraryApi'
import { CONFIGURED_PRODUCTION_SETTING_OPTIONS } from '../../config/productionSettingOptions'

type Props = {
  open: boolean
  onClose: () => void
  onCreate: (input: CreateResourcePackInput) => Promise<ResourcePackSummary>
}

export function CreateResourcePackDialog({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [styles, setStyles] = useState<string[]>([])
  const [dimension, setDimension] = useState<CreateResourcePackInput['dimension']>('agnostic')
  const [gameTypes, setGameTypes] = useState<string[]>([])
  const [customStyle, setCustomStyle] = useState('')
  const [customGameType, setCustomGameType] = useState('')
  const [categories, setCategories] = useState<string[]>(['environment'])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  if (!open) return null
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || styles.length === 0 || gameTypes.length === 0 || categories.length === 0) {
      setError('请填写 Pack 名称、风格和适用游戏类型')
      return
    }
    setSaving(true); setError('')
    try {
      await onCreate({ name: name.trim(), style: styles.join(' / '), dimension, gameTypes, categories })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建 Pack 失败') } finally { setSaving(false) }
  }
  const chipClass = (selected: boolean) => `type-caption-2 inline-flex h-8 items-center rounded-full border px-3 transition-colors ${selected ? 'border-orange-200/45 bg-orange-200/10 text-orange-100' : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-200'}`
  const categoryOptions = [['characters', '角色'], ['environment', '环境'], ['tiles', 'Tile'], ['models', '模型'], ['materials', '材质'], ['animation', '动画'], ['ui', 'UI'], ['vfx', '特效'], ['fonts', '字体'], ['audio', '音频'], ['textures', '贴图']] as const
  return <div role="dialog" aria-modal="true" aria-label="创建 Pack" className="fixed inset-0 z-[260] flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-sm">
    <form onSubmit={submit} className="input-surface relative flex max-h-[min(720px,calc(100vh-2rem))] w-[min(620px,calc(100vw-2rem))] flex-col overflow-y-auto rounded-3xl border border-white/15 p-6 shadow-2xl shadow-black/50 sm:p-7">
      <header className="relative z-10 flex items-start justify-between gap-6 border-b border-white/10 pb-5"><div className="min-w-0"><p className="type-caption-1 text-zinc-500">资源库</p><h2 className="type-title-2 mt-1 text-zinc-100">创建 Pack</h2><p className="type-footnote mt-2 max-w-[34rem] text-zinc-500">先定义风格与使用场景，再添加资源。</p></div><button type="button" onClick={onClose} className="glass-icon-button h-9 w-9 shrink-0 text-lg" aria-label="关闭">×</button></header>
      <div className="relative z-10 mt-5 grid gap-5">
        <label className="type-callout grid gap-2 text-zinc-300">名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="glass-control type-input h-11 rounded-xl px-3" placeholder="例如：Painterly Forest" /></label>
        <div className="grid gap-4 border-b border-white/10 pb-5 sm:grid-cols-2"><label className="type-callout grid gap-2 text-zinc-300">维度<select value={dimension} onChange={(event) => setDimension(event.target.value as CreateResourcePackInput['dimension'])} className="glass-control type-input h-11 rounded-xl px-3"><option value="agnostic">混合</option><option value="2D">2D</option><option value="3D">3D</option></select></label><fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0"><legend className="type-callout block p-0 text-zinc-300">主分类 <span className="type-caption-2 text-zinc-500">可多选</span></legend><div className="flex flex-wrap gap-2">{categoryOptions.map(([value, label]) => <button key={value} type="button" aria-pressed={categories.includes(value)} onClick={() => setCategories((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} className={chipClass(categories.includes(value))}>{label}</button>)}</div></fieldset></div>
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0"><legend className="type-callout block p-0 text-zinc-300">风格 <span className="type-caption-2 text-zinc-500">可多选</span></legend><div className="flex flex-wrap gap-2">{CONFIGURED_PRODUCTION_SETTING_OPTIONS.styles.map((option) => <button key={option} type="button" aria-pressed={styles.includes(option)} onClick={() => setStyles((current) => current.includes(option) ? current.filter((value) => value !== option) : [...current, option])} className={chipClass(styles.includes(option))}>{option}</button>)}</div><div className="flex gap-2"><input value={customStyle} onChange={(event) => setCustomStyle(event.target.value)} className="glass-control type-input h-10 min-w-0 flex-1 rounded-xl px-3" placeholder="添加自定义风格" /><button type="button" className="secondary-pill type-button h-10 px-4" onClick={() => { const value = customStyle.trim(); if (value && !styles.includes(value)) setStyles((current) => [...current, value]); setCustomStyle('') }}>添加</button></div></fieldset>
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0"><legend className="type-callout block p-0 text-zinc-300">适用游戏类型 <span className="type-caption-2 text-zinc-500">可多选</span></legend><div className="flex flex-wrap gap-2">{CONFIGURED_PRODUCTION_SETTING_OPTIONS.genres.map((option) => <button key={option} type="button" aria-pressed={gameTypes.includes(option)} onClick={() => setGameTypes((current) => current.includes(option) ? current.filter((value) => value !== option) : [...current, option])} className={chipClass(gameTypes.includes(option))}>{option}</button>)}</div><div className="flex gap-2"><input value={customGameType} onChange={(event) => setCustomGameType(event.target.value)} className="glass-control type-input h-10 min-w-0 flex-1 rounded-xl px-3" placeholder="添加自定义类型" /><button type="button" className="secondary-pill type-button h-10 px-4" onClick={() => { const value = customGameType.trim(); if (value && !gameTypes.includes(value)) setGameTypes((current) => [...current, value]); setCustomGameType('') }}>添加</button></div></fieldset>
      </div>
      {error ? <p role="alert" className="relative z-10 mt-5 rounded-xl border border-red-300/20 bg-red-400/10 p-3 type-footnote text-red-200">{error}</p> : null}
      <footer className="relative z-10 mt-6 flex justify-end border-t border-white/10 pt-5"><button disabled={saving} className="primary-pill type-button h-10 px-5 disabled:cursor-not-allowed disabled:opacity-50">{saving ? '创建中…' : '创建 Pack'}</button></footer>
    </form>
  </div>
}
