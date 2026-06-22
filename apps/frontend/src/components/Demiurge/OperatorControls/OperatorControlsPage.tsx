import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';

import type { PendingUserReviewItem } from '../../../services/api';
import { useProjectStore } from '../../../store/projectStore';
import { useSystemStore } from '../../../store/systemStore';
import { useToast } from '../../../hooks/useToast';
import { operatorControlsApi } from '../../../services/operatorControlsApi';
import type { StageControlAnchor, StageControlAnchorPayload, StageControlInspectPayload } from '../../../types/operatorControls';
import type { Language } from '../AgentsConfig';
import { DisclosurePanel, StageAgentDropdown, StageSnapshotPanel, StageTimelineList, StatusPanel, type StageAgentGroupDefinition } from './OperatorControlsPanels';

interface OperatorControlsPageProps {
  projectId: string;
  projectName: string;
  lang: Language;
  onBackToWorkspace: () => void;
}

type ApiStatusError = Error & { status?: number };

const STAGE_FLOW: StageControlAnchor[] = [
  'WAITING_FOR_USER_GDD_APPROVAL',
  'ARCHITECTURE_BLUEPRINT_IN_PROGRESS',
  'ARCHITECTURE_SELF_CHECK_READY',
  'ARCHITECTURE_INTERNAL_REVIEW_READY',
  'ART_DIRECTION_IN_PROGRESS',
  'ART_DIRECTION_SELF_CHECK_READY',
  'ART_DIRECTION_INTERNAL_REVIEW_READY',
  'UI_BLUEPRINT_IN_PROGRESS',
  'UI_SELF_CHECK_READY',
  'UI_ISSUE_LEDGER_READY',
  'UI_INTERNAL_REVIEW_READY',
  'UI_CLOSURE_REVIEW_READY',
  'ASSET_REQUIREMENT_PREPARING',
  'WAITING_FOR_USER_ASSETS',
  'IMPLEMENTATION_IN_PROGRESS',
  'SANKTA_IMPLEMENTATION_IN_PROGRESS',
  'HEPHAESTUS_IMPLEMENTATION_IN_PROGRESS',
  'IMPLEMENTATION_SELF_CHECK_READY',
  'IMPLEMENTATION_INTERNAL_REVIEW_READY',
  'QA_IN_PROGRESS',
  'POLISH_IN_PROGRESS',
  'BUILD_IN_PROGRESS',
];

type AgentGroupKey = string;

