import { memo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Box, CheckCircle2, CircleAlert, Cuboid, FileJson, Image, Info, Music, Upload } from 'lucide-react';
import type { BeeGameAssetImportPayload, BeeGameAssetManifestPayload, BeeGameAssetRequirementPayload } from '../../../services/api';
import type { ProjectBaselineStatusPayload } from '../../../services/api';
import type { Language } from '../AgentsConfig';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';
import { Skeleton } from '../../ui/skeleton';

interface AssetsPanelProps {
    manifest: BeeGameAssetManifestPayload | null;
    isLoading: boolean;
    isUploadingRequirementId?: string | null;
    onUpload?: (requirementId: string, file: File) => Promise<void>;
    acceptance?: ProjectBaselineStatusPayload['acceptance'];
    lang?: Language;
}

type AssetsPanelText = Record<string, string>;

/**
 * Project resources are intentionally shown as three separate layers:
 * requirements describe what the game needs, imports are the actual reusable
 * source material, and compositions are target-native authored results.
 */
export const AssetsPanel = memo(({
    manifest,
    isLoading,
    isUploadingRequirementId = null,
    onUpload,
    acceptance,
    lang = 'en',
}: AssetsPanelProps) => {
    const text = useBeeGameText(lang).assets as AssetsPanelText;
    const requirements = manifest?.requirements ?? [];
    const imports = manifest?.imports ?? [];
    const compositions = manifest?.compositions ?? [];
    const hasContract = manifest?.contract_state === 'ready'
        || requirements.length > 0
        || imports.length > 0
        || compositions.length > 0;

    if (isLoading && !hasContract) return <AssetsPanelSkeleton text={text} />;
    if (!hasContract) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 py-20 text-center text-zinc-500">
                <Box className="h-11 w-11" />
                <div className="type-callout max-w-sm">{text.empty}</div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto px-4 pb-7 pt-4 sm:px-5">
            <header className="mb-5 flex items-start justify-between gap-4 border-b border-white/[0.07] pb-4">
                <div className="min-w-0">
                    <div className="type-caption-1 text-orange-300">{text.title}</div>
                    <div className="type-body-sm mt-1 truncate text-zinc-300">
                        {manifest?.project_target?.runtime || manifest?.project_target?.platform || 'Project'} · {formatMode(manifest?.project_target?.integration_mode, text)}
                    </div>
                    <div className="type-caption-2 mt-2 text-zinc-500">
                        {imports.length} {text.libraryBinding} · {compositions.length} {text.compositions}
                    </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                    <AcceptancePill acceptance={acceptance} text={text} />
                </div>
            </header>

            {compositions.length > 0 ? (
                <AssetSection title={text.compositions}>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {compositions.map(composition => (
                            <motion.div key={composition.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="type-body-sm truncate text-zinc-100">{composition.id}</div>
                                        <div className="type-caption-2 mt-1 text-zinc-500">{composition.kind} · {composition.members.length} {text.members}</div>
                                    </div>
                                    <StatusPill status={composition.status || 'planned'} text={text} />
                                </div>
                                {composition.recipe?.path ? <div className="type-code-sm mt-3 truncate rounded-lg bg-black/25 px-2.5 py-2 text-emerald-300/80">{composition.recipe.path}</div> : null}
                            </motion.div>
                        ))}
                    </div>
                </AssetSection>
            ) : null}

            {imports.length > 0 ? (
                <AssetSection title={text.libraryBinding}>
                    <div className="space-y-2">
                        {imports.map(resourceImport => <ImportCard key={resourceImport.id} resourceImport={resourceImport} text={text} />)}
                    </div>
                </AssetSection>
            ) : null}

            {requirements.length > 0 ? (
                <AssetSection title={text.title} subdued>
                    <div className="space-y-2">
                        {requirements.map(requirement => (
                            <RequirementCard
                                key={requirement.id}
                                requirement={requirement}
                                text={text}
                                isUploading={isUploadingRequirementId === requirement.id}
                                onUpload={onUpload}
                            />
                        ))}
                    </div>
                </AssetSection>
            ) : null}
        </div>
    );
});

