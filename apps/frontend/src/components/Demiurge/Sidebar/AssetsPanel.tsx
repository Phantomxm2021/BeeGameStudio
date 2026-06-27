import { memo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
    Box,
    CheckCircle2,
    CircleAlert,
    Cuboid,
    FileJson,
    Image,
    Music,
    Upload,
} from 'lucide-react';
import type { BeeGameAssetManifestPayload, BeeGameAssetSlotPayload } from '../../../services/api';
import type { Language } from '../AgentsConfig';

interface AssetsPanelProps {
    manifest: BeeGameAssetManifestPayload | null;
    isLoading: boolean;
    isUploadingSlotId?: string | null;
    onUpload?: (slotId: string, file: File) => Promise<void>;
    onRequestIntegration?: (slot: BeeGameAssetSlotPayload) => void;
    onRequestAllIntegration?: (slots: BeeGameAssetSlotPayload[]) => void;
    lang?: Language;
}

const LABELS = {
    zh: {
        title: '资源合同',
        empty: '还没有资源合同。下一次构建时，BeeGame 会要求 agent 生成 assets/asset-manifest.json。',
        loading: '正在读取资源合同...',
        upload: '上传替换',
        uploading: '上传中...',
        requestIntegration: '让 BeeGame 集成',
        verifyIntegration: '重新集成 / 验证',
        integrateAllPending: '集成所有待处理',
        required: '必需',
        optional: '可选',
        placeholder: 'Placeholder',
        uploaded: '等待集成',
        integrated: '已集成',
        uploadedHint: '资源已上传，但还没有确认接入运行时。',
        mcp: 'MCP 集成',
        filesystem: '文件集成',
        manual: '手动集成',
        target: '目标',
        formats: '格式',
        specs: '规格',
        noPurpose: '未提供用途说明',
    },
    en: {
        title: 'Asset Contracts',
        empty: 'No asset contract yet. BeeGame will ask the agent to create assets/asset-manifest.json on the next build.',
        loading: 'Loading asset contracts...',
        upload: 'Upload replacement',
        uploading: 'Uploading...',
        requestIntegration: 'Ask BeeGame to integrate',
        verifyIntegration: 'Re-integrate / verify',
        integrateAllPending: 'Integrate all pending',
        required: 'Required',
        optional: 'Optional',
        placeholder: 'Placeholder',
        uploaded: 'Pending integration',
        integrated: 'Integrated',
        uploadedHint: 'Uploaded, but not confirmed in runtime yet.',
        mcp: 'MCP integration',
        filesystem: 'File integration',
        manual: 'Manual integration',
        target: 'Target',
        formats: 'Formats',
        specs: 'Specs',
        noPurpose: 'No purpose provided',
    },
};

export const AssetsPanel = memo(({
    manifest,
    isLoading,
    isUploadingSlotId = null,
    onUpload,
    onRequestIntegration,
    onRequestAllIntegration,
    lang = 'en',
}: AssetsPanelProps) => {
    const text = lang === 'zh' || lang === 'zh-TW' ? LABELS.zh : LABELS.en;
    const slots = manifest?.slots ?? [];
    const pendingSlots = slots.filter(slot => {
        const status = slot.status || (slot.placeholder === false ? 'uploaded' : 'placeholder');
        return status === 'uploaded';
    });

    if (isLoading && slots.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 italic space-y-4 text-zinc-500 dark:text-zinc-400 opacity-70">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-100"></div>
                <div className="text-sm">{text.loading}</div>
            </div>
        );
    }

    if (slots.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 px-8 text-center space-y-4 text-zinc-500 dark:text-zinc-400 opacity-80">
                <Box className="w-12 h-12" />
                <div className="text-sm leading-6">{text.empty}</div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-5 scrollbar-hide">
            <div className="mb-4 flex items-center justify-between">
                <div className="min-w-0">
                    <div className="text-xs font-black uppercase tracking-[0.26em] text-orange-300">{text.title}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                        {manifest?.project_target?.engine || manifest?.project_target?.kind || 'Project'} · {formatMode(manifest?.project_target?.integration_mode, text)}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {pendingSlots.length && onRequestAllIntegration ? (
                        <button
                            type="button"
                            onClick={() => onRequestAllIntegration(pendingSlots)}
                            className="rounded-full border border-orange-400/40 bg-orange-400/10 px-3 py-1 text-xs font-black text-orange-200 transition hover:bg-orange-400/20"
                        >
                            {text.integrateAllPending}
                        </button>
                    ) : null}
                    <div className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-bold text-zinc-400">
                        {slots.filter(slot => slot.status === 'uploaded' || slot.status === 'integrated').length}/{slots.length}
                    </div>
                </div>
            </div>
            <div className="space-y-3">
                {slots.map(slot => (
                    <AssetSlotCard
                        key={slot.id}
                        slot={slot}
                        text={text}
                        isUploading={isUploadingSlotId === slot.id}
                        onUpload={onUpload}
                        onRequestIntegration={onRequestIntegration}
                    />
                ))}
            </div>
        </div>
    );
});

