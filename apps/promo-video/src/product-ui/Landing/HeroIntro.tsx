import { interpolate, useCurrentFrame } from 'remotion';

/** API-free presentation copy of the frontend Landing/HeroIntro component. */
export function HeroIntro({ title, subtitle, isTransitioning }: { title: string; subtitle: string; isTransitioning: boolean }) {
  const frame = useCurrentFrame();
  const opacity = isTransitioning ? interpolate(frame, [102, 132], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;
  return <section style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', opacity, transform: `translateY(${(1 - opacity) * -18}px)`, filter: `blur(${(1 - opacity) * 8}px)` }}><h1 style={{ margin: 0, color: '#fff', fontSize: 74, lineHeight: 1.05, fontWeight: 800, letterSpacing: '-.045em' }}>{title}</h1><p style={{ margin: '22px 0 0', color: 'rgba(255,255,255,.58)', fontSize: 25, lineHeight: 1.55 }}>{subtitle}</p></section>;
}