AssetsPanel.displayName = 'AssetsPanel';

function AcceptancePill({
    acceptance,
    text,
}: {
    acceptance?: ProjectBaselineStatusPayload['acceptance'];
    text: AssetsPanelText;
}) {
    const status = acceptance?.status ?? 'not_run';
    const config = status === 'passed'
        ? { label: text.acceptancePassed, className: 'border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300', Icon: CheckCircle2 }
        : status === 'failed'
            ? { label: text.acceptanceFailed, className: 'border-red-400/25 bg-red-400/[0.08] text-red-300', Icon: CircleAlert }
            : status === 'blocked'
                ? { label: text.acceptanceBlocked, className: 'border-amber-400/25 bg-amber-400/[0.08] text-amber-200', Icon: CircleAlert }
                : status === 'stale'
                    ? { label: text.acceptanceStale, className: 'border-amber-400/25 bg-amber-400/[0.08] text-amber-200', Icon: CircleAlert }
                    : { label: text.acceptanceNotRun, className: 'border-white/[0.09] bg-white/[0.03] text-zinc-400', Icon: Info };
    return (
        <div
            className={`type-caption-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 ${config.className}`}
            title={acceptance?.summary || config.label}
            data-testid="asset-acceptance-status"
        >
            <config.Icon className="h-3.5 w-3.5" />
            {config.label}
        </div>
    );
}

function AssetSection({ title, subdued = false, children }: { title: string; subdued?: boolean; children: ReactNode }) {
    return (
        <section className="mb-5 border-b border-white/[0.07] pb-5 last:mb-0 last:border-b-0 last:pb-0">
            <div className={`type-caption-1 mb-2.5 ${subdued ? 'text-zinc-500' : 'text-zinc-300'}`}>{title}</div>
            {children}
        </section>
    );
}

function ImportCard({ resourceImport, text }: { resourceImport: BeeGameAssetImportPayload; text: AssetsPanelText }) {
    return (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="relative rounded-2xl border border-white/[0.08] bg-zinc-950/45 p-3.5 pr-14">
            <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-orange-300"><AssetKindIcon type={resourceImport.asset_kind} /></div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="type-body-sm truncate text-zinc-100">{resourceImport.id}</div>
                            <div className="type-caption-2 mt-1 truncate font-mono text-zinc-500">{resourceImport.root_path}</div>
                        </div>
                        <StatusPill status={resourceImport.status} text={text} />
                    </div>
                </div>
            </div>
            <ImportInfoTooltip resourceImport={resourceImport} text={text} />
        </motion.div>
    );
}

function ImportInfoTooltip({ resourceImport, text }: { resourceImport: BeeGameAssetImportPayload; text: AssetsPanelText }) {
    return (
        <div className="group absolute right-3.5 top-3.5 z-20">
            <button type="button" aria-label={text.assetInfo} className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200">
                <Info className="h-4 w-4" />
            </button>
            <div role="tooltip" className="pointer-events-none invisible absolute right-0 top-10 w-72 rounded-xl border border-white/[0.1] bg-zinc-950/95 p-3 opacity-0 shadow-2xl backdrop-blur transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                <InfoLine label={text.type} value={resourceImport.asset_kind || resourceImport.source.type} />
                <InfoLine label={text.sourcePack} value={resourceImport.source.pack_id ? `${shortIdentifier(resourceImport.source.pack_id)} · v${resourceImport.source.pack_version || '—'}` : resourceImport.source.type} />
                <InfoLine label={text.target} value={resourceImport.root_path} code />
                <InfoLine label={text.copiedFile} value={String(resourceImport.local_files.length)} />
                {resourceImport.dependencies?.length ? <InfoLine label={text.members} value={String(resourceImport.dependencies.length)} /> : null}
            </div>
        </div>
    );
}

