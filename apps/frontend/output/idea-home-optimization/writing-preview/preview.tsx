// Local visual QA only: the actual LandingView with a delayed synthetic intake.
// This file is outside the production entry; no paid generation/build runs.
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import '/src/index.css';
import i18n from '/src/i18n';
import { LandingView } from '/src/components/Demiurge/LandingView';
import { ToastProvider } from '/src/contexts/ToastContext';
import { useSystemStore } from '/src/store/systemStore';
import { beeGameAdapter } from '/src/services/beeGameAdapter';

const user = { id: 'local-animation-preview', role: 'viewer', displayName: 'Preview', permissions: [] };
useSystemStore.setState({ currentUser: user, authenticationStatus: 'anonymous', loadCurrentUser: async () => user });
beeGameAdapter.runIdeaIntake = async () => {
  await new Promise(resolve => setTimeout(resolve, 8000));
  return { options: ['High Score Arcade', 'Maze Survival', 'Timed Challenge'].map((title, index) => ({
    id: 'preview-' + index, title,
    gameplay: 'Guide a moving snake to collect food and grow longer. Every pickup increases the score. Avoid the walls and your own tail, and survive as long as possible while beating your high score.',
    recommendedPlatform: 'Web', recommendedEngine: 'React', recommendedDimension: '2D',
    recommendedGenre: 'Arcade', recommendedStyle: 'Minimal', recommendedInputs: ['Keyboard'], scope: 'Prototype',
  })) };
};
await i18n.changeLanguage('en');
createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="user"><ToastProvider>
    <LandingView lang="en" onSetLang={() => {}} onStart={async () => { throw new Error('Build disabled in visual preview'); }} />
    <span style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 500, fontSize: 11, color: 'white', pointerEvents: 'none' }}>Animation preview · simulated response · no Credit charged</span>
  </ToastProvider></MotionConfig>,
);
