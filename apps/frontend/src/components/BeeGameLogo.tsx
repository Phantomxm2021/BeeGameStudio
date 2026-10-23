import type { ImgHTMLAttributes } from 'react';

import { cn } from '../lib/utils';

export function BeeGameLogo({
  alt = '',
  className,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      src="/assets/bgs_logo.svg"
      alt={alt}
      className={cn('shrink-0 object-contain', className)}
      {...props}
    />
  );
}