const OPERATOR_CONTROLS_TRANSLATIONS = {
  zh: {
    backToWorkspace: 'Back To Workspace',
    refreshDiagnostics: 'Refresh Diagnostics',
    refreshing: 'Refreshing',
    diagnosticsRefreshed: '测试诊断数据已刷新',
    diagnosticsRefreshFailed: '测试诊断数据刷新失败',
    routesDisabled: '测试路由未启用。请先开启 DEMIURGE_ENABLE_OPERATOR_CONTROLS 并重启后端。',
    resetFailed: '重置阶段锚点失败',
    startFailed: '启动阶段锚点失败',
    currentStatus: 'Current Status',
    pendingUserReviews: 'Pending User Reviews',
    noPendingReviews: '当前没有可见的待审批项。',
    stageAnchors: 'Stage Timeline',
    stageFlows: 'Stage Flows',
    baselineSummary: 'Approved GDD Baseline',
    currentDataPanel: 'Stage Snapshot',
    timelineCards: 'Timeline Cards',
    agentSelector: 'Agent',
    diagnostics: 'Diagnostics',
    selectedControlDetails: 'Selected Control Details',
    currentFlow: 'Current Flow',
    exploreFlow: 'Explore Flow',
    tabGdd: 'GDD Gate',
    tabArchitecture: 'Architecture',
    tabArtDirection: 'Art Direction',
    tabUi: 'UI',
    tabAssets: 'Assets',
    tabImplementation: 'Implementation',
    tabQa: 'QA',
    tabPolish: 'Polish',
    tabBuild: 'Build',
    tabWorkflow: 'Workflow',
    tabGddDescription: 'GDD approval checkpoint and downstream reset entry.',
    tabArchitectureDescription: 'Architecture generation, self-check, and internal review.',
    tabArtDirectionDescription: 'Apollo generation lane and art-direction review flow.',
    tabUiDescription: 'Morphe UI generation and review lane.',
    tabAssetsDescription: 'Hyle asset generation and asset approval gate.',
    tabImplementationDescription: 'Sankta and Hephaestus coding implementation lane.',
    tabQaDescription: 'Argus verification lane.',
    tabPolishDescription: 'Pneuma polish lane.',
    tabBuildDescription: 'Synthet build packaging lane.',
    tabWorkflowDescription: 'Unclassified workflow controls.',
    operatorControlsDisabled: 'Operator Controls Disabled',
    disabledDescription: '当前后端没有注册 operator diagnostics 路由，所以访问 `POST /api/operator-controls/projects/{projectId}/reset-stage-anchor` 会返回 `404`。这不是接口损坏，而是诊断能力尚未启用。',
    enableSteps: 'Enable Steps',
    verifyStatus: 'Verify Status',
    pipelineStage: 'Pipeline Stage',
    projectPhase: 'Project Phase',
    approvalRequired: 'Approval Required',
    blocked: 'Blocked',
    nextAction: 'Next Action',
    lastResumeStage: 'Last Resume Stage',
    lastResumeError: 'Last Resume Error',
    latestRun: 'Latest Run',
    latestFailure: 'Latest Failure',
    activeGate: 'Active Gate',
    retryAvailable: 'Retry Available',
    preservedBaselines: 'Input Baselines',
    removalPreview: 'Rollback Cleanup',
    memoryCleanup: 'Memory Cleanup',
    derivedArtifacts: 'Derived Artifacts',
    rerunScope: 'Rerun Scope',
    tokenCost: 'Token Cost Hint',
    stageDriver: 'Flow Driver',
    nothingToClean: 'Nothing to clean',
    resetToHere: 'Reset To Here',
    resetting: 'Resetting',
    startFromHere: 'Start From Here',
    starting: 'Starting',
    available: 'available',
    blockedState: 'blocked',
    noValue: 'n/a',
    capabilityDisabledHint: '诊断路由未启用。请设置 DEMIURGE_ENABLE_OPERATOR_CONTROLS=true 并重启后端，然后确认 /api/status 中的 capability 已开启。',
    resetSuccess: '已恢复到',
    startSuccess: '已启动',
    confirmReset: '确认将项目恢复到',
    confirmStart: '确认从',
    currentStageFallback: 'n/a',
    currentAnchorReadyToStart: '当前锚点已就绪，可直接启动。',
    assetApprovalRealGateReady: '会自动批准当前资源审批门，并继续进入后续资源验证/实现链路。',
    assetApprovalSyntheticReady: '会以 operator recovery 方式越过当前资源等待门，并继续进入后续资源验证/实现链路。',
    assetApprovalMissingContext: '当前缺少可恢复的资源审批 gate 上下文，无法直接启动。',
    resetFirstToStart: '需要先 Reset To Here，再 Start From Here。',
    startRequiresCurrentAnchor: '只有当前停留的锚点才允许手动启动。',
    startNotAvailableForThisAnchor: '该锚点不支持直接启动。',
    assetApprovalAutoStart: '会自动批准当前资源审批门，并继续进入后续资源验证/实现链路。',
    resetPreviewLead: '将保留',
    resetPreviewDelete: '将删除',
    resetPreviewReplay: '接下来只重跑',
  },
  en: {
    backToWorkspace: 'Back To Workspace',
    refreshDiagnostics: 'Refresh Diagnostics',
    refreshing: 'Refreshing',
    diagnosticsRefreshed: 'Diagnostics refreshed',
    diagnosticsRefreshFailed: 'Failed to refresh diagnostics',
    routesDisabled: 'Operator control routes are disabled. Enable DEMIURGE_ENABLE_OPERATOR_CONTROLS and restart the backend.',
    resetFailed: 'Failed to reset stage anchor',
    startFailed: 'Failed to start stage anchor',
    currentStatus: 'Current Status',
    pendingUserReviews: 'Pending User Reviews',
    noPendingReviews: 'No pending user reviews are currently visible.',
    stageAnchors: 'Stage Timeline',
    stageFlows: 'Stage Flows',
    baselineSummary: 'Approved GDD Baseline',
    currentDataPanel: 'Stage Snapshot',
    timelineCards: 'Timeline Cards',
    agentSelector: 'Agent',
    diagnostics: 'Diagnostics',
    selectedControlDetails: 'Selected Control Details',
    currentFlow: 'Current Flow',
    exploreFlow: 'Explore Flow',
    tabGdd: 'GDD Gate',
    tabArchitecture: 'Architecture',
    tabArtDirection: 'Art Direction',
    tabUi: 'UI',
    tabAssets: 'Assets',
    tabImplementation: 'Implementation',
    tabQa: 'QA',
    tabPolish: 'Polish',
    tabBuild: 'Build',
    tabWorkflow: 'Workflow',
    tabGddDescription: 'GDD approval checkpoint and downstream reset entry.',
    tabArchitectureDescription: 'Generation, self-check, and internal review for architecture.',
    tabArtDirectionDescription: 'Apollo output lane and art-direction review flow.',
    tabUiDescription: 'Morphe UI generation and review lane.',
    tabAssetsDescription: 'Hyle asset generation and asset approval gate.',
    tabImplementationDescription: 'Sankta and Hephaestus coding implementation lane.',
    tabQaDescription: 'Argus verification lane.',
    tabPolishDescription: 'Pneuma polish lane.',
    tabBuildDescription: 'Synthet build packaging lane.',
    tabWorkflowDescription: 'Unclassified workflow controls.',
    operatorControlsDisabled: 'Operator Controls Disabled',
    disabledDescription: 'The backend did not register operator diagnostics routes, so `POST /api/operator-controls/projects/{projectId}/reset-stage-anchor` returns `404`. The route is disabled, not broken.',
    enableSteps: 'Enable Steps',
    verifyStatus: 'Verify Status',
    pipelineStage: 'Pipeline Stage',
    projectPhase: 'Project Phase',
    approvalRequired: 'Approval Required',
    blocked: 'Blocked',
    nextAction: 'Next Action',
    lastResumeStage: 'Last Resume Stage',
    lastResumeError: 'Last Resume Error',
    latestRun: 'Latest Run',
    latestFailure: 'Latest Failure',
    activeGate: 'Active Gate',
    retryAvailable: 'Retry Available',
    preservedBaselines: 'Input Baselines',
    removalPreview: 'Rollback Cleanup',
    memoryCleanup: 'Memory Cleanup',
    derivedArtifacts: 'Derived Artifacts',
    rerunScope: 'Rerun Scope',
    tokenCost: 'Token Cost Hint',
    stageDriver: 'Flow Driver',
    nothingToClean: 'Nothing to clean',
    resetToHere: 'Reset To Here',
    resetting: 'Resetting',
    startFromHere: 'Start From Here',
    starting: 'Starting',
    available: 'available',
    blockedState: 'blocked',
    noValue: 'n/a',
    capabilityDisabledHint: 'Operator control routes are disabled. Set DEMIURGE_ENABLE_OPERATOR_CONTROLS=true, restart the backend, and verify the capability flags in /api/status.',
    resetSuccess: 'Reset to',
    startSuccess: 'Started',
    confirmReset: 'Reset the project to',
    confirmStart: 'Start manually from',
    currentStageFallback: 'n/a',
    currentAnchorReadyToStart: 'This is the current anchor and it is ready to start.',
    assetApprovalRealGateReady: 'This will auto-approve the current asset approval gate and continue into the downstream validation/implementation flow.',
    assetApprovalSyntheticReady: 'This will continue through the waiting-assets gate via operator recovery and move into downstream validation/implementation.',
    assetApprovalMissingContext: 'The waiting-assets anchor is missing recoverable gate context, so direct start is unavailable.',
    resetFirstToStart: 'Reset to this anchor first, then use Start From Here.',
    startRequiresCurrentAnchor: 'Manual start is only allowed on the current anchor.',
    startNotAvailableForThisAnchor: 'This anchor does not support direct start.',
    assetApprovalAutoStart: 'This will auto-approve the current asset approval gate and continue into the downstream validation/implementation flow.',
    resetPreviewLead: 'Will preserve',
    resetPreviewDelete: 'Will delete',
    resetPreviewReplay: 'Will replay',
  },
  ja: {
    backToWorkspace: 'ワークスペースに戻る',
    refreshDiagnostics: '診断を更新',
    refreshing: '更新中',
    diagnosticsRefreshed: '診断データを更新しました',
    diagnosticsRefreshFailed: '診断データの更新に失敗しました',
    routesDisabled: 'テスト用ルートが無効です。DEMIURGE_ENABLE_OPERATOR_CONTROLS を有効にしてバックエンドを再起動してください。',
    resetFailed: 'ステージアンカーのリセットに失敗しました',
    startFailed: 'ステージアンカーの開始に失敗しました',
    currentStatus: '現在の状態',
    pendingUserReviews: '保留中のユーザーレビュー',
    noPendingReviews: '現在表示可能な承認待ちはありません。',
    stageAnchors: 'ステージタイムライン',
    stageFlows: 'ステージフロー',
    baselineSummary: '承認済み GDD ベースライン',
    currentDataPanel: 'ステージスナップショット',
    timelineCards: 'タイムラインカード',
    agentSelector: 'Agent',
    diagnostics: 'Diagnostics',
    selectedControlDetails: 'Selected Control Details',
    currentFlow: 'Current Flow',
    exploreFlow: 'Explore Flow',
    tabGdd: 'GDD Gate',
    tabArchitecture: 'Architecture',
    tabArtDirection: 'Art Direction',
    tabUi: 'UI',
    tabAssets: 'Assets',
    tabImplementation: 'Implementation',
    tabQa: 'QA',
    tabPolish: 'Polish',
    tabBuild: 'Build',
    tabWorkflow: 'Workflow',
    tabGddDescription: 'GDD 承認ゲートと下流リセット入口です。',
    tabArchitectureDescription: 'アーキテクチャ生成、self-check、internal review を扱います。',
    tabArtDirectionDescription: 'Apollo の生成レーンと美術レビューの流れです。',
    tabUiDescription: 'Morphe UI 生成と review レーンです。',
    tabAssetsDescription: 'Hyle アセット生成とアセット承認ゲートです。',
    tabImplementationDescription: 'Sankta と Hephaestus の coding implementation レーンです。',
    tabQaDescription: 'Argus の verification レーンです。',
    tabPolishDescription: 'Pneuma の polish レーンです。',
    tabBuildDescription: 'Synthet の build packaging レーンです。',
    tabWorkflowDescription: '分類されていない workflow control です。',
    operatorControlsDisabled: 'オペレーター制御は無効です',
    disabledDescription: 'バックエンドが operator diagnostics ルートを登録していないため、`POST /api/operator-controls/projects/{projectId}/reset-stage-anchor` は `404` を返します。ルートが壊れているのではなく無効です。',
    enableSteps: '有効化手順',
    verifyStatus: '確認項目',
    pipelineStage: 'パイプラインステージ',
    projectPhase: 'プロジェクトフェーズ',
    approvalRequired: '承認が必要',
    blocked: 'ブロック中',
    nextAction: '次のアクション',
    lastResumeStage: '直前の再開ステージ',
    lastResumeError: '直前の再開エラー',
    latestRun: '最新実行',
    latestFailure: '最新失敗',
    activeGate: 'アクティブゲート',
    retryAvailable: '再試行可能',
    preservedBaselines: '入力ベースライン',
    removalPreview: 'ロールバック清掃',
    memoryCleanup: 'メモリ清掃',
    derivedArtifacts: '派生アーティファクト',
    rerunScope: '再実行範囲',
    tokenCost: 'トークンコスト',
    stageDriver: 'フロードライバー',
    nothingToClean: '削除対象はありません',
    resetToHere: 'ここへリセット',
    resetting: 'リセット中',
    startFromHere: 'ここから開始',
    starting: '開始中',
    available: 'available',
    blockedState: 'blocked',
    noValue: 'n/a',
    capabilityDisabledHint: '診断ルートが無効です。DEMIURGE_ENABLE_OPERATOR_CONTROLS=true を設定し、バックエンドを再起動して /api/status の capability を確認してください。',
    resetSuccess: '次へ復元しました:',
    startSuccess: '開始しました:',
    confirmReset: '次へプロジェクトを復元しますか:',
    confirmStart: '次から手動開始しますか:',
    currentStageFallback: 'n/a',
    currentAnchorReadyToStart: '現在のアンカーなので、そのまま開始できます。',
    assetApprovalRealGateReady: '現在のアセット承認ゲートを自動承認し、そのまま後続の検証/実装フローへ進みます。',
    assetApprovalSyntheticReady: 'operator recovery として現在のアセット待機ゲートを越え、そのまま後続の検証/実装フローへ進みます。',
    assetApprovalMissingContext: '復元可能なアセット承認ゲートのコンテキストが不足しているため、直接開始できません。',
    resetFirstToStart: '先に Reset To Here を実行してから Start From Here を使ってください。',
    startRequiresCurrentAnchor: '手動開始できるのは現在停止しているアンカーだけです。',
    startNotAvailableForThisAnchor: 'このアンカーは直接開始できません。',
    assetApprovalAutoStart: '現在のアセット承認ゲートを自動承認し、そのまま後続の検証/実装フローへ進みます。',
    resetPreviewLead: '保持されるもの',
    resetPreviewDelete: '削除されるもの',
    resetPreviewReplay: '再実行されるもの',
  },
} as const;

