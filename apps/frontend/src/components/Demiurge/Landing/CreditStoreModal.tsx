import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, CreditCard } from 'lucide-react';
import type { Language } from '../AgentsConfig';
import { normalizeI18nLanguage } from '../../../i18n/useBeeGameTranslations';
import { Skeleton } from '../../ui/skeleton';
import {
  createStripeCheckoutSession,
  getStripeCreditPacks,
  type BeeGameStripeCreditPack,
} from '../../../services/creditsApi';
import { Button } from '../../beui/project-button';
import { CloseIconButton } from '../../ui/CloseIconButton';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../ui/dialog';
import { isDesktopShell, openExternal } from '../../../lib/platform';
import { useToastContext } from '../../../contexts/ToastContext';

interface CreditStoreModalProps {
  isOpen: boolean;
  presentation?: 'dialog' | 'desktop';
  balance?: { balanceCredits: number; consumedCredits: number } | null;
  lang: Language;
  onClose: () => void;
}

type CreditStoreCopy = {
  title: string;
  description: string;
  close: string;
  loading: string;
  notConfigured: string;
  unavailable: string;
  checkoutUnavailable: string;
  buy: string;
  buyAria: (credits: string) => string;
  creditAmount: (credits: string) => string;
  tierTitle: (tier: CreditStoreTierKey, fallback: string) => string;
  tierDescription: (tier: CreditStoreTierKey) => string;
};

type CreditStoreTierKey = 'starter' | 'builder' | 'pro' | 'studio';

const CREDIT_STORE_TIERS: CreditStoreTierKey[] = ['starter', 'builder', 'pro', 'studio'];

export function CreditStoreModal({ isOpen, lang, onClose, presentation = 'dialog', balance }: CreditStoreModalProps) {
  const desktop = presentation === 'desktop';
  const { showError } = useToastContext();
  const { i18n } = useTranslation('beegame');
  const copy = getCreditStoreCopy((key, options) => (
    i18n.getFixedT(normalizeI18nLanguage(lang), 'beegame')(key, options)
  ));
  const [packs, setPacks] = useState<BeeGameStripeCreditPack[]>([]);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [checkoutPriceId, setCheckoutPriceId] = useState('');
  const [selectedPriceId, setSelectedPriceId] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    // Opening the modal starts a fresh catalog request and clears stale status.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setStatus('');
    void getStripeCreditPacks()
      .then((result) => {
        if (cancelled) return;
        setPacks(result.packs);
        setSelectedPriceId(current => result.packs.some(pack => pack.priceId === current) ? current : result.packs[0]?.priceId || '');
        setStatus(result.packs.length ? '' : copy.notConfigured);
      })
      .catch((error) => {
        if (!cancelled) {
          setPacks([]);
          setStatus(error instanceof Error ? error.message : copy.unavailable);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [copy.notConfigured, copy.unavailable, isOpen]);

  const startCheckout = async (priceId: string) => {
    setStatus('');
    setCheckoutPriceId(priceId);
    try {
      const session = await createStripeCheckoutSession(priceId);
      if (isDesktopShell()) {
        await openExternal(session.url);
        setCheckoutPriceId('');
      } else window.open(session.url, '_self');
    } catch (error) {
      const message = error instanceof Error ? error.message : copy.checkoutUnavailable;
      if (desktop) setStatus(message); else showError(message);
      setCheckoutPriceId('');
    }
  };

  const selectedPack = packs.find(pack => pack.priceId === selectedPriceId);
  const titleFor = (pack: BeeGameStripeCreditPack, index: number) => pack.displayName?.trim() || copy.tierTitle(CREDIT_STORE_TIERS[index] ?? 'studio', copy.creditAmount(pack.credits.toLocaleString()));
  if (desktop) return <section className="desktop-credit-store">
    <div className="desktop-credit-balance"><div><span>{i18n.getFixedT(normalizeI18nLanguage(lang), 'landing')('intake.profile.balance')}</span><strong>{balance ? balance.balanceCredits.toLocaleString() : '—'}</strong></div>{balance ? <span>{i18n.getFixedT(normalizeI18nLanguage(lang), 'landing')('intake.profile.consumed')} {balance.consumedCredits.toLocaleString()}</span> : null}</div>
    <div className="desktop-settings-group-label">{lang.startsWith('zh') ? '购买 Credit' : 'Buy Credit'}</div>
    {isLoading ? <p role="status" className="desktop-inline-feedback">{copy.loading}</p> : <fieldset className="desktop-credit-packs" disabled={Boolean(checkoutPriceId)}><legend className="sr-only">{copy.title}</legend>
      {packs.map((pack, index) => <label key={pack.priceId} className="desktop-credit-pack"><input type="radio" name="desktop-credit-pack" value={pack.priceId} checked={selectedPriceId === pack.priceId} onChange={() => setSelectedPriceId(pack.priceId)} /><span>{titleFor(pack, index)}</span><span>{copy.creditAmount(pack.credits.toLocaleString())}</span></label>)}
    </fieldset>}
    {selectedPack && !isLoading ? <div className="desktop-purchase-row"><span>{titleFor(selectedPack, packs.indexOf(selectedPack))} · {copy.creditAmount(selectedPack.credits.toLocaleString())}</span><button type="button" className="desktop-settings-button desktop-primary" disabled={Boolean(checkoutPriceId)} onClick={() => void startCheckout(selectedPack.priceId)}>{copy.buy}<ArrowUpRight aria-hidden="true" /></button></div> : null}
    {status ? <p role="status" className="desktop-inline-feedback">{status}</p> : null}
  </section>;

  const content = <>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0"><DialogTitle className="type-title-2 text-foreground">{copy.title}</DialogTitle><DialogDescription className="type-footnote mt-1 text-muted-foreground">{copy.description}</DialogDescription></div>
          <CloseIconButton label={copy.close} onClick={onClose} />
        </div>

        <div className="mt-4 min-h-0">
          {isLoading ? (
            <div className="overflow-hidden rounded-lg border border-border" aria-label={copy.loading}>
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="grid gap-3 border-b border-border bg-muted/40 px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                >
                  <div className="min-w-0 space-y-2">
                    <Skeleton className="h-4 w-32 bg-accent" />
                    <Skeleton className="h-3 w-56 bg-accent" />
                  </div>
                  <Skeleton className="h-5 w-24 bg-accent sm:ml-auto" />
                  <Skeleton className="h-9 w-full rounded-full bg-accent sm:w-24" />
                </div>
              ))}
            </div>
          ) : (
            <div className="max-h-[min(360px,calc(100vh-13rem))] overflow-y-auto rounded-lg border border-border">
              {packs.map((pack, index) => (
                <CreditPackRow
                  key={pack.priceId}
                  pack={pack}
                  tier={CREDIT_STORE_TIERS[index] ?? 'studio'}
                  copy={copy}
                  isCheckingOut={Boolean(checkoutPriceId)}
                  onBuy={() => void startCheckout(pack.priceId)}
                />
              ))}
            </div>
          )}
        </div>

        {status ? (
          <div className="type-footnote mt-3 rounded-lg border border-[var(--warning)] bg-[var(--surface-2)] px-3 py-2 text-[var(--warning)]">
            {status}
          </div>
        ) : null}
  </>;
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[min(560px,calc(100dvh-2rem))] max-w-2xl flex-col overflow-hidden p-5">{content}</DialogContent>
    </Dialog>
  );
}

