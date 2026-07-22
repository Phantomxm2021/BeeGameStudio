import { CheckCircle2, AlertCircle, type LucideIcon } from 'lucide-react';

type ApprovalAction = 'approve' | 'revise' | 'reject';

export interface ApprovalCardState {
    gateId: string | null;
    action: ApprovalAction | null;
    phase: 'idle' | 'submitting' | 'awaiting_runtime' | 'failed';
    message: string;
}

interface ApprovalActionConfig {
    action: ApprovalAction;
    label: string;
    onClick: () => void;
    tone?: 'approve' | 'revise' | 'reject';
}

interface ApprovalActionCardProps {
    gateId: string;
    title: string;
    description: string;
    tone: 'approval' | 'revision' | 'clarification';
    approvalState: ApprovalCardState;
    actions: ApprovalActionConfig[];
    pendingMessage?: string;
    failedMessage?: string;
    className?: string;
}

const CARD_TONES = {
    approval: {
        card: 'border-emerald-200 bg-emerald-50/90 dark:border-emerald-900/50 dark:bg-emerald-950/20',
        icon: 'text-emerald-500',
        title: 'text-emerald-600 dark:text-emerald-300',
        body: 'text-emerald-950/85 dark:text-emerald-100/85',
        Icon: CheckCircle2,
    },
    revision: {
        card: 'border-rose-200 bg-rose-50/90 dark:border-rose-900/50 dark:bg-rose-950/20',
        icon: 'text-rose-500',
        title: 'text-rose-600 dark:text-rose-300',
        body: 'text-rose-950/85 dark:text-rose-100/85',
        Icon: AlertCircle,
    },
    clarification: {
        card: 'border-amber-200 bg-amber-50/90 dark:border-amber-900/50 dark:bg-amber-950/20',
        icon: 'text-amber-500',
        title: 'text-amber-600 dark:text-amber-300',
        body: 'text-amber-950/85 dark:text-amber-100/85',
        Icon: AlertCircle,
    },
} as const;

const ACTION_TONES: Record<NonNullable<ApprovalActionConfig['tone']>, { button: string; shadow: string; Icon: LucideIcon }> = {
    approve: {
        button: 'bg-emerald-600 hover:bg-emerald-500 text-white',
        shadow: 'shadow-emerald-950/15 dark:shadow-emerald-950/40',
        Icon: CheckCircle2,
    },
    revise: {
        button: 'bg-rose-600 hover:bg-rose-500 text-white',
        shadow: 'shadow-rose-950/15 dark:shadow-rose-950/40',
        Icon: AlertCircle,
    },
    reject: {
        button: 'bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900',
        shadow: 'shadow-zinc-950/15 dark:shadow-black/40',
        Icon: AlertCircle,
    },
};

export const isApprovalActionPending = (
    approvalState: ApprovalCardState,
    gateId: string,
    action: ApprovalAction,
): boolean => (
    approvalState.gateId === gateId &&
    approvalState.action === action &&
    (approvalState.phase === 'submitting' || approvalState.phase === 'awaiting_runtime')
);

export const isApprovalActionFailed = (
    approvalState: ApprovalCardState,
    gateId: string,
    action: ApprovalAction,
): boolean => (
    approvalState.gateId === gateId &&
    approvalState.action === action &&
    approvalState.phase === 'failed'
);

export function ApprovalActionCard({
    gateId,
    title,
    description,
    tone,
    approvalState,
    actions,
    pendingMessage,
    failedMessage,
    className = '',
}: ApprovalActionCardProps) {
    const palette = CARD_TONES[tone];
    const Icon = palette.Icon;
    const activePending = actions.some((action) => isApprovalActionPending(approvalState, gateId, action.action));
    const activeFailed = actions.some((action) => isApprovalActionFailed(approvalState, gateId, action.action));
    const visiblePendingMessage = activePending ? (pendingMessage || approvalState.message) : '';
    const visibleFailedMessage = activeFailed ? (failedMessage || approvalState.message) : '';
    const containerClasses = `w-full max-w-full overflow-hidden rounded-3xl border border-white/15 bg-black/25 p-4 text-zinc-100 backdrop-blur-2xl pointer-events-auto ${className}`.trim();
    const descriptionClasses = 'type-callout whitespace-pre-wrap break-words text-zinc-300 [overflow-wrap:anywhere]';
    const actionGridClasses = 'grid w-full grid-cols-1 gap-2.5 min-[360px]:grid-cols-2';
    const actionButtonClasses = 'type-button flex min-h-[2rem] min-w-0 w-full items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-center transition-all duration-200 shadow-sm disabled:cursor-not-allowed disabled:opacity-55';
    const iconShellClasses = 'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300';
    const contentStackClasses = 'flex flex-col gap-3 sm:flex-col sm:items-center sm:justify-between';

    return (
        <div className={containerClasses}>
            <div className={contentStackClasses}>
                <div className="flex w-full min-w-0 items-start gap-3 overflow-hidden">
                    <div className={iconShellClasses}>
                        <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1 overflow-hidden">
                        <div className="type-caption-1 break-words text-zinc-100 [overflow-wrap:anywhere]">
                            {title}
                        </div>
                        <p className={descriptionClasses}>
                            {description}
                        </p>
                    </div>
                </div>

                <div className={actionGridClasses}>
                    {actions.map((action) => {
                        const actionTone = ACTION_TONES[action.tone || (action.action === 'approve' ? 'approve' : action.action === 'revise' ? 'revise' : 'reject')];
                        const ActionIcon = actionTone.Icon;
                        const disabled = isApprovalActionPending(approvalState, gateId, action.action);

                        return (
                            <button
                                key={action.action}
                                type="button"
                                onClick={action.onClick}
                                disabled={disabled}
                                className={`${actionButtonClasses} ${actionTone.button} ${actionTone.shadow}`}
                            >
                                <ActionIcon className="h-4 w-4 shrink-0" />
                                <span className="min-w-0 truncate">
                                    {action.label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {visiblePendingMessage ? (
                <div className="type-footnote mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-zinc-300"
                >
                    {visiblePendingMessage}
                </div>
            ) : null}

            {visibleFailedMessage ? (
                <div className="type-footnote mt-3 rounded-2xl border border-rose-300/20 bg-rose-400/[0.08] px-3.5 py-2.5 text-rose-200"
                >
                    {visibleFailedMessage}
                </div>
            ) : null}
        </div>
    );
}
