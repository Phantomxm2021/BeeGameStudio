import { useEffect, useRef, useState } from 'react';
import { api } from '../../../services/api';
import type { TaskRecoveryStatus } from '../../../services/beeGameAdapter';

/** Reads host ownership facts, not Chat's reconstructed idle/running label.
 * Only the explicit recovery button mutates anything; it never continues. */
export function WorkflowRecoveryNotice({ projectId, lang, refreshKey, onBlockedChange }: {
    projectId: string; lang: string; refreshKey: string; onBlockedChange: (blocked: boolean) => void;
}) {
    const [status, setStatus] = useState<TaskRecoveryStatus | null>(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [recovering, setRecovering] = useState(false);
    const [revision, setRevision] = useState(0);
    const mounted = useRef(false);
    const zh = lang.startsWith('zh');
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const read = async () => {
            try {
                const next = await api.getTaskRecovery(projectId);
                if (cancelled) return;
                setStatus(next); setError(''); setSuccess(false); onBlockedChange(Boolean(next));
                if (next?.state === 'stopping') timer = setTimeout(() => void read(), 1000);
            } catch (error) {
                if (!cancelled) { setSuccess(false); setError(error instanceof Error ? error.message : String(error)); onBlockedChange(true); }
            }
        };
        void read();
        return () => { cancelled = true; clearTimeout(timer); };
    }, [projectId, refreshKey, revision, onBlockedChange]);
    const recover = async () => {
        setRecovering(true); setError('');
        try {
            const result = await api.recoverTask({ project_id: projectId });
            if (!mounted.current) return;
            if (!result.paused) throw new Error(zh ? '未确认保持暂停；没有继续任务。' : 'Pause was not confirmed; no task was continued.');
            setStatus(null); setSuccess(true); onBlockedChange(false);
        } catch (error) {
            if (mounted.current) setError(error instanceof Error ? error.message : String(error));
        } finally { if (mounted.current) setRecovering(false); }
    };
    if (!status && !error && !success) return null;
    return <div role="status" className="border-b border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)]">
        <p>{success ? (zh ? '遗留执行占用已清理，任务保持暂停。请明确继续后再执行。' : 'Previous execution settled. The task remains paused; continue explicitly when ready.') :
            status ? (zh ? status.message : 'Previous execution has not settled. Recovery only releases ownership; it does not continue the task.') :
                (zh ? '无法读取执行状态，未执行恢复。' : 'Execution state is unavailable. No recovery was performed.')}</p>
        {status && <p className="mt-1 text-xs text-[var(--text-muted)]">{status.code}</p>}
        {error && <p role="alert" className="mt-1">{error}</p>}
        <div className="mt-2 flex gap-3">
            {status?.state === 'recoverable' && <button type="button" disabled={recovering} onClick={() => void recover()}>
                {recovering ? (zh ? '清理中…' : 'Settling…') : (zh ? '清理遗留执行占用' : 'Settle previous execution')}
            </button>}
            {!success && <button type="button" disabled={recovering} onClick={() => setRevision(value => value + 1)}>
                {zh ? '重新检查' : 'Check again'}
            </button>}
        </div>
    </div>;
}
