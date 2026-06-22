import { useState, type ReactNode } from 'react';
import { Play, RotateCcw } from 'lucide-react';

import type { PendingUserReviewItem } from '../../../services/api';
import type {
  ArtifactSummaryRefPayload,
  StageControlAnchor,
  StageControlAnchorPayload,
  StageOperationLogEntryPayload,
  StageSnapshotPayload,
} from '../../../types/operatorControls';

export interface KeyValueRow {
  label: string;
  value: string;
}

export function KeyValueRows({ rows }: { rows: KeyValueRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/50">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">{row.label}</div>
          <div className="mt-1 break-all text-sm font-medium text-zinc-900 dark:text-zinc-100">{row.value || 'n/a'}</div>
        </div>
      ))}
    </div>
  );
}

export function buildReviewSummary(review: PendingUserReviewItem): string {
  const workflowId = String(review.review_status?.workflow_id ?? review.type ?? 'review').trim() || 'review';
  const artifactId = String(review.artifact_id ?? review.binding?.artifact_id ?? 'n/a').trim() || 'n/a';
  const laneStatus = String(review.review_status?.lane_status ?? review.status ?? 'pending').trim() || 'pending';
  return `${workflowId} · ${artifactId} · ${laneStatus}`;
}

export function formatAnchorTitle(anchor: StageControlAnchor): string {
  if (anchor === 'WAITING_FOR_USER_GDD_APPROVAL') return 'GDD Approval Gate';
  if (anchor === 'ARCHITECTURE_BLUEPRINT_IN_PROGRESS') return 'Architecture Generation';
  if (anchor === 'ARCHITECTURE_SELF_CHECK_READY') return 'Architecture Self Check';
  if (anchor === 'ARCHITECTURE_INTERNAL_REVIEW_READY') return 'Architecture Internal Review';
  if (anchor === 'ART_DIRECTION_IN_PROGRESS') return 'Art Direction Generation';
  if (anchor === 'ART_DIRECTION_SELF_CHECK_READY') return 'Art Direction Self Check';
  if (anchor === 'ART_DIRECTION_INTERNAL_REVIEW_READY') return 'Art Direction Internal Review';
  if (anchor === 'UI_BLUEPRINT_IN_PROGRESS') return 'UI Generation';
  if (anchor === 'UI_SELF_CHECK_READY') return 'UI Self Check';
  if (anchor === 'UI_ISSUE_LEDGER_READY') return 'UI Issue Ledger';
  if (anchor === 'UI_INTERNAL_REVIEW_READY') return 'UI Internal Review';
  if (anchor === 'UI_CLOSURE_REVIEW_READY') return 'UI Closure Review';
  if (anchor === 'ASSET_REQUIREMENT_PREPARING') return 'Asset Generation';
  if (anchor === 'WAITING_FOR_USER_ASSETS') return 'Asset Approval Gate';
  if (anchor === 'IMPLEMENTATION_IN_PROGRESS') return 'Implementation Generation';
  if (anchor === 'SANKTA_IMPLEMENTATION_IN_PROGRESS') return 'Sankta UI Adapter Implementation';
  if (anchor === 'HEPHAESTUS_IMPLEMENTATION_IN_PROGRESS') return 'Hephaestus Runtime Implementation';
  if (anchor === 'IMPLEMENTATION_SELF_CHECK_READY') return 'Implementation Self Check';
  if (anchor === 'IMPLEMENTATION_INTERNAL_REVIEW_READY') return 'Implementation Internal Review';
  if (anchor === 'QA_IN_PROGRESS') return 'QA Verification';
  if (anchor === 'POLISH_IN_PROGRESS') return 'Polish Pass';
  if (anchor === 'BUILD_IN_PROGRESS') return 'Build Packaging';
  return anchor;
}

export function formatArtifactLine(item: ArtifactSummaryRefPayload): string {
  return [item.label, item.artifact_type, String(item.version ?? ''), item.artifact_id, item.name].filter(Boolean).join(' · ');
}

function controlButtonLabel(anchor: StageControlAnchorPayload): string {
  return anchor.substage === 'Generation' ? anchor.title : anchor.substage ?? anchor.title;
}

export interface StageAgentGroupDefinition {
  key: string;
  label: string;
  description: string;
  agents: string[];
  anchors: StageControlAnchorPayload[];
}

interface StatusPanelProps {
  title: string;
  pendingTitle: string;
  noPendingReviews: string;
  statusRows: KeyValueRow[];
  pendingReviews: PendingUserReviewItem[];
}

