import { memo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
    Box,
    CheckCircle2,
    CircleAlert,
    Cuboid,
    FileJson,
    Image,
    Info,
    Library,
    MoreHorizontal,
    Music,
    Sparkles,
    Unlink,
    Upload,
} from 'lucide-react';
import type { BeeGameAssetManifestPayload, BeeGameAssetSlotPayload, BeeGameResourceCandidatePayload } from '../../../services/api';
import type { Language } from '../AgentsConfig';
import { normalizeI18nLanguage } from '../../../i18n/useBeeGameTranslations';
import { Skeleton } from '../../ui/skeleton';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

interface AssetsPanelProps {
    manifest: BeeGameAssetManifestPayload | null;
    isLoading: boolean;
    isUploadingSlotId?: string | null;
    isReintegratingSlotId?: string | null;
    isAutoBinding?: boolean;
    autoBindFeedback?: { message: string; tone: 'success' | 'warning' | 'error' } | null;
    onUpload?: (slotId: string, file: File) => Promise<void>;
    onReintegrate?: (slotId: string) => Promise<void>;
    onRemoveIntegration?: (slotId: string) => Promise<void>;
    onAutoBind?: () => Promise<void>;
    onUnbind?: (slotId: string) => Promise<void>;
    onRequestIntegration?: (slot: BeeGameAssetSlotPayload) => void;
    onRequestAllIntegration?: (slots: BeeGameAssetSlotPayload[]) => void;
    onRequestSelectionPreparation?: (slots: BeeGameAssetSlotPayload[]) => void;
    onCandidates?: (slot: BeeGameAssetSlotPayload) => Promise<BeeGameResourceCandidatePayload[]>;
    onBindCandidate?: (slot: BeeGameAssetSlotPayload, candidate: BeeGameResourceCandidatePayload) => Promise<void>;
    lang?: Language;
}

type AssetsPanelText = Record<string, string>;