type OperatorControlsTranslation = (typeof OPERATOR_CONTROLS_TRANSLATIONS)[keyof typeof OPERATOR_CONTROLS_TRANSLATIONS];

const resolveOperatorControlsTranslation = (lang: Language): OperatorControlsTranslation => {
  return OPERATOR_CONTROLS_TRANSLATIONS[lang as keyof typeof OPERATOR_CONTROLS_TRANSLATIONS] ?? OPERATOR_CONTROLS_TRANSLATIONS.en;
};

const AGENT_GROUP_ORDER = [
  'metis',
  'tecton',
  'apollo',
  'morphe',
  'hyle',
  'sankta',
  'hephaestus',
  'argus',
  'pneuma',
  'synthet',
  'workflow',
];

function formatAgentName(agent: string): string {
  if (agent === 'metis') return 'Metis';
  if (agent === 'tecton') return 'Tecton';
  if (agent === 'apollo') return 'Apollo';
  if (agent === 'morphe') return 'Morphe';
  if (agent === 'hyle') return 'Hyle';
  if (agent === 'sankta') return 'Sankta';
  if (agent === 'hephaestus') return 'Hephaestus';
  if (agent === 'argus') return 'Argus';
  if (agent === 'pneuma') return 'Pneuma';
  if (agent === 'synthet') return 'Synthet';
  if (agent === 'workflow') return 'Workflow';
  return agent.replace(/(^|[_-])([a-z])/g, (_match, prefix: string, value: string) => `${prefix ? ' ' : ''}${value.toUpperCase()}`);
}

