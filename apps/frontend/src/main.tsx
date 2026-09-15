import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import './i18n';
import './index.css';
import App from './App.tsx';
import { ToastProvider } from './contexts/ToastContext';

function renderApplication() {
  if (import.meta.env.DEV && window.location.pathname === '/__workbench_fixture') {
    const DevWorkbenchFixture = lazy(() =>
      import('./dev/DevWorkbenchFixture').then(module => ({
        default: module.DevWorkbenchFixture,
      })),
    );
    return (
      <Suspense fallback={null}>
        <DevWorkbenchFixture />
      </Suspense>
    );
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        {renderApplication()}
      </ToastProvider>
    </MotionConfig>
  </StrictMode>,
);