AssetsPanel.displayName = 'AssetsPanel';

function AssetSlotCard({
    slot,
    text,
    isUploading,
    onUpload,
    onRequestIntegration,
}: {
    slot: BeeGameAssetSlotPayload;
    text: typeof LABELS.en;
    isUploading: boolean;
    onUpload?: (slotId: string, file: File) => Promise<void>;
    onRequestIntegration?: (slot: BeeGameAssetSlotPayload) => void;
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
            className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4"
        >
            <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-orange-300">
                    <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-zinc-100">{slot.name || slot.id}</div>
                            <div className="mt-1 text-xs leading-5 text-zinc-400">{slot.purpose || text.noPurpose}</div>
                        </div>
                        <StatusBadge status={status} text={text} />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.16em]">
                        <span className="rounded-full bg-zinc-900 px-2 py-1 text-zinc-400">{slot.required ? text.required : text.optional}</span>
                        {slot.type ? <span className="rounded-full bg-zinc-900 px-2 py-1 text-zinc-400">{slot.type}</span> : null}
                        {mode ? <span className="rounded-full bg-zinc-900 px-2 py-1 text-blue-300">{formatMode(mode, text)}</span> : null}
                    </div>

                    <div className="mt-3 space-y-1 text-xs text-zinc-500">
                        {slot.target?.path ? <MetaLine label={text.target} value={slot.target.path} /> : null}
                        {slot.accepted_formats?.length ? <MetaLine label={text.formats} value={slot.accepted_formats.join(', ')} /> : null}
                        {slot.recommended_specs ? <MetaLine label={text.specs} value={formatSpecs(slot.recommended_specs)} /> : null}
                    </div>

                    {slot.uploaded_files?.length ? (
                        <div className="mt-3 space-y-1">
                            {slot.uploaded_files.map(path => (
                                <div key={path} className="truncate rounded-lg bg-zinc-900 px-2 py-1 font-mono text-xs text-emerald-300">
                                    {path}
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {status === 'uploaded' ? (
                        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                            {text.uploadedHint}
                        </div>
                    ) : null}

                    {error ? <div className="mt-3 text-xs text-red-300">{error}</div> : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                        {onUpload ? (
                            <>
                                <input
                                    ref={inputRef}
                                    type="file"
                                    aria-label={text.upload}
                                    className="hidden"
                                    onChange={event => void handleFile(event.currentTarget.files?.[0])}
                                />
                                <button
                                    type="button"
                                    disabled={isUploading}
                                    onClick={() => inputRef.current?.click()}
                                    className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-xs font-black text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <Upload className="h-4 w-4" />
                                    {isUploading ? text.uploading : text.upload}
                                </button>
                            </>
                        ) : null}
                        {(status === 'uploaded' || status === 'integrated') && onRequestIntegration ? (
                            <button
                                type="button"
                                onClick={() => onRequestIntegration(slot)}
                                className="inline-flex items-center gap-2 rounded-full border border-orange-400/40 bg-orange-400/10 px-4 py-2 text-xs font-black text-orange-200 transition hover:bg-orange-400/20"
                            >
                                <CheckCircle2 className="h-4 w-4" />
                                {status === 'integrated' ? text.verifyIntegration : text.requestIntegration}
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

function StatusBadge({ status, text }: { status: string; text: typeof LABELS.en }) {
    const isGood = status === 'integrated';
    const label = status === 'integrated'
        ? text.integrated
        : status === 'uploaded'
            ? text.uploaded
            : text.placeholder;
    return (
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
            isGood ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'
        }`}>
            {isGood ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
            {label}
        </span>
    );
}

function MetaLine({ label, value }: { label: string; value: string }) {
    return (
        <div className="grid grid-cols-[64px_1fr] gap-2">
            <span className="text-zinc-600">{label}</span>
            <span className="min-w-0 break-words text-zinc-400">{value}</span>
        </div>
    );
}

function iconForType(type: string | undefined) {
    const value = (type || '').toLowerCase();
    if (value.includes('model') || value.includes('3d') || value.includes('prefab') || value.includes('scene')) return Cuboid;
    if (value.includes('audio') || value.includes('music') || value.includes('voice')) return Music;
    if (value.includes('data') || value.includes('localization')) return FileJson;
    if (value.includes('image') || value.includes('sprite') || value.includes('texture')) return Image;
    return Box;
}

function formatMode(mode: string | undefined, text: typeof LABELS.en): string {
    if (mode === 'mcp') return text.mcp;
    if (mode === 'manual') return text.manual;
    return text.filesystem;
}

function formatSpecs(specs: Record<string, unknown>): string {
    return Object.entries(specs)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
        .join(' · ');
}
