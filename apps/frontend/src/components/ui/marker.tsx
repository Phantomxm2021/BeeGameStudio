import type { ComponentProps } from 'react';

const cx = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(' ');

type MarkerVariant = 'default' | 'separator' | 'border';

type MarkerProps = ComponentProps<'div'> & {
    variant?: MarkerVariant;
};

const markerVariantClassName = (variant: MarkerVariant) => {
    if (variant === 'separator') {
        return 'before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-white/10 after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-white/10';
    }
    if (variant === 'border') return 'border-b border-white/10 pb-2';
    return '';
};

export function Marker({ className, variant = 'default', ...props }: MarkerProps) {
    return (
        <div
            data-slot="marker"
            data-variant={variant}
            className={cx(
                "group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-sm text-muted-foreground [&_svg:not([class*='size-'])]:size-4",
                markerVariantClassName(variant),
                className,
            )}
            {...props}
        />
    );
}

export function MarkerIcon({ className, ...props }: ComponentProps<'span'>) {
    return (
        <span
            data-slot="marker-icon"
            aria-hidden="true"
            className={cx('size-4 shrink-0 [&_svg:not([class*=size-])]:size-4', className)}
            {...props}
        />
    );
}

export function MarkerContent({ className, ...props }: ComponentProps<'span'>) {
    return (
        <span
            data-slot="marker-content"
            className={cx('min-w-0 break-words [overflow-wrap:anywhere]', className)}
            {...props}
        />
    );
}
