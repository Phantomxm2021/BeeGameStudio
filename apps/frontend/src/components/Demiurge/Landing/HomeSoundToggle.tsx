import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX } from 'lucide-react';
import { isHomeSoundEnabled, playHomeSound, setHomeSoundEnabled } from './homeSounds';

export function HomeSoundToggle() {
  const { t } = useTranslation('landing');
  const [enabled, setEnabled] = useState(isHomeSoundEnabled);
  const label = t(enabled ? 'avatar.muteSound' : 'avatar.enableSound');
  return <button type="button" aria-label={label} title={label} aria-pressed={enabled} data-testid="home-sound-toggle"
    className="inline-flex size-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    onClick={() => { const next = !enabled; setHomeSoundEnabled(next); setEnabled(next); if (next) playHomeSound('perk', true); }}>
    {enabled ? <Volume2 aria-hidden="true" className="size-4" /> : <VolumeX aria-hidden="true" className="size-4" />}
  </button>;
}
