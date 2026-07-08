import { useEffect, useState } from 'react';
import { CreditCard, X } from 'lucide-react';
import {
  createStripeCheckoutSession,
  getStripeCreditPacks,
  type BeeGameStripeCreditPack,
} from '../../../services/creditsApi';

interface CreditStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreditStoreModal({ isOpen, onClose }: CreditStoreModalProps) {
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
        setStatus(result.packs.length ? '' : 'Credit purchases are not configured.');
      })
      .catch((error) => {
        if (!cancelled) {
          setPacks([]);
          setStatus(error instanceof Error ? error.message : 'Credit store unavailable.');
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
      setStatus(error instanceof Error ? error.message : 'Checkout unavailable.');
      setCheckoutPriceId('');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Credit Store"
      className="fixed inset-0 z-[210] flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-sm"
    >
      <div
        data-surface="frosted-glass"
        className="input-surface glass-panel w-[min(520px,calc(100vw-2rem))] rounded-[28px] p-5 text-zinc-100"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="type-title-2 text-white">Credit Store</h2>
            <p className="type-footnote mt-1 text-zinc-500">Buy credits for BeeGame generation, preview, and iteration.</p>
          </div>
          <button
            type="button"
            aria-label="Close credit store"
            onClick={onClose}
            className="glass-icon-button inline-flex h-9 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {isLoading ? (
            <div className="type-footnote rounded-2xl border border-white/10 px-3 py-4 text-zinc-500">Loading credit packs...</div>
          ) : packs.map((pack) => (
            <div
              key={pack.priceId}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3"
            >
              <div className="min-w-0">
                <div className="type-subheadline text-white">{pack.credits.toLocaleString()} credits</div>
                <div className="type-caption-1 truncate text-zinc-500">{pack.priceId}</div>
              </div>
              <button
                type="button"
                disabled={Boolean(checkoutPriceId)}
                onClick={() => void startCheckout(pack.priceId)}
                className="glass-control type-button inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-zinc-100 disabled:opacity-60"
              >
                <CreditCard className="h-4 w-4" />
                Buy {pack.credits.toLocaleString()} credits
              </button>
            </div>
          ))}
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
