import { X } from 'lucide-react';
import { Button } from '../beui/project-button';

export function CloseIconButton({
  label,
  onClick,
  className,
  disabled,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full ${className ?? ''}`}
    >
      <X className="size-4" aria-hidden="true" />
    </Button>
  );
}
