import { ChevronDown } from 'lucide-react';
import type { BeeGameThinkingMode } from '../../services/beeGameAdapter';

interface ThinkingModeSelectProps {
    label: string;
    value: BeeGameThinkingMode;
    options: Array<{ value: BeeGameThinkingMode; label: string }>;
    disabled?: boolean;
    onChange: (value: BeeGameThinkingMode) => void;
    className?: string;
}

export function ThinkingModeSelect({
    label,
    value,
    options,
    disabled = false,
    onChange,
    className = '',
}: ThinkingModeSelectProps) {
    return (
        <div className={className}>
            <div className="group relative flex h-10 w-fit shrink-0 items-center rounded-full px-2 transition-colors hover:bg-white/[0.06]">
                <select
                    aria-label={label}
                    value={value}
                    onChange={(event) => {
                        onChange(event.target.value as BeeGameThinkingMode);
                        event.currentTarget.blur();
                    }}
                    disabled={disabled}
                    className="type-button h-full w-auto cursor-pointer appearance-none bg-transparent pl-0 pr-5 text-zinc-500 outline-none transition-colors hover:text-zinc-300 focus-visible:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {options.map(option => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 transition-colors group-hover:text-zinc-100" aria-hidden="true" />
            </div>
        </div>
    );
}
