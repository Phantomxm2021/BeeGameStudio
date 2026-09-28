import { forwardRef } from 'react';
import {
  Button as RegistryButton,
  type ButtonProps as RegistryButtonProps,
} from './registry/components/motion/button';
import { cn } from './registry/lib/utils';

type ProjectVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
type ProjectSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';

export type ButtonProps = Omit<RegistryButtonProps, 'variant' | 'size'> & {
  variant?: ProjectVariant;
  size?: ProjectSize;
};

const variantClass: Record<ProjectVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  outline: 'border border-border bg-transparent text-foreground hover:bg-muted',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
  destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
  link: 'text-primary underline-offset-4 hover:underline',
};

const sizeClass: Record<ProjectSize, string> = {
  default: 'h-8 gap-1.5 px-2.5 text-sm',
  xs: 'h-7 gap-1 rounded-md px-2 text-xs',
  sm: 'h-8 gap-1 rounded-md px-2.5 text-sm',
  lg: 'h-10 gap-1.5 px-3 text-sm',
  icon: 'size-8 rounded-full',
  'icon-xs': 'size-7 rounded-full',
  'icon-sm': 'size-8 rounded-full',
  'icon-lg': 'size-10 rounded-full',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'default', className, ...props },
  ref,
) {
  const registryVariant: RegistryButtonProps['variant'] =
    variant === 'default' || variant === 'destructive' || variant === 'link' ? 'primary' : variant;
  const registrySize: RegistryButtonProps['size'] =
    size === 'lg' || size === 'icon-lg' ? 'lg' : size === 'icon' || size === 'icon-xs' || size === 'icon-sm' ? 'icon' : size === 'sm' || size === 'xs' ? 'sm' : 'md';
  return (
    <RegistryButton
      ref={ref}
      variant={registryVariant}
      size={registrySize}
      className={cn('rounded-md', variantClass[variant], sizeClass[size], className)}
      {...props}
    />
  );
});