function CreditPackRow({
  pack,
  tier,
  copy,
  isCheckingOut,
  onBuy,
}: {
  pack: BeeGameStripeCreditPack;
  tier: CreditStoreTierKey;
  copy: CreditStoreCopy;
  isCheckingOut: boolean;
  onBuy: () => void;
}) {
  const credits = pack.credits.toLocaleString();
  const title = pack.displayName?.trim() || copy.tierTitle(tier, copy.creditAmount(credits));
  return (
    <div className="grid gap-3 border-b border-border bg-muted/40 px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
      <div className="min-w-0">
        <div className="type-footnote text-foreground">{title}</div>
        <p className="type-caption-1 mt-0.5 line-clamp-2 text-muted-foreground">{copy.tierDescription(tier)}</p>
      </div>
      <div className="type-subheadline text-foreground sm:min-w-32 sm:text-right">{copy.creditAmount(credits)}</div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={copy.buyAria(credits)}
        disabled={isCheckingOut}
        onClick={onBuy}
        className="w-full sm:w-24"
      >
        <CreditCard className="h-3.5 w-3.5" />
        {copy.buy}
      </Button>
    </div>
  );
}

function getCreditStoreCopy(translate: (key: string, options?: Record<string, unknown>) => string): CreditStoreCopy {
  return {
    title: translate('creditStore.title'),
    description: translate('creditStore.description'),
    close: translate('creditStore.close'),
    loading: translate('creditStore.loading'),
    notConfigured: translate('creditStore.notConfigured'),
    unavailable: translate('creditStore.unavailable'),
    checkoutUnavailable: translate('creditStore.checkoutUnavailable'),
    buy: translate('creditStore.buy'),
    buyAria: (credits) => translate('creditStore.buyAria', { credits }),
    creditAmount: (credits) => translate('creditStore.creditAmount', { credits }),
    tierTitle: (tier, fallback) => {
      const title = translate(`creditStore.tiers.${tier}.title`);
      return title === `creditStore.tiers.${tier}.title` ? fallback : title;
    },
    tierDescription: (tier) => translate(`creditStore.tiers.${tier}.description`),
  };
}

export function DesktopCreditStore(props: Omit<CreditStoreModalProps, 'presentation'>) {
  return <CreditStoreModal {...props} presentation="desktop" />;
}
