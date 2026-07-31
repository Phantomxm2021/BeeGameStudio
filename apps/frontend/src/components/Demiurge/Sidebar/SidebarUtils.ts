import type { ProjectTask } from '../../../store/systemStore';
import type {
    PermissionDisplayModel,
} from '../../../viewModels/displayModels';

export const TASK_STATUS_COLORS: Record<string, string> = {
    'released': 'bg-emerald-500 text-white',
    'in_progress': 'bg-blue-600 text-white shadow-[0_4px_12px_rgba(37,99,235,0.3)] animate-pulse',
    'in_review': 'bg-amber-500 text-white',
    'verified': 'bg-emerald-600 text-white',
    'failed': 'bg-rose-600 text-white',
    'pending': 'bg-zinc-400 text-white dark:bg-zinc-600',
    'to_do': 'bg-zinc-400 text-white dark:bg-zinc-600',
    'blocked': 'bg-red-600 text-white',
    'invalidated': 'bg-orange-600 text-white',
    'changes_requested': 'bg-fuchsia-600 text-white',
    'paused': 'bg-violet-600 text-white',
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
