import { GrainGradient } from '../../beui/grain-gradient';
import { useDailyBackground } from './useDailyBackground';

export function IdeaHomeBackdrop() {
  const palette = useDailyBackground();
  return <div aria-hidden="true" data-testid="idea-home-backdrop" data-palette={palette.name} className="pointer-events-none fixed inset-0 z-0">
    <GrainGradient colorLight={palette.colors[0]} colorMid={palette.colors[1]} colorDark={palette.colors[2]} />
  </div>;
}
