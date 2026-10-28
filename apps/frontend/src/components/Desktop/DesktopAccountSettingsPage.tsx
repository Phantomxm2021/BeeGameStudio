import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '../Demiurge/AgentsConfig';
import { DeferredSettingsMenu } from '../Demiurge/Landing/DeferredSettingsMenu';
import { DesktopProfileSettings, type ProfileModalUser } from '../Demiurge/Landing/ProfileModal';
import { DesktopCreditStore } from '../Demiurge/Landing/CreditStoreModal';
import type { BeeGameCreditBalance } from '../../services/creditsApi';
import { useCommonText } from '../../i18n/useBeeGameTranslations';
import { useDesktopLayout } from './desktopLayoutContext';

export type DesktopAccountSettingsData = {
  currentUser: ProfileModalUser | null | undefined;
  creditBalance: Pick<BeeGameCreditBalance, 'balanceCredits' | 'consumedCredits'> | null;
  onSetLang: (language: Language) => void;
  onUserChanged: () => void | Promise<void>;
};

export function DesktopAccountSettingsPage({ lang, data }: { lang: Language; data: DesktopAccountSettingsData }) {
  const desktop = useDesktopLayout();
  const common = useCommonText(lang);
  const page = useRef<HTMLElement>(null);
  const isOpen = Boolean(desktop?.settingsSection && data.currentUser);
  useEffect(() => { if (isOpen) page.current?.focus(); }, [isOpen]);
  if (!desktop?.settingsPage || !desktop.setSettingsSection) return null;
  const section = desktop.settingsSection;
  const close = () => {
    desktop.setSettingsSection?.(null);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.desktop-account-trigger')?.focus());
  };
  return createPortal(
    <section ref={page} tabIndex={-1} className="desktop-account-page" hidden={!isOpen} aria-label={common.settings}>
      <DeferredSettingsMenu isOpen={isOpen} embedded lang={lang} onClose={close}
        section={section ?? undefined} onSectionChange={isOpen ? desktop.setSettingsSection : undefined} onSetLang={data.onSetLang}
        accountSections={{
          profile: <DesktopProfileSettings key={data.currentUser?.id} onOpenCreditStore={() => desktop.setSettingsSection?.('credit-store')} isOpen={isOpen && section === 'profile'} lang={lang}
            currentUser={data.currentUser} creditBalance={data.creditBalance}
            onClose={close} onUserChanged={data.onUserChanged} />,
          credits: <DesktopCreditStore isOpen={isOpen && section === 'credit-store'} lang={lang} onClose={close} balance={data.creditBalance} />,
        }} />
    </section>, desktop.settingsPage,
  );
}
