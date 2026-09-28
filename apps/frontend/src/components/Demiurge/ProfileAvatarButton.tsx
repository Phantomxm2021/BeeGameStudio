import { forwardRef, useState, type ComponentPropsWithoutRef } from 'react';
import { UserRound } from 'lucide-react';

interface ProfileAvatarButtonProps extends ComponentPropsWithoutRef<'button'> {
    avatarUrl?: string;
    userLabel?: string;
    anonymous?: boolean;
}

// Shared by the dashboard and landing page, including the image-error fallback.
export const ProfileAvatarButton = forwardRef<HTMLButtonElement, ProfileAvatarButtonProps>(
    function ProfileAvatarButton({ avatarUrl, userLabel = 'Profile', anonymous = false, className = '', children, ...props }, ref) {
        const [failedUrl, setFailedUrl] = useState<string>();
        const initial = Array.from(userLabel.trim() || 'Profile')[0].toUpperCase();

        return (
            <button ref={ref} type="button" {...props}
                className={`grid h-10 w-10 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full border-2 border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-secondary)] transition hover:border-[var(--ring)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed ${className}`}>
                {children ?? (anonymous ? <UserRound className="h-6 w-6" aria-hidden="true" /> : (
                    avatarUrl && avatarUrl !== failedUrl
                        ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full rounded-full object-cover" onError={() => setFailedUrl(avatarUrl)} />
                        : <span className="type-button font-semibold" aria-hidden="true">{initial}</span>
                ))}
            </button>
        );
    },
);
