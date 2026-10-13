import { Menu } from '@base-ui/react/menu';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const DropdownMenu = Menu.Root;

function DropdownMenuTrigger({ className, ...props }: ComponentProps<typeof Menu.Trigger>) {
  return <Menu.Trigger className={cn(className)} {...props} />;
}

function DropdownMenuContent({ className, align = 'start', positionerClassName, ...props }: ComponentProps<typeof Menu.Popup> & { align?: ComponentProps<typeof Menu.Positioner>['align']; positionerClassName?: string }) {
  return (
    <Menu.Portal>
      <Menu.Positioner align={align} sideOffset={6} className={cn('z-[240]', positionerClassName)}>
        <Menu.Popup
          className={cn(
            'min-w-44 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover)] p-1 text-[var(--text-primary)] shadow-lg outline-none',
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        'flex min-h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-highlighted:bg-[var(--surface-hover)] data-highlighted:text-[var(--text-primary)] data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('my-1 h-px bg-[var(--border)]', className)} {...props} />;
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger };
