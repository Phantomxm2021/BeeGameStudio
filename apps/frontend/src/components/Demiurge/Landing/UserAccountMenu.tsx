import { type ReactNode, useEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { ProfileAvatarButton } from '../ProfileAvatarButton';

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
    const containerRef = useRef<HTMLDivElement | null>(null);
    const userLabel = currentUserDisplayName || currentUserEmail || (currentUserId ? fallbackUserLabel : undefined);

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
            <ProfileAvatarButton
                type="button"
                aria-label={ariaLabel}
                aria-haspopup="menu"
                aria-expanded={currentUserId ? isUserMenuOpen : undefined}
                avatarUrl={currentUserAvatarUrl}
                userLabel={userLabel}
                anonymous={!currentUserId}
                onClick={handleUserButtonClick}
                className={isActive || isUserMenuOpen ? 'ring-2 ring-ring' : ''}
            />

            {currentUserId && isUserMenuOpen ? (
                <div
                    role="menu"
                    aria-label={ariaLabel}
                    data-testid="beegame-user-settings-menu"
                    className="absolute right-0 top-14 z-[140] w-64 overflow-hidden rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
                >
                    <div className="px-3 py-3">
                        <div className="truncate text-base font-semibold text-foreground">{userLabel}</div>
                        {currentUserEmail ? (
                            <div className="mt-1 truncate text-sm text-muted-foreground">{currentUserEmail}</div>
                        ) : null}
                        {typeof creditBalance === 'number' ? (
                            <div className="mt-1 text-sm text-primary">{creditBalance} credits</div>
                        ) : null}
                    </div>
                    {items.length > 0 ? <div className="my-1 h-px bg-border" /> : null}
                    {items.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            role="menuitem"
                            onClick={() => handleItemClick(item)}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-foreground transition hover:bg-accent"
                        >
                            {item.icon}
                            <span>{item.label}</span>
                        </button>
                    ))}
                    {onSignOut ? (
                        <>
                            <div className="my-1 h-px bg-border" />
                            <button
                                type="button"
                                role="menuitem"
                                onClick={handleSignOut}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
