import type { LucideIcon } from 'lucide-react';

export function ArtifactEmptyCard({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
    return <div data-testid="artifact-empty-card" className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-6 text-center text-[var(--text-muted)]">
        <Icon className="size-6" aria-hidden="true" />
        <p className="type-footnote">{message}</p>
    </div>;
}
