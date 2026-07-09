import type { AttachmentBuildAnalysis } from '../../../services/attachmentBuild';
import type { Language } from '../AgentsConfig';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';

type ConflictChoice = 'gdd' | 'image' | 'custom';

export function AttachmentBuildReview({
    analysis,
    isSubmitting,
    onChangeDraft,
    onSelectConflict,
    onRetry,
    onConfirm,
    lang,
}: {
    analysis: AttachmentBuildAnalysis;
    isSubmitting: boolean;
    onChangeDraft: (draft: string) => void;
    onSelectConflict: (field: string, choice: ConflictChoice) => void;
    onRetry: () => void;
    onConfirm: () => void;
    lang?: Language;
}) {
    const text = useBeeGameText(lang || 'en');
    const copy = text.attachmentBuild || {};
    return (
        <div data-testid="attachment-build-review" className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="text-sm text-zinc-400">{copy.input || 'Input'}: {analysis.sourceType} · {copy.completeness || 'Completeness'}: {analysis.completeness}</div>
                <textarea
                    aria-label={copy.confirmedGdd || 'Confirmed GDD'}
                    value={analysis.gddDraft}
                    onChange={event => onChangeDraft(event.target.value)}
                    className="glass-control mt-3 min-h-64 w-full rounded-2xl p-4 text-sm text-zinc-200 outline-none"
                    disabled={isSubmitting}
                />
            </div>
            <section>
                <h3 className="text-sm font-medium text-zinc-200">{copy.confirmedFacts || 'Confirmed facts'}</h3>
                <ul className="mt-2 space-y-2 text-sm text-zinc-300">
                    {analysis.confirmedFacts.map(item => <li key={`${item.field}-${item.source}`}>{item.field}: {item.value}</li>)}
                </ul>
            </section>
            <section>
                <h3 className="text-sm font-medium text-zinc-200">{copy.inferredDesign || 'Inferred design'}</h3>
                <ul className="mt-2 space-y-2 text-sm text-zinc-300">
                    {analysis.inferredDesign.map(item => <li key={`${item.field}-${item.source}`}>{item.field}: {item.value} ({item.confidence})</li>)}
                </ul>
            </section>
            {analysis.missingFields.length > 0 ? (
                <section className="rounded-2xl border border-amber-300/20 bg-amber-950/20 p-4">
                    <h3 className="text-sm font-medium text-amber-100">{copy.missingInformation || 'Missing information'}</h3>
                    <ul className="mt-2 space-y-2 text-sm text-amber-100">
                        {analysis.missingFields.map(item => <li key={item.field}>{item.field}: {item.reason}</li>)}
                    </ul>
                </section>
            ) : null}
            {analysis.conflicts.length > 0 ? (
                <section className="space-y-3 rounded-2xl border border-red-300/20 bg-red-950/20 p-4">
                    <h3 className="text-sm font-medium text-red-100">{copy.conflicts || 'Conflicts to resolve'}</h3>
                    {analysis.conflicts.map(item => (
                        <div key={item.field} className="space-y-2 text-sm text-red-100">
                            <div>{item.field}: {item.gddValue} / {item.imageValue}</div>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" disabled={isSubmitting} onClick={() => onSelectConflict(item.field, 'gdd')} className="secondary-pill px-3 py-1.5">{copy.useGdd || 'Use GDD value'}</button>
                                <button type="button" disabled={isSubmitting} onClick={() => onSelectConflict(item.field, 'image')} className="secondary-pill px-3 py-1.5">{copy.useImage || 'Use image value'}</button>
                                <button type="button" disabled={isSubmitting} onClick={() => onSelectConflict(item.field, 'custom')} className="secondary-pill px-3 py-1.5">{copy.useCustom || 'Use custom value'}</button>
                            </div>
                        </div>
                    ))}
                </section>
            ) : null}
            <div className="flex justify-end gap-3">
                <button type="button" disabled={isSubmitting} onClick={onRetry} className="secondary-pill px-4 py-2">{copy.retry || 'Retry analysis'}</button>
                <button type="button" disabled={isSubmitting} onClick={onConfirm} className="primary-pill px-4 py-2">{isSubmitting ? (copy.preparing || 'Preparing build…') : (copy.confirm || 'Confirm and build')}</button>
            </div>
        </div>
    );
}