function normalizeAgentId(agent: string): string {
  return agent.trim().toLowerCase().replace(/\s+/g, '_');
}

function phaseToFallbackAgents(phase: string): string[] {
  const normalized = phase.trim().toLowerCase();
  if (normalized === 'gdd') return ['metis'];
  if (normalized === 'architecture') return ['tecton'];
  if (normalized === 'art_direction') return ['apollo'];
  if (normalized === 'ui') return ['morphe'];
  if (normalized === 'asset') return ['hyle'];
  if (normalized === 'implementation') return ['sankta', 'hephaestus'];
  if (normalized === 'qa') return ['argus'];
  if (normalized === 'polish') return ['pneuma'];
  if (normalized === 'build') return ['synthet'];
  return [];
}

function stageIdToFallbackAgents(stageId: string): string[] {
  const normalized = stageId.trim().toLowerCase();
  if (normalized === 'metis_design') return ['metis'];
  if (normalized === 'interface_design') return ['morphe'];
  if (normalized === 'asset_manifest') return ['hyle'];
  if (normalized === 'implementation_parallel') return ['sankta', 'hephaestus'];
  if (normalized === 'qa') return ['argus'];
  if (normalized === 'polish') return ['pneuma'];
  if (normalized === 'build') return ['synthet'];
  return [];
}

function anchorToFallbackAgents(anchor: StageControlAnchor): string[] {
  if (anchor === 'WAITING_FOR_USER_GDD_APPROVAL') return ['metis'];
  if (anchor.startsWith('ARCHITECTURE_')) return ['tecton'];
  if (anchor.startsWith('ART_DIRECTION_')) return ['apollo'];
  if (anchor.startsWith('UI_')) return ['morphe'];
  if (anchor.startsWith('ASSET_') || anchor === 'WAITING_FOR_USER_ASSETS') return ['hyle'];
  if (anchor.startsWith('SANKTA_')) return ['sankta'];
  if (anchor.startsWith('HEPHAESTUS_')) return ['hephaestus'];
  if (anchor.startsWith('IMPLEMENTATION_')) return ['workflow'];
  if (anchor.startsWith('QA_')) return ['argus'];
  if (anchor.startsWith('POLISH_')) return ['pneuma'];
  if (anchor.startsWith('BUILD_')) return ['synthet'];
  return ['workflow'];
}

function resolveAgentGroupAgents(anchorPayload: StageControlAnchorPayload): string[] {
  const targetAgent = normalizeAgentId(anchorPayload.target_agent ?? '');
  if ((anchorPayload.execution_scope ?? '') === 'agent' && targetAgent) return [targetAgent];
  const requestedAgents = (anchorPayload.requested_agents ?? []).map(normalizeAgentId).filter(Boolean);
  if (requestedAgents.length) return sortAgents(requestedAgents);
  const payloadAgents = (anchorPayload.agents ?? []).map(normalizeAgentId).filter(Boolean);
  if (payloadAgents.length === 1) return sortAgents(payloadAgents);
  if (payloadAgents.length > 1) return ['workflow'];
  const phaseAgents = phaseToFallbackAgents(anchorPayload.phase ?? '');
  if (phaseAgents.length === 1) return sortAgents(phaseAgents);
  if (phaseAgents.length > 1) return ['workflow'];
  const stageAgents = stageIdToFallbackAgents(anchorPayload.stage_id ?? '');
  if (stageAgents.length === 1) return sortAgents(stageAgents);
  if (stageAgents.length > 1) return ['workflow'];
  return sortAgents(anchorToFallbackAgents(anchorPayload.anchor));
}

function resolveAgentGroupKey(anchorPayload: StageControlAnchorPayload): AgentGroupKey {
  return resolveAgentGroupAgents(anchorPayload)[0] ?? 'workflow';
}

function sortAgents(agents: string[]): string[] {
  const uniqueAgents = [...new Set(agents)];
  return uniqueAgents.sort((left, right) => agentOrderIndex(left) - agentOrderIndex(right));
}

