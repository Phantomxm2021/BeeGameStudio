import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, X } from 'lucide-react';
import type { Language } from '../AgentsConfig';
import { normalizeI18nLanguage } from '../../../i18n/useBeeGameTranslations';
import {
  createStripeCheckoutSession,
  getStripeCreditPacks,
  type BeeGameStripeCreditPack,
} from '../../../services/creditsApi';

interface CreditStoreModalProps {
  isOpen: boolean;
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

export function CreditStoreModal({ isOpen, lang, onClose }: CreditStoreModalProps) {
  const { i18n } = useTranslation('beegame');
  const copy = getCreditStoreCopy((key, options) => (
    i18n.getFixedT(normalizeI18nLanguage(lang), 'beegame')(key, options)
  ));
  const [packs, setPacks] = useState<BeeGameStripeCreditPack[]>([]);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [checkoutPriceId, setCheckoutPriceId] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setStatus('');
    void getStripeCreditPacks()
      .then((result) => {
        if (cancelled) return;
        setPacks(result.packs);
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
  }, [isOpen]);

  if (!isOpen) return null;

  const startCheckout = async (priceId: string) => {
    setStatus('');
    setCheckoutPriceId(priceId);
    try {
      const session = await createStripeCheckoutSession(priceId);
      window.open(session.url, '_self');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : copy.checkoutUnavailable);
      setCheckoutPriceId('');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      className="fixed inset-0 z-[210] flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-sm"
    >
      <div
        data-surface="frosted-glass"
        className="input-surface glass-panel flex max-h-[min(560px,calc(100vh-2rem))] w-[min(600px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[28px] p-5 text-zinc-100"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="type-title-2 text-white">{copy.title}</h2>
            <p className="type-footnote mt-1 text-zinc-500">{copy.description}</p>
          </div>
          <button
            type="button"
            aria-label={copy.close}
            onClick={onClose}
            className="glass-icon-button inline-flex h-9 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 min-h-0">
          {isLoading ? (
            <div className="type-footnote rounded-2xl border border-white/10 px-3 py-4 text-zinc-500">{copy.loading}</div>
          ) : (
            <div className="max-h-[min(360px,calc(100vh-13rem))] overflow-y-auto rounded-2xl border border-white/10">
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
          <div className="type-footnote mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-amber-200">
            {status}
          </div>
        ) : null}
      </div>
    </div>
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
    <div className="grid gap-3 border-b border-white/10 bg-white/[0.035] px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
      <div className="min-w-0">
        <div className="type-footnote text-white">{title}</div>
        <p className="type-caption-1 mt-0.5 line-clamp-2 text-zinc-500">{copy.tierDescription(tier)}</p>
      </div>
      <div className="type-subheadline text-white sm:min-w-32 sm:text-right">{copy.creditAmount(credits)}</div>
      <button
        type="button"
        aria-label={copy.buyAria(credits)}
        disabled={isCheckingOut}
        onClick={onBuy}
        className="glass-control type-button inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-full px-3 text-zinc-100 disabled:opacity-60 sm:w-24"
      >
        <CreditCard className="h-3.5 w-3.5" />
        {copy.buy}
      </button>
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
