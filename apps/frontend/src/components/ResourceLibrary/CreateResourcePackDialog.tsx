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
  const [category, setCategory] = useState('environment')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  if (!open) return null
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || styles.length === 0 || gameTypes.length === 0) {
      setError('请填写 Pack 名称、风格和适用游戏类型')
      return
    }
    setSaving(true); setError('')
    try {
      await onCreate({ name: name.trim(), style: styles.join(' / '), dimension, gameTypes, categories: [category] })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建 Pack 失败') } finally { setSaving(false) }
  }
  return <div role="dialog" aria-modal="true" aria-label="创建 Pack" className="fixed inset-0 z-[260] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
    <form onSubmit={submit} className="w-full max-w-lg rounded-3xl border border-white/15 bg-zinc-900 p-6 shadow-2xl">
      <div className="flex items-start justify-between"><div><p className="type-caption-2 text-orange-200">资源库</p><h2 className="type-title-3 mt-1">创建 Pack</h2><p className="type-footnote mt-2 text-zinc-500">先定义风格与使用场景，再添加资源。</p></div><button type="button" onClick={onClose} className="glass-icon-button h-8 w-8" aria-label="关闭">×</button></div>
      <div className="mt-6 grid gap-4">
        <label className="grid gap-2 type-button">名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="glass-control rounded-xl px-3 py-2" placeholder="例如：Painterly Forest" /></label>
        <div className="grid grid-cols-2 gap-4"><label className="grid gap-2 type-button">维度<select value={dimension} onChange={(event) => setDimension(event.target.value as CreateResourcePackInput['dimension'])} className="glass-control rounded-xl px-3 py-2"><option value="agnostic">混合</option><option value="2D">2D</option><option value="3D">3D</option></select></label><label className="grid gap-2 type-button">主分类<select value={category} onChange={(event) => setCategory(event.target.value)} className="glass-control rounded-xl px-3 py-2"><option value="environment">环境</option><option value="characters">角色</option><option value="models">模型</option><option value="ui">UI</option><option value="vfx">特效</option><option value="audio">音频</option><option value="fonts">字体</option><option value="textures">贴图</option></select></label></div>
        <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0"><legend className="type-button mb-1 block p-0">风格（可多选）</legend><div className="flex flex-wrap gap-2">{CONFIGURED_PRODUCTION_SETTING_OPTIONS.styles.map((option) => <button key={option} type="button" aria-pressed={styles.includes(option)} onClick={() => setStyles((current) => current.includes(option) ? current.filter((value) => value !== option) : [...current, option])} className={`type-caption-2 rounded-full border px-3 py-1.5 ${styles.includes(option) ? 'border-orange-300/50 bg-orange-400/15 text-orange-100' : 'border-white/10 text-zinc-400'}`}>{option}</button>)}</div><div className="flex gap-2"><input value={customStyle} onChange={(event) => setCustomStyle(event.target.value)} className="glass-control min-w-0 flex-1 rounded-xl px-3 py-2" placeholder="添加自定义风格" /><button type="button" className="secondary-pill type-button px-3" onClick={() => { const value = customStyle.trim(); if (value && !styles.includes(value)) setStyles((current) => [...current, value]); setCustomStyle('') }}>添加</button></div></fieldset>
        <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0"><legend className="type-button mb-1 block p-0">适用游戏类型（可多选）</legend><div className="flex flex-wrap gap-2">{CONFIGURED_PRODUCTION_SETTING_OPTIONS.genres.map((option) => <button key={option} type="button" aria-pressed={gameTypes.includes(option)} onClick={() => setGameTypes((current) => current.includes(option) ? current.filter((value) => value !== option) : [...current, option])} className={`type-caption-2 rounded-full border px-3 py-1.5 ${gameTypes.includes(option) ? 'border-orange-300/50 bg-orange-400/15 text-orange-100' : 'border-white/10 text-zinc-400'}`}>{option}</button>)}</div><div className="flex gap-2"><input value={customGameType} onChange={(event) => setCustomGameType(event.target.value)} className="glass-control min-w-0 flex-1 rounded-xl px-3 py-2" placeholder="添加自定义类型" /><button type="button" className="secondary-pill type-button px-3" onClick={() => { const value = customGameType.trim(); if (value && !gameTypes.includes(value)) setGameTypes((current) => [...current, value]); setCustomGameType('') }}>添加</button></div></fieldset>
      </div>
      {error ? <p role="alert" className="mt-4 rounded-xl border border-red-300/20 bg-red-400/10 p-3 type-footnote text-red-200">{error}</p> : null}
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="secondary-pill type-button px-4 py-2">取消</button><button disabled={saving} className="primary-pill type-button px-4 py-2 disabled:opacity-50">{saving ? '创建中…' : '创建 Pack'}</button></div>
    </form>
  </div>
}
