import { type ButtonHTMLAttributes } from 'react';

const cx = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ');

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    size?: 'sm' | 'default';
};

export function Switch({
    checked = false,
    disabled = false,
    onCheckedChange,
    onClick,
    size = 'default',
    className,
    ...props
}: SwitchProps) {
    const isSmall = size === 'sm';

    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            data-state={checked ? 'checked' : 'unchecked'}
            data-disabled={disabled ? '' : undefined}
            onClick={(event) => {
                onClick?.(event);
                if (!event.defaultPrevented) onCheckedChange?.(!checked);
            }}
            className={cx(
                'relative shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 disabled:cursor-not-allowed disabled:opacity-50',
                checked ? 'border-emerald-300/60 bg-emerald-400' : 'border-white/15 bg-white/[0.04]',
                isSmall ? 'h-6 w-10' : 'h-7 w-12',
                className,
            )}
            {...props}
        >
            <span
                aria-hidden="true"
                className={cx(
                    'absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-zinc-50 shadow-sm transition-transform',
                    isSmall ? 'h-4 w-4' : 'h-5 w-5',
                    checked ? (isSmall ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0',
                )}
            />
        </button>
    );
}
