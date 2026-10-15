import { memo, useRef } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Box, CheckCircle2, CircleAlert, Cuboid, FileJson, Image, Info, Music, Upload } from 'lucide-react';
import type {
  BeeGameAssetManifestPayload, BeeGameAssetRequirementPayload,
  BeeGameProjectResourcePayload,
} from '../../../services/api';
import type { ProjectBaselineStatusPayload } from '../../../services/api';
import type { Language } from '../AgentsConfig';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';
import { Skeleton } from '../../ui/skeleton';
import { Button } from '../../beui/project-button';
import { ArtifactEmptyCard } from './ArtifactEmptyCard';
import { useToastContext } from '../../../contexts/ToastContext';

interface AssetsPanelProps {
    manifest: BeeGameAssetManifestPayload | null;
    isLoading: boolean;
  isUploadingResource?: boolean;
  onUpload?: (file: File) => Promise<void>;
  onBack?: () => void;
    acceptance?: ProjectBaselineStatusPayload['acceptance'];
    lang?: Language;
}

type AssetsPanelText = Record<string, string>;

/**
 * Project resources are shown as requirements and independently replaceable files.
 */
export const AssetsPanel = memo(({
    manifest,
    isLoading, isUploadingResource = false,
    onUpload,
    onBack,
    acceptance,
    lang = 'en',
}: AssetsPanelProps) => {
    const text = useBeeGameText(lang).assets as AssetsPanelText;
    const requirements = manifest?.requirements ?? [];
    const resources = manifest?.resources ?? [];
    const hasResources = requirements.length > 0 || resources.length > 0;

    if (isLoading && !hasResources) return <AssetsPanelSkeleton text={text} />;
    return (
        <div className="h-full overflow-y-auto px-4 pb-7 pt-4 sm:px-5">
            <header className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
                <div className="min-w-0">
                    {onBack ? <Button type="button" variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2 gap-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{text.back || 'Back to artifacts'}</Button> : null}
                    <div className="type-caption-1 text-[var(--text-primary)]">{text.title}</div>
                    <div className="type-body-sm mt-1 truncate text-[var(--text-secondary)]">
                        {manifest?.project_target?.runtime || manifest?.project_target?.platform || 'Project'}
                    </div>
                    {hasResources ? <div className="type-caption-2 mt-1.5 text-[var(--text-muted)]">
                        {resources.length} {text.libraryBinding} · {requirements.length} {text.required}
                    </div> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                    <AcceptancePill acceptance={acceptance} text={text} />
            {onUpload ? <ResourceUploadButton text={text} disabled={isUploadingResource} onUpload={onUpload} /> : null}
          </div>
            </header>

            {!hasResources ? <ArtifactEmptyCard icon={Box} message={text.empty} /> : null}

            {resources.length > 0 ? (
                <AssetSection title={text.libraryBinding}>
                    <div className="space-y-2">
                        {resources.map(resource => (
                <ResourceCard key={resource.id} resource={resource} text={text} />))}
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
                                text={text} />
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
        ? { label: text.acceptancePassed, className: 'border-[var(--success)]/35 bg-[var(--success)]/10 text-[var(--success)]', Icon: CheckCircle2 }
        : status === 'failed'
            ? { label: text.acceptanceFailed, className: 'border-[var(--destructive)]/35 bg-[var(--destructive)]/10 text-[var(--destructive)]', Icon: CircleAlert }
            : status === 'blocked'
                ? { label: text.acceptanceBlocked, className: 'border-[var(--warning)]/35 bg-[var(--warning)]/10 text-[var(--warning)]', Icon: CircleAlert }
                : status === 'stale'
                    ? { label: text.acceptanceStale, className: 'border-[var(--warning)]/35 bg-[var(--warning)]/10 text-[var(--warning)]', Icon: CircleAlert }
                    : { label: text.acceptanceNotRun, className: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]', Icon: Info };
    return (
        <div
            className={`type-caption-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${config.className}`}
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
        <section className="mb-4 border-b border-[var(--border)] pb-4 last:mb-0 last:border-b-0 last:pb-0">
            <div className={`type-caption-1 mb-2 ${subdued ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}`}>{title}</div>
            {children}
        </section>
    );
}

function ResourceUploadButton({
  text,
  disabled,
  onUpload,
}: {
  text: AssetsPanelText;
  disabled: boolean;
  onUpload: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { showError } = useToastContext();
  const handleFile = async (file?: File) => {
    if (!file) return;
    try {
      await onUpload(file);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <label
        className={`type-caption-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] ${disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
      >
        <Upload className="h-3.5 w-3.5" />
        {text.upload}
        <input
          ref={inputRef}
          aria-label={text.upload}
          type="file"
          disabled={disabled}
          className="hidden"
          onChange={event => void handleFile(event.currentTarget.files?.[0])}
        />
      </label>
    </div>
  );
}

function ResourceCard({ resource, text }: { resource: BeeGameProjectResourcePayload; text: AssetsPanelText }) {
    return (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="relative rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 pr-12">
            <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-3)] text-[var(--text-secondary)]"><AssetKindIcon type={resource.asset_kind} /></div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="type-body-sm truncate text-[var(--text-primary)]">{resource.id}</div>
                            <div className="type-caption-2 mt-1 truncate font-mono text-[var(--text-muted)]">{resource.root_path}</div>
                        </div>
                        <StatusPill resource={resource} text={text} />
                    </div>
                </div>
            </div>
            <ResourceInfoTooltip resource={resource} text={text} />
        </motion.div>
    );
}

function ResourceInfoTooltip({ resource, text }: { resource: BeeGameProjectResourcePayload; text: AssetsPanelText }) {
    return (
        <div className="group absolute right-3.5 top-3.5 z-20">
            <button type="button" aria-label={text.assetInfo} className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                <Info className="h-4 w-4" />
            </button>
            <div role="tooltip" className="pointer-events-none invisible absolute right-0 top-10 z-20 w-72 rounded-lg border border-[var(--border)] bg-[var(--popover)] p-3 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                <InfoLine label={text.type} value={resource.asset_kind || resource.source.type} />
                <InfoLine label={text.sourcePack} value={
            resource.source.type === 'resource-library'
              ? `${shortIdentifier(resource.source.pack_id)} · v${resource.source.pack_version}` : resource.source.type} />
                <InfoLine label={text.target} value={resource.root_path} code />
                <InfoLine label={text.copiedFile} value={String(resource.file_paths.length)} />
                {resource.dependencies?.length ? (
          <InfoLine label={text.members} value={String(resource.dependencies.length)} />
        ) : null}
            </div>
        </div>
    );
}

function RequirementCard({ requirement, text,
}: { requirement: BeeGameAssetRequirementPayload; text: AssetsPanelText;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
            <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                    <div className="type-footnote truncate text-[var(--text-secondary)]">{requirement.name || requirement.id}</div>
                    <div className="type-caption-2 mt-0.5 truncate text-[var(--text-muted)]">{requirement.purpose || text.noPurpose}</div>
                </div>
                <span className="type-caption-2 shrink-0 text-[var(--text-muted)]">{requirement.required ? text.required : text.optional}</span>
      </div>
    </div>
  );
}

function StatusPill({ resource, text }: { resource: BeeGameProjectResourcePayload; text: AssetsPanelText }) {
  const good = resource.status === 'verified';
  const bad = resource.status === 'failed';
  const label = resource.provisional ? text.placeholder : good ? text.integrated : bad ? text.missing : text.uploaded;
    return (
        <span className={`type-caption-2 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 ${good ? 'bg-[var(--success)]/10 text-[var(--success)]' : bad ? 'bg-[var(--destructive)]/10 text-[var(--destructive)]' : 'bg-[var(--surface-3)] text-[var(--text-muted)]'}`}>
            {good ? <CheckCircle2 className="h-3 w-3" /> : bad ? <CircleAlert className="h-3 w-3" /> : null}{label}
        </span>
    );
}

function InfoLine({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
    return (
    <div className="mt-2 grid grid-cols-[64px_minmax(0,1fr)] gap-2 first:mt-0"><span className="type-caption-2 text-[var(--text-muted)]">{label}</span><span title={value} className={`${code ? 'type-code-sm' : 'type-caption-2'} truncate text-[var(--text-secondary)]`}>{value}</span></div>
  );
}

function AssetsPanelSkeleton({ text }: { text: AssetsPanelText }) {
    return (
    <div className="h-full p-4" aria-label={text.loading}><Skeleton className="h-4 w-28 bg-[var(--surface-3)]" /><Skeleton className="mt-2 h-3 w-44 bg-[var(--surface-3)]" /><div className="mt-4 space-y-2">{Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-16 rounded-lg bg-[var(--surface-3)]" />))}</div></div>
  );
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
