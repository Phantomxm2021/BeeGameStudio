import { type ReactNode, useState } from 'react';
import { LogOut } from 'lucide-react';
import { ProfileAvatarButton } from '../ProfileAvatarButton';
import { MorphPopover, MorphPopoverContent, MorphPopoverTrigger } from '../../beui/registry/components/motion/popover-morph';

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
    const userLabel = currentUserDisplayName || currentUserEmail || (currentUserId ? fallbackUserLabel : undefined);

    const handleItemClick = (item: UserAccountMenuItem) => {
        setIsUserMenuOpen(false);
        item.onClick();
    };

    const handleSignOut = () => {
        setIsUserMenuOpen(false);
        onSignOut?.();
    };

    return (
        <div className={`${className} transition-opacity duration-200 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`.trim()}>
            {currentUserId ? (
                <MorphPopover open={isUserMenuOpen} onOpenChange={setIsUserMenuOpen}>
                    <MorphPopoverTrigger>
                        <ProfileAvatarButton
                            type="button"
                            aria-label={ariaLabel}
                            avatarUrl={currentUserAvatarUrl}
                            userLabel={userLabel}
                            anonymous={false}
                            className={isActive || isUserMenuOpen ? 'ring-2 ring-ring' : ''}
                        />
                    </MorphPopoverTrigger>
                    <MorphPopoverContent side="bottom" align="end" sideOffset={10} radius={12} className="z-[140] w-64 overflow-hidden rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg">
                        <div role="menu" aria-label={ariaLabel} data-testid="beegame-user-settings-menu" className="border-border bg-popover">
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
                    </MorphPopoverContent>
                </MorphPopover>
            ) : (
                <ProfileAvatarButton
                    type="button"
                    aria-label={ariaLabel}
                    avatarUrl={currentUserAvatarUrl}
                    userLabel={userLabel}
                    anonymous
                    onClick={onOpenLogin}
                    className={isActive ? 'ring-2 ring-ring' : ''}
                />
            )}
        </div>
    );
}