export function StatusPanel({ title, pendingTitle, noPendingReviews, statusRows, pendingReviews }: StatusPanelProps) {
  return (
    <section className="space-y-6">
      <div className="rounded-[2rem] border border-zinc-200 bg-white/75 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/65 dark:shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="mb-4 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">{title}</div>
        <KeyValueRows rows={statusRows} />
      </div>

      <div className="rounded-[2rem] border border-zinc-200 bg-white/75 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/65 dark:shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="mb-4 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">{pendingTitle}</div>
        <div className="space-y-3">
          {pendingReviews.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">{noPendingReviews}</div>
          ) : (
            pendingReviews.map((review) => (
              <div key={review.gate_id} className="rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black text-zinc-900 dark:text-zinc-100">{buildReviewSummary(review)}</div>
                  <div className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{review.gate_id}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

interface StageAgentDropdownProps {
  groups: StageAgentGroupDefinition[];
  activeAgent: string;
  currentAnchor: string;
  label: string;
  onSelectAgent: (agent: string) => void;
}

export function StageAgentDropdown({ groups, activeAgent, currentAnchor, label, onSelectAgent }: StageAgentDropdownProps) {
  const activeDefinition = groups.find((group) => group.key === activeAgent) ?? groups[0] ?? null;
  const activeFailure = activeDefinition?.anchors.find((anchor) => anchor.stage_snapshot?.latest_failure?.error_message)?.stage_snapshot?.latest_failure?.error_message ?? '';
  const activeHasCurrentAnchor = activeDefinition?.anchors.some((anchor) => anchor.anchor === currentAnchor) ?? false;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.45fr)_1fr]">
      <label className="grid gap-2">
        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">{label}</span>
        <select
          value={activeDefinition?.key ?? ''}
          onChange={(event) => onSelectAgent(event.target.value)}
          className="h-12 rounded-xl border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        >
          {groups.map((group) => (
            <option key={group.key} value={group.key}>
              {group.label} ({group.anchors.length})
            </option>
          ))}
        </select>
      </label>
      {activeDefinition ? (
        <div className="rounded-[1.25rem] border border-zinc-200 bg-zinc-50/80 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-black text-zinc-900 dark:text-zinc-100">{activeDefinition.label}</div>
            <div className="rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {activeHasCurrentAnchor ? 'Current Flow' : 'Explore Flow'}
            </div>
          </div>
          <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{activeDefinition.description}</div>
          {activeFailure ? <div className="mt-3 text-sm text-rose-700 dark:text-rose-300">{activeFailure}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

interface DisclosurePanelProps {
  title: string;
  children: ReactNode;
}

export function DisclosurePanel({ title, children }: DisclosurePanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="rounded-[1.5rem] border border-zinc-200 bg-white/75 shadow-[0_24px_60px_rgba(15,23,42,0.07)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/65 dark:shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
      <button
        type="button"
        aria-label={`${title} ${isOpen ? 'Hide' : 'Show'}`}
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="text-sm font-black text-zinc-900 dark:text-zinc-100">{title}</span>
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {isOpen ? 'Hide' : 'Show'}
        </span>
      </button>
      {isOpen ? (
        <div className="border-t border-zinc-200 p-5 dark:border-zinc-800">
          {children}
        </div>
      ) : null}
    </section>
  );
}

interface StageTimelineListProps {
  currentTitle: string;
  currentStageFallback: string;
  anchors: StageControlAnchorPayload[];
  selectedAnchor: StageControlAnchorPayload | null;
  currentStage: string;
  availableLabel: string;
  blockedLabel: string;
  currentAnchorReadyToStart: string;
  assetApprovalRealGateReady: string;
  assetApprovalSyntheticReady: string;
  assetApprovalMissingContext: string;
  startRequiresCurrentAnchor: string;
  resetFirstToStart: string;
  startNotAvailableForThisAnchor: string;
  resetToHere: string;
  resetting: string;
  startFromHere: string;
  starting: string;
  resettingAnchor: StageControlAnchor | null;
  startingAnchor: StageControlAnchor | null;
  onSelectAnchor: (anchor: StageControlAnchor) => void;
  onResetAnchor: (anchor: StageControlAnchorPayload) => void;
  onStartAnchor: (anchor: StageControlAnchorPayload) => void;
}

export function StageTimelineList(props: StageTimelineListProps) {
  const {
    currentTitle,
    currentStageFallback,
    anchors,
    selectedAnchor,
    currentStage,
    availableLabel,
    blockedLabel,
    currentAnchorReadyToStart,
    assetApprovalRealGateReady,
    assetApprovalSyntheticReady,
    assetApprovalMissingContext,
    startRequiresCurrentAnchor,
    resetFirstToStart,
    startNotAvailableForThisAnchor,
    resetToHere,
    resetting,
    startFromHere,
    starting,
    resettingAnchor,
    startingAnchor,
    onSelectAnchor,
    onResetAnchor,
    onStartAnchor,
  } = props;

  const activeAnchor = selectedAnchor && anchors.some((anchor) => anchor.anchor === selectedAnchor.anchor)
    ? selectedAnchor
    : anchors[0] ?? null;

  if (!activeAnchor) {
    return (
      <div className="rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        {currentStageFallback}
      </div>
    );
  }

  const isSelected = true;
  const isResetting = resettingAnchor === activeAnchor.anchor;
  const isStarting = startingAnchor === activeAnchor.anchor;
  const isCurrentAnchor = currentStage === activeAnchor.anchor;
  const gateContextMode = activeAnchor.stage_snapshot?.active_gate?.gate_context_mode ?? '';
  const waitingAssetsMissingContext = activeAnchor.anchor === 'WAITING_FOR_USER_ASSETS' && gateContextMode === 'missing';
  const canStart = activeAnchor.available && isCurrentAnchor && activeAnchor.allowed_actions.length > 0 && !waitingAssetsMissingContext;
  const isFineAnchor = Boolean(activeAnchor.parent_anchor);
  const startHint = !activeAnchor.allowed_actions.length
    ? startNotAvailableForThisAnchor
    : isCurrentAnchor
      ? activeAnchor.anchor === 'WAITING_FOR_USER_ASSETS'
        ? gateContextMode === 'real_gate'
          ? assetApprovalRealGateReady
          : gateContextMode === 'synthetic_gate'
            ? assetApprovalSyntheticReady
            : assetApprovalMissingContext
        : currentAnchorReadyToStart
      : `${startRequiresCurrentAnchor} ${resetFirstToStart}`;

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Controls</div>
        <div className="rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {activeAnchor.title ?? currentStageFallback}
        </div>
      </div>
      <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
        {anchors.map((anchor) => {
          const isTabActive = activeAnchor.anchor === anchor.anchor;
          return (
            <button
              key={anchor.anchor}
              type="button"
              onClick={() => onSelectAnchor(anchor.anchor)}
              className={`relative shrink-0 rounded-full border px-4 py-2 text-sm font-black transition-colors ${isTabActive ? 'border-amber-400 bg-amber-100 text-amber-950 dark:border-amber-500/60 dark:bg-amber-950/40 dark:text-amber-100' : 'border-zinc-200 bg-white/70 text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-300 dark:hover:border-zinc-700'}`}
            >
              {controlButtonLabel(anchor)}
            </button>
          );
        })}
      </div>
      <div
        onClick={() => onSelectAnchor(activeAnchor.anchor)}
        className={`mt-4 flex min-h-[340px] flex-col rounded-[1.5rem] border p-5 text-left transition-all ${isSelected ? 'border-amber-400 bg-amber-50/90 shadow-[0_24px_60px_rgba(245,158,11,0.18)] dark:border-amber-500/60 dark:bg-amber-950/20' : 'border-zinc-200 bg-zinc-50/85 dark:border-zinc-800 dark:bg-zinc-900/70'}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {isFineAnchor ? (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
                  {activeAnchor.substage ?? activeAnchor.phase_group}
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                  Generation
                </span>
              )}
              <div className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {activeAnchor.available ? availableLabel : blockedLabel}
              </div>
            </div>
            <div className="text-base font-black text-zinc-900 dark:text-zinc-100">{activeAnchor.title}</div>
            <div className="text-sm text-zinc-600 dark:text-zinc-300">{activeAnchor.description}</div>
          </div>
        </div>

        {!activeAnchor.available && activeAnchor.unavailable_reason ? (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/25 dark:text-rose-100">
            {activeAnchor.unavailable_reason}
          </div>
        ) : null}

        <div className="mt-4 flex-1 space-y-3">
          <div className="rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/35">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">Rerun Scope</div>
            <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">{activeAnchor.stage_snapshot?.rerun_scope.summary || currentTitle}</div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/35">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">Start Hint</div>
            <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">{startHint}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onResetAnchor(activeAnchor);
            }}
            disabled={!activeAnchor.available || isResetting}
            className={`inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-100 px-4 py-2 text-sm font-black text-amber-900 transition-colors dark:border-amber-700/70 dark:bg-amber-950/40 dark:text-amber-100 ${!activeAnchor.available || isResetting ? 'cursor-not-allowed opacity-60' : 'hover:bg-amber-200 dark:hover:bg-amber-950/60'}`}
          >
            <RotateCcw className={`h-4 w-4 ${isResetting ? 'animate-spin' : ''}`} />
            <span>{isResetting ? resetting : resetToHere}</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (!canStart || isStarting) return;
              onStartAnchor(activeAnchor);
            }}
            disabled={!canStart || isStarting}
            className={`inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-100 px-4 py-2 text-sm font-black text-emerald-900 transition-colors dark:border-emerald-700/70 dark:bg-emerald-950/40 dark:text-emerald-100 ${!canStart || isStarting ? 'cursor-not-allowed opacity-60' : 'hover:bg-emerald-200 dark:hover:bg-emerald-950/60'}`}
          >
            <Play className={`h-4 w-4 ${isStarting ? 'animate-pulse' : ''}`} />
            <span>{isStarting ? starting : startFromHere}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

interface StageSnapshotPanelProps {
  title: string;
  noValue: string;
  preservedBaselines: string;
  derivedArtifacts: string;
  removalPreview: string;
  memoryCleanupTitle: string;
  stageDriver: string;
  baselineSummary: string;
  baselineRows: KeyValueRow[];
  selectedAnchor: StageControlAnchorPayload | null;
  selectedSnapshot: StageSnapshotPayload | null;
  snapshotRows: KeyValueRow[];
  memoryCleanupRows: KeyValueRow[];
  operationLog: StageOperationLogEntryPayload[];
}

export function StageSnapshotPanel({
  title,
  noValue,
  preservedBaselines,
  derivedArtifacts,
  removalPreview,
  memoryCleanupTitle,
  stageDriver,
  baselineSummary,
  baselineRows,
  selectedAnchor,
  selectedSnapshot,
  snapshotRows,
  memoryCleanupRows,
  operationLog,
}: StageSnapshotPanelProps) {
  return (
    <section className="space-y-6">
      <div className="rounded-[2rem] border border-zinc-200 bg-white/75 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/65 dark:shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">{title}</div>
          <div className="rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {selectedAnchor?.title ?? noValue}
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <div className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{preservedBaselines}</div>
            <KeyValueRows rows={(selectedSnapshot?.baseline_artifacts ?? []).map((item) => ({ label: item.label, value: formatArtifactLine(item) }))} />
          </div>

          <div>
            <div className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{derivedArtifacts}</div>
            <KeyValueRows rows={(selectedSnapshot?.derived_artifacts ?? []).map((item) => ({ label: item.label, value: formatArtifactLine(item) }))} />
          </div>

          <div>
            <div className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{removalPreview}</div>
            <KeyValueRows rows={(selectedAnchor?.removal_preview.cleanup_summary ?? []).map((line, index) => ({ label: `${removalPreview} ${index + 1}`, value: line }))} />
          </div>

          <div>
            <div className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{memoryCleanupTitle}</div>
            <KeyValueRows rows={memoryCleanupRows} />
          </div>

          <div>
            <div className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{stageDriver}</div>
            <KeyValueRows rows={snapshotRows} />
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-zinc-200 bg-white/75 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/65 dark:shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="mb-4 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">{baselineSummary}</div>
        <KeyValueRows rows={baselineRows} />
      </div>

      <div className="rounded-[2rem] border border-zinc-200 bg-white/75 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/65 dark:shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="mb-4 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Operation Log</div>
        {operationLog.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">No operator control operations recorded.</div>
        ) : (
          <div className="space-y-3">
            {operationLog.map((entry) => (
              <div key={entry.event_id} className="rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black text-zinc-900 dark:text-zinc-100">{entry.event_type}</div>
                  <div className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{entry.event_id}</div>
                </div>
                <div className="mt-2 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">{entry.anchor}</div>
                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{[entry.phase, entry.substage, entry.status, entry.created_at].filter(Boolean).join(' · ')}</div>
                {entry.summary.length ? <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">{entry.summary.join(' · ')}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
