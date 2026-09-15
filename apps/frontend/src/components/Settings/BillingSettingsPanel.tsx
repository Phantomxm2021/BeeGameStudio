import type { BeeGameBillingCreditPack, BeeGameBillingEvent, BeeGameUsageSummary } from '../../services/creditsApi';

export type BillingPackFormState = {
  priceId: string;
  credits: string;
  displayName: string;
  sortOrder: string;
  enabled: boolean;
};

export type BillingSettingsCopy = {
  tab: string;
  title: string;
  description: string;
  packsTitle: string;
  packsDescription: string;
  savePack: string;
  saving: string;
  priceId: string;
  credits: string;
  displayName: string;
  sortOrder: string;
  enabled: string;
  disabled: string;
  edit: string;
  noPacks: string;
  noEvents: string;
  noReference: string;
  positiveCreditsRequired: string;
  packSaved: string;
  packSaveFailed: string;
  auditUnavailable: string;
  billingUnavailable: string;
  metrics: { consumed: string; weightedTokens: string };
};

type CreditMetricProps = { label: string; value: string };

export function CreditMetric({ label, value }: CreditMetricProps) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="type-caption-1 text-muted-foreground">{label}</div>
      <div className="type-subheadline mt-1 text-foreground">{value}</div>
    </div>
  );
}

function formatCreditAmount(value: number): string {
  return Math.max(0, Number(value) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatBillingEventTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleString();
}

export function UsageBillingPanel({
  summary,
  status,
  billingCreditPacks,
  billingEvents,
  packForm,
  copy,
  isSavingPack,
  onPackFormChange,
  onSavePack,
}: {
  summary: BeeGameUsageSummary | null;
  status: string;
  billingCreditPacks: BeeGameBillingCreditPack[];
  billingEvents: BeeGameBillingEvent[];
  packForm: BillingPackFormState;
  copy: BillingSettingsCopy;
  isSavingPack: boolean;
  onPackFormChange: (form: BillingPackFormState) => void;
  onSavePack: () => void;
}) {
  const recentBillingEvents = billingEvents.slice(0, 8);
  return (
    <div className="space-y-4 py-3">
      <div>
        <h3 className="type-subheadline text-foreground">{copy.title}</h3>
        <p className="type-footnote mt-1 text-muted-foreground">{copy.description}</p>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="type-footnote text-foreground">{copy.packsTitle}</h4>
            <p className="type-caption-1 mt-1 text-muted-foreground">{copy.packsDescription}</p>
          </div>
          <button
            type="button"
            className="type-button shrink-0 rounded-full border border-border px-3 py-1.5 text-foreground hover:border-warning-300/40 hover:text-foreground disabled:opacity-50"
            disabled={isSavingPack}
            onClick={onSavePack}
          >
            {isSavingPack ? copy.saving : copy.savePack}
          </button>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(7rem,.7fr)_minmax(0,1fr)]">
          <input
            className="type-input text-[16px] min-[900px]:text-md min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-foreground outline-none focus:border-ring"
            placeholder={copy.priceId}
            value={packForm.priceId}
            onChange={event => onPackFormChange({ ...packForm, priceId: event.target.value })}
          />
          <input
            className="type-input text-[16px] min-[900px]:text-md min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-foreground outline-none focus:border-ring"
            placeholder={copy.credits}
            inputMode="numeric"
            value={packForm.credits}
            onChange={event => onPackFormChange({ ...packForm, credits: event.target.value })}
          />
          <input
            className="type-input text-[16px] min-[900px]:text-md min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-foreground outline-none focus:border-ring sm:col-span-2 xl:col-span-1"
            placeholder={copy.displayName}
            value={packForm.displayName}
            onChange={event => onPackFormChange({ ...packForm, displayName: event.target.value })}
          />
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(7rem,10rem)_auto] sm:items-center">
          <input
            className="type-input text-[16px] min-[900px]:text-md min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-foreground outline-none focus:border-ring"
            placeholder={copy.sortOrder}
            inputMode="numeric"
            value={packForm.sortOrder}
            onChange={event => onPackFormChange({ ...packForm, sortOrder: event.target.value })}
          />
          <label className="type-callout flex min-w-0 items-center gap-2 rounded-xl border border-border px-3 py-2 text-foreground">
            <input
              type="checkbox"
              checked={packForm.enabled}
              onChange={event => onPackFormChange({ ...packForm, enabled: event.target.checked })}
            />
            {copy.enabled}
          </label>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          {billingCreditPacks.length ? (
            <div className="max-h-64 divide-y divide-border overflow-y-auto">
              {billingCreditPacks.map(pack => (
                <BillingCreditPackRow
                  key={pack.priceId}
                  pack={pack}
                  copy={copy}
                  onEdit={() =>
                    onPackFormChange({
                      priceId: pack.priceId,
                      credits: String(pack.credits),
                      displayName: pack.displayName ?? '',
                      sortOrder: String(pack.sortOrder),
                      enabled: pack.enabled,
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <div className="type-footnote px-3 py-4 text-muted-foreground">{copy.noPacks}</div>
          )}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <CreditMetric label={copy.metrics.consumed} value={`${formatCreditAmount(summary?.consumedCredits ?? 0)} credits`} />
        <CreditMetric label={copy.metrics.weightedTokens} value={String(summary?.weightedTokens ?? 0)} />
      </div>
      {status ? (
        <div className="type-footnote rounded-lg border border-warning-300/20 bg-muted px-3 py-2 text-foreground">
          {status}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border">
        {recentBillingEvents.length ? (
          <div className="max-h-64 divide-y divide-border overflow-y-auto">
            {recentBillingEvents.map((event, index) => (
              <BillingEventRow key={event.id ?? `${event.eventType}-${index}`} event={event} copy={copy} />
            ))}
          </div>
        ) : (
          <div className="type-footnote px-3 py-4 text-muted-foreground">{copy.noEvents}</div>
        )}
      </div>
    </div>
  );
}

function BillingCreditPackRow({
  pack,
  copy,
  onEdit,
}: {
  pack: BeeGameBillingCreditPack;
  copy: BillingSettingsCopy;
  onEdit: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
      <div className="min-w-0">
        <div className="type-footnote truncate text-foreground">{pack.displayName || `${pack.credits} credits`}</div>
        <div className="type-caption-1 break-all text-muted-foreground">{pack.priceId}</div>
      </div>
      <div className="type-caption-1 text-muted-foreground">{pack.enabled ? copy.enabled : copy.disabled}</div>
      <button
        type="button"
        className="type-button rounded-full border border-border px-3 py-1.5 text-foreground hover:border-warning-300/40 hover:text-foreground"
        onClick={onEdit}
      >
        {copy.edit}
      </button>
    </div>
  );
}

function BillingEventRow({ event, copy }: { event: BeeGameBillingEvent; copy: BillingSettingsCopy }) {
  return (
    <div className="grid min-w-0 gap-2 px-3 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center">
      <div>
        <div className="type-footnote text-foreground">{event.status}</div>
        <div className="type-caption-1 text-muted-foreground">{formatCreditAmount(event.credits ?? 0)} credits</div>
      </div>
      <div className="min-w-0">
        <div className="type-footnote truncate text-foreground">{event.eventType}</div>
        <div className="type-caption-1 break-all text-muted-foreground">
          {event.priceId || event.providerEventId || event.errorMessage || copy.noReference}
        </div>
      </div>
      <div className="type-caption-1 text-muted-foreground">
        {event.createdAt ? formatBillingEventTime(event.createdAt) : ''}
      </div>
    </div>
  );
}
