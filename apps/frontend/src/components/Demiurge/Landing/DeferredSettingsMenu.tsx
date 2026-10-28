import { lazy, Suspense, useEffect, useState, type ComponentProps } from 'react';
import type { SettingsMenu as SettingsMenuComponent } from './SettingsMenu';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '../../ui/dialog';
import { CloseIconButton } from '../../ui/CloseIconButton';

const SettingsMenu = lazy(async () => {
  const module = await import('./SettingsMenu');
  return { default: module.SettingsMenu };
});

export function DeferredSettingsMenu(props: ComponentProps<typeof SettingsMenuComponent>) {
  const [hasOpened, setHasOpened] = useState(props.isOpen);
  useEffect(() => { if (props.isOpen) setHasOpened(true); }, [props.isOpen]);
  // Retain the instance after first opening: closing must not discard drafts
  // or interrupt the dialog's existing save/close lifecycle.
  if (!props.isOpen && !hasOpened) return null;
  return <Suspense fallback={props.isOpen ? <SettingsLoading lang={props.lang} onClose={props.onClose} embedded={props.embedded} /> : null}>
    <SettingsMenu {...props} />
  </Suspense>;
}

function SettingsLoading({ lang, onClose, embedded }: Pick<ComponentProps<typeof SettingsMenuComponent>, 'lang' | 'onClose' | 'embedded'>) {
  const { i18n } = useTranslation();
  const label = i18n.getFixedT(lang, 'common')('settings');
  if (embedded) return <div className="desktop-settings-loading" aria-label={label}>
    <CloseIconButton label={i18n.getFixedT(lang, 'beegame')('closeSettings')} onClick={onClose} />
    <div role="status" aria-label={label}><span className="size-7 animate-spin rounded-full border-2 border-border border-t-foreground/80" /></div>
  </div>;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent aria-label={label} className="h-[min(680px,calc(100dvh-1rem))] w-[min(820px,calc(100vw-1rem))] max-w-none p-3 sm:h-[min(620px,calc(100dvh-2rem))] sm:w-[min(820px,calc(100vw-2rem))]">
      <CloseIconButton label={i18n.getFixedT(lang, 'beegame')('closeSettings')} onClick={onClose} />
      <div role="status" aria-label={label} className="grid h-[calc(100%-2.5rem)] place-items-center">
        <span className="size-7 animate-spin rounded-full border-2 border-border border-t-foreground/80" />
      </div>
    </DialogContent>
  </Dialog>;
}
