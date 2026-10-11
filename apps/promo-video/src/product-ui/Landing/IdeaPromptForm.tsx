import { Paperclip, Sparkles } from 'lucide-react';
import { useCurrentFrame } from 'remotion';

/** API-free presentation copy of the frontend Landing/IdeaPromptForm component. */
export function IdeaPromptForm({ value, placeholder, generateLabel, isTransitioning }: { value: string; placeholder: string; generateLabel: string; isTransitioning: boolean }) {
  const frame = useCurrentFrame();
  const visible = value.slice(0, Math.min(value.length, Math.max(0, Math.floor((frame - 10) / 2))));
  return <div style={{ width: '100%', height: 112, padding: 5, boxSizing: 'border-box', border: '1px solid rgba(255,255,255,.15)', borderRadius: 60, background: 'rgba(72, 72, 49, .4)', boxShadow: '0 22px 70px rgba(0,0,0,.32)', backdropFilter: 'blur(18px)', display: 'flex', alignItems: 'center', opacity: isTransitioning ? .75 : 1 }}><span style={{ width: 76, height: 76, marginLeft: 18, flexShrink: 0, borderRadius: '50%', background: 'rgba(255,255,255,.08)', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.88)' }}><Paperclip size={38} /></span><span style={{ flex: 1, marginLeft: 22, minWidth: 0, color: visible ? 'rgba(255,255,255,.62)' : 'rgba(255,255,255,.4)', fontSize: 25, whiteSpace: 'nowrap', overflow: 'hidden' }}>{visible || placeholder}{visible ? <i style={{ color: '#d6e8d8', fontStyle: 'normal' }}>▌</i> : null}</span><span style={{ height: 76, marginRight: 10, padding: '0 28px', borderRadius: 42, background: 'rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 14, color: 'rgba(255,255,255,.54)', fontSize: 25 }}>{generateLabel}<Sparkles size={28} /></span></div>;
}