export const AssetsPanel = memo(({
    manifest,
    isLoading,
    isUploadingSlotId = null,
    isReintegratingSlotId = null,
    isAutoBinding = false,
    autoBindFeedback = null,
    onUpload,
    onReintegrate,
    onRemoveIntegration,
    onAutoBind,
    onUnbind,
    onRequestIntegration,
    onRequestAllIntegration,
    onRequestSelectionPreparation,
    onCandidates,
    onBindCandidate,
    lang = 'en',
}: AssetsPanelProps) => {
    const { i18n } = useTranslation('beegame');
    const text = i18n.getResourceBundle(normalizeI18nLanguage(lang), 'beegame').assets as AssetsPanelText;
    const slots = manifest?.slots ?? [];
    const pendingSlots = slots.filter(slot => {
        const status = slot.status || (slot.placeholder === false ? 'uploaded' : 'placeholder');
        return status === 'uploaded';
    });
    const selectableSlots = slots.filter(slot => !slot.resource_binding && slot.resource_requirement && slot.status !== 'integrated');
    const runtimeFormats = manifest?.project_target?.asset_format_capabilities ?? [];
    const slotsMissingSelectionContract = selectableSlots.filter(slot => (
        !slot.resource_requirement?.tags?.length || runtimeFormats.length === 0
    ));
    const safelySelectableSlots = selectableSlots.filter(slot => (
        Boolean(slot.resource_requirement?.tags?.length) && runtimeFormats.length > 0
    ));
    const repairableLibrarySlots = slots.filter(slot => slot.resource_binding && slot.status === 'missing');
    const [unbindSlot, setUnbindSlot] = useState<BeeGameAssetSlotPayload | null>(null);
    const [isUnbinding, setIsUnbinding] = useState(false);
    const [unbindError, setUnbindError] = useState('');
    const [removeIntegrationSlot, setRemoveIntegrationSlot] = useState<BeeGameAssetSlotPayload | null>(null);
    const [isRemovingIntegration, setIsRemovingIntegration] = useState(false);
    const [removeIntegrationError, setRemoveIntegrationError] = useState('');
    const [candidateSlot, setCandidateSlot] = useState<BeeGameAssetSlotPayload | null>(null);
    const [candidates, setCandidates] = useState<BeeGameResourceCandidatePayload[]>([]);
    const [candidateError, setCandidateError] = useState('');
    const [candidateLoading, setCandidateLoading] = useState(false);
    const [candidateToBind, setCandidateToBind] = useState<BeeGameResourceCandidatePayload | null>(null);
    const [isBindingCandidate, setIsBindingCandidate] = useState(false);

    if (isLoading && slots.length === 0) {
        return (
            <div className="h-full overflow-y-auto p-5" aria-label={text.loading}>
                <div className="mb-4 flex items-center justify-between">
                    <div className="min-w-0 space-y-2">
                        <Skeleton className="h-4 w-24 bg-white/10" />
                        <Skeleton className="h-3 w-40 bg-white/10" />
                    </div>
                    <Skeleton className="h-7 w-14 rounded-full bg-white/10" />
                </div>
                <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
                            <div className="flex items-start gap-3">
                                <Skeleton className="h-10 w-10 shrink-0 rounded-xl bg-white/10" />
                                <div className="min-w-0 flex-1 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 space-y-2">
                                            <Skeleton className="h-4 w-36 bg-white/10" />
                                            <Skeleton className="h-3 w-56 bg-white/10" />
                                        </div>
                                        <Skeleton className="h-6 w-20 rounded-full bg-white/10" />
                                    </div>
                                    <div className="flex gap-2">
                                        <Skeleton className="h-6 w-14 rounded-full bg-white/10" />
                                        <Skeleton className="h-6 w-16 rounded-full bg-white/10" />
                                    </div>
                                    <Skeleton className="h-9 w-32 rounded-full bg-white/10" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (slots.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 px-8 text-center space-y-4 text-zinc-500 dark:text-zinc-400 opacity-80">
                <Box className="w-12 h-12" />
                <div className="type-callout">{text.empty}</div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto px-4 pb-6 pt-4 sm:px-5">
            <div className="mb-4 border-b border-white/[0.07] pb-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="type-caption-1 text-orange-300">{text.title}</div>
                        <div className="type-body-sm mt-1 truncate text-zinc-300">
                            {manifest?.project_target?.engine || manifest?.project_target?.kind || 'Project'} · {formatMode(manifest?.project_target?.integration_mode, text)}
                        </div>
                    </div>
                    <div className="type-caption-2 shrink-0 rounded-full border border-white/[0.08] bg-zinc-900 px-2.5 py-1 text-zinc-500">
                        {slots.filter(slot => slot.status === 'uploaded' || slot.status === 'integrated').length}/{slots.length}
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    {slotsMissingSelectionContract.length > 0 && onRequestSelectionPreparation ? (
                        <button
                            type="button"
                            onClick={() => onRequestSelectionPreparation(slotsMissingSelectionContract)}
                            className="type-button inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/[0.08] px-3 py-1.5 text-amber-100 transition hover:bg-amber-400/[0.14]"
                        >
                            <Sparkles className="h-3.5 w-3.5" />
                            {text.prepareSelection}
                        </button>
                    ) : null}
                    {(safelySelectableSlots.length > 0 || repairableLibrarySlots.length > 0) && onAutoBind ? (
                        <button
                            type="button"
                            disabled={isAutoBinding}
                            onClick={() => void onAutoBind()}
                            className="type-button inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <Library className="h-3.5 w-3.5" />
                            {isAutoBinding
                                ? (text.autoSelecting || text.uploading)
                                : (safelySelectableSlots.length > 0
                                    ? (text.autoSelectLibrary || text.requestIntegration)
                                    : (text.syncLibraryResources || text.autoSelectLibrary || text.requestIntegration))}
                        </button>
                    ) : null}
                    {pendingSlots.length && onRequestAllIntegration ? (
                        <button
                            type="button"
                            onClick={() => onRequestAllIntegration(pendingSlots)}
                            className="type-button rounded-full border border-white/[0.12] px-3 py-1.5 text-zinc-300 transition hover:bg-white/[0.06]"
                        >
                            {text.integrateAllPending}
                        </button>
                    ) : null}
                </div>
                {autoBindFeedback ? <div role="status" className={`type-caption-2 mt-3 border-l-2 py-1 pl-2.5 ${autoBindFeedback.tone === 'error' ? 'border-red-400 text-red-200' : autoBindFeedback.tone === 'warning' ? 'border-amber-400 text-amber-100' : 'border-emerald-400 text-emerald-100'}`}>{autoBindFeedback.message}</div> : null}
            </div>
            <div className="space-y-2.5">
                {slots.map(slot => (
                    <AssetSlotCard
                        key={slot.id}
                        slot={slot}
                        text={text}
                        isUploading={isUploadingSlotId === slot.id}
                        isReintegrating={isReintegratingSlotId === slot.id}
                        onUpload={onUpload}
                        onReintegrate={onReintegrate}
                        onRequestRemoveIntegration={slot.uploaded_files?.length && onRemoveIntegration ? () => {
                            setRemoveIntegrationError('');
                            setRemoveIntegrationSlot(slot);
                        } : undefined}
                        onRequestUnbind={slot.resource_binding && onUnbind ? () => { setUnbindError(''); setUnbindSlot(slot); } : undefined}
                        onRequestIntegration={onRequestIntegration}
                        onRequestCandidates={onCandidates ? async () => {
                            setCandidateSlot(slot);
                            setCandidateToBind(null);
                            setCandidateLoading(true);
                            setCandidateError('');
                            try {
                                setCandidates(await onCandidates(slot));
                            } catch (error) {
                                setCandidateError(error instanceof Error ? error.message : String(error));
                            } finally {
                                setCandidateLoading(false);
                            }
                        } : undefined}
                        selectionNeedsPreparation={slotsMissingSelectionContract.some(candidate => candidate.id === slot.id)}
                    />
                ))}
            </div>
            {unbindSlot ? (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-5 backdrop-blur-sm">
                    <div role="dialog" aria-modal="true" className="glass-panel w-full max-w-md rounded-3xl p-6 text-zinc-100">
                        <div className="type-title-3 text-white">{text.unbindTitle || 'Disconnect library resource?'}</div>
                        <p className="type-footnote mt-3 text-zinc-400">
                            {text.unbindDescription || 'This removes the library binding only. Copied project files remain unchanged.'}
                        </p>
                        {unbindError ? <p className="type-footnote mt-3 text-red-300">{unbindError}</p> : null}
                        <div className="mt-6 flex justify-end gap-2">
                            <button type="button" disabled={isUnbinding} onClick={() => setUnbindSlot(null)} className="secondary-pill type-button px-4 py-2">
                                {text.cancel || 'Cancel'}
                            </button>
                            <button
                                type="button"
                                disabled={isUnbinding || !onUnbind}
                                onClick={() => {
                                    if (!onUnbind) return;
                                    setIsUnbinding(true);
                                    void onUnbind(unbindSlot.id)
                                        .then(() => setUnbindSlot(null))
                                        .catch(err => setUnbindError(err instanceof Error ? err.message : String(err)))
                                        .finally(() => setIsUnbinding(false));
                                }}
                                className="type-button rounded-full border border-red-400/40 bg-red-400/10 px-4 py-2 text-red-200 transition hover:bg-red-400/20 disabled:opacity-60"
                            >
                                {isUnbinding ? (text.unbinding || text.uploading) : (text.unbind || 'Disconnect')}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
            {removeIntegrationSlot ? (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-5 backdrop-blur-sm">
                    <div role="dialog" aria-modal="true" className="glass-panel w-full max-w-md rounded-3xl p-6 text-zinc-100">
                        <div className="type-title-3 text-white">{text.removeIntegrationTitle}</div>
                        <p className="type-footnote mt-3 text-zinc-400">{text.removeIntegrationDescription}</p>
                        {removeIntegrationError ? <p className="type-footnote mt-3 text-red-300">{removeIntegrationError}</p> : null}
                        <div className="mt-6 flex justify-end gap-2">
                            <button type="button" disabled={isRemovingIntegration} onClick={() => setRemoveIntegrationSlot(null)} className="secondary-pill type-button px-4 py-2">{text.cancel}</button>
                            <button
                                type="button"
                                disabled={isRemovingIntegration || !onRemoveIntegration}
                                onClick={() => {
                                    if (!onRemoveIntegration) return;
                                    setIsRemovingIntegration(true);
                                    void onRemoveIntegration(removeIntegrationSlot.id)
                                        .then(() => setRemoveIntegrationSlot(null))
                                        .catch(err => setRemoveIntegrationError(err instanceof Error ? err.message : String(err)))
                                        .finally(() => setIsRemovingIntegration(false));
                                }}
                                className="type-button rounded-full border border-red-400/40 bg-red-400/10 px-4 py-2 text-red-200 transition hover:bg-red-400/20 disabled:opacity-60"
                            >
                                {isRemovingIntegration ? text.removingIntegration : text.removeIntegration}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
            {candidateSlot ? (
                <div className="fixed inset-0 z-[81] grid place-items-center bg-black/60 p-5 backdrop-blur-sm">
                    <div role="dialog" aria-modal="true" aria-label="资源候选" className="glass-panel w-full max-w-lg rounded-3xl p-6 text-zinc-100">
                        <div className="flex items-center justify-between gap-4">
                            <div className="type-title-3">资源候选</div>
                            <button type="button" onClick={() => setCandidateSlot(null)} className="glass-icon-button h-8 w-8" aria-label="关闭">×</button>
                        </div>
                        <p className="type-footnote mt-2 text-zinc-400">{candidateSlot.name || candidateSlot.id}</p>
                        {candidateLoading ? <p className="type-footnote mt-5 text-zinc-400">正在加载候选资源…</p> : null}
                        {!candidateLoading && candidateError ? <p className="type-footnote mt-5 text-red-300">{candidateError}</p> : null}
                        {!candidateLoading && !candidateError ? (
                            <div className="mt-5 space-y-2">
                                {candidates.length ? candidates.map(candidate => (
                                    <button
                                        key={`${candidate.packId}:${candidate.elementId}`}
                                        type="button"
                                        onClick={() => setCandidateToBind(candidate)}
                                        className={`w-full rounded-xl border p-3 text-left transition hover:bg-white/5 ${candidateToBind?.elementId === candidate.elementId && candidateToBind.packId === candidate.packId ? 'border-sky-300/70 bg-sky-400/10' : 'border-white/10'}`}
                                    >
                                        <div className="type-footnote text-white">{candidate.elementPath}</div>
                                        <div className="type-caption-2 mt-1 text-zinc-500">{candidate.packId} · v{candidate.packVersion} · {candidate.reasons.join(' · ')}</div>
                                    </button>
                                )) : <p className="type-footnote text-zinc-500">没有兼容候选资源。</p>}
                            </div>
                        ) : null}
                        {candidateToBind ? (
                            <div className="mt-5 rounded-2xl border border-sky-300/20 bg-sky-400/5 p-4">
                                <p className="type-footnote text-zinc-200">
                                    {candidateSlot.resource_binding ? '确认替换当前资源绑定？' : '确认使用此资源？'}
                                </p>
                                <p className="type-caption-2 mt-1 text-zinc-500">{candidateToBind.elementPath}</p>
                                <div className="mt-4 flex justify-end gap-2">
                                    <button type="button" disabled={isBindingCandidate} onClick={() => setCandidateToBind(null)} className="secondary-pill type-button px-4 py-2">取消</button>
                                    <button
                                        type="button"
                                        disabled={isBindingCandidate || !onBindCandidate}
                                        onClick={() => {
                                            if (!onBindCandidate) return;
                                            setIsBindingCandidate(true);
                                            setCandidateError('');
                                            void onBindCandidate(candidateSlot, candidateToBind)
                                                .then(() => {
                                                    setCandidateToBind(null);
                                                    setCandidateSlot(null);
                                                })
                                                .catch(error => setCandidateError(error instanceof Error ? error.message : String(error)))
                                                .finally(() => setIsBindingCandidate(false));
                                        }}
                                        className="type-button rounded-full bg-white px-4 py-2 text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-60"
                                    >
                                        {isBindingCandidate ? '正在绑定…' : (candidateSlot.resource_binding ? '确认替换' : '确认使用')}
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
});

AssetsPanel.displayName = 'AssetsPanel';

function AssetSlotCard({
    slot,
    text,
    isUploading,
    isReintegrating,
    onUpload,
    onReintegrate,
    onRequestRemoveIntegration,
    onRequestUnbind,
    onRequestIntegration,
    onRequestCandidates,
    selectionNeedsPreparation,
}: {
    slot: BeeGameAssetSlotPayload;
    text: AssetsPanelText;
    isUploading: boolean;
    isReintegrating: boolean;
    onUpload?: (slotId: string, file: File) => Promise<void>;
    onReintegrate?: (slotId: string) => Promise<void>;
    onRequestRemoveIntegration?: () => void;
    onRequestUnbind?: () => void;
    onRequestIntegration?: (slot: BeeGameAssetSlotPayload) => void;
    onRequestCandidates?: () => Promise<void>;
    selectionNeedsPreparation: boolean;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [error, setError] = useState('');
    const Icon = iconForType(slot.type);
    const status = slot.status || (slot.placeholder === false ? 'uploaded' : 'placeholder');
    const mode = slot.integration_provider?.type;

    const handleFile = async (file: File | undefined) => {
        if (!file || !onUpload) return;
        setError('');
        try {
            await onUpload(slot.id, file);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative rounded-2xl border border-white/[0.08] bg-zinc-950/45 p-3.5 shadow-[0_1px_0_rgba(255,255,255,0.025)] transition-colors hover:border-white/[0.13]"
        >
            <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-orange-300">
                    <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3 pr-16">
                        <div className="min-w-0">
                            <div className="type-body-sm truncate text-zinc-100" title={slot.name || slot.id}>{slot.name || slot.id}</div>
                            <div className="type-caption-1 mt-1 line-clamp-2 text-zinc-400">{slot.purpose || text.noPurpose}</div>
                        </div>
                    </div>

                    <div className="type-caption-2 mt-2.5 flex flex-wrap gap-1.5">
                        <StatusBadge status={status} text={text} />
                        <span className="rounded-full bg-zinc-900 px-2 py-1 text-zinc-500">{slot.required ? text.required : text.optional}</span>
                    </div>

                    {status === 'missing' ? (
                        <div role="alert" className="type-caption-2 mt-3 border-l-2 border-red-400 py-1 pl-2.5 text-red-200">
                            {slot.integration_error || text.missingFile}
                        </div>
                    ) : null}

                    {selectionNeedsPreparation ? <p className="type-caption-2 mt-3 text-amber-200/80">{text.missingSelectionContract}</p> : null}

                    {status === 'uploaded' ? (
                        <div className="type-caption-2 mt-3 border-l-2 border-amber-400 py-1 pl-2.5 text-amber-100">
                            {text.uploadedHint}
                        </div>
                    ) : null}

                    {error ? <div className="type-footnote mt-3 text-red-300">{error}</div> : null}

                    <input
                        ref={inputRef}
                        type="file"
                        aria-label={text.upload}
                        className="hidden"
                        onChange={event => void handleFile(event.currentTarget.files?.[0])}
                    />
                </div>
                <AssetInfoTooltip slot={slot} text={text} mode={mode} />
                <AssetActionsMenu
                    slot={slot}
                    text={text}
                    isUploading={isUploading}
                    isReintegrating={isReintegrating}
                    selectionNeedsPreparation={selectionNeedsPreparation}
                    onUpload={onUpload ? () => inputRef.current?.click() : undefined}
                    onCandidates={onRequestCandidates}
                    onRequestIntegration={onRequestIntegration}
                    onReintegrate={slot.resource_binding && onReintegrate ? () => void onReintegrate(slot.id).catch(err => setError(err instanceof Error ? err.message : String(err))) : undefined}
                    onRemoveIntegration={onRequestRemoveIntegration}
                    onUnbind={onRequestUnbind}
                />
            </div>
        </motion.div>
    );
}

function AssetInfoTooltip({
    slot,
    text,
    mode,
}: {
    slot: BeeGameAssetSlotPayload;
    text: AssetsPanelText;
    mode?: string;
}) {
    const formats = slot.resource_requirement?.accepted_formats?.length
        ? slot.resource_requirement.accepted_formats
        : slot.accepted_formats;
    return (
        <div className="group absolute right-12 top-3.5 z-20">
            <button
                type="button"
                aria-label={text.assetInfo}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-zinc-500 transition hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
                <Info className="h-4 w-4" />
            </button>
            <div role="tooltip" className="pointer-events-none invisible absolute right-0 top-10 w-72 origin-top-right rounded-xl border border-white/[0.1] bg-zinc-950/95 p-3 opacity-0 shadow-2xl backdrop-blur transition duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                <div className="type-caption-1 text-zinc-100">{text.assetInfo}</div>
                <div className="mt-2.5 space-y-2">
                    {slot.target?.path ? <InfoLine label={text.target} value={slot.target.path} code /> : null}
                    {formats?.length ? <InfoLine label={text.formats} value={formats.join(' · ')} /> : null}
                    {slot.type ? <InfoLine label={text.type} value={slot.type} /> : null}
                    {mode ? <InfoLine label={text.integration} value={formatMode(mode, text)} /> : null}
                </div>
                {slot.resource_binding ? (
                    <div className="mt-3 border-t border-white/[0.08] pt-3">
                        <div className="type-caption-2 text-sky-300">{text.libraryBinding}</div>
                        <div className="type-footnote mt-1 truncate text-zinc-200" title={slot.resource_binding.element_id}>{slot.resource_binding.element_id}</div>
                        <div className="type-caption-2 mt-1 text-zinc-500">{text.sourcePack} · {shortIdentifier(slot.resource_binding.pack_id)} · v{slot.resource_binding.pack_version}</div>
                    </div>
                ) : null}
                {slot.uploaded_files?.length ? (
                    <div className="mt-3 border-t border-white/[0.08] pt-3">
                        <div className="type-caption-2 text-emerald-300/80">{text.copiedFile} · {slot.uploaded_files.length}</div>
                        <div className="mt-1 space-y-1">
                            {slot.uploaded_files.slice(0, 3).map(path => <div key={path} title={path} className="type-code-sm truncate text-emerald-200/80">{path}</div>)}
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function AssetActionsMenu({
    slot,
    text,
    isUploading,
    isReintegrating,
    selectionNeedsPreparation,
    onUpload,
    onCandidates,
    onRequestIntegration,
    onReintegrate,
    onRemoveIntegration,
    onUnbind,
}: {
    slot: BeeGameAssetSlotPayload;
    text: AssetsPanelText;
    isUploading: boolean;
    isReintegrating: boolean;
    selectionNeedsPreparation: boolean;
    onUpload?: () => void;
    onCandidates?: () => Promise<void>;
    onRequestIntegration?: (slot: BeeGameAssetSlotPayload) => void;
    onReintegrate?: () => void;
    onRemoveIntegration?: () => void;
    onUnbind?: () => void;
}) {
    const status = slot.status || (slot.placeholder === false ? 'uploaded' : 'placeholder');
    const hasCandidateAction = Boolean(slot.resource_requirement && onCandidates && !selectionNeedsPreparation);
    const hasIntegrationAction = !slot.resource_binding && (status === 'uploaded' || status === 'integrated') && onRequestIntegration;
    const hasAnyAction = onUpload || hasCandidateAction || hasIntegrationAction || onReintegrate || onRemoveIntegration || onUnbind;
    if (!hasAnyAction) return null;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                aria-label={text.moreActions}
                className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-zinc-500 transition hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
                <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 border border-white/[0.1] bg-zinc-950 p-1.5 text-zinc-100 shadow-2xl">
                {onUpload ? (
                    <DropdownMenuItem disabled={isUploading} onClick={onUpload} className="type-button gap-2 px-2.5 py-2 text-zinc-200">
                        <Upload className="h-4 w-4" />
                        {isUploading ? text.uploading : text.upload}
                    </DropdownMenuItem>
                ) : null}
                {hasCandidateAction ? (
                    <DropdownMenuItem onClick={() => void onCandidates?.()} className="type-button gap-2 px-2.5 py-2 text-zinc-200">
                        <Library className="h-4 w-4" />
                        {slot.resource_binding ? text.replaceResource : text.viewCandidates}
                    </DropdownMenuItem>
                ) : null}
                {hasIntegrationAction ? (
                    <DropdownMenuItem onClick={() => onRequestIntegration?.(slot)} className="type-button gap-2 px-2.5 py-2 text-zinc-200">
                        <CheckCircle2 className="h-4 w-4" />
                        {status === 'integrated' ? text.verifyIntegration : text.requestIntegration}
                    </DropdownMenuItem>
                ) : null}
                {onReintegrate ? (
                    <DropdownMenuItem disabled={isReintegrating} onClick={onReintegrate} className="type-button gap-2 px-2.5 py-2 text-zinc-200">
                        <CheckCircle2 className="h-4 w-4" />
                        {isReintegrating ? text.uploading : text.reintegrateLibrary}
                    </DropdownMenuItem>
                ) : null}
                {onRemoveIntegration || onUnbind ? <DropdownMenuSeparator className="bg-white/[0.08]" /> : null}
                {onRemoveIntegration ? (
                    <DropdownMenuItem onClick={onRemoveIntegration} className="type-button gap-2 px-2.5 py-2 text-amber-200 focus:text-amber-100">
                        <CircleAlert className="h-4 w-4" />
                        {text.removeIntegration}
                    </DropdownMenuItem>
                ) : null}
                {onUnbind ? (
                    <DropdownMenuItem variant="destructive" onClick={onUnbind} className="type-button gap-2 px-2.5 py-2">
                        <Unlink className="h-4 w-4" />
                        {text.unbind}
                    </DropdownMenuItem>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function InfoLine({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
    return (
        <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-2">
            <span className="type-caption-2 text-zinc-600">{label}</span>
            <span title={value} className={`${code ? 'type-code-sm' : 'type-caption-2'} truncate text-zinc-300`}>{value}</span>
        </div>
    );
}

function StatusBadge({ status, text }: { status: string; text: AssetsPanelText }) {
    const isGood = status === 'integrated';
    const isMissing = status === 'missing';
    const label = status === 'integrated'
        ? text.integrated
        : status === 'missing'
            ? text.missing
        : status === 'uploaded'
            ? text.uploaded
            : text.placeholder;
    return (
        <span className={`type-caption-1 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 ${
            isGood ? 'bg-emerald-500/10 text-emerald-300' : isMissing ? 'bg-red-500/10 text-red-200' : 'bg-amber-500/10 text-amber-300'
        }`}>
            {isGood ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
            {label}
        </span>
    );
}

function shortIdentifier(value: string): string {
    return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function iconForType(type: string | undefined) {
    const value = (type || '').toLowerCase();
    if (value.includes('model') || value.includes('3d') || value.includes('prefab') || value.includes('scene')) return Cuboid;
    if (value.includes('audio') || value.includes('music') || value.includes('voice')) return Music;
    if (value.includes('data') || value.includes('localization')) return FileJson;
    if (value.includes('image') || value.includes('sprite') || value.includes('texture')) return Image;
    return Box;
}

function formatMode(mode: string | undefined, text: AssetsPanelText): string {
    if (mode === 'mcp') return text.mcp;
    if (mode === 'manual') return text.manual;
    return text.filesystem;
}
