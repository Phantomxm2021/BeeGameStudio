import type { ProjectTask } from '../../../store/systemStore';
import type {
    PermissionDisplayModel,
} from '../../../viewModels/displayModels';

export const TASK_STATUS_COLORS: Record<string, string> = {
    'released': 'border border-[var(--success)]/40 bg-[var(--surface-2)] text-[var(--success)]',
    'in_progress': 'border border-[var(--selection)]/40 bg-[var(--surface-2)] text-[var(--selection)] animate-pulse',
    'in_review': 'border border-[var(--warning)]/40 bg-[var(--surface-2)] text-[var(--warning)]',
    'verified': 'border border-[var(--success)]/40 bg-[var(--surface-2)] text-[var(--success)]',
    'failed': 'border border-[var(--destructive)]/40 bg-[var(--surface-2)] text-[var(--destructive)]',
    'pending': 'bg-[var(--surface-3)] text-[var(--text-secondary)]',
    'to_do': 'bg-[var(--surface-3)] text-[var(--text-secondary)]',
    'blocked': 'border border-[var(--destructive)]/40 bg-[var(--surface-2)] text-[var(--destructive)]',
    'invalidated': 'border border-[var(--warning)]/40 bg-[var(--surface-2)] text-[var(--warning)]',
    'changes_requested': 'border border-[var(--selection)]/40 bg-[var(--surface-2)] text-[var(--selection)]',
    'paused': 'bg-[var(--surface-3)] text-[var(--text-secondary)]',
};

export const getCanonicalTaskStatus = (task: Pick<ProjectTask, 'task_status' | 'lifecycle_status'>): string => {
    return String(task.lifecycle_status || task.task_status || 'unknown').toLowerCase();
};

export const getTaskStatusLabel = (task: ProjectTask): string => {
    const status = getCanonicalTaskStatus(task);
    switch (status.toLowerCase()) {
        case 'in_review': return 'Reviewing';
        case 'verified':
            if (task.id?.toLowerCase().includes('generate_resource_manifest') || task.id === 'wp_4') {
                return 'Pending Upload';
            }
            return 'Verified';
        case 'in_progress': return 'Active';
        case 'released': return 'Released';
        case 'changes_requested': return 'Changes Req';
        case 'invalidated': return 'Invalidated';
        case 'to_do': return 'Planned';
        default: return status;
    }
};

type PermissionLike = PermissionDisplayModel | undefined | null;
export const isBeeGamePermission = (permission: PermissionLike): boolean => {
    if (!permission) return false;
    return permission.type === 'BEEGAME_PERMISSION';
};

export const formatPermissionTitle = (permission: PermissionLike): string => {
    if (!permission) return 'Pending permission';
    return permission.title || 'BeeGame permission';
};

export const formatBeeGamePermissionSummary = (permission: PermissionLike): string => {
    if (!permission) return 'BeeGame is waiting for a permission decision.';
    const artifact = permission.artifact || {};
    const content = String(artifact.content || '').trim();
    const input = artifact.input && typeof artifact.input === 'object'
        ? artifact.input as Record<string, unknown>
        : {};
    const command = String(input.command || '').trim();
    const path = String(input.path || input.file_path || input.notebook_path || '').trim();
    const target = command || compactPermissionPath(path);
    if (content.includes('was blocked') && content.includes('allowed working directories')) {
        return `${content} This is a workspace boundary. Change the session workspace if BeeGame should operate there.`;
    }
    if (target) {
        return `BeeGame requests ${permission.title || 'tool access'}:\n${target}`;
    }
    return content || 'BeeGame is waiting for a tool permission decision.';
};

const compactPermissionPath = (path: string): string => {
    if (!path) return '';
    const normalizedPath = path.replace(/\/+$/, '');
    const parts = normalizedPath.split('/').filter(Boolean);
    if (parts.length <= 5) return normalizedPath;
    return `.../${parts.slice(-4).join('/')}`;
};

export const formatPermissionSummary = (permission: PermissionLike): string => {
    return formatBeeGamePermissionSummary(permission);
};