function RequirementCard({ requirement, text, isUploading, onUpload }: { requirement: BeeGameAssetRequirementPayload; text: AssetsPanelText; isUploading: boolean; onUpload?: (requirementId: string, file: File) => Promise<void> }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [error, setError] = useState('');
    const status = requirement.status || 'planned';
    const handleFile = async (file?: File) => {
        if (!file || !onUpload) return;
        setError('');
        try { await onUpload(requirement.id, file); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { if (inputRef.current) inputRef.current.value = ''; }
    };
    return (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.018] px-3 py-2.5">
            <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                    <div className="type-footnote truncate text-zinc-300">{requirement.name || requirement.id}</div>
                    <div className="type-caption-2 mt-0.5 truncate text-zinc-600">{requirement.purpose || text.noPurpose}</div>
                </div>
                <span className="type-caption-2 shrink-0 text-zinc-600">{requirement.required ? text.required : text.optional}</span>
                <StatusPill status={status} text={text} />
                {onUpload ? (
                    <label aria-label={text.upload} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-white/[0.06] hover:text-zinc-200 ${isUploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
                        <Upload className="h-4 w-4" />
                        <input ref={inputRef} type="file" disabled={isUploading} className="hidden" onChange={event => void handleFile(event.currentTarget.files?.[0])} />
                    </label>
                ) : null}
            </div>
            {error ? <div role="alert" className="type-caption-2 mt-2 text-red-300">{error}</div> : null}
        </div>
    );
}

function StatusPill({ status, text }: { status: string; text: AssetsPanelText }) {
    const good = status === 'integrated' || status === 'referenced' || status === 'assembled' || status === 'satisfied';
    const bad = status === 'missing' || status === 'failed' || status === 'blocked';
    const label = good ? text.integrated : bad ? text.missing : status === 'available' || status === 'uploaded' ? text.uploaded : text.placeholder;
    return (
        <span className={`type-caption-2 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 ${good ? 'bg-emerald-500/10 text-emerald-300' : bad ? 'bg-red-500/10 text-red-200' : 'bg-zinc-900 text-zinc-500'}`}>
            {good ? <CheckCircle2 className="h-3 w-3" /> : bad ? <CircleAlert className="h-3 w-3" /> : null}{label}
        </span>
    );
}

function InfoLine({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
    return <div className="mt-2 grid grid-cols-[64px_minmax(0,1fr)] gap-2 first:mt-0"><span className="type-caption-2 text-zinc-600">{label}</span><span title={value} className={`${code ? 'type-code-sm' : 'type-caption-2'} truncate text-zinc-300`}>{value}</span></div>;
}

function AssetsPanelSkeleton({ text }: { text: AssetsPanelText }) {
    return <div className="h-full p-5" aria-label={text.loading}><Skeleton className="h-4 w-28 bg-white/10" /><Skeleton className="mt-2 h-3 w-44 bg-white/10" /><div className="mt-5 space-y-2">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-2xl bg-white/[0.06]" />)}</div></div>;
}

function shortIdentifier(value: string): string { return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }
function AssetKindIcon({ type }: { type?: string }) {
    switch (type) {
        case 'mesh':
        case 'model':
        case 'scene':
        case 'rig':
        case 'animation-clip':
        case 'animation-library':
            return <Cuboid className="h-4 w-4" />;
        case 'audio-clip':
        case 'audio-cue':
        case 'audio-bank':
        case 'music':
        case 'ambience':
        case 'voice':
            return <Music className="h-4 w-4" />;
        case 'data':
        case 'input-profile':
            return <FileJson className="h-4 w-4" />;
        case 'image':
        case 'texture':
        case 'sprite':
        case 'sprite-sheet':
        case 'sprite-atlas':
        case 'frame-animation':
        case 'tileset':
        case 'tilemap':
            return <Image className="h-4 w-4" />;
        default:
            return <Box className="h-4 w-4" />;
    }
}
function formatMode(mode: string | undefined, text: AssetsPanelText): string { return mode === 'mcp' ? text.mcp : mode === 'manual' ? text.manual : text.filesystem; }
