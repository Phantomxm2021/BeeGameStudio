import { type ReactNode, useEffect, useRef, useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';

export interface UserAccountMenuItem {
    key: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
}

interface UserAccountMenuProps {
    ariaLabel: string;
    className?: string;
    isTransitioning?: boolean;
    isActive?: boolean;
    currentUserId?: string;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
    creditBalance?: number;
    fallbackUserLabel: string;
    signOutLabel: string;
    items: UserAccountMenuItem[];
    onOpenLogin: () => void;
    onSignOut?: () => void;
}

export function UserAccountMenu({
    ariaLabel,
    className = '',
    isTransitioning = false,
    isActive = false,
    currentUserId,
    currentUserDisplayName,
    currentUserEmail,
    currentUserAvatarUrl,
    creditBalance,
    fallbackUserLabel,
    signOutLabel,
    items,
    onOpenLogin,
    onSignOut,
}: UserAccountMenuProps) {
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [avatarFailed, setAvatarFailed] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const userLabel = currentUserDisplayName || currentUserEmail || (currentUserId ? fallbackUserLabel : undefined);
    const userInitial = getUserInitial(userLabel);

    useEffect(() => {
        setAvatarFailed(false);
    }, [currentUserAvatarUrl]);

    useEffect(() => {
        if (isUserMenuOpen) setAvatarFailed(false);
    }, [isUserMenuOpen]);

    useEffect(() => {
        if (!isUserMenuOpen) return undefined;
        const handlePointerDown = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setIsUserMenuOpen(false);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [isUserMenuOpen]);

    const handleUserButtonClick = () => {
        if (!currentUserId) {
            onOpenLogin();
            return;
        }
        setIsUserMenuOpen((value) => !value);
    };

    const handleItemClick = (item: UserAccountMenuItem) => {
        setIsUserMenuOpen(false);
        item.onClick();
    };

    const handleSignOut = () => {
        setIsUserMenuOpen(false);
        onSignOut?.();
    };

    return (
        <div
            ref={containerRef}
            className={`${className} transition-opacity duration-200 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`.trim()}
        >
            <button
                type="button"
                aria-label={ariaLabel}
                aria-haspopup="menu"
                aria-expanded={currentUserId ? isUserMenuOpen : undefined}
                data-avatar-surface="outline"
                onClick={handleUserButtonClick}
                className={`relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/25 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-[border-color,background-color,transform] duration-150 hover:scale-105 hover:border-white/50 hover:bg-white/5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${isActive || isUserMenuOpen ? 'border-emerald-300/60 bg-white/5' : ''}`}
            >
                {currentUserId ? (
                    currentUserAvatarUrl && !avatarFailed ? (
                        <img
                            src={currentUserAvatarUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="absolute inset-0 h-full w-full rounded-full object-cover"
                            onLoad={() => setAvatarFailed(false)}
                            onError={() => setAvatarFailed(true)}
                        />
                    ) : (
                        <span className="type-footnote flex h-8 w-8 items-center justify-center rounded-full text-white">
                            {userInitial}
                        </span>
                    )
                ) : (
                    <UserRound className="h-6 w-6" />
                )}
            </button>

            {currentUserId && isUserMenuOpen ? (
                <div
                    role="menu"
                    aria-label={ariaLabel}
                    data-surface="frosted-glass"
                    data-style-source="pixelfork"
                    data-testid="beegame-user-settings-menu"
                    className="input-surface glass-panel absolute right-0 top-14 z-[140] w-64 overflow-hidden rounded-[28px] p-2 text-zinc-100 backdrop-blur-2xl"
                >
                    <div className="px-3 py-3">
                        <div className="type-headline truncate text-white">{userLabel}</div>
                        {currentUserEmail ? (
                            <div className="type-footnote mt-1 truncate text-zinc-400">{currentUserEmail}</div>
                        ) : null}
                        {typeof creditBalance === 'number' ? (
                            <div className="type-footnote mt-1 text-emerald-200">{creditBalance} credits</div>
                        ) : null}
                    </div>
                    {items.length > 0 ? <div className="my-1 h-px bg-white/10" /> : null}
                    {items.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            role="menuitem"
                            onClick={() => handleItemClick(item)}
                            className="type-button flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-zinc-200 transition hover:bg-white/10 hover:text-white"
                        >
                            {item.icon}
                            <span>{item.label}</span>
                        </button>
                    ))}
                    {onSignOut ? (
                        <>
                            <div className="my-1 h-px bg-white/10" />
                            <button
                                type="button"
                                role="menuitem"
                                onClick={handleSignOut}
                                className="type-button flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-zinc-300 transition hover:bg-white/10 hover:text-white"
                            >
                                <LogOut className="h-4 w-4" />
                                <span>{signOutLabel}</span>
                            </button>
                        </>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

const getUserInitial = (userId?: string): string => {
    const first = Array.from(userId?.trim() || 'U')[0] || 'U';
    return /^[a-z]$/i.test(first) ? first.toUpperCase() : first;
};
