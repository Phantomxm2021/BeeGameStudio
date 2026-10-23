import type {
    PermissionDisplayModel,
} from '../../../viewModels/displayModels';

type PermissionLike = PermissionDisplayModel | undefined | null;
export const isBeeGamePermission = (permission: PermissionLike): boolean => {
    if (!permission) return false;
    return permission.type === 'BEEGAME_PERMISSION';
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