function agentOrderIndex(agentOrGroup: string): number {
  const index = AGENT_GROUP_ORDER.indexOf(agentOrGroup);
  return index >= 0 ? index : AGENT_GROUP_ORDER.length;
}

function buildAgentDescription(agents: string[], anchors: StageControlAnchorPayload[]): string {
  if (agents.includes('workflow')) return 'Unclassified workflow controls.';
  const phases = [...new Set(anchors.map((anchor) => anchor.phase).filter(Boolean))];
  const agentLabel = agents.map(formatAgentName).join(' + ');
  return phases.length ? `${agentLabel} controls for ${phases.join(' / ')}.` : `${agentLabel} controls.`;
}

function buildAgentGroups(
  anchors: StageControlAnchorPayload[],
): StageAgentGroupDefinition[] {
  const grouped = new Map<AgentGroupKey, { agents: string[]; anchors: StageControlAnchorPayload[] }>();
  for (const anchor of anchors) {
    const agents = resolveAgentGroupAgents(anchor);
    for (const agent of agents) {
      const key = agent || 'workflow';
      const current = grouped.get(key) ?? { agents: [key], anchors: [] };
      current.anchors.push(anchor);
      grouped.set(key, current);
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => agentOrderIndex(left) - agentOrderIndex(right))
    .map(([key, value]) => {
      const sortedAnchors = [...value.anchors].sort((left, right) => stageFlowIndex(left.anchor) - stageFlowIndex(right.anchor));
      return {
        key,
        label: value.agents.map(formatAgentName).join(' + '),
        description: buildAgentDescription(value.agents, sortedAnchors),
        agents: value.agents,
        anchors: sortedAnchors,
      };
    });
}

function stageFlowIndex(anchor: StageControlAnchor): number {
  const index = STAGE_FLOW.indexOf(anchor);
  return index >= 0 ? index : STAGE_FLOW.length;
}

function confirmDangerousAction(message: string): boolean {
  if (typeof globalThis.confirm === 'function') {
    return globalThis.confirm(message);
  }
  return true;
}

function formatCompactList(values: string[], fallback: string): string {
  return values.length ? values.join(' -> ') : fallback;
}

function buildDangerousActionMessage(
  t: OperatorControlsTranslation,
  action: 'reset' | 'start',
  anchor: StageControlAnchorPayload,
): string {
  const snapshot = anchor.stage_snapshot;
  const preserved = (snapshot?.baseline_artifacts ?? []).map((item) => item.label).filter(Boolean);
  const removed = anchor.removal_preview.cleanup_summary;
  const replay = snapshot?.rerun_scope.replay_stages ?? [];
  const actionLabel = action === 'reset' ? t.confirmReset : t.confirmStart;
  const lines = [
    `${actionLabel} ${anchor.title} ?`,
    `${t.resetPreviewLead}: ${formatCompactList(preserved, t.noValue)}`,
    `${t.resetPreviewDelete}: ${formatCompactList(removed, t.nothingToClean)}`,
    `${t.resetPreviewReplay}: ${formatCompactList(replay, t.noValue)}`,
  ];
  if (action === 'start' && anchor.anchor === 'WAITING_FOR_USER_ASSETS') {
    lines.push(t.assetApprovalAutoStart);
  }
  return lines.join('\n');
}

export function resolveResetGddApprovalErrorMessage(error: unknown, operatorControlsEnabled: boolean, lang: Language = 'zh'): string {
  const typedError = error as ApiStatusError | null;
  if (!operatorControlsEnabled && typedError?.status === 404) {
    return resolveOperatorControlsTranslation(lang).capabilityDisabledHint;
  }
  if (typedError instanceof Error && typedError.message.trim()) {
    return typedError.message;
  }
  return resolveOperatorControlsTranslation(lang).resetFailed;
}

export function resolveStartStageAnchorErrorMessage(error: unknown, lang: Language = 'zh'): string {
  const typedError = error as ApiStatusError | null;
  if (typedError instanceof Error && typedError.message.trim()) {
    return typedError.message;
  }
  if (typedError?.status === 409) {
    return resolveOperatorControlsTranslation(lang).startRequiresCurrentAnchor;
  }
  return resolveOperatorControlsTranslation(lang).startFailed;
}

export function OperatorControlsPage({ projectId, projectName, lang, onBackToWorkspace }: OperatorControlsPageProps) {
  const { status, loadStatus, loadPhases, loadTasks } = useSystemStore();
  const { pendingReviews, projectStatus, loadPendingReviews, loadProjectStatus } = useProjectStore();
  const { showError, showSuccess } = useToast();
  const t = resolveOperatorControlsTranslation(lang);
  const operatorControlsEnabled = Boolean(status?.capabilities?.operator_controls_enabled);
  const stageControlEnabled = Boolean(status?.capabilities?.stage_control_enabled);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pollUntil, setPollUntil] = useState(0);
  const [stageControls, setStageControls] = useState<StageControlInspectPayload | null>(null);
  const [resettingAnchor, setResettingAnchor] = useState<StageControlAnchor | null>(null);
  const [startingAnchor, setStartingAnchor] = useState<StageControlAnchor | null>(null);
  const [selectedAnchor, setSelectedAnchor] = useState<StageControlAnchor | null>(null);
  const [activeAgentKey, setActiveAgentKey] = useState<AgentGroupKey | null>(null);

  const refreshDiagnostics = useCallback(async (options?: { silent?: boolean }) => {
    try {
      setIsRefreshing(true);
      const promises: Promise<unknown>[] = [
        loadStatus(),
        loadPhases(projectId),
        loadTasks(projectId),
        loadPendingReviews(projectId),
        loadProjectStatus(projectId),
      ];
      if (operatorControlsEnabled && stageControlEnabled) {
        promises.push(operatorControlsApi.getStageControls(projectId).then(setStageControls));
      } else {
        setStageControls(null);
      }
      await Promise.all(promises);
      if (!options?.silent) {
        showSuccess(t.diagnosticsRefreshed);
      }
    } catch (error) {
      console.error('Failed to refresh operator diagnostics:', error);
      showError(error instanceof Error ? error.message : t.diagnosticsRefreshFailed);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadPendingReviews, loadPhases, loadProjectStatus, loadStatus, loadTasks, projectId, showError, showSuccess, stageControlEnabled, t.diagnosticsRefreshFailed, t.diagnosticsRefreshed, operatorControlsEnabled]);

  useEffect(() => {
    refreshDiagnostics({ silent: true }).catch(console.error);
  }, [refreshDiagnostics]);

  useEffect(() => {
    if (pollUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      refreshDiagnostics({ silent: true }).catch(console.error);
      if (Date.now() >= pollUntil) {
        window.clearInterval(timer);
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [pollUntil, refreshDiagnostics]);

  const agentGroups = useMemo(
    () => buildAgentGroups(stageControls?.available_anchors ?? []),
    [stageControls?.available_anchors],
  );
  const preferredAgentKey = useMemo(() => {
    if (!agentGroups.length) return null;
    const stageCandidate = String(stageControls?.current_anchor ?? stageControls?.current_stage ?? '').trim();
    const currentAnchor = (
      (stageCandidate && stageControls?.available_anchors.some((anchor) => anchor.anchor === stageCandidate)
        ? stageCandidate
        : '') as StageControlAnchor | ''
    ) || selectedAnchor || agentGroups[0].anchors[0]?.anchor;
    if (!currentAnchor) return agentGroups[0].key;
    const currentAnchorPayload = stageControls?.available_anchors.find((anchor) => anchor.anchor === currentAnchor);
    const resolved = currentAnchorPayload
      ? resolveAgentGroupKey(currentAnchorPayload)
      : resolveAgentGroupKey({ anchor: currentAnchor } as StageControlAnchorPayload);
    return agentGroups.some((group) => group.key === resolved) ? resolved : agentGroups[0].key;
  }, [selectedAnchor, stageControls?.available_anchors, stageControls?.current_anchor, stageControls?.current_stage, agentGroups]);
  const effectiveAgentKey = useMemo(
    () => (activeAgentKey && agentGroups.some((group) => group.key === activeAgentKey) ? activeAgentKey : preferredAgentKey),
    [activeAgentKey, preferredAgentKey, agentGroups],
  );
  const activeAgentDefinition = useMemo(
    () => agentGroups.find((group) => group.key === effectiveAgentKey) ?? agentGroups[0] ?? null,
    [effectiveAgentKey, agentGroups],
  );
  const visibleAnchors = activeAgentDefinition?.anchors ?? [];

  useEffect(() => {
    if (!stageControls) return;
    const availableAnchors = stageControls.available_anchors.map((item) => item.anchor);
    if (!availableAnchors.length) return;
    if (selectedAnchor && availableAnchors.includes(selectedAnchor)) return;
    const currentAnchor = stageControls.current_anchor ?? stageControls.current_stage;
    setSelectedAnchor(availableAnchors.includes(currentAnchor as StageControlAnchor) ? currentAnchor as StageControlAnchor : availableAnchors[0]);
  }, [selectedAnchor, stageControls]);

  useEffect(() => {
    if (!agentGroups.length) return;
    const groupExists = agentGroups.some((group) => group.key === activeAgentKey);
    if ((!activeAgentKey || !groupExists) && preferredAgentKey) {
      setActiveAgentKey(preferredAgentKey);
      return;
    }
    const selectedStillVisible = selectedAnchor
      ? agentGroups.some((group) => group.key === effectiveAgentKey && group.anchors.some((anchor) => anchor.anchor === selectedAnchor))
      : false;
    if (!selectedStillVisible && effectiveAgentKey !== preferredAgentKey && preferredAgentKey) {
      setActiveAgentKey(preferredAgentKey);
    }
  }, [activeAgentKey, effectiveAgentKey, preferredAgentKey, selectedAnchor, agentGroups]);

  const selectedAnchorPayload = useMemo(
    () => stageControls?.available_anchors.find((item) => item.anchor === selectedAnchor) ?? stageControls?.available_anchors[0] ?? null,
    [selectedAnchor, stageControls],
  );
  const selectedSnapshot = selectedAnchorPayload?.stage_snapshot ?? null;

  const handleSelectAgent = useCallback((agent: string) => {
    const agentGroup = agentGroups.find((item) => item.key === agent);
    if (!agentGroup) return;
    setActiveAgentKey(agentGroup.key);
    const nextAnchor = agentGroup.anchors[0];
    if (nextAnchor) {
      setSelectedAnchor(nextAnchor.anchor);
    }
  }, [agentGroups]);

  const handleResetAnchor = async (anchorPayload: StageControlAnchorPayload) => {
    if (!operatorControlsEnabled || !stageControlEnabled) {
      showError(t.routesDisabled);
      return;
    }
    if (!confirmDangerousAction(buildDangerousActionMessage(t, 'reset', anchorPayload))) {
      return;
    }
    try {
      setResettingAnchor(anchorPayload.anchor);
      await operatorControlsApi.resetStageAnchor(projectId, anchorPayload.anchor);
      await refreshDiagnostics({ silent: true });
      showSuccess(`${t.resetSuccess} ${anchorPayload.title}`);
    } catch (error) {
      console.error('Failed to reset stage anchor:', error);
      showError(resolveResetGddApprovalErrorMessage(error, operatorControlsEnabled, lang));
    } finally {
      setResettingAnchor(null);
    }
  };

  const handleStartAnchor = async (anchorPayload: StageControlAnchorPayload) => {
    if (!operatorControlsEnabled || !stageControlEnabled) {
      showError(t.routesDisabled);
      return;
    }
    if (!confirmDangerousAction(buildDangerousActionMessage(t, 'start', anchorPayload))) {
      return;
    }
    try {
      setStartingAnchor(anchorPayload.anchor);
      await operatorControlsApi.startStageAnchor(projectId, anchorPayload.anchor);
      setPollUntil(Date.now() + 20000);
      await refreshDiagnostics({ silent: true });
      showSuccess(`${t.startSuccess} ${anchorPayload.title}`);
    } catch (error) {
      console.error('Failed to start stage anchor:', error);
      showError(resolveStartStageAnchorErrorMessage(error, lang));
    } finally {
      setStartingAnchor(null);
    }
  };

  const baselineRows = useMemo(
    () => (stageControls?.baseline_summary ?? []).map((item) => ({
      label: item.alias,
      value: [item.artifact_id, item.checkpoint_id, item.workspace_path].filter(Boolean).join(' · '),
    })),
    [stageControls],
  );

  const leftStatusRows = useMemo(
    () => [
      { label: t.pipelineStage, value: String(stageControls?.current_stage ?? projectStatus?.phase ?? '').trim() },
      { label: t.projectPhase, value: String(projectStatus?.phase ?? '').trim() },
      { label: t.approvalRequired, value: String(Boolean(projectStatus?.approval_required)) },
      { label: t.blocked, value: String(Boolean(projectStatus?.blocked)) },
      { label: t.nextAction, value: String(projectStatus?.next_action ?? '').trim() },
      { label: t.latestRun, value: [stageControls?.latest_run?.artifact_type, stageControls?.latest_run?.status, stageControls?.latest_run?.artifact_id].filter(Boolean).join(' · ') },
      {
        label: t.latestFailure,
        value: String(
          stageControls?.latest_failure?.error_message
          ?? (projectStatus?.last_resume_failure as Record<string, unknown> | null | undefined)?.error_message
          ?? projectStatus?.blocked_reason
          ?? '',
        ).trim(),
      },
      { label: t.activeGate, value: [stageControls?.active_gate?.gate_name, stageControls?.active_gate?.artifact_id].filter(Boolean).join(' · ') },
      { label: t.retryAvailable, value: String(Boolean(projectStatus?.can_retry_continue)) },
      { label: t.lastResumeStage, value: String(projectStatus?.last_resume_failure_stage ?? '').trim() },
      {
        label: t.lastResumeError,
        value: String(
          (projectStatus?.last_resume_failure as Record<string, unknown> | null | undefined)?.error_message
          ?? (stageControls?.last_resume_failure as Record<string, unknown> | null | undefined)?.error_message
          ?? '',
        ).trim(),
      },
    ],
    [projectStatus, stageControls, t],
  );

  const selectedSnapshotRows = useMemo(() => {
    if (!selectedSnapshot) return [];
    return [
      { label: t.latestRun, value: [selectedSnapshot.latest_run.title, selectedSnapshot.latest_run.status, selectedSnapshot.latest_run.artifact_id].filter(Boolean).join(' · ') },
      { label: t.latestFailure, value: [selectedSnapshot.latest_failure.error_message, selectedSnapshot.latest_failure.failed_at].filter(Boolean).join(' · ') },
      { label: t.activeGate, value: [selectedSnapshot.active_gate.gate_name, selectedSnapshot.active_gate.status, selectedSnapshot.active_gate.artifact_id].filter(Boolean).join(' · ') },
      { label: t.tokenCost, value: selectedSnapshot.token_cost_hint },
      { label: t.rerunScope, value: selectedSnapshot.rerun_scope.summary },
    ];
  }, [selectedSnapshot, t]);

  const selectedMemoryCleanupRows = useMemo(() => {
    const preview = selectedAnchorPayload?.memory_cleanup_preview ?? stageControls?.memory_cleanup_preview ?? null;
    if (!preview) return [];
    return [
      { label: 'Affected Stages', value: preview.affected_stages.join(' · ') },
      { label: 'Removable Memory', value: Object.entries(preview.removable_counts).map(([key, value]) => `${key}=${value}`).join(' · ') },
      { label: 'Residual Files', value: Object.entries(preview.file_counts ?? {}).map(([key, value]) => `${key}=${value}`).join(' · ') },
      { label: 'Conversation Summary', value: preview.clear_conversation_summary ? 'clear' : 'keep' },
      { label: 'Preserved Scope', value: preview.preserved_memory_scopes.join(' · ') },
      ...(preview.summary ?? []).map((value, index) => ({ label: `Summary ${index + 1}`, value })),
    ].filter((row) => row.value);
  }, [selectedAnchorPayload, stageControls?.memory_cleanup_preview]);

  const activeAgents = useMemo(
    () => activeAgentDefinition?.agents ?? [],
    [activeAgentDefinition],
  );
  const compactFailureText = String(
    selectedSnapshot?.latest_failure?.error_message
    || stageControls?.latest_failure?.error_message
    || projectStatus?.blocked_reason
    || '',
  ).trim();
  const compactGateText = [
    selectedSnapshot?.active_gate?.gate_name || stageControls?.active_gate?.gate_name,
    selectedSnapshot?.active_gate?.status || stageControls?.active_gate?.status,
    selectedSnapshot?.active_gate?.artifact_id || stageControls?.active_gate?.artifact_id,
  ].filter(Boolean).join(' · ');

  return (
    <div className="h-screen overflow-x-hidden overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.12),_transparent_32%),linear-gradient(180deg,_#fafaf9_0%,_#f4f4f5_55%,_#e4e4e7_100%)] px-6 py-8 text-zinc-950 dark:bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.14),_transparent_28%),linear-gradient(180deg,_#09090b_0%,_#111827_52%,_#18181b_100%)] dark:text-zinc-50">
      <div className="mx-auto max-w-7xl space-y-6 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">Operator Controls</div>
            <h1 className="mt-2 text-3xl font-black tracking-tight">{projectName}</h1>
            <div className="mt-2 font-mono text-xs text-zinc-600 dark:text-zinc-300">{projectId}</div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="rounded-full bg-zinc-900 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white dark:bg-zinc-100 dark:text-zinc-900">
                {stageControls?.current_stage || t.currentStageFallback}
              </div>
              {baselineRows[0]?.value ? (
                <div className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  {baselineRows[0].value}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onBackToWorkspace} className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white/80 px-4 py-2 text-sm font-bold text-zinc-900 transition-colors hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:hover:bg-zinc-900">
              <ArrowLeft className="h-4 w-4" />
              <span>{t.backToWorkspace}</span>
            </button>
            <button type="button" onClick={() => refreshDiagnostics()} disabled={isRefreshing} className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white/80 px-4 py-2 text-sm font-bold text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:hover:bg-zinc-900">
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? t.refreshing : t.refreshDiagnostics}</span>
            </button>
          </div>
        </div>

        {!operatorControlsEnabled ? (
          <div className="rounded-[2rem] border border-rose-300 bg-rose-50/90 p-6 dark:border-rose-900/70 dark:bg-rose-950/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-600 dark:text-rose-300" />
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-sm font-black uppercase tracking-[0.16em] text-rose-700 dark:text-rose-200">{t.operatorControlsDisabled}</div>
                  <div className="text-sm text-rose-800 dark:text-rose-100">{t.disabledDescription.replace('{projectId}', projectId)}</div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-rose-200 bg-white/60 px-4 py-4 dark:border-rose-900/70 dark:bg-zinc-950/35">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-rose-700 dark:text-rose-200">{t.enableSteps}</div>
                    <div className="mt-2 space-y-1 text-sm text-rose-900 dark:text-rose-50">
                      <div>1. 设置环境变量 `DEMIURGE_ENABLE_OPERATOR_CONTROLS=true`</div>
                      <div>2. 重启后端进程</div>
                      <div>3. 重新打开本页面</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-rose-200 bg-white/60 px-4 py-4 dark:border-rose-900/70 dark:bg-zinc-950/35">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-rose-700 dark:text-rose-200">{t.verifyStatus}</div>
                    <div className="mt-2 space-y-1 text-sm text-rose-900 dark:text-rose-50">
                      <div>检查 `/api/status` 中：</div>
                      <div className="font-mono text-[12px]">capabilities.operator_controls_enabled = true</div>
                      <div className="font-mono text-[12px]">capabilities.reset_gdd_approval_enabled = true</div>
                      <div className="font-mono text-[12px]">capabilities.stage_control_enabled = true</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <section className="space-y-6">
          <div className="rounded-[2rem] border border-zinc-200 bg-white/75 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/65 dark:shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">{t.stageFlows}</div>
              <div className="rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {activeAgentDefinition?.label ?? t.currentStageFallback}
              </div>
            </div>
            <StageAgentDropdown
              groups={agentGroups}
              activeAgent={effectiveAgentKey ?? ''}
              currentAnchor={String(stageControls?.current_anchor ?? stageControls?.current_stage ?? '')}
              label={t.agentSelector}
              onSelectAgent={handleSelectAgent}
            />
            {activeAgents.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {activeAgents.map((agent) => (
                  <span key={agent} className="rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {agent}
                  </span>
                ))}
              </div>
            ) : null}
            {compactFailureText ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/25 dark:text-rose-100">
                {compactFailureText}
              </div>
            ) : null}
            {compactGateText ? (
              <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50/85 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200">
                {compactGateText}
              </div>
            ) : null}
            <div className="mt-6">
              <StageTimelineList
                currentTitle={t.currentAnchorReadyToStart}
                currentStageFallback={t.currentStageFallback}
                anchors={visibleAnchors}
                selectedAnchor={selectedAnchorPayload}
                currentStage={String(stageControls?.current_anchor ?? stageControls?.current_stage ?? '')}
                availableLabel={t.available}
                blockedLabel={t.blockedState}
                currentAnchorReadyToStart={t.currentAnchorReadyToStart}
                assetApprovalRealGateReady={t.assetApprovalRealGateReady}
                assetApprovalSyntheticReady={t.assetApprovalSyntheticReady}
                assetApprovalMissingContext={t.assetApprovalMissingContext}
                startRequiresCurrentAnchor={t.startRequiresCurrentAnchor}
                resetFirstToStart={t.resetFirstToStart}
                startNotAvailableForThisAnchor={t.startNotAvailableForThisAnchor}
                resetToHere={t.resetToHere}
                resetting={t.resetting}
                startFromHere={t.startFromHere}
                starting={t.starting}
                resettingAnchor={resettingAnchor}
                startingAnchor={startingAnchor}
                onSelectAnchor={setSelectedAnchor}
                onResetAnchor={(anchor) => void handleResetAnchor(anchor)}
                onStartAnchor={(anchor) => void handleStartAnchor(anchor)}
              />
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <DisclosurePanel title={t.diagnostics}>
            <StatusPanel
              title={t.currentStatus}
              pendingTitle={t.pendingUserReviews}
              noPendingReviews={t.noPendingReviews}
              statusRows={leftStatusRows}
              pendingReviews={pendingReviews as PendingUserReviewItem[]}
            />
          </DisclosurePanel>
          <DisclosurePanel title={t.selectedControlDetails}>
            <StageSnapshotPanel
              title={t.currentDataPanel}
              noValue={t.noValue}
              preservedBaselines={t.preservedBaselines}
              derivedArtifacts={t.derivedArtifacts}
              removalPreview={t.removalPreview}
              memoryCleanupTitle={t.memoryCleanup}
              stageDriver={t.stageDriver}
              baselineSummary={t.baselineSummary}
              baselineRows={baselineRows}
              selectedAnchor={selectedAnchorPayload}
              selectedSnapshot={selectedSnapshot}
              snapshotRows={selectedSnapshotRows}
              memoryCleanupRows={selectedMemoryCleanupRows}
              operationLog={stageControls?.operation_log ?? []}
            />
          </DisclosurePanel>
        </div>
      </div>
    </div>
  );
}
