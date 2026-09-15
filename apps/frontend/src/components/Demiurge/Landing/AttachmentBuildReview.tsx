import type { AttachmentBuildAnalysis } from '../../../services/attachmentBuild';
import type { Language } from '../AgentsConfig';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';
import type { BeeGameIntakeSettings } from '../../../services/beeGameAdapter';

type ConflictChoice = 'gdd' | 'image' | 'custom';

export function AttachmentBuildReview({
    analysis,
    isSubmitting,
    onChangeDraft,
    onSelectConflict,
    onRetry,
    onConfirm,
    resourceLibraryUsage,
    onResourceLibraryUsageChange,
    lang,
}: {
    analysis: AttachmentBuildAnalysis;
    isSubmitting: boolean;
    onChangeDraft: (draft: string) => void;
    onSelectConflict: (field: string, choice: ConflictChoice) => void;
    onRetry: () => void;
    onConfirm: () => void;
    resourceLibraryUsage: BeeGameIntakeSettings['resourceLibraryUsage'];
    onResourceLibraryUsageChange: (value: BeeGameIntakeSettings['resourceLibraryUsage']) => void;
    lang?: Language;
}) {
    const text = useBeeGameText(lang || 'en');
    const copy = text.attachmentBuild || {};
    return (
        <div data-testid="attachment-build-review" className="space-y-5">
            <div className="rounded-lg border border-border bg-muted/40 p-4">
                <div className="type-caption-1 text-muted-foreground">{copy.input || 'Input'}: {analysis.sourceType} · {copy.completeness || 'Completeness'}: {analysis.completeness}</div>
                <textarea
                    aria-label={copy.confirmedGdd || 'Confirmed GDD'}
                    value={analysis.gddDraft}
                    onChange={event => onChangeDraft(event.target.value)}
                    className="border border-input bg-background type-input mt-3 min-h-64 w-full rounded-lg p-4 text-foreground outline-none"
                    disabled={isSubmitting}
                />
            </div>
            <section>
                <h3 className="type-headline text-foreground">{copy.confirmedFacts || 'Confirmed facts'}</h3>
                <ul className="type-footnote mt-2 space-y-2 text-foreground">
                    {analysis.confirmedFacts.map(item => <li key={`${item.field}-${item.source}`}>{item.field}: {item.value}</li>)}
                </ul>
            </section>
            <section>
                <h3 className="type-headline text-foreground">{copy.inferredDesign || 'Inferred design'}</h3>
                <ul className="type-footnote mt-2 space-y-2 text-foreground">
                    {analysis.inferredDesign.map(item => <li key={`${item.field}-${item.source}`}>{item.field}: {item.value} ({item.confidence})</li>)}
                </ul>
            </section>
            {analysis.missingFields.length > 0 ? (
                <section className="rounded-lg border border-warning-300/20 bg-muted p-4">
                    <h3 className="type-headline text-foreground">{copy.missingInformation || 'Missing information'}</h3>
                    <ul className="type-footnote mt-2 space-y-2 text-foreground">
                        {analysis.missingFields.map(item => <li key={item.field}>{item.field}: {item.reason}</li>)}
                    </ul>
                </section>
            ) : null}
            {analysis.conflicts.length > 0 ? (
                <section className="space-y-3 rounded-lg border border-destructive-300/20 bg-muted p-4">
                    <h3 className="type-headline text-foreground">{copy.conflicts || 'Conflicts to resolve'}</h3>
                    {analysis.conflicts.map(item => (
                        <div key={item.field} className="type-footnote space-y-2 text-foreground">
                            <div>{item.field}: {item.gddValue} / {item.imageValue}</div>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" disabled={isSubmitting} onClick={() => onSelectConflict(item.field, 'gdd')} className="rounded-md border border-border bg-secondary text-secondary-foreground px-3 py-1.5">{copy.useGdd || 'Use GDD value'}</button>
                                <button type="button" disabled={isSubmitting} onClick={() => onSelectConflict(item.field, 'image')} className="rounded-md border border-border bg-secondary text-secondary-foreground px-3 py-1.5">{copy.useImage || 'Use image value'}</button>
                                <button type="button" disabled={isSubmitting} onClick={() => onSelectConflict(item.field, 'custom')} className="rounded-md border border-border bg-secondary text-secondary-foreground px-3 py-1.5">{copy.useCustom || 'Use custom value'}</button>
                            </div>
                        </div>
                    ))}
                </section>
            ) : null}
            <label className="type-callout block text-foreground">
                {copy.resourceLibrary || 'Resource Library'}
                <select
                    aria-label={copy.resourceLibrary || 'Resource Library'}
                    value={resourceLibraryUsage}
                    onChange={event => onResourceLibraryUsageChange(event.target.value as BeeGameIntakeSettings['resourceLibraryUsage'])}
                    disabled={isSubmitting}
                    className="border border-input bg-background type-input mt-2 h-10 w-full rounded-lg px-3"
                >
                    <option value="preferred">{copy.resourcePreferred || 'Prefer Resource Library'}</option>
                    <option value="optional">{copy.resourceOptional || 'Use when helpful'}</option>
                    <option value="required">{copy.resourceRequired || 'Require Resource Library'}</option>
                </select>
            </label>
            <div className="flex justify-end gap-3">
                <button type="button" disabled={isSubmitting} onClick={onRetry} className="rounded-md border border-border bg-secondary text-secondary-foreground type-button px-4 py-2">{copy.retry || 'Retry analysis'}</button>
                <button type="button" disabled={isSubmitting} onClick={onConfirm} className="rounded-md border border-transparent bg-primary text-primary-foreground type-button px-4 py-2">{isSubmitting ? (copy.preparing || 'Preparing build…') : (copy.confirm || 'Confirm and build')}</button>
            </div>
        </div>
    );
}
