import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './registry/components/motion/select';
import { cn } from './registry/lib/utils';

export type ProjectSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type ProjectSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly ProjectSelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
};

/** Product adapter around the canonical beUI Select primitives. */
export function ProjectSelect({
  value,
  onValueChange,
  options,
  placeholder,
  ariaLabel,
  title,
  disabled,
  className,
  triggerClassName,
  contentClassName,
}: ProjectSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled} className={className}>
      <SelectTrigger ariaLabel={ariaLabel} title={title} className={triggerClassName}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={cn('max-h-64 overflow-y-auto', contentClassName)}>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
