import { DotsAvatar } from '../Demiurge/Landing/DotsAvatar';
import { useDailyAvatar } from '../Demiurge/Landing/useDailyAvatar';

type WorkspaceLoadingPageProps = {
  title?: string;
  description?: string;
  ariaLabel?: string;
  className?: string;
};

export function WorkspaceLoadingPage({
  title = '正在恢复项目工作区',
  description = '正在准备你的项目',
  ariaLabel = 'Restoring project workspace',
  className = '',
}: WorkspaceLoadingPageProps) {
  const avatarToken = useDailyAvatar();
  return (
    <div
      className={`flex min-h-screen items-center justify-center bg-background px-6 text-foreground ${className}`.trim()}
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="size-24"><DotsAvatar token={avatarToken} mood="thinking" label={title} /></div>
        <div aria-hidden="true" className="mt-6 h-0.5 w-40 overflow-hidden rounded-full bg-foreground/10">
          <span className="workspace-loading-beam block h-full w-1/3 rounded-full bg-foreground/70" />
        </div>
        <p className="mt-4 max-w-sm text-sm font-normal text-muted-foreground">{title}</p>
        {description ? <p className="mt-1 max-w-sm text-sm font-normal text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}
